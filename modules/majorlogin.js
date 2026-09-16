'use strict';
// modules/majorlogin.js — v11 OB55
//
// FIX v11: Ganti pendekatan dari full decode→re-encode ke HYBRID:
//   - Decode proto untuk READ saja (logging, detect ban)
//   - Binary patch langsung di rawBuf untuk field yang perlu diubah
//   - TIDAK re-encode seluruh message → ak/aiv/field unknown AMAN
//
// Root cause v10: protobufjs encode ulang RAFIN → ak/aiv (field bytes) hilang
// karena proto3 zero-value optimization atau Uint8Array vs Buffer type mismatch.
// Game cek ak/aiv → null → tampilkan UIAccountForbiddenPopWndController.

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

let RAFIN = null;

protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        console.log('[MAJORLOGIN] v11 OB55 Proto loaded OK (READ-ONLY mode)');
        tglog.send('✅ <b>Server Start v11 OB55</b>\nHybrid patch — ak/aiv safe');
    })
    .catch(err => {
        console.error('[MAJORLOGIN] Proto load FAILED:', err.message);
    });

// ── Binary patch helpers ──────────────────────────────────────────────────────

function readVarint(buf, pos) {
    let result = BigInt(0), shift = BigInt(0);
    while (pos < buf.length) {
        const b = buf[pos++];
        result |= BigInt(b & 0x7F) << shift;
        shift += BigInt(7);
        if (!(b & 0x80)) break;
    }
    const n = Number(result);
    return { value: Number.isSafeInteger(n) ? n : result, pos };
}

function encodeVarint(n) {
    const parts = [];
    if (typeof n === 'bigint') {
        do { let b = Number(n & BigInt(0x7F)); n >>= BigInt(7); if (n) b |= 0x80; parts.push(b); } while (n);
    } else {
        do { let b = n & 0x7F; n >>>= 7; if (n) b |= 0x80; parts.push(b); } while (n);
    }
    return Buffer.from(parts);
}

function encodeLenField(fieldNum, contentBuf) {
    const tag = encodeVarint((fieldNum << 3) | 2);
    const len = encodeVarint(contentBuf.length);
    return Buffer.concat([tag, len, contentBuf]);
}

/**
 * patchBinaryRAFIN — patch rawBuf langsung field by field tanpa re-encode
 * Field yang di-patch:
 *   field 12 (blacklist)         : splice-out seluruh TLV
 *   field 14 (tp_url)            : splice-out
 *   field 16 (ano_url)           : splice-out
 *   field 24 (ffanti_url)        : splice-out
 *   field 25 (ff_anti_config)    : splice-out
 *   field 36 (connection_seed_enabled) : set bool = false (varint 0)
 *   field 37 (connection_seed)   : splice-out
 *   field 10 (server_url)        : PASS-THROUGH (biarkan loginbp asli)
 *   field 22 (ak), 23 (aiv)     : PASS-THROUGH (WAJIB untuk koneksi)
 */
function patchBinaryRAFIN(buf) {
    const chunks   = [];
    const patches  = [];
    let   pos      = 0;

    // Field yang di-splice (hapus seluruh TLV)
    const SPLICE_FIELDS = new Set([12, 14, 16, 24, 25, 37]);

    while (pos < buf.length) {
        const tagStart = pos;
        const tv       = readVarint(buf, pos);
        pos = tv.pos;
        if (pos > buf.length) { chunks.push(buf.slice(tagStart)); break; }

        const tag      = typeof tv.value === 'bigint' ? Number(tv.value) : tv.value;
        const fieldNum = tag >>> 3;
        const wireType = tag & 0x07;

        if (wireType === 0) {
            // Varint field
            const vv = readVarint(buf, pos);
            pos = vv.pos;

            if (fieldNum === 36) {
                // connection_seed_enabled → force false (varint 0)
                const tagBuf = encodeVarint((36 << 3) | 0);
                chunks.push(Buffer.concat([tagBuf, Buffer.from([0x00])]));
                patches.push('connection_seed_enabled=false');
            } else {
                chunks.push(buf.slice(tagStart, pos));
            }
        } else if (wireType === 2) {
            // Length-delimited field
            const lv = readVarint(buf, pos);
            const contentStart = lv.pos;
            const contentEnd   = contentStart + (typeof lv.value === 'bigint' ? Number(lv.value) : lv.value);
            pos = contentEnd;

            if (SPLICE_FIELDS.has(fieldNum)) {
                // Splice-out: jangan push ke chunks
                const label = {12:'blacklist',14:'tp_url',16:'ano_url',24:'ffanti_url',25:'ff_anti_config',37:'connection_seed'}[fieldNum];
                patches.push(`${label} removed`);
            } else {
                // Pass-through verbatim (termasuk ak/aiv/server_url/semua field lain)
                chunks.push(buf.slice(tagStart, pos));
            }
        } else if (wireType === 1) {
            pos += 8;
            chunks.push(buf.slice(tagStart, pos));
        } else if (wireType === 5) {
            pos += 4;
            chunks.push(buf.slice(tagStart, pos));
        } else {
            // Unknown wire type → stop, push sisa sebagai-is
            chunks.push(buf.slice(tagStart));
            break;
        }
    }

    return { buf: Buffer.concat(chunks), patches };
}

