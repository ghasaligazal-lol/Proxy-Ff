'use strict';
// modules/majorlogin.js — Binary patch RAFIN response (SAFE version)
// Strategi: 
//   1. Blacklist (field 12) → SPLICE OUT seluruh field (tag+len+content). Bukan zero-out.
//   2. server_url → replace in-place / length-adjusted.
//   3. String fields anticheat (tp_url, ffanti, gin, ano) → set length=0 + hapus content.
// Tidak ada zero-out tag yang merusak struktur protobuf → client tidak error Unconsumed data.

const _PROXY_FULL_URL = process.env.PROXY_URL || 'https://proxy-reza-kontolodon-memek-luu.up.railway.app/';
const TARGET_SERVER_URL = _PROXY_FULL_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

let MajorLoginRes = null;
let RAFIN         = null;

protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        MajorLoginRes = root.lookupType('freefire.MajorLoginRes');
        RAFIN         = root.lookupType('freefire.RAFIN');
        const msg = '[MAJORLOGIN] Proto loaded OK (v3 safe-splice)';
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
    if (!bl) return null;
    const reason = BAN_REASON_MAP[bl.ban_reason] || `code_${bl.ban_reason}`;
    const banType = bl.ban_type ? ` (${bl.ban_type})` : '';
    const exp    = bl.expire_duration ? `${bl.expire_duration}s` : 'permanent';
    return `BAN: ${reason}${banType} | expire: ${exp}`;
}
function formatQueue(q) {
    if (!q || q.allow) return null;
    return `QUEUE pos:${q.queue_position} wait:${q.need_wait_secs}s`;
}

/**
 * Baca length-delimited field length varint mulai dari posisi pos.
 * Return { len, size } atau null.
 */
function readVarintLen(buf, pos) {
    if (pos >= buf.length) return null;
    let len = 0, shift = 0, size = 0;
    while (pos + size < buf.length) {
        const b = buf[pos + size];
        size++;
        len |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
        if (size > 5) return null;
    }
    return { len, size };
}

/**
 * patchStringInBuf — replace string di binary proto.
 * Support length berbeda dengan update varint.
 */
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

    // Cari length varint sebelum content
    let lengthVarintIdx = -1;
    let lengthVarintSize = 0;

    if (idx >= 1 && buf[idx - 1] === oldBytes.length) {
        lengthVarintIdx = idx - 1;
        lengthVarintSize = 1;
    } else if (idx >= 2) {
        const b0 = buf[idx - 2], b1 = buf[idx - 1];
        if ((b0 & 0x80) && ((b0 & 0x7f) | ((b1 & 0x7f) << 7)) === oldBytes.length) {
            lengthVarintIdx = idx - 2;
            lengthVarintSize = 2;
        }
    }

    if (lengthVarintIdx === -1) {
        // Fallback zero-pad (jarang terjadi)
        const padded = Buffer.alloc(oldBytes.length, 0x20);
        newBytes.copy(padded, 0, 0, Math.min(newBytes.length, padded.length));
        const result = Buffer.from(buf);
        padded.copy(result, idx);
        return { buf: result, patched: true };
    }

    const newLen = newBytes.length;
    let newVarint;
    if (newLen < 128) {
        newVarint = Buffer.from([newLen]);
    } else {
        newVarint = Buffer.from([(newLen & 0x7f) | 0x80, newLen >> 7]);
    }

    const before = buf.slice(0, lengthVarintIdx);
    const after  = buf.slice(idx + oldBytes.length);
    const result = Buffer.concat([before, newVarint, newBytes, after]);
    return { buf: result, patched: true };
}

/**
 * emptyStringByPrefix — set string field length = 0 dan hapus content.
 * Aman: tidak meninggalkan tag rusak.
 */
function emptyStringByPrefix(buf, prefix) {
    const prefixBytes = Buffer.from(prefix, 'utf8');
    let searchFrom = 0;
    let count = 0;
    let result = buf;

    while (true) {
        const idx = result.indexOf(prefixBytes, searchFrom);
        if (idx === -1) break;

        // Cari length varint
        let lenStart = -1;
        let totalLen = 0;
        let varintSize = 0;

        if (idx >= 2) {
            const b0 = result[idx - 2], b1 = result[idx - 1];
            if (b0 & 0x80) {
                totalLen = (b0 & 0x7f) | ((b1 & 0x7f) << 7);
                if (totalLen > 0 && totalLen < 400 && idx + totalLen <= result.length) {
                    lenStart = idx - 2;
                    varintSize = 2;
                }
            }
        }
        if (lenStart === -1 && idx >= 1) {
            const b0 = result[idx - 1];
            if (b0 > 0 && b0 < 128) {
                totalLen = b0;
                if (idx + totalLen <= result.length) {
                    lenStart = idx - 1;
                    varintSize = 1;
                }
            }
        }

        if (lenStart === -1) {
            searchFrom = idx + prefixBytes.length;
            continue;
        }

        // Splice: ganti length varint jadi 0, hapus content
        const before = result.slice(0, lenStart);
        const after  = result.slice(idx + totalLen);
        result = Buffer.concat([before, Buffer.from([0x00]), after]);
        count++;
        searchFrom = lenStart + 1;
    }

    return { buf: result, patched: count > 0, count };
}

