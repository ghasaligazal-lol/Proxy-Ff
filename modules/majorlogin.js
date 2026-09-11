'use strict';
// modules/majorlogin.js — FIXED v3
//
// ROOT CAUSE FIXES:
//
// BUG 1 — patchBlacklist() skip:
//   Lama: limit msgLen < 50 + cek firstByte === 0x08||0x10 → gagal karena
//         ban_type="Modifiers" (string field 4, tag 0x22) menambah size sub-message
//         sehingga firstByte bisa 0x22 bukan 0x08, dan size bisa > 50.
//   Fix:  Hapus limit size. Hapus cek firstByte. Cukup temukan tag 0x62, baca
//         length varint, splice-out seluruh sub-message dari buffer (bukan zero-out).
//         Splice-out lebih aman karena tidak corrupt field lain.
//
// BUG 2 — ProtoException: Unconsumed data setelah ChooseRegion:
//   Lama: ff_anti_config_desc zero-out loop cari tag [0xAA, 0x01] (field 21).
//         Response setelah ChooseRegion punya field kts (field 19, tag 0x98 0x01),
//         ak (field 22, tag 0xB2 0x01), aiv (field 23, tag 0xBA 0x01).
//         Loop zero-out byte dari ffIdx s/d pos+msgLen corrupt varint kts/ak/aiv
//         yang posisinya berdekatan → game parse buffer rusak → Unconsumed data.
//   Fix:  HAPUS ff_anti_config_desc zero-out sepenuhnya.
//         Game tidak butuh ff_anti_config_desc untuk login — field ini null di log.
//         Yang penting: blacklist (field 12) dihapus dengan benar (fix di BUG 1).
//
// TAMBAHAN: mode 'speed_sensi' — hanya inject speed+sensi ke gamevar, tidak pakai cache_res
//           → cache_res download dari server Garena resmi
//           → abhotupdate_check ikut mode ini

const _PROXY_FULL_URL  = process.env.PROXY_URL || 'https://proxy-reza-kontolodon-memek-luu.up.railway.app/';
const TARGET_SERVER_URL = _PROXY_FULL_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

let RAFIN = null;

protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        const msg = '[MAJORLOGIN] Proto loaded OK';
        console.log(msg);
        tglog.send(`✅ <b>Server Start</b>\n${msg}`);
    })
    .catch(err => {
        const msg = `[MAJORLOGIN] Proto load FAILED: ${err.message}`;
        console.error(msg);
        tglog.send(`❌ <b>Proto FAILED</b>\n${msg}`);
    });

// ─── Request decoder (untuk logging) ───────────────────────────────────────────
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

// ─── patchStringInBuf ─────────────────────────────────────────────────────────
// Replace string di binary proto, update length varint kalau panjang berbeda
function patchStringInBuf(buf, oldStr, newStr) {
    const oldBytes = Buffer.from(oldStr, 'utf8');
    const idx = buf.indexOf(oldBytes);
    if (idx === -1) return { buf, patched: false };

    const newBytes = Buffer.from(newStr, 'utf8');

    if (newBytes.length === oldBytes.length) {
        const result = Buffer.from(buf);
        newBytes.copy(result, idx);
        return { buf: result, patched: true };
    }

    // Panjang berbeda — update length varint
    let lengthVarintIdx = -1, lengthVarintSize = 0;
    if (idx >= 1 && buf[idx - 1] === oldBytes.length) {
        lengthVarintIdx  = idx - 1;
        lengthVarintSize = 1;
    } else if (idx >= 2) {
        const b0 = buf[idx - 2], b1 = buf[idx - 1];
        if ((b0 & 0x80) && ((b0 & 0x7f) | ((b1 & 0x7f) << 7)) === oldBytes.length) {
            lengthVarintIdx  = idx - 2;
            lengthVarintSize = 2;
        }
    }

    if (lengthVarintIdx === -1) {
        // Fallback: zero-pad ke panjang lama
        const padded = Buffer.alloc(oldBytes.length, 0x20);
        newBytes.copy(padded, 0, 0, Math.min(newBytes.length, padded.length));
        const result = Buffer.from(buf);
        padded.copy(result, idx);
        return { buf: result, patched: true };
    }

    const newLen = newBytes.length;
    const newVarint = newLen < 128
        ? Buffer.from([newLen])
        : Buffer.from([(newLen & 0x7f) | 0x80, newLen >> 7]);

    const before = buf.slice(0, lengthVarintIdx);
    const after  = buf.slice(idx + oldBytes.length);
    return { buf: Buffer.concat([before, newVarint, newBytes, after]), patched: true };
}

