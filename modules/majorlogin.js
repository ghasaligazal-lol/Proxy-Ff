'use strict';
// modules/majorlogin.js — Proto decode → patch → re-encode RAFIN response
// Strategy: decode protobuf properly, patch fields, re-encode
// Fixes:
//   - server_url: clientbp → proxy
//   - blacklist: zero out (ban bypass)
//   - tp_url / ano_url / gin URLs: clear (anticheat bypass)

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');
const { MY_IP } = require('../gamevar');

let RAFIN = null;
let protoLoaded = false;

// Load proto with all required message types
const protoRoot = protobuf.loadSync(path.join(__dirname, '..', 'MajorLoginRes.proto'));
try {
    RAFIN = protoRoot.lookupType('freefire.RAFIN');
    protoLoaded = true;
    console.log('[MAJORLOGIN] Proto loaded OK');
} catch (err) {
    console.error('[MAJORLOGIN] Proto load FAILED:', err.message);
}

// ── Decode request fields for logging ──────────────────────────────────────
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
                if (fieldNum === 3)   out.device_id      = str;
                if (fieldNum === 20)  out.client_ip      = str;
                if (fieldNum === 11)  out.network_type   = str;
            } else if (wireType === 5) { reader.fixed32();
            } else if (wireType === 1) { reader.fixed64();
            } else { break; }
        }
    } catch (_) {}
    return out;
}

// ── Format ban info for TG log ─────────────────────────────────────────────
const BAN_REASON_MAP = {
    0: 'UNKNOWN', 1: 'IN_GAME_AUTO', 2: 'REFUND',
    3: 'OTHERS',  4: 'SKINMOD', 1014: 'IN_GAME_AUTO_NEW'
};
function formatBlacklist(bl) {
    if (!bl || !bl.ban_reason) return null;
    const reason = BAN_REASON_MAP[bl.ban_reason] || `code_${bl.ban_reason}`;
    const exp    = bl.expire_duration ? `${bl.expire_duration}s` : 'permanent';
    return `🚫 BAN (intercepted): ${reason} | expire: ${exp}`;
}
function formatQueue(q) {
    if (!q || q.allow) return null;
    return `⏳ QUEUE pos:${q.queue_position} wait:${q.need_wait_secs}s`;
}

// ── Main patch: decode → edit → re-encode ─────────────────────────────────
function patchRafinBuf(buf, proxyBase) {
    const patchLog = [];

    // Try proper proto decode first
    if (protoLoaded && RAFIN) {
        try {
            const obj = RAFIN.toObject(RAFIN.decode(buf), {
                defaults: true,
                longs:    String,
                enums:    Number,
                bytes:    Buffer,
            });

            // Patch 1: server_url → proxy
            if (obj.server_url && (
                obj.server_url.includes('clientbp.ggpolarbear.com') ||
                obj.server_url.includes('loginbp.ggpolarbear.com')
            )) {
                patchLog.push(`server_url: ${obj.server_url} → ${proxyBase}`);
                obj.server_url = proxyBase;
            } else if (!obj.server_url || obj.server_url === '') {
                // server_url kosong → isi dengan proxy supaya game tahu ke mana konek
                obj.server_url = proxyBase;
                patchLog.push(`server_url: (empty) → ${proxyBase}`);
            }

            // Patch 2: blacklist → null (ban bypass)
            if (obj.blacklist && (obj.blacklist.ban_reason || obj.blacklist.ban_time)) {
                patchLog.push(`blacklist: ${JSON.stringify(obj.blacklist)} → null`);
                obj.blacklist = null;
            }

            // Patch 3: tp_url → clear
            if (obj.tp_url && obj.tp_url.length > 0) {
                patchLog.push(`tp_url: cleared (${obj.tp_url.substring(0,30)}...)`);
                obj.tp_url = '';
            }

            // Patch 4: ano_url (field 16) → clear (GIN alt route)
            if (obj.ano_url && obj.ano_url.length > 0) {
                patchLog.push(`ano_url: cleared`);
                obj.ano_url = '';
            }

            // Patch 5: ffanti_url → clear
            if (obj.ffanti_url && obj.ffanti_url.length > 0) {
                patchLog.push(`ffanti_url: cleared`);
                obj.ffanti_url = '';
            }

            // Re-encode
            const errMsg = RAFIN.verify(obj);
            if (errMsg) throw new Error('verify failed: ' + errMsg);
            const reencoded = Buffer.from(RAFIN.encode(RAFIN.fromObject(obj)).finish());
            console.log(`[MAJORLOGIN] proto re-encode OK, buf ${buf.length}B → ${reencoded.length}B`);
            return { buf: reencoded, patchLog, obj };

        } catch (err) {
            console.log(`[MAJORLOGIN] proto decode/re-encode failed: ${err.message} — falling back to binary patch`);
        }
    }

    // ── Fallback: binary string patch (jika proto gagal) ──────────────────
    console.log('[MAJORLOGIN] using binary fallback patch');

    // server_url patch
    const serverUrls = [
        'https://clientbp.ggpolarbear.com',
        'http://clientbp.ggpolarbear.com',
        'https://loginbp.ggpolarbear.com',
    ];
    for (const su of serverUrls) {
        const oldB = Buffer.from(su, 'utf8');
        const idx  = buf.indexOf(oldB);
        if (idx === -1) continue;
        const newB = Buffer.from(proxyBase, 'utf8');
        // adjust varint before string
        let result;
        if (newB.length === oldB.length) {
            result = Buffer.from(buf);
            newB.copy(result, idx);
        } else {
            // build new buf with correct length varint
            const lenIdx = idx - 1;
            if (lenIdx >= 0) {
                const before = buf.slice(0, lenIdx);
                const after  = buf.slice(idx + oldB.length);
                const newLen = newB.length < 128 ? Buffer.from([newB.length]) :
                    Buffer.from([(newB.length & 0x7f) | 0x80, newB.length >> 7]);
                result = Buffer.concat([before, newLen, newB, after]);
            } else {
                result = Buffer.from(buf);
            }
        }
        buf = result;
        patchLog.push(`server_url (binary): ${su} → ${proxyBase}`);
        break;
    }

    // clear tp_url and gin URLs by zeroing bytes
    for (const prefix of [
        'csoversea.stronghold.freefiremobile.com',
        'gin.freefiremobile.com',
        'ffanti.freefiremobile.com',
        'grtc.freefiremobile.com',
    ]) {
        const gIdx = buf.indexOf(Buffer.from(prefix, 'utf8'));
        if (gIdx === -1) continue;
        const lenIdx = gIdx - 1;
        if (lenIdx >= 0 && buf[lenIdx] > 0 && buf[lenIdx] < 250) {
            const oldLen = buf[lenIdx];
            buf[lenIdx] = 0;
            for (let i = 0; i < oldLen && gIdx + i < buf.length; i++) buf[gIdx + i] = 0;
            patchLog.push(`${prefix}: zeroed (binary)`);
        }
    }

    return { buf, patchLog, obj: null };
}

