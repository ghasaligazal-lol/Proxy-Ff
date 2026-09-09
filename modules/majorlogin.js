'use strict';
// modules/majorlogin.js — Binary string-patch RAFIN response
// Strategi: patch buffer langsung (string replace di binary)
// Tidak re-encode proto → tidak ada risiko field mapping salah
//
// Patches:
//   Patch 1 — field 10 server_url         : patch ke domain PROXY (MY_IP)
//             → wajib supaya GetLoginData + semua clientbp request lewat proxy
//             → kalau server_url = loginbp/clientbp, game bypass proxy & CECNLHCONMI tidak ter-patch
//   Patch 2 — field 14 tp_url             : dikosongkan (anticheat bypass)
//   Patch 3 — field 16 ano_url + gin URLs : dikosongkan (GIN bypass)
//   Patch 4 — field 12 blacklist proto    : zero-out semua ban fields
//             (ban_reason, expire_duration, ban_time) termasuk
//             multi-byte varint & ban_reason=1014 (IN_GAME_AUTO_NEW)
//   Patch 5 — ffanti_url (field 19)       : dikosongkan (sama dengan tp_url)
//
// FIX SESSION 2: GetLoginData bypass proxy karena server_url = loginbp/clientbp
// Root cause: game gunakan server_url untuk semua request post-login termasuk GetLoginData.
// server_url HARUS = domain proxy sendiri bukan loginbp/clientbp.

// Ambil domain proxy dari env (sama dengan gamevar.js MY_IP)
// Strip trailing slash + https:// → jadi bare hostname untuk proto string patch
const _PROXY_FULL_URL = process.env.PROXY_URL || 'https://proxy-reza-kontolodon-memek-luu.up.railway.app/';
const TARGET_SERVER_URL = _PROXY_FULL_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const crypto   = require('crypto');
const tglog    = require('./tglog');

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

/**
 * patchStringInBuf — patch binary proto buffer langsung
 * Cari string lama di buffer, replace dengan string baru (zero-padded ke panjang sama)
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

    // Panjang berbeda — harus update length varint
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
        console.log(`[MAJORLOGIN] patchStringInBuf: varint not found for "${oldStr.substring(0,30)}", using zero-pad`);
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
 * zeroOutStringField — zero-out string field di proto buffer berdasarkan prefix
 * Cari prefix string, lalu zero-out length varint + seluruh content
 * Support multi-byte varint (string panjang > 127 byte)
 */
function zeroOutStringField(buf, prefix) {
    const prefixBytes = Buffer.from(prefix, 'utf8');
    const idx = buf.indexOf(prefixBytes);
    if (idx === -1) return { buf, patched: false };

    // Cari length varint sebelum string
    // Bisa 1 byte (length < 128) atau 2 byte (length 128-16383)
    let lenStart = -1;
    let totalLen = 0;

    if (idx >= 2) {
        const b0 = buf[idx - 2], b1 = buf[idx - 1];
        if (b0 & 0x80) {
            // 2-byte varint
            totalLen = (b0 & 0x7f) | ((b1 & 0x7f) << 7);
            if (totalLen > 0 && totalLen < 300) {
                lenStart = idx - 2;
            }
        }
    }
    if (lenStart === -1 && idx >= 1) {
        const b0 = buf[idx - 1];
        if (b0 > 0 && b0 < 128 && !(b0 & 0x80)) {
            totalLen = b0;
            lenStart = idx - 1;
        }
    }

    if (lenStart === -1) {
        console.log(`[MAJORLOGIN] zeroOutStringField: varint not found for "${prefix.substring(0,30)}"`);
        return { buf, patched: false };
    }

    const result = Buffer.from(buf);
    // Zero-out length varint byte(s)
    const varintSize = (idx - lenStart);
    for (let v = 0; v < varintSize; v++) result[lenStart + v] = 0;
    // Zero-out string content
    for (let i = 0; i < totalLen && idx + i < result.length; i++) {
        result[idx + i] = 0;
    }
    return { buf: result, patched: true };
}

/**
 * patchBlacklist — zero-out semua blacklist field (field 12 wiretype 2 = tag 0x62)
 * Fix: support multi-byte length varint untuk blacklist besar
 * Fix: juga handle ban_reason=1014 (2-byte varint dalam nested message)
 */
