'use strict';
// modules/majorlogin.js — v4
//
// ROOT CAUSE (confirmed dari log 2026-09-15):
//   patchStringInBuf mengubah PANJANG buffer ketika server_url domain berbeda.
//   Perubahan ukuran buffer membuat offset semua field setelahnya BERGESER.
//   Proto parser baca field berikutnya dari posisi salah → "Unconsumed data".
//
// FIX v4 — PRINSIP INTI:
//   SEMUA string patch harus MEMPERTAHANKAN UKURAN BUFFER.
//   - server_url  : zero-fill sisa bytes setelah content baru (size tetap)
//   - tp_url      : zero content, pertahankan varint length (size tetap)
//   - gin urls    : zero content, pertahankan varint length (size tetap)
//   - blacklist   : zero content sub-message, pertahankan tag+varint (size tetap)
//
//   TIDAK boleh ada Buffer.concat yang mengubah total panjang buffer.

const _PROXY_FULL_URL   = process.env.PROXY_URL || 'https://proxy-reza-kontolodon-memek-luu.up.railway.app/';
const TARGET_SERVER_URL = _PROXY_FULL_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

let RAFIN = null;

protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        console.log('[MAJORLOGIN] Proto loaded OK');
        tglog.send('✅ <b>Server Start</b>\nProto loaded OK');
    })
    .catch(err => {
        console.error('[MAJORLOGIN] Proto load FAILED:', err.message);
        tglog.send(`❌ <b>Proto FAILED</b>\n${err.message}`);
    });

// ─── Request decoder ─────────────────────────────────────────────────────────
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

// ─── readVarint: baca varint LE dari buf[pos], return {value, bytesRead} ──────
function readVarint(buf, pos) {
    let val = 0, shift = 0;
    for (let i = 0; i < 5; i++) {
        if (pos + i >= buf.length) return null;
        const b = buf[pos + i];
        val |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) return { value: val >>> 0, bytesRead: i + 1 };
    }
    return null;
}

// ─── writeVarint: tulis value sebagai varint ke buf[pos] (in-place) ───────────
// CATATAN: ukuran varint HARUS sama dengan sebelumnya (kita tidak resize).
// Kalau tidak muat, return false.
function writeVarintInPlace(buf, pos, value, originalBytesCount) {
    const tmp = [];
    let v = value >>> 0;
    do {
        const b = v & 0x7f;
        v >>>= 7;
        tmp.push(v ? (b | 0x80) : b);
    } while (v);
    if (tmp.length > originalBytesCount) return false; // tidak muat
    // Tulis dgn zero-padding di depan kalau perlu (varint tetap valid dgn leading 0x80 0x00)
    let wi = 0;
    for (let i = 0; i < originalBytesCount; i++) {
        if (i < tmp.length - 1) {
            buf[pos + i] = tmp[i];
        } else if (i === tmp.length - 1) {
            // byte terakhir dari value kita
            if (i < originalBytesCount - 1) {
                // Masih ada slot tersisa, set MSB untuk "ada byte lagi" lalu isi 0
                buf[pos + i] = tmp[i] | 0x80;
            } else {
                buf[pos + i] = tmp[i] & 0x7f;
            }
        } else {
            // Padding: 0x80 kecuali byte terakhir = 0x00
            buf[pos + i] = (i < originalBytesCount - 1) ? 0x80 : 0x00;
        }
        wi++;
    }
    return true;
}