function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body     = req.body;
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');

        const reqInfo  = Buffer.isBuffer(body) && body.length > 0 ? decodeReqFields(body) : {};
        const openId   = reqInfo.open_id || null;
        const proxyBase = MY_IP.replace(/\/$/, '');

        const options = {
            hostname: 'loginbp.ggpolarbear.com',
            path:     '/MajorLogin',
            method:   'POST',
            headers: {
                ...req.headers,
                'host':           'loginbp.ggpolarbear.com',
                'content-length': Buffer.isBuffer(body) ? body.length : 0,
            }
        };
        delete options.headers['transfer-encoding'];

        const proxyReq = https.request(options, (proxyRes) => {
            const chunks = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
                let buf = Buffer.concat(chunks);

                // ── 404 account_not_found → pass-through for register flow ──
                if (proxyRes.statusCode === 404) {
                    const bodyStr = buf.toString('utf8');
                    if (bodyStr.includes('account_not_found')) {
                        console.log('[MAJORLOGIN] 404 account_not_found → pass-through (register flow)');
                        tglog.send(`ℹ️ <b>MajorLogin</b>\n404 account_not_found — register flow\nopen_id: ${openId || '?'}`);
                        const h = { ...proxyRes.headers, 'content-length': buf.length };
                        delete h['transfer-encoding'];
                        res.writeHead(404, h);
                        return res.end(buf);
                    }
                }

                // ── Only patch binary proto responses ─────────────────────────
                if (proxyRes.statusCode !== 200 || buf.length === 0) {
                    const h = { ...proxyRes.headers, 'content-length': buf.length };
                    delete h['transfer-encoding'];
                    res.writeHead(proxyRes.statusCode, h);
                    return res.end(buf);
                }

                const { buf: patched, patchLog, obj } = patchRafinBuf(buf, proxyBase);
                buf = patched;

                // ── Logging ───────────────────────────────────────────────────
                let uid = '?', region = '?', token = '?', ttl = 0;
                let banStr = null, queueStr = null;
                try {
                    const decoded = obj || (RAFIN ? RAFIN.toObject(RAFIN.decode(buf), { defaults: true, longs: String }) : null);
                    if (decoded) {
                        uid    = decoded.account_id || '?';
                        region = decoded.lock_region || decoded.noti_region || '?';
                        token  = (decoded.token || '').substring(0, 20) + '...';
                        ttl    = decoded.ttl || 0;
                        // obj is already patched (blacklist=null), so read from original buf for logging
                        banStr   = null; // already zeroed, no need to log
                        queueStr = decoded.queue_info ? formatQueue(decoded.queue_info) : null;
                    }
                } catch (_) {}

                const status = patchLog.length > 0 ? '🔑 PATCHED' : '✅ LOGIN OK';
                const lines  = [`<b>MajorLogin — ${status}</b>`, ''];
                lines.push(`👤 UID: <code>${uid}</code>`);
                lines.push(`🆔 open_id: <code>${openId || '?'}</code>`);
                if (reqInfo.client_version) lines.push(`📱 ver: ${reqInfo.client_version}`);
                lines.push(`🌏 region: ${region}`);
                lines.push(`🌐 ip: ${clientIp}`);
                lines.push(`🎫 token: <code>${token}</code>`);
                if (ttl) lines.push(`⏱ ttl: ${ttl}s`);
                if (patchLog.length) lines.push(`🔧 patch:\n  ${patchLog.join('\n  ')}`);
                if (queueStr) { lines.push(''); lines.push(queueStr); }

                console.log(`[MAJORLOGIN] uid=${uid} region=${region} patches=[${patchLog.join(', ')}]`);
                tglog.send(lines.join('\n'));

                const newHeaders = { ...proxyRes.headers, 'content-length': buf.length };
                delete newHeaders['transfer-encoding'];
                res.writeHead(proxyRes.statusCode, newHeaders);
                res.end(buf);
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

    console.log('[MAJORLOGIN] Active → proto decode/re-encode mode (ban bypass + server_url patch)');
}

module.exports = { init };
