'use strict';
// modules/majorlogin.js

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const crypto   = require('crypto');
const tglog    = require('./tglog');
const keys     = require('./keys');

let MajorLoginRes = null;
let RAFIN         = null;

protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        MajorLoginRes = root.lookupType('freefire.MajorLoginRes');
        RAFIN         = root.lookupType('freefire.RAFIN');
        const msg = '[MAJORLOGIN] Proto loaded OK';
        console.log(msg);
        tglog.send(`✅ <b>Server Start</b>\n${msg}`);
    })
    .catch(err => {
        const msg = `[MAJORLOGIN] Proto load FAILED: ${err.message}`;
        console.error(msg);
        tglog.send(`❌ <b>Proto FAILED</b>\n${msg}`);
    });

function decodeReqFields(buf) {
    const out = {};
    try {
        const reader = protobuf.Reader.create(buf);
        while (reader.pos < reader.len) {
            const tag      = reader.uint32();
            const fieldNum = tag >>> 3;
            const wireType = tag & 0x7;
            if (wireType === 0) {
                // BUG FIX: simpan hasil reader.uint64() ke variable dulu
                // Kalau langsung: reader.uint64().toNumber ? reader.uint64()... → advance cursor 2x
                const long = reader.uint64();
                const val  = typeof long.toNumber === 'function' ? long.toNumber() : Number(long);
                if (fieldNum === 98) out.is_vpn = val;
            } else if (wireType === 2) {
                const bytes = reader.bytes();
                const str   = bytes.toString('utf8');
                if (fieldNum === 22)  out.open_id        = str;
                if (fieldNum === 23)  out.open_id_type   = str;
                if (fieldNum === 29)  out.access_token   = str.substring(0, 20) + '...';
                if (fieldNum === 57)  out.client_version = str;
                if (fieldNum === 83)  out.version_code   = str;
                if (fieldNum === 94)  out.extra_info     = str;
                if (fieldNum === 20)  out.client_ip      = str;
                if (fieldNum === 11)  out.network_type   = str;
            } else if (wireType === 5) { reader.fixed32();
            } else if (wireType === 1) { reader.fixed64();
            } else { break; }
        }
    } catch (_) {}
    return out;
}

function checkOpenId(openId) {
    if (!openId) return { allowed: false, reason: 'no_id' };
    if (process.env.KEY_VALIDATION !== '1') return { allowed: true };

    const db = keys.getDb();
    if (!db) return { allowed: true };

    const entry = Object.values(db).find(e => e.open_id === openId);
    if (!entry) return { allowed: false, reason: 'not_registered' };
    if (entry.status === 'revoked') return { allowed: false, reason: 'revoked' };
    if (Date.now() > entry.expires_at) return { allowed: false, reason: 'expired' };
    if (entry.status !== 'active') return { allowed: false, reason: entry.status };

    return { allowed: true, entry };
}

function sendUnverifiedResponse(res, openId) {
    const msg = `[c][ffffff]Account ID: [90EE90]${openId || 'UNKNOWN'} [ffffff]is [FF0000]Not Verified!\n\n[ffffff]Visit [c][00ffff]proxy-reza-kontolodon-memek-luu.up.railway.app/[ffffff] to Verify for FREE!`;
    res.status(400).set('Content-Type', 'text/plain').send(msg);
}

const BAN_REASON_MAP = {
    0: 'UNKNOWN', 1: 'IN_GAME_AUTO', 2: 'REFUND',
    3: 'OTHERS',  4: 'SKINMOD',      1014: 'IN_GAME_AUTO_NEW'
};
function formatBlacklist(bl) {
    if (!bl || !bl.ban_reason) return null;
    const reason = BAN_REASON_MAP[bl.ban_reason] || `code_${bl.ban_reason}`;
    const exp    = bl.expire_duration ? `${bl.expire_duration}s` : 'permanent';
    return `🚫 BAN: ${reason} | expire: ${exp}`;
}
function formatQueue(q) {
    if (!q || q.allow) return null;
    return `⏳ QUEUE pos:${q.queue_position} wait:${q.need_wait_secs}s`;
}