// ─── patchStringFieldInPlace ───────────────────────────────────────────────────
// Cari string `oldStr` di buf, ganti dengan `newStr` IN-PLACE (size TIDAK berubah).
// Kalau newStr lebih pendek → zero-fill sisa.
// Kalau newStr lebih panjang → truncate (tidak mungkin untuk domain → proxy).
// Update varint length in-place juga.
// Return: {buf, patched: bool}
function patchStringFieldInPlace(buf, oldStr, newStr) {
    const oldBytes = Buffer.from(oldStr, 'utf8');
    const idx = buf.indexOf(oldBytes);
    if (idx === -1) return { buf, patched: false };

    const newBytes = Buffer.from(newStr, 'utf8');
    const result   = Buffer.from(buf); // copy

    // Tulis newStr ke posisi yang sama
    const writeLen = Math.min(newBytes.length, oldBytes.length);
    newBytes.copy(result, idx, 0, writeLen);

    // Zero-fill sisa (kalau newStr lebih pendek)
    for (let i = writeLen; i < oldBytes.length; i++) result[idx + i] = 0x00;

    // Update length varint in-place
    // Cari varint sebelum idx
    if (newBytes.length !== oldBytes.length) {
        // Try 2-byte varint
        let updated = false;
        if (idx >= 2) {
            const b0 = buf[idx - 2], b1 = buf[idx - 1];
            if ((b0 & 0x80) && !(b1 & 0x80)) {
                const oldLen = (b0 & 0x7f) | ((b1 & 0x7f) << 7);
                if (oldLen === oldBytes.length) {
                    writeVarintInPlace(result, idx - 2, newBytes.length, 2);
                    updated = true;
                }
            }
        }
        // Try 1-byte varint
        if (!updated && idx >= 1) {
            const b0 = buf[idx - 1];
            if (!(b0 & 0x80) && b0 === oldBytes.length) {
                result[idx - 1] = newBytes.length & 0x7f;
            }
        }
    }

    return { buf: result, patched: true };
}

// ─── zeroOutStringFieldInPlace ────────────────────────────────────────────────
// Temukan field yg mengandung prefix, zero-out CONTENT saja (tidak ubah varint length).
// Proto akan parse field tersebut dengan length sama tapi isi null bytes.
// String null → domain tidak valid → GIN tidak connect.
// Buffer size TIDAK berubah.
function zeroOutStringFieldInPlace(buf, prefix) {
    const prefixBytes = Buffer.from(prefix, 'utf8');
    const idx = buf.indexOf(prefixBytes);
    if (idx === -1) return { buf, patched: false };

    const result = Buffer.from(buf);

    // Cari panjang field dari varint sebelum idx
    let totalLen = 0, lenStart = -1, varintBytes = 0;

    // Try 2-byte varint
    if (idx >= 2) {
        const b0 = buf[idx - 2], b1 = buf[idx - 1];
        if ((b0 & 0x80) && !(b1 & 0x80)) {
            const candidate = (b0 & 0x7f) | ((b1 & 0x7f) << 7);
            if (candidate > 0 && candidate < 512) {
                totalLen = candidate; lenStart = idx - 2; varintBytes = 2;
            }
        }
    }
    // Try 1-byte varint
    if (lenStart === -1 && idx >= 1) {
        const b0 = buf[idx - 1];
        if (!(b0 & 0x80) && b0 > 0 && b0 < 200) {
            totalLen = b0; lenStart = idx - 1; varintBytes = 1;
        }
    }

    if (lenStart === -1) return { buf, patched: false };

    // Zero content saja (PERTAHANKAN varint length bytes)
    for (let i = 0; i < totalLen && idx + i < result.length; i++) {
        result[idx + i] = 0x00;
    }

    return { buf: result, patched: true };
}

// ─── zeroOutBlacklistInPlace ───────────────────────────────────────────────────
// Temukan field 12 (tag 0x62 wiretype=2), zero-out CONTENT sub-message saja.
// Tag + varint DIPERTAHANKAN → buffer size TIDAK berubah.
// Game baca blacklist field dengan length N tapi isi null bytes →
// blacklist.ban_reason = 0 → treat as no ban.
function zeroOutBlacklistInPlace(buf) {
    const result = Buffer.from(buf);
    let patched = false;
    let i = 0;

    while (i < result.length - 1) {
        if (result[i] !== 0x62) { i++; continue; }

        // Baca varint length
        const varintRes = readVarint(result, i + 1);
        if (!varintRes) { i++; continue; }

        const { value: msgLen, bytesRead } = varintRes;
        const contentStart = i + 1 + bytesRead;
        const contentEnd   = contentStart + msgLen;

        if (msgLen <= 0 || contentEnd > result.length) { i++; continue; }

        // Validasi: byte pertama content harus valid proto tag dari blacklist
        const firstByte = result[contentStart];
        const validFirstTags = [0x08, 0x10, 0x18, 0x22, 0x2A];
        if (!validFirstTags.includes(firstByte)) { i++; continue; }

        // Zero-out CONTENT SAJA, pertahankan tag (0x62) + varint length
        for (let j = contentStart; j < contentEnd; j++) result[j] = 0x00;

        console.log(`[MAJORLOGIN-PATCH] blacklist zeroed at offset ${i}, sub-msg len=${msgLen}, firstByte=0x${firstByte.toString(16)}`);
        patched = true;
        i = contentEnd; // lanjut setelah field ini
    }

    return { buf: result, patched };
}