function patchBlacklist(buf) {
    let result = Buffer.from(buf);
    let patched = false;
    let patchCount = 0;
    let i = 0;

    while (i < result.length - 2) {
        // Field 12, wiretype 2 = tag byte 0x62
        if (result[i] === 0x62) {
            // Baca length varint (bisa 1 atau 2 byte)
            let msgLen = 0;
            let varintSize = 0;
            const b0 = result[i + 1];

            if (b0 & 0x80) {
                // 2-byte varint
                const b1 = result[i + 2];
                msgLen = (b0 & 0x7f) | ((b1 & 0x7f) << 7);
                varintSize = 2;
            } else {
                msgLen = b0;
                varintSize = 1;
            }

            if (msgLen > 0 && msgLen < 50 && (i + 1 + varintSize + msgLen) <= result.length) {
                const contentStart = i + 1 + varintSize;
                const firstByte = result[contentStart];

                // Verify: field 1 (ban_reason varint) = tag 0x08
                // Field 2 (expire_duration varint) = tag 0x10
                if (firstByte === 0x08 || firstByte === 0x10) {
                    console.log(`[MAJORLOGIN-PATCH] blacklist at offset ${i}, len=${msgLen} varintSize=${varintSize} → zeroed`);

                    // Zero-out length varint byte(s)
                    for (let v = 0; v < varintSize; v++) result[i + 1 + v] = 0;
                    // Zero-out message content
                    for (let j = 0; j < msgLen; j++) result[contentStart + j] = 0;

                    patched = true;
                    patchCount++;
                    i += 1 + varintSize + msgLen;
                    continue;
                }
            }
        }
        i++;
    }

    return { buf: result, patched, count: patchCount };
}

/**
 * patchFfAntiConfig — patch ff_anti_config_desc nested message
 * Set ff_anti_config_desc.enable = false (field 2 bool dalam nested)
 * Field ff_anti_config_desc kemungkinan field 25 atau field dekat akhir RAFIN
 * Approach: cari sequence { region: "ID" } di nested, lalu flip enable flag
 */