function decodeReqFields(buf) {
    const out = {};
    try {
        const reader = protobuf.Reader.create(buf);
        while (reader.pos < reader.len) {
            const tag      = reader.uint32();
            const fieldNum = tag >>> 3;
            const wireType = tag & 0x7;
            if (wireType === 0) {
                const val = reader.uint64();
                if (fieldNum === 98) out.is_vpn = typeof val.toNumber === 'function' ? val.toNumber() : Number(val);
            } else if (wireType === 2) {
                const bytes = reader.bytes();
                const str   = bytes.toString('utf8');
                if (fieldNum === 22) out.open_id        = str;
                if (fieldNum === 57) out.client_version = str;
                if (fieldNum === 20) out.client_ip      = str;
            } else if (wireType === 5) { reader.fixed32();
            } else if (wireType === 1) { reader.fixed64();
            } else { break; }
        }
    } catch (_) {}
    return out;
}

const BAN_REASON_MAP = {
    0: 'UNKNOWN', 1: 'IN_GAME_AUTO', 2: 'REFUND',
    3: 'OTHERS',  4: 'SKINMOD', 1014: 'IN_GAME_AUTO_NEW'
};

function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body     = req.body;
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const reqInfo  = Buffer.isBuffer(body) && body.length > 0 ? decodeReqFields(body) : {};

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
                const rawBuf = Buffer.concat(chunks);

                // 404 account_not_found → pass-through
                if (proxyRes.statusCode === 404) {
                    const bodyStr = rawBuf.toString('utf8');
                    if (bodyStr.includes('account_not_found')) {
                        console.log('[MAJORLOGIN] 404 account_not_found');
                        tglog.send(`ℹ️ <b>MajorLogin 404</b>\nopen_id: ${reqInfo.open_id || '-'}`);
                        const h = { ...proxyRes.headers, 'content-length': rawBuf.length };
                        delete h['transfer-encoding'];
                        res.writeHead(404, h);
                        return res.end(rawBuf);
                    }
                }

                // ── READ-ONLY decode untuk logging & ban detect ───────────────
                let uid = '?', region = '?', token = '?', ttl = 0;
                let banStr = null;

                if (RAFIN) {
                    try {
                        const decoded = RAFIN.decode(rawBuf);
                        const obj     = RAFIN.toObject(decoded, {
                            defaults: false, longs: String, enums: Number,
                            bytes: Buffer, keepCase: true,
                        });
                        uid    = obj.account_id  || '?';
                        region = obj.lock_region || '?';
                        token  = (obj.token || '').substring(0, 20) + '...';
                        ttl    = obj.ttl || 0;
                        if (obj.blacklist && obj.blacklist.ban_reason && obj.blacklist.ban_reason !== 0) {
                            const reason = BAN_REASON_MAP[obj.blacklist.ban_reason] || `code_${obj.blacklist.ban_reason}`;
                            banStr = `🚫 BAN detected: ${reason}`;
                        }
                    } catch (e) {
                        console.log('[MAJORLOGIN] read-only decode warn:', e.message);
                    }
                }

                // ── Binary patch (tidak re-encode, ak/aiv AMAN) ───────────────
                let outBuf   = rawBuf;
                let patches  = [];

                try {
                    const result = patchBinaryRAFIN(rawBuf);
                    outBuf   = result.buf;
                    patches  = result.patches;
                    console.log(`[MAJORLOGIN] v11 uid=${uid} region=${region} ${rawBuf.length}b→${outBuf.length}b patches=[${patches.join(', ')}]`);
                } catch (err) {
                    console.error('[MAJORLOGIN] Binary patch error:', err.message, '→ raw pass-through');
                    outBuf  = rawBuf;
                    patches = [`FALLBACK: ${err.message}`];
                }

                // TG log
                const lines = [`<b>MajorLogin v11 OB55</b>`, ''];
                lines.push(`👤 UID: <code>${uid}</code>`);
                lines.push(`🆔 open_id: <code>${reqInfo.open_id || '?'}</code>`);
                if (reqInfo.client_version) lines.push(`📱 ver: ${reqInfo.client_version}`);
                lines.push(`🌏 region: ${region}`);
                lines.push(`🌐 ip: ${clientIp}`);
                lines.push(`🎫 token: <code>${token}</code>`);
                if (ttl) lines.push(`⏱ ttl: ${ttl}s`);
                if (patches.length) lines.push(`🔧 ${patches.join(', ')}`);
                if (banStr) { lines.push(''); lines.push(banStr); }
                tglog.send(lines.join('\n'));

                const outHeaders = { ...proxyRes.headers, 'content-length': outBuf.length };
                delete outHeaders['transfer-encoding'];
                delete outHeaders['content-encoding'];
                res.writeHead(proxyRes.statusCode, outHeaders);
                res.end(outBuf);
            });

            proxyRes.on('error', err => {
                console.error('[MAJORLOGIN] Response error:', err.message);
                if (!res.headersSent) res.status(502).send('MajorLogin Error');
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

    console.log('[MAJORLOGIN] v11 OB55 hybrid binary patch active');
}

module.exports = { init };