function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body     = req.body;
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');

        const reqInfo = Buffer.isBuffer(body) && body.length > 0 ? decodeReqFields(body) : {};
        const openId  = reqInfo.open_id || null;

        const check = checkOpenId(openId);
        if (!check.allowed) {
            const logMsg = `🔒 <b>MajorLogin BLOCKED</b>\n`
                + `👤 open_id: <code>${openId || 'n/a'}</code>\n`
                + `🌐 ip: ${clientIp}\n`
                + `❌ reason: ${check.reason}`;
            console.log(`[MAJORLOGIN] BLOCKED open_id=${openId} reason=${check.reason} ip=${clientIp}`);
            tglog.send(logMsg);
            return sendUnverifiedResponse(res, openId);
        }

        const options = {
            hostname: 'loginbp.ggpolarbear.com',
            path:     '/MajorLogin',
            method:   'POST',
            headers: {
                ...req.headers,
                'host':           'loginbp.ggpolarbear.com',
                'content-length': Buffer.isBuffer(body) ? body.length : 0
            }
        };
        delete options.headers['transfer-encoding'];

        const proxyReq = https.request(options, (proxyRes) => {
            const chunks = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
                const buf = Buffer.concat(chunks);

                if (!MajorLoginRes) {
                    console.warn('[MAJORLOGIN] Proto not ready, passthrough');
                    tglog.send('⚠️ [MAJORLOGIN] Proto not ready, passthrough');
                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
                    return res.end(buf);
                }

                try {
                    const decoded = MajorLoginRes.decode(buf);
                    const obj     = MajorLoginRes.toObject(decoded, { defaults: true });

                    const keyLen = (obj.key && obj.key.length) ? obj.key.length : 0;
                    const ivLen  = (obj.iv  && obj.iv.length)  ? obj.iv.length  : 0;

                    let rafinObj = null;
                    try { rafinObj = RAFIN.toObject(RAFIN.decode(buf), { defaults: true }); } catch (_) {}

                    let modified = false;
                    if (keyLen === 0) { obj.key = crypto.randomBytes(16); modified = true; }
                    if (ivLen  === 0) { obj.iv  = crypto.randomBytes(16); modified = true; }

                    const uid = obj.account_uid || rafinObj?.account_id || '?';

                    // BUG FIX: persist last_uid + last_login ke file via updateLoginInfo
                    // (versi updated hanya mutasi in-memory check.entry yang tidak di-save)
                    if (openId && uid !== '?') keys.updateLoginInfo(openId, String(uid));

                    const status = modified ? '🔑 KEY/IV INJECTED' : '✅ LOGIN OK';
                    const lines  = [`<b>MajorLogin — ${status}</b>`, ''];
                    lines.push(`👤 uid: <code>${uid}</code>`);
                    lines.push(`🔑 open_id: <code>${openId || '?'}</code>`);
                    lines.push(`🌏 region: ${obj.region || rafinObj?.lock_region || '?'}`);
                    if (rafinObj?.ip_region) lines.push(`📍 ip_region: ${rafinObj.ip_region}`);
                    if (rafinObj?.ip_city)   lines.push(`🏙 ip_city: ${rafinObj.ip_city}`);
                    lines.push(`🌐 client_ip: ${clientIp}`);
                    if (obj.token)            lines.push(`🎫 token: <code>${obj.token.substring(0, 24)}...</code>`);
                    if (rafinObj?.server_url) lines.push(`🔗 server: ${rafinObj.server_url}`);
                    if (rafinObj?.ttl)        lines.push(`⏱ ttl: ${rafinObj.ttl}s`);
                    lines.push('');
                    lines.push(`🔐 key: ${keyLen}B${modified && keyLen === 0 ? ' → injected' : ''}`);
                    lines.push(`🔐 iv:  ${ivLen}B${modified && ivLen  === 0 ? ' → injected' : ''}`);
                    lines.push('', '<b>🛡 Anticheat</b>');
                    if (rafinObj?.emulator_score !== undefined) lines.push(`  emu_score: ${rafinObj.emulator_score}`);
                    if (reqInfo.is_vpn !== undefined)           lines.push(`  is_vpn: ${reqInfo.is_vpn}`);
                    if (reqInfo.network_type)                   lines.push(`  net: ${reqInfo.network_type}`);
                    if (reqInfo.client_version)                 lines.push(`  ver: ${reqInfo.client_version}`);
                    const banStr   = rafinObj?.blacklist   ? formatBlacklist(rafinObj.blacklist)   : null;
                    const queueStr = rafinObj?.queue_info  ? formatQueue(rafinObj.queue_info)       : null;
                    if (banStr)   { lines.push(''); lines.push(banStr); }
                    if (queueStr) { lines.push(''); lines.push(queueStr); }

                    console.log(`[MAJORLOGIN] OK uid=${uid} open_id=${openId} region=${obj.region} key=${keyLen}B modified=${modified}`);
                    tglog.send(lines.join('\n'));

                    if (modified) {
                        const errMsg = MajorLoginRes.verify(obj);
                        if (errMsg) {
                            console.error('[MAJORLOGIN] Verify error:', errMsg);
                            tglog.send(`❌ Verify error: ${errMsg}`);
                            res.writeHead(proxyRes.statusCode, proxyRes.headers);
                            return res.end(buf);
                        }
                        const newBuf     = MajorLoginRes.encode(MajorLoginRes.create(obj)).finish();
                        const newHeaders = { ...proxyRes.headers, 'content-length': newBuf.length };
                        delete newHeaders['transfer-encoding'];
                        res.writeHead(proxyRes.statusCode, newHeaders);
                        return res.end(newBuf);
                    }

                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
                    res.end(buf);

                } catch (err) {
                    console.error('[MAJORLOGIN] Decode error:', err.message);
                    tglog.send(`❌ <b>Decode Error</b>\n${err.message}`);
                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
                    res.end(buf);
                }
            });
        });

        proxyReq.on('error', err => {
            console.error('[MAJORLOGIN] Proxy error:', err.message);
            tglog.send(`❌ <b>Proxy Error</b>\n${err.message}`);
            if (!res.headersSent) res.status(502).send('MajorLogin Proxy Error');
        });

        if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });

    console.log('[MAJORLOGIN] Active → loginbp.ggpolarbear.com');
}

module.exports = { init };
