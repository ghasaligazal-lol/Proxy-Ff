'use strict';
// modules/majorlogin.js
// Intercept MajorLogin — decode request & response proto
// Kirim field lengkap (uid, region, token, key/iv, blacklist, anticheat, dll) ke Telegram

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const crypto   = require('crypto');
const tglog    = require('./tglog');

let MajorLoginRes = null;
let RAFIN         = null;
let BlacklistRes  = null;

protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        MajorLoginRes = root.lookupType('freefire.MajorLoginRes');
        RAFIN         = root.lookupType('freefire.RAFIN');
        BlacklistRes  = root.lookupType('freefire.BlacklistInfoRes');
        const msg = '[MAJORLOGIN] Proto loaded OK (MajorLoginRes + RAFIN)';
        console.log(msg);
        tglog.send(`✅ <b>Server Start</b>\n${msg}`);
    })
    .catch(err => {
        const msg = `[MAJORLOGIN] Proto load FAILED: ${err.message}`;
        console.error(msg);
        tglog.send(`❌ <b>Proto FAILED</b>\n${msg}`);
    });

// ─── Helper: decode request proto (MajorLoginReq) secara raw ───────────────
// Kita ga punya .proto-nya di sini, tapi bisa baca field string penting
// Field 22=open_id, 23=open_id_type, 29=access_token, 98=is_vpn
function decodeReqFields(buf) {
    const out = {};
    try {
        // Pakai raw protobuf reader
        const reader = protobuf.Reader.create(buf);
        while (reader.pos < reader.len) {
            const tag      = reader.uint32();
            const fieldNum = tag >>> 3;
            const wireType = tag & 0x7;
            if (wireType === 0) {          // varint
                const val = reader.uint64().toNumber ? reader.uint64().toNumber() : Number(reader.uint64());
                if (fieldNum === 98) out.is_vpn = val; // is_vpn field
            } else if (wireType === 2) {   // length-delimited (string/bytes/submessage)
                const bytes = reader.bytes();
                const str   = bytes.toString('utf8');
                if (fieldNum === 22)  out.open_id       = str;
                if (fieldNum === 23)  out.open_id_type  = str;
                if (fieldNum === 29)  out.access_token  = str.substring(0, 20) + '...'; // truncate token
                if (fieldNum === 57)  out.client_version = str;
                if (fieldNum === 83)  out.version_code  = str;
                if (fieldNum === 94)  out.extra_info    = str;
                if (fieldNum === 20)  out.client_ip     = str;
                if (fieldNum === 11)  out.network_type  = str;
                if (fieldNum === 98)  out.is_vpn_str    = str;
            } else if (wireType === 5) {   // 32-bit
                reader.fixed32();
            } else if (wireType === 1) {   // 64-bit
                reader.fixed64();
            } else {
                break; // unknown wire type, stop
            }
        }
    } catch (_) { /* partial decode ok */ }
    return out;
}

// ─── Helper: format ban info ────────────────────────────────────────────────
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
    return `⏳ QUEUE pos:${q.queue_position} wait:${q.need_wait_secs}s full:${q.queue_is_full}`;
}