function patchFfAntiEnable(buf) {
    // ff_anti_config_desc.enable = field 2, wiretype 0, bool true = 0x10 0x01
    // Ganti 0x10 0x01 menjadi 0x10 0x00 HANYA dalam konteks setelah marker nested
    // Marker: cari string "enable" tidak ada di proto binary (proto encode by field number)
    // Approach lebih aman: cari byte sequence [0x10, 0x01] setelah ffanti/csoversea area
    // Tapi ini bisa false-positive. Approach paling aman: skip dan zero-out ffanti_url saja.
    // Game tidak akan konek ke ffanti jika URL-nya kosong.
    return { buf, patched: false };
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

                // ── Patch 1: server_url (field 10) → loginbp.ggpolarbear.com ──
                if (RAFIN) {
                    try {
                        const rafinPeek = RAFIN.toObject(RAFIN.decode(buf), { defaults: false, longs: String });
                        const currentServerUrl = (rafinPeek.server_url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
                        if (currentServerUrl && currentServerUrl !== TARGET_SERVER_URL) {
                            const r = patchStringInBuf(buf, currentServerUrl, TARGET_SERVER_URL);
                            if (r.patched) {
                                buf = r.buf;
                                modified = true;
                                patchLog.push(`server_url: "${currentServerUrl}" → "${TARGET_SERVER_URL}"`);
                            } else {
                                console.log(`[MAJORLOGIN] server_url patch skip: "${currentServerUrl}" tidak ditemukan di buffer`);
                            }
                        } else if (!currentServerUrl) {
                            console.log('[MAJORLOGIN] server_url kosong dari Garena → skip patch');
                        }
                    } catch (peekErr) {
                        console.log(`[MAJORLOGIN] server_url peek failed: ${peekErr.message} → skip patch`);
                    }
                }

                // ── Patch 2 + 5: tp_url (field 14) + ffanti_url ───────────────
                // Keduanya berisi "csoversea.stronghold.freefiremobile.com;IP;IP;..."
                // Scan SEMUA kemunculan prefix ini (bisa muncul 2x: tp_url & ffanti_url)
                {
                    const tpPrefix = 'csoversea.stronghold.freefiremobile.com';
                    const tpBytes  = Buffer.from(tpPrefix, 'utf8');
                    let searchFrom = 0;
                    let tpCount = 0;

                    while (true) {
                        const tpIdx = buf.indexOf(tpBytes, searchFrom);
                        if (tpIdx === -1) break;

                        // Cari length varint sebelumnya (1 atau 2 byte)
                        let zeroed = false;

                        // Coba 2-byte varint dulu
                        if (tpIdx >= 2) {
                            const b0 = buf[tpIdx - 2], b1 = buf[tpIdx - 1];
                            if ((b0 & 0x80) && !(b1 & 0x80)) {
                                const totalLen = (b0 & 0x7f) | (b1 << 7);
                                if (totalLen > 0 && totalLen < 300) {
                                    buf[tpIdx - 2] = 0;
                                    buf[tpIdx - 1] = 0;
                                    for (let i = 0; i < totalLen && tpIdx + i < buf.length; i++) buf[tpIdx + i] = 0;
                                    modified = true;
                                    tpCount++;
                                    zeroed = true;
                                    searchFrom = tpIdx + totalLen;
                                }
                            }
                        }
                        // Coba 1-byte varint
                        if (!zeroed && tpIdx >= 1) {
                            const lenByte = buf[tpIdx - 1];
                            if (lenByte > 0 && lenByte < 250 && !(lenByte & 0x80)) {
                                buf[tpIdx - 1] = 0;
                                for (let i = 0; i < lenByte && tpIdx + i < buf.length; i++) buf[tpIdx + i] = 0;
                                modified = true;
                                tpCount++;
                                zeroed = true;
                                searchFrom = tpIdx + lenByte;
                            }
                        }

                        if (!zeroed) {
                            searchFrom = tpIdx + tpBytes.length;
                        }
                    }

                    if (tpCount > 0) {
                        patchLog.push(`tp_url+ffanti_url: ${tpCount}x dikosongkan`);
                    }
                }

                // ── Patch 3: ano_url + gin URLs → kosong ──────────────────────
                const ginPrefixes = [
                    'gin.freefiremobile.com',
                    'ffanti.freefiremobile.com',
                    'grtc.freefiremobile.com',
                ];
                for (const prefix of ginPrefixes) {
                    const r = zeroOutStringField(buf, prefix);
                    if (r.patched) {
                        buf = r.buf;
                        modified = true;
                        patchLog.push(`${prefix}: dikosongkan`);
                    }
                }

                // ── Patch 4: zero-out blacklist field (field 12) ──────────────
                // Fix: support multi-byte varint length + ban_reason=1 (IN_GAME_AUTO)
                {
                    const blResult = patchBlacklist(buf);
                    if (blResult.patched) {
                        buf = blResult.buf;
                        modified = true;
                        patchLog.push(`blacklist: ${blResult.count}x zeroed`);
                    } else {
                        // Fallback: brute-force scan semua known ban sequences
                        // ban_reason=1: 0x62 <len> 0x08 0x01
                        // ban_reason=4: 0x62 <len> 0x08 0x04
                        // ban_reason=1014: 0x62 <len> 0x08 0xF6 0x07 (varint 1014)
                        const banSeqs = [
                            Buffer.from([0x62, 0x02, 0x08, 0x01]),
                            Buffer.from([0x62, 0x02, 0x08, 0x04]),
                            Buffer.from([0x62, 0x02, 0x08, 0x02]),
                            Buffer.from([0x62, 0x02, 0x08, 0x03]),
                        ];
                        for (const seq of banSeqs) {
                            let sIdx = buf.indexOf(seq);
                            while (sIdx !== -1) {
                                buf[sIdx + 1] = 0; // len = 0
                                buf[sIdx + 2] = 0;
                                buf[sIdx + 3] = 0;
                                modified = true;
                                patchLog.push(`blacklist fallback: ban_reason=${seq[3]} zeroed`);
                                console.log(`[MAJORLOGIN-PATCH] Fallback: blacklist ban_reason=${seq[3]} at ${sIdx}`);
                                sIdx = buf.indexOf(seq, sIdx + 4);
                            }
                        }
                        // ban_reason=1014 (multi-byte varint)
                        const bl1014 = Buffer.from([0x62, 0x03, 0x08, 0xF6, 0x07]);
                        let sIdx1014 = buf.indexOf(bl1014);
                        while (sIdx1014 !== -1) {
                            buf[sIdx1014 + 1] = 0;
                            buf[sIdx1014 + 2] = 0;
                            buf[sIdx1014 + 3] = 0;
                            buf[sIdx1014 + 4] = 0;
                            modified = true;
                            patchLog.push('blacklist fallback: ban_reason=1014 zeroed');
                            console.log(`[MAJORLOGIN-PATCH] Fallback: blacklist ban_reason=1014 at ${sIdx1014}`);
                            sIdx1014 = buf.indexOf(bl1014, sIdx1014 + 5);
                        }
                    }
                }

                // ── Logging & TG ──────────────────────────────────────────────
                let uid = '?', region = '?', token = '?', ttl = 0;
                let banStr = null, queueStr = null;
                try {
                    if (RAFIN) {
                        const rafinObj = RAFIN.toObject(RAFIN.decode(buf), { defaults: true, longs: String });
                        uid    = rafinObj.account_id || '?';
                        region = rafinObj.lock_region || '?';
                        token  = (rafinObj.token || '').substring(0, 20) + '...';
                        ttl    = rafinObj.ttl || 0;
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

    console.log('[MAJORLOGIN] Active → binary-patch mode (no proto re-encode) v2');
}

module.exports = { init };