// ─── zeroOutStringField ───────────────────────────────────────────────────────
// Zero-out string field berdasarkan prefix konten
function zeroOutStringField(buf, prefix) {
    const prefixBytes = Buffer.from(prefix, 'utf8');
    const idx = buf.indexOf(prefixBytes);
    if (idx === -1) return { buf, patched: false };

    let lenStart = -1, totalLen = 0;
    if (idx >= 2) {
        const b0 = buf[idx - 2], b1 = buf[idx - 1];
        if (b0 & 0x80) {
            totalLen = (b0 & 0x7f) | ((b1 & 0x7f) << 7);
            if (totalLen > 0 && totalLen < 300) lenStart = idx - 2;
        }
    }
    if (lenStart === -1 && idx >= 1) {
        const b0 = buf[idx - 1];
        if (b0 > 0 && b0 < 128 && !(b0 & 0x80)) { totalLen = b0; lenStart = idx - 1; }
    }
    if (lenStart === -1) return { buf, patched: false };

    const result = Buffer.from(buf);
    const varintSize = idx - lenStart;
    for (let v = 0; v < varintSize; v++) result[lenStart + v] = 0;
    for (let i = 0; i < totalLen && idx + i < result.length; i++) result[idx + i] = 0;
    return { buf: result, patched: true };
}