// ─── Main interceptor ───────────────────────────────────────────────────────
function init(app) {

    app.post('/MajorLogin', (req, res) => {
        const body    = req.body;
        const reqInfo = Buffer.isBuffer(body) && body.length > 0
            ? decodeReqFields(body)
            : {};

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

                    // ── Coba juga decode sebagai RAFIN (full response) ──
                    let rafinObj = null;
                    try {
                        const rafinDecoded = RAFIN.decode(buf);
                        rafinObj = RAFIN.toObject(rafinDecoded, { defaults: true });
                    } catch (_) {}

                    // ── Inject key/iv kalau null ──
                    let modified = false;
                    if (keyLen === 0) { obj.key = crypto.randomBytes(16); modified = true; }
                    if (ivLen  === 0) { obj.iv  = crypto.randomBytes(16); modified = true; }

                    // ── Build Telegram message ──
                    const lines = [];
                    const status = modified ? '🔑 KEY/IV INJECTED' : '✅ LOGIN OK';
                    lines.push(`<b>MajorLogin — ${status}</b>`);
                    lines.push('');

                    // Basic info
                    lines.push(`👤 uid: <code>${obj.account_uid || rafinObj?.account_id || '?'}</code>`);
                    lines.push(`🌏 region: ${obj.region || rafinObj?.lock_region || '?'}`);
                    if (rafinObj?.ip_region)   lines.push(`📍 ip_region: ${rafinObj.ip_region}`);
                    if (rafinObj?.ip_city)     lines.push(`🏙 ip_city: ${rafinObj.ip_city}`);

                    // Token & URL
                    if (obj.token)             lines.push(`🎫 token: <code>${obj.token.substring(0,24)}...</code>`);
                    if (rafinObj?.server_url)  lines.push(`🔗 server_url: ${rafinObj.server_url}`);
                    if (rafinObj?.tp_url)      lines.push(`🔗 tp_url: ${rafinObj.tp_url}`);
                    if (rafinObj?.ttl)         lines.push(`⏱ ttl: ${rafinObj.ttl}s`);

                    // Key/IV
                    lines.push('');
                    lines.push(`🔐 key: ${keyLen}B${modified && keyLen===0 ? ' → 16B (injected)' : ''}`);
                    lines.push(`🔐 iv:  ${ivLen}B${modified && ivLen===0  ? ' → 16B (injected)' : ''}`);

                    // Anticheat
                    lines.push('');
                    lines.push('<b>🛡 Anticheat</b>');
                    if (rafinObj?.emulator_score !== undefined) lines.push(`  emulator_score: ${rafinObj.emulator_score}`);
                    if (reqInfo.is_vpn !== undefined)           lines.push(`  is_vpn: ${reqInfo.is_vpn}`);
                    if (reqInfo.network_type)                   lines.push(`  network_type: ${reqInfo.network_type}`);
                    if (reqInfo.client_ip)                      lines.push(`  client_ip: ${reqInfo.client_ip}`);
                    if (reqInfo.extra_info)                     lines.push(`  extra_info: ${reqInfo.extra_info}`);

                    // Login info
                    if (reqInfo.open_id || reqInfo.open_id_type) {
                        lines.push('');
                        lines.push('<b>🔑 Login</b>');
                        if (reqInfo.open_id)       lines.push(`  open_id: <code>${reqInfo.open_id}</code>`);
                        if (reqInfo.open_id_type)  lines.push(`  open_id_type: ${reqInfo.open_id_type}`);
                        if (reqInfo.client_version) lines.push(`  version: ${reqInfo.client_version}`);
                    }

                    // Blacklist / ban
                    const banStr = rafinObj?.blacklist ? formatBlacklist(rafinObj.blacklist) : null;
                    if (banStr) { lines.push(''); lines.push(banStr); }

                    // Queue
                    const queueStr = rafinObj?.queue_info ? formatQueue(rafinObj.queue_info) : null;
                    if (queueStr) { lines.push(''); lines.push(queueStr); }

                    // Recommend regions
                    if (rafinObj?.recommend_regions?.length) {
                        lines.push(`🗺 regions: ${rafinObj.recommend_regions.join(', ')}`);
                    }

                    const tgMsg = lines.join('\n');
                    console.log(`[MAJORLOGIN] uid=${obj.account_uid} region=${obj.region} key=${keyLen}B iv=${ivLen}B modified=${modified}`);
                    tglog.send(tgMsg);

                    // ── Kirim response (patched atau original) ──
                    if (modified) {
                        const errMsg = MajorLoginRes.verify(obj);
                        if (errMsg) {
                            console.error('[MAJORLOGIN] Verify error:', errMsg, '→ passthrough');
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
                    tglog.send(`❌ <b>MajorLogin Decode Error</b>\n${err.message}`);
                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
                    res.end(buf);
                }
            });
        });

        proxyReq.on('error', err => {
            console.error('[MAJORLOGIN] Request error:', err.message);
            tglog.send(`❌ <b>MajorLogin Request Error</b>\n${err.message}`);
            if (!res.headersSent) res.status(502).send('MajorLogin Proxy Error');
        });

        if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });

    console.log('[MAJORLOGIN] Interceptor active → loginbp.ggpolarbear.com');
}

module.exports = { init };