/**
 * removeBlacklistField — SPLICE OUT seluruh field 12 (tag 0x62 + length + content).
 * Ini yang paling aman. Tidak ada residual byte.
 * Support ban_type string (firstByte bisa 0x22).
 */
function removeBlacklistField(buf) {
    let result = Buffer.from(buf);
    let removed = 0;
    let i = 0;

    while (i < result.length - 1) {
        if (result[i] === 0x62) { // field 12, wiretype 2
            const lenInfo = readVarintLen(result, i + 1);
            if (!lenInfo) { i++; continue; }

            const { len: msgLen, size: varintSize } = lenInfo;
            const totalFieldSize = 1 + varintSize + msgLen;

            if (msgLen > 0 && msgLen < 200 && (i + totalFieldSize) <= result.length) {
                // Optional sanity: cek apakah nested terlihat seperti blacklist
                // (boleh 0x08, 0x10, atau 0x22 untuk ban_type)
                const contentStart = i + 1 + varintSize;
                const firstByte = result[contentStart];
                if (firstByte === 0x08 || firstByte === 0x10 || firstByte === 0x22 || firstByte === 0x18) {
                    // Splice out seluruh field
                    const before = result.slice(0, i);
                    const after  = result.slice(i + totalFieldSize);
                    result = Buffer.concat([before, after]);
                    removed++;
                    console.log(`[MAJORLOGIN-PATCH] blacklist field spliced out at ${i}, len=${msgLen}`);
                    // Jangan naikkan i, karena buffer sudah berubah
                    continue;
                }
            }
        }
        i++;
    }

    return { buf: result, patched: removed > 0, count: removed };
}

/**
 * removeLengthDelimitedFieldByTag — generic remove field by tag bytes (untuk multi-byte tag)
 */
function removeFieldByTag(buf, tagBytes) {
    let result = Buffer.from(buf);
    let removed = 0;
    let searchFrom = 0;

    while (true) {
        const idx = result.indexOf(tagBytes, searchFrom);
        if (idx === -1) break;

        const lenInfo = readVarintLen(result, idx + tagBytes.length);
        if (!lenInfo) {
            searchFrom = idx + 1;
            continue;
        }
        const { len: msgLen, size: varintSize } = lenInfo;
        const totalSize = tagBytes.length + varintSize + msgLen;

        if (msgLen >= 0 && msgLen < 300 && (idx + totalSize) <= result.length) {
            const before = result.slice(0, idx);
            const after  = result.slice(idx + totalSize);
            result = Buffer.concat([before, after]);
            removed++;
            // continue from same position
            searchFrom = idx;
        } else {
            searchFrom = idx + 1;
        }
    }
    return { buf: result, patched: removed > 0, count: removed };
}