// ─── init ─────────────────────────────────────────────────────────────────────
function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body     = req.body;
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const reqInfo  = Buffer.isBuffer(body) && body.length > 0 ? decodeReqFields(body) : {};
        const openId   = reqInfo.open_id || null;

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
                let buf = Buffer.concat(chunks);
                const origLen  = buf.length;
                const patchLog = [];
                let modified   = false;

                // ── 404 account_not_found → pass-through ──────────────────
                if (proxyRes.statusCode === 404) {
                    const bodyStr = buf.toString('utf8');
                    if (bodyStr.includes('account_not_found')) {
                        console.log('[MAJORLOGIN] 404 account_not_found → pass-through');
                        tglog.send(`ℹ️ <b>MajorLogin</b>\n404 account_not_found\nopen_id: ${reqInfo.open_id || '-'}`);
                        const headers = { ...proxyRes.headers, 'content-length': buf.length };
                        delete headers['transfer-encoding'];
                        res.writeHead(404, headers);
                        return res.end(buf);
                    }
                }

                // ── Patch 1: server_url → proxy (IN-PLACE, size tetap) ────
                // Ganti domain Garena dengan proxy domain, zero-fill sisa bytes
                {
                    const GARENA_HOSTS = [
                        'https://loginbp.ggpolarbear.com',
                        'https://clientbp.ggpolarbear.com',
                        'loginbp.ggpolarbear.com',
                        'clientbp.ggpolarbear.com',
                    ];
                    const PROXY_WITH_HTTPS  = 'https://' + TARGET_SERVER_URL;
                    const PROXY_BARE        = TARGET_SERVER_URL;

                    for (const host of GARENA_HOSTS) {
                        const newStr = host.startsWith('https://') ? PROXY_WITH_HTTPS : PROXY_BARE;
                        const r = patchStringFieldInPlace(buf, host, newStr);
                        if (r.patched) {
                            buf = r.buf; modified = true;
                            patchLog.push(`server_url: "${host}" → proxy`);
                        }
                    }

                    // Fallback: decode RAFIN, baca server_url asli
                    if (!modified && RAFIN) {
                        try {
                            const peek = RAFIN.toObject(RAFIN.decode(buf), { defaults: false, longs: String });
                            const cur  = (peek.server_url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
                            if (cur && cur !== TARGET_SERVER_URL) {
                                const r = patchStringFieldInPlace(buf, cur, TARGET_SERVER_URL);
                                if (r.patched) {
                                    buf = r.buf; modified = true;
                                    patchLog.push(`server_url fallback: "${cur}" → proxy`);
                                }
                            }
                        } catch (e) { console.log('[MAJORLOGIN] server_url fallback err:', e.message); }
                    }
                }

                // ── Patch 2: tp_url → zero content (size tetap) ──────────
                {
                    const tpPrefix = 'csoversea.stronghold.freefiremobile.com';
                    let searchFrom = 0;
                    let tpCount    = 0;
                    const tpBytes  = Buffer.from(tpPrefix, 'utf8');
                    while (true) {
                        const tpIdx = buf.indexOf(tpBytes, searchFrom);
                        if (tpIdx === -1) break;
                        const r = zeroOutStringFieldInPlace(buf, tpPrefix);
                        if (r.patched) {
                            buf = r.buf; modified = true; tpCount++;
                            searchFrom = tpIdx + tpBytes.length;
                        } else {
                            searchFrom = tpIdx + 1;
                        }
                    }
                    if (tpCount > 0) patchLog.push(`tp_url: ${tpCount}x content zeroed`);
                }

                // ── Patch 3: GIN/GRTC URLs → zero content (size tetap) ───
                const ginPrefixes = [
                    'gin.freefiremobile.com',
                    'ffanti.freefiremobile.com',
                    'grtc.freefiremobile.com',
                    'ggblueshark.com',
                ];
                for (const prefix of ginPrefixes) {
                    const r = zeroOutStringFieldInPlace(buf, prefix);
                    if (r.patched) {
                        buf = r.buf; modified = true;
                        patchLog.push(`${prefix}: content zeroed`);
                    }
                }

                // ── Patch 4: Blacklist → zero content (size tetap) ───────
                // Tag 0x62 + varint dipertahankan, content di-zero.
                // Proto parse ok, ban_reason = 0 → no ban.
                {
                    const blResult = zeroOutBlacklistInPlace(buf);
                    if (blResult.patched) {
                        buf = blResult.buf; modified = true;
                        patchLog.push('blacklist: content zeroed (size preserved)');
                    }
                }

                // ── Safety check: buffer size HARUS sama ──────────────────
                if (buf.length !== origLen) {
                    console.error(`[MAJORLOGIN] FATAL: buffer size changed! ${origLen} → ${buf.length}. Reverting patches.`);
                    tglog.send(`❌ <b>MajorLogin FATAL</b>\nBuffer size changed ${origLen}→${buf.length}\nReverting to original`);
                    buf = Buffer.concat(chunks); // revert ke original
                    patchLog.push('REVERTED: buffer size mismatch');
                }

                // ── Logging & TG ──────────────────────────────────────────
                let uid = '?', region = '?', token = '?', ttl = 0;
                let banStr = null, queueStr = null;
                try {
                    if (RAFIN) {
                        const rafinObj = RAFIN.toObject(RAFIN.decode(buf), { defaults: true, longs: String });
                        uid      = rafinObj.account_id || '?';
                        region   = rafinObj.lock_region || '?';
                        token    = (rafinObj.token || '').substring(0, 20) + '...';
                        ttl      = rafinObj.ttl || 0;
                        banStr   = rafinObj.blacklist  ? formatBlacklist(rafinObj.blacklist)  : null;
                        queueStr = rafinObj.queue_info ? formatQueue(rafinObj.queue_info)      : null;
                    }
                } catch (parseErr) {
                    console.error('[MAJORLOGIN] RAFIN decode after patch failed:', parseErr.message);
                    tglog.send(`⚠️ <b>MajorLogin parse error after patch</b>\n${parseErr.message}`);
                }

                const status = modified ? '🔑 PATCHED' : '✅ LOGIN OK';
                const lines  = [`<b>MajorLogin — ${status}</b>`, ''];
                lines.push(`👤 UID: <code>${uid}</code>`);
                lines.push(`🆔 open_id: <code>${openId || '?'}</code>`);
                if (reqInfo.client_version) lines.push(`📱 ver: ${reqInfo.client_version}`);
                lines.push(`🌏 region: ${region}`);
                lines.push(`🌐 ip: ${clientIp}`);
                lines.push(`🎫 token: <code>${token}</code>`);
                if (ttl) lines.push(`⏱ ttl: ${ttl}s`);
                if (patchLog.length) lines.push(`🔧 patch:\n  ${patchLog.join('\n  ')}`);
                if (banStr)   { lines.push(''); lines.push(banStr); }
                if (queueStr) { lines.push(''); lines.push(queueStr); }

                console.log(`[MAJORLOGIN] uid=${uid} region=${region} size=${origLen}→${buf.length} patches=[${patchLog.join(', ')}]`);
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

    console.log('[MAJORLOGIN] v4 active — IN-PLACE patches, buffer size preserved');
}

module.exports = { init };