// ─── patchBlacklist FIXED ─────────────────────────────────────────────────────
// FIX v3: splice-out (bukan zero-out) seluruh blacklist sub-message dari buffer.
// - Tidak ada limit msgLen (dihapus → support ban_type string panjang berapa pun)
// - Tidak ada cek firstByte (dihapus → support field urutan apa pun di sub-message)
// - Splice-out = buffer lebih pendek, tapi proto parse aman karena field 12 hilang sepenuhnya
// - Game tidak tampilkan ban screen karena tidak ada field blacklist → treat as null
function patchBlacklist(buf) {
    const results = [];
    let searchBuf = buf;
    let spliced   = 0;
    let i = 0;

    while (i < searchBuf.length - 1) {
        // Field 12, wiretype 2 → tag byte 0x62
        if (searchBuf[i] !== 0x62) { i++; continue; }

        // Baca length varint (support multi-byte)
        let pos = i + 1;
        let msgLen = 0, shift = 0, varintOk = false;
        while (pos < searchBuf.length) {
            const b = searchBuf[pos++];
            msgLen |= (b & 0x7f) << shift;
            shift += 7;
            if (!(b & 0x80)) { varintOk = true; break; }
            if (shift > 28) break; // safety: max 4-byte varint
        }

        if (!varintOk || msgLen <= 0 || pos + msgLen > searchBuf.length) {
            i++;
            continue;
        }

        // Validasi minimal: sub-message harus punya minimal 1 valid protobuf tag
        // (field 1 ban_reason=0x08, field 2 expire=0x10, field 3 ban_time=0x18, field 4 ban_type=0x22)
        const contentStart = pos;
        const firstByte    = searchBuf[contentStart];
        const validFirstTags = [0x08, 0x10, 0x18, 0x22];
        if (!validFirstTags.includes(firstByte)) { i++; continue; }

        // Splice-out: potong tag byte (0x62) + varint + sub-message content
        const tagStart    = i;
        const totalRemove = (pos - i) + msgLen; // tag + varint bytes + content
        const before      = searchBuf.slice(0, tagStart);
        const after       = searchBuf.slice(tagStart + totalRemove);
        searchBuf = Buffer.concat([before, after]);
        spliced++;

        console.log(`[MAJORLOGIN-PATCH] blacklist spliced at offset ${tagStart}, sub-msg len=${msgLen}, firstByte=0x${firstByte.toString(16)}`);
        // Tidak increment i — setelah splice posisi i menunjuk ke byte berikutnya secara otomatis
    }

    return { buf: searchBuf, patched: spliced > 0, count: spliced };
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

                // ── Patch 1: server_url → proxy domain ────────────────────
                {
                    const GARENA_HOSTS = [
                        'loginbp.ggpolarbear.com',
                        'clientbp.ggpolarbear.com',
                    ];
                    let serverUrlPatched = false;
                    for (const host of GARENA_HOSTS) {
                        const withHttps = 'https://' + host;
                        let r = patchStringInBuf(buf, withHttps, 'https://' + TARGET_SERVER_URL);
                        if (r.patched) {
                            buf = r.buf; modified = true; serverUrlPatched = true;
                            patchLog.push(`server_url: "${withHttps}" → proxy`);
                        }
                        r = patchStringInBuf(buf, host, TARGET_SERVER_URL);
                        if (r.patched) {
                            buf = r.buf; modified = true; serverUrlPatched = true;
                            patchLog.push(`server_url bare: "${host}" → proxy`);
                        }
                    }
                    if (!serverUrlPatched && RAFIN) {
                        try {
                            const peek = RAFIN.toObject(RAFIN.decode(buf), { defaults: false, longs: String });
                            const cur  = (peek.server_url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
                            if (cur && cur !== TARGET_SERVER_URL) {
                                const r = patchStringInBuf(buf, cur, TARGET_SERVER_URL);
                                if (r.patched) {
                                    buf = r.buf; modified = true;
                                    patchLog.push(`server_url fallback: "${cur}" → proxy`);
                                }
                            }
                        } catch (e) { console.log('[MAJORLOGIN] server_url fallback err:', e.message); }
                    }
                }

                // ── Patch 2: tp_url + ffanti_url → kosong ─────────────────
                // Zero-out string yang mengandung stronghold domain
                {
                    const tpPrefix  = 'csoversea.stronghold.freefiremobile.com';
                    const tpBytes   = Buffer.from(tpPrefix, 'utf8');
                    let searchFrom  = 0;
                    let tpCount     = 0;
                    while (true) {
                        const tpIdx = buf.indexOf(tpBytes, searchFrom);
                        if (tpIdx === -1) break;
                        let zeroed = false;
                        // Coba 2-byte varint
                        if (tpIdx >= 2) {
                            const b0 = buf[tpIdx - 2], b1 = buf[tpIdx - 1];
                            if ((b0 & 0x80) && !(b1 & 0x80)) {
                                const totalLen = (b0 & 0x7f) | (b1 << 7);
                                if (totalLen > 0 && totalLen < 300) {
                                    const nb = Buffer.from(buf);
                                    nb[tpIdx - 2] = 0; nb[tpIdx - 1] = 0;
                                    for (let k = 0; k < totalLen && tpIdx + k < nb.length; k++) nb[tpIdx + k] = 0;
                                    buf = nb; modified = true; tpCount++; zeroed = true;
                                    searchFrom = tpIdx + totalLen;
                                }
                            }
                        }
                        // Coba 1-byte varint
                        if (!zeroed && tpIdx >= 1) {
                            const lenByte = buf[tpIdx - 1];
                            if (lenByte > 0 && lenByte < 250 && !(lenByte & 0x80)) {
                                const nb = Buffer.from(buf);
                                nb[tpIdx - 1] = 0;
                                for (let k = 0; k < lenByte && tpIdx + k < nb.length; k++) nb[tpIdx + k] = 0;
                                buf = nb; modified = true; tpCount++; zeroed = true;
                                searchFrom = tpIdx + lenByte;
                            }
                        }
                        if (!zeroed) searchFrom = tpIdx + tpBytes.length;
                    }
                    if (tpCount > 0) patchLog.push(`tp_url+ffanti_url: ${tpCount}x cleared`);
                }

                // ── Patch 3: GIN URLs → kosong ────────────────────────────
                const ginPrefixes = [
                    'gin.freefiremobile.com',
                    'ffanti.freefiremobile.com',
                    'grtc.freefiremobile.com',
                ];
                for (const prefix of ginPrefixes) {
                    const r = zeroOutStringField(buf, prefix);
                    if (r.patched) {
                        buf = r.buf; modified = true;
                        patchLog.push(`${prefix}: cleared`);
                    }
                }

                // ── Patch 4: BLACKLIST SPLICE-OUT (FIX v3) ───────────────
                // Splice seluruh field 12 sub-message dari buffer.
                // TIDAK ada ff_anti_config_desc zero-out (DIHAPUS — penyebab corrupt).
                {
                    const blResult = patchBlacklist(buf);
                    if (blResult.patched) {
                        buf = blResult.buf;
                        modified = true;
                        patchLog.push(`blacklist: ${blResult.count}x spliced-out`);
                    } else {
                        // Fallback: cari sequence ban klasik dan splice-out manual
                        // Ini handle edge case kalau patchBlacklist miss karena tag 0x62 tidak ada
                        const banPatterns = [
                            Buffer.from([0x62, 0x02, 0x08, 0x01]),  // ban_reason=1
                            Buffer.from([0x62, 0x02, 0x08, 0x02]),  // ban_reason=2
                            Buffer.from([0x62, 0x02, 0x08, 0x03]),  // ban_reason=3
                            Buffer.from([0x62, 0x02, 0x08, 0x04]),  // ban_reason=4 (SKINMOD)
                            Buffer.from([0x62, 0x03, 0x08, 0xF6, 0x07]), // ban_reason=1014
                        ];
                        for (const pat of banPatterns) {
                            let si = buf.indexOf(pat);
                            while (si !== -1) {
                                // Splice out: tag(1) + len(1) + content(len)
                                const msgLen    = pat[1]; // second byte = length
                                const totalSize = 1 + 1 + msgLen;
                                const before    = buf.slice(0, si);
                                const after     = buf.slice(si + totalSize);
                                buf = Buffer.concat([before, after]);
                                modified = true;
                                patchLog.push(`blacklist fallback splice: ban_reason=${pat[3]}`);
                                si = buf.indexOf(pat); // cari lagi dari awal (offset berubah)
                            }
                        }
                    }
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
                } catch (_) {}

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

                console.log(`[MAJORLOGIN] uid=${uid} region=${region} modified=${modified} patches=[${patchLog.join(', ')}]`);
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

    console.log('[MAJORLOGIN] Active → splice-out blacklist v3 (no ff_anti zero-out)');
}

module.exports = { init };