function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body     = req.body;
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');

        const reqInfo = Buffer.isBuffer(body) && body.length > 0 ? decodeReqFields(body) : {};
        const openId  = reqInfo.open_id || null;

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
                let modified = false;

                // ── 404 account_not_found → pass-through ──────────────────────
                if (proxyRes.statusCode === 404) {
                    const bodyStr = buf.toString('utf8');
                    if (bodyStr.includes('account_not_found')) {
                        console.log('[MAJORLOGIN] 404 account_not_found → guest/new account, pass-through');
                        tglog.send(`ℹ️ <b>MajorLogin</b>\n404 account_not_found — akun baru masuk register flow\nopen_id: ${reqInfo.open_id || '-'}`);
                        const headers = { ...proxyRes.headers, 'content-length': buf.length };
                        delete headers['transfer-encoding'];
                        res.writeHead(404, headers);
                        return res.end(buf);
                    }
                }

                // ── Patch 1: server_url (field 10) → proxy domain ───────────
                {
                    const GARENA_SERVER_HOSTS = [
                        'loginbp.ggpolarbear.com',
                        'clientbp.ggpolarbear.com',
                        'loginbp.ggpolarbear.com/',
                        'clientbp.ggpolarbear.com/',
                    ];
                    let serverUrlPatched = false;
                    for (const garenaHost of GARENA_SERVER_HOSTS) {
                        const withHttps = 'https://' + garenaHost.replace(/\/$/, '');
                        let r = patchStringInBuf(buf, withHttps, 'https://' + TARGET_SERVER_URL);
                        if (r.patched) {
                            buf = r.buf; modified = true; serverUrlPatched = true;
                            patchLog.push(`server_url: "${withHttps}" → "https://${TARGET_SERVER_URL}"`);
                        }
                        const bareHost = garenaHost.replace(/\/$/, '');
                        r = patchStringInBuf(buf, bareHost, TARGET_SERVER_URL);
                        if (r.patched) {
                            buf = r.buf; modified = true; serverUrlPatched = true;
                            patchLog.push(`server_url bare: "${bareHost}" → "${TARGET_SERVER_URL}"`);
                        }
                    }
                    // Fallback decode
                    if (!serverUrlPatched && RAFIN) {
                        try {
                            const rafinPeek = RAFIN.toObject(RAFIN.decode(buf), { defaults: false, longs: String });
                            const cur = (rafinPeek.server_url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
                            if (cur && cur !== TARGET_SERVER_URL && cur.length > 0) {
                                const r2 = patchStringInBuf(buf, cur, TARGET_SERVER_URL);
                                if (r2.patched) {
                                    buf = r2.buf; modified = true;
                                    patchLog.push(`server_url fallback: "${cur}" → "${TARGET_SERVER_URL}"`);
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }
                }

                // ── Patch 2: Blacklist field 12 → SPLICE OUT (paling penting) ─
                {
                    const bl = removeBlacklistField(buf);
                    if (bl.patched) {
                        buf = bl.buf;
                        modified = true;
                        patchLog.push(`blacklist: ${bl.count}x removed (splice)`);
                    }
                }

                // ── Patch 3: kosongkan anticheat / GIN / ffanti string fields ─
                // Pakai empty (length=0) biar struktur tetap valid
                const antiPrefixes = [
                    'csoversea.stronghold.freefiremobile.com',
                    'gin.freefiremobile.com',
                    'ffanti.freefiremobile.com',
                    'grtc.freefiremobile.com',
                    'csoversea.castle.freefiremobile.com',
                ];
                for (const prefix of antiPrefixes) {
                    const r = emptyStringByPrefix(buf, prefix);
                    if (r.patched) {
                        buf = r.buf;
                        modified = true;
                        patchLog.push(`${prefix.substring(0, 28)}...: emptied x${r.count}`);
                    }
                }

                // ── Patch 4: optional remove ff_anti_config_desc jika ada ─────
                // Tag field 21 wiretype 2 = 0xAA 0x01
                {
                    const r = removeFieldByTag(buf, Buffer.from([0xAA, 0x01]));
                    if (r.patched) {
                        buf = r.buf;
                        modified = true;
                        patchLog.push(`ff_anti_config_desc: ${r.count}x removed`);
                    }
                }

                // ── Logging & TG ──────────────────────────────────────────────
                let uid = '?', region = '?', token = '?', ttl = 0;
                let banStr = null, queueStr = null;
                try {
                    if (RAFIN) {
                        const rafinObj = RAFIN.toObject(RAFIN.decode(buf), { defaults: true, longs: String });
                        uid    = rafinObj.account_id || '?';
                        region = rafinObj.lock_region || rafinObj.noti_region || '?';
                        token  = (rafinObj.token || '').substring(0, 20) + '...';
                        ttl    = rafinObj.ttl || 0;
                        banStr   = rafinObj.blacklist  ? formatBlacklist(rafinObj.blacklist)  : null;
                        queueStr = rafinObj.queue_info ? formatQueue(rafinObj.queue_info)      : null;
                    }
                } catch (_) {}

                const status = modified ? 'PATCHED' : 'LOGIN OK';
                const lines  = [`<b>MajorLogin — ${status}</b>`, ''];
                lines.push(`UID: <code>${uid}</code>`);
                lines.push(`open_id: <code>${openId || '?'}</code>`);
                if (reqInfo.client_version) lines.push(`ver: ${reqInfo.client_version}`);
                lines.push(`region: ${region}`);
                lines.push(`ip: ${clientIp}`);
                lines.push(`token: <code>${token}</code>`);
                if (ttl) lines.push(`ttl: ${ttl}s`);
                if (patchLog.length) lines.push(`patch:\n  ${patchLog.join('\n  ')}`);
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

    console.log('[MAJORLOGIN] Active → safe binary-splice mode v3');
}


module.exports = { init };
