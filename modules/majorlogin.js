'use strict';
// modules/majorlogin.js — Pure binary proto patch (NO decode/re-encode)
// Strategy: parse proto wire format field-by-field, surgically patch in-place.
//           Passes through ALL unknown fields untouched → no "Unconsumed data".
// Patches:
//   - field 10 server_url : clientbp/loginbp → proxy
//   - field 12 blacklist  : DROPPED (ban bypass)
//   - field 14 tp_url     : DROPPED (anticheat bypass)
//   - field 16 ano_url    : DROPPED (GIN bypass)

const https = require('https');
const tglog = require('./tglog');
const { MY_IP } = require('../gamevar');

// ── Proto varint helpers ──────────────────────────────────────────────────────

function readVarint(buf, pos) {
    // Gunakan BigInt untuk field 64-bit aman, tapi return Number untuk field 32-bit.
    // JS bitwise (|=, <<) hanya 32-bit signed — uint64 account_id akan overflow/corrupt
    // kalau di-shift lebih dari 31 bit. Fix: pakai BigInt accumulator, konversi ke Number
    // hanya jika nilainya masih dalam range safe integer (field varint32 biasa).
    let result = BigInt(0), shift = BigInt(0);
    while (pos < buf.length) {
        const b = buf[pos++];
        result |= BigInt(b & 0x7F) << shift;
        shift += BigInt(7);
        if (!(b & 0x80)) break;
    }
    // Konversi ke Number jika aman (field 32-bit), biarkan BigInt untuk field 64-bit
    const asNum = Number(result);
    return { value: Number.isSafeInteger(asNum) ? asNum : result, pos };
}

function encodeVarint(n) {
    // Handle BigInt input (dari readVarint untuk field 64-bit)
    // n >>>= 7 tidak valid untuk BigInt — gunakan >> BigInt(7)
    const parts = [];
    if (typeof n === 'bigint') {
        do {
            let b = Number(n & BigInt(0x7F));
            n >>= BigInt(7);
            if (n) b |= 0x80;
            parts.push(b);
        } while (n);
    } else {
        do {
            let b = n & 0x7F;
            n >>>= 7;
            if (n) b |= 0x80;
            parts.push(b);
        } while (n);
    }
    return Buffer.from(parts);
}

function encodeLenField(fieldNum, contentBuf) {
    const tag = encodeVarint((fieldNum << 3) | 2);
    const len = encodeVarint(contentBuf.length);
    return Buffer.concat([tag, len, contentBuf]);
}

// ── Decode request fields for logging ────────────────────────────────────────

function decodeReqFields(buf) {
    const out = {};
    try {
        let pos = 0;
        while (pos < buf.length) {
            const r = readVarint(buf, pos);
            pos = r.pos;
            const fieldNum = r.value >>> 3;
            const wireType = r.value & 0x7;
            if (wireType === 0) {
                const v = readVarint(buf, pos);
                pos = v.pos;
                if (fieldNum === 98) out.is_vpn = v.value;
            } else if (wireType === 2) {
                const l = readVarint(buf, pos);
                pos = l.pos;
                const s = buf.slice(pos, pos + l.value).toString('utf8');
                pos += l.value;
                if (fieldNum === 22)  out.open_id        = s;
                if (fieldNum === 23)  out.open_id_type   = s;
                if (fieldNum === 29)  out.access_token   = s.substring(0, 20) + '...';
                if (fieldNum === 57)  out.client_version = s;
                if (fieldNum === 83)  out.version_code   = s;
                if (fieldNum === 3)   out.device_id      = s;
                if (fieldNum === 20)  out.client_ip      = s;
                if (fieldNum === 11)  out.network_type   = s;
            } else if (wireType === 5) { pos += 4;
            } else if (wireType === 1) { pos += 8;
            } else { break; }
        }
    } catch (_) {}
    return out;
}

// ── Decode RAFIN response (read-only, for logging only) ──────────────────────

function decodeRafinForLog(buf) {
    const out = {};
    try {
        let pos = 0;
        while (pos < buf.length) {
            const r = readVarint(buf, pos);
            pos = r.pos;
            const fieldNum = r.value >>> 3;
            const wireType = r.value & 0x7;
            if (wireType === 0) {
                const v = readVarint(buf, pos);
                pos = v.pos;
                if (fieldNum === 1)  out.account_id = v.value;
                if (fieldNum === 9)  out.ttl        = v.value;
            } else if (wireType === 2) {
                const l = readVarint(buf, pos);
                pos = l.pos;
                const bytes = buf.slice(pos, pos + l.value);
                const s = bytes.toString('utf8');
                pos += l.value;
                if (fieldNum === 2)  out.lock_region = s;
                if (fieldNum === 3)  out.noti_region = s;
                if (fieldNum === 8)  out.token       = s;
                if (fieldNum === 10) out.server_url  = s;
                if (fieldNum === 12) {
                    // parse BlacklistInfoRes submessage
                    const bl = {};
                    let bp = 0;
                    while (bp < bytes.length) {
                        const br = readVarint(bytes, bp); bp = br.pos;
                        const bfn = br.value >>> 3, bwt = br.value & 7;
                        if (bwt === 0) {
                            const bv = readVarint(bytes, bp); bp = bv.pos;
                            if (bfn === 1) bl.ban_reason      = bv.value;
                            if (bfn === 2) bl.expire_duration = bv.value;
                            if (bfn === 3) bl.ban_time        = bv.value;
                        } else break;
                    }
                    out.blacklist = bl;
                }
                if (fieldNum === 13) {
                    // parse LoginQueueInfo
                    const qi = {};
                    let qp = 0;
                    while (qp < bytes.length) {
                        const qr = readVarint(bytes, qp); qp = qr.pos;
                        const qfn = qr.value >>> 3, qwt = qr.value & 7;
                        if (qwt === 0) {
                            const qv = readVarint(bytes, qp); qp = qv.pos;
                            if (qfn === 1) qi.allow          = !!qv.value;
                            if (qfn === 2) qi.queue_position = qv.value;
                            if (qfn === 3) qi.need_wait_secs = qv.value;
                            if (qfn === 4) qi.queue_is_full  = !!qv.value;
                        } else break;
                    }
                    out.queue_info = qi;
                }
            } else if (wireType === 5) { pos += 4;
            } else if (wireType === 1) { pos += 8;
            } else { break; }
        }
    } catch (_) {}
    return out;
}

// ── BAN info formatter ────────────────────────────────────────────────────────

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

// ── CORE: Pure binary proto field-by-field patcher ───────────────────────────
// Reads every field tag+value from src, rewrites to dst:
//   - field 10 (server_url): replace value with proxyUrlBuf
//   - field 12 (blacklist) : DROP the entire TLV
//   - field 14 (tp_url)    : DROP
//   - field 16 (ano_url)   : DROP
//   - everything else      : copy verbatim (unknown fields preserved!)

function patchRafinBinary(buf, proxyUrlBuf) {
    const chunks  = [];
    const patches = [];
    let   pos     = 0;

    // Fields to drop completely (tag written, content replaced with nothing)
    const DROP_FIELDS = new Set([12, 14, 16]);

    while (pos < buf.length) {
        const tagStart = pos;

        // Read tag varint
        const tr = readVarint(buf, pos);
        pos = tr.pos;
        const tag      = tr.value;
        const fieldNum = tag >>> 3;
        const wireType = tag & 0x7;

        if (wireType === 0) {
            // varint field — read value
            const vr = readVarint(buf, pos);
            pos = vr.pos;
            // copy tag+value verbatim
            chunks.push(buf.slice(tagStart, pos));

        } else if (wireType === 1) {
            // 64-bit fixed — copy verbatim
            chunks.push(buf.slice(tagStart, pos + 8));
            pos += 8;

        } else if (wireType === 2) {
            // length-delimited
            const lr       = readVarint(buf, pos);
            pos            = lr.pos;
            const dataLen  = lr.value;
            const dataEnd  = pos + dataLen;
            const content  = buf.slice(pos, dataEnd);
            pos            = dataEnd;

            if (fieldNum === 10) {
                // server_url → SELALU replace ke proxy, kecuali sudah pointing ke proxy sendiri.
                // Bug lama: kondisi if hanya cek clientbp/loginbp — kalau server kirim domain
                // lain (staging, backup, freefiremobile.com, dll) → lolos ke game → game connect
                // langsung ke Garena, bypass semua patch ban & GIN intercept.
                // Fix: invert logic — REPLACE kecuali sudah proxy. Bukan whitelist domain lama.
                const oldUrl = content.toString('utf8');
                const proxyStr = proxyUrlBuf.toString();
                const alreadyProxy = oldUrl !== '' && (
                    oldUrl === proxyStr ||
                    oldUrl === proxyStr.replace(/\/$/, '') ||
                    oldUrl.startsWith(proxyStr)
                );
                if (!alreadyProxy) {
                    chunks.push(encodeLenField(10, proxyUrlBuf));
                    patches.push(`server_url: "${oldUrl || '(empty)'}" → "${proxyStr}"`);
                } else {
                    // Sudah menunjuk ke proxy — keep as-is
                    chunks.push(buf.slice(tagStart, pos));
                }
            } else if (DROP_FIELDS.has(fieldNum)) {
                // DROP: don't push anything
                const names = { 12: 'blacklist', 14: 'tp_url', 16: 'ano_url' };
                patches.push(`${names[fieldNum] || `field${fieldNum}`}: dropped (${dataLen}B)`);
            } else {
                // Pass through verbatim (includes all unknown fields from server)
                chunks.push(buf.slice(tagStart, pos));
            }

        } else if (wireType === 5) {
            // 32-bit fixed
            chunks.push(buf.slice(tagStart, pos + 4));
            pos += 4;

        } else {
            // Unknown wire type — stop and pass rest verbatim (safety)
            console.warn(`[MAJORLOGIN] unknown wire type ${wireType} at pos ${tagStart}, passing rest verbatim`);
            chunks.push(buf.slice(tagStart));
            break;
        }
    }

    return { buf: Buffer.concat(chunks), patches };
}

// ── Route handler ─────────────────────────────────────────────────────────────

function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body      = req.body;
        const rawIp     = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp  = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const reqInfo   = Buffer.isBuffer(body) && body.length > 0 ? decodeReqFields(body) : {};
        const openId    = reqInfo.open_id || null;
        const proxyBase = MY_IP.replace(/\/$/, '');
        const proxyUrlBuf = Buffer.from(proxyBase, 'utf8');

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
            // Bug #4: upstream (loginbp.ggpolarbear.com) kadang kirim gzip/deflate/br response.
            // loginProxy di proxy.js pakai proxyRes langsung tanpa decompress → kalau
            // Garena server kirim Content-Encoding: gzip, body yang diterima masih compressed
            // tapi header sudah di-strip → game receive garbage, proto parse fail.
            // Fix: decompress dulu sebelum patch, kirim plain (tanpa Content-Encoding).
            const encoding = proxyRes.headers['content-encoding'];
            const zlib = require('zlib');
            let stream = proxyRes;
            if (encoding === 'gzip')    stream = proxyRes.pipe(zlib.createGunzip());
            else if (encoding === 'deflate') stream = proxyRes.pipe(zlib.createInflate());
            else if (encoding === 'br') stream = proxyRes.pipe(zlib.createBrotliDecompress());

            const chunks = [];
            stream.on('data', c => chunks.push(c));
            stream.on('error', (err) => {
                // Decompress gagal (upstream kirim body tidak sesuai Content-Encoding)
                // Fallback: baca raw dari proxyRes langsung
                console.log('[MAJORLOGIN] decompress error, fallback raw:', err.message);
                const rawChunks = [];
                proxyRes.on('data', c => rawChunks.push(c));
                proxyRes.on('end', () => {
                    const rawBuf = Buffer.concat(rawChunks);
                    const h = { ...proxyRes.headers };
                    delete h['transfer-encoding'];
                    h['content-length'] = rawBuf.length;
                    res.writeHead(proxyRes.statusCode, h);
                    res.end(rawBuf);
                });
            });
            stream.on('end', () => {
                let buf = Buffer.concat(chunks);

                // Helper: buat headers bersih (hapus encoding/length lama)
                function cleanHeaders() {
                    const h = { ...proxyRes.headers };
                    delete h['content-encoding'];   // sudah di-decompress di atas
                    delete h['transfer-encoding'];  // kita set content-length manual
                    delete h['content-length'];
                    return h;
                }

                // 404 account_not_found → pass-through (register flow)
                if (proxyRes.statusCode === 404) {
                    const bodyStr = buf.toString('utf8');
                    if (bodyStr.includes('account_not_found')) {
                        console.log('[MAJORLOGIN] 404 account_not_found → pass-through (register flow)');
                        tglog.send(`ℹ️ <b>MajorLogin</b>\n404 account_not_found — register flow\nopen_id: ${openId || '?'}`);
                        const h = cleanHeaders();
                        h['content-length'] = buf.length;
                        res.writeHead(404, h);
                        return res.end(buf);
                    }
                }

                // Only patch 200 binary proto responses
                if (proxyRes.statusCode !== 200 || buf.length === 0) {
                    const h = cleanHeaders();
                    h['content-length'] = buf.length;
                    res.writeHead(proxyRes.statusCode, h);
                    return res.end(buf);
                }

                // ── BINARY PATCH (no decode/re-encode) ───────────────────────
                let patched, patches;
                try {
                    const result = patchRafinBinary(buf, proxyUrlBuf);
                    patched  = result.buf;
                    patches  = result.patches;
                    console.log(`[MAJORLOGIN] binary patch OK: ${buf.length}B → ${patched.length}B patches=[${patches.join(', ')}]`);
                } catch (err) {
                    // If binary patch itself crashes (should never happen), pass original
                    console.error('[MAJORLOGIN] binary patch FAILED:', err.message, '— passing original');
                    patched = buf;
                    patches = [];
                }

                // ── Logging (decode patched buf read-only) ────────────────────
                let uid = '?', region = '?', token = '?', ttl = 0;
                let banStr = null, queueStr = null;
                try {
                    // Decode the ORIGINAL buf for ban logging (before blacklist was dropped)
                    const orig = decodeRafinForLog(buf);
                    banStr   = orig.blacklist ? formatBlacklist(orig.blacklist) : null;
                    // Decode patched for normal fields
                    const dec = decodeRafinForLog(patched);
                    uid    = dec.account_id || '?';
                    region = dec.lock_region || dec.noti_region || '?';
                    token  = (dec.token || '').substring(0, 20) + '...';
                    ttl    = dec.ttl || 0;
                    queueStr = dec.queue_info ? formatQueue(dec.queue_info) : null;
                } catch (_) {}

                const status = patches.length > 0 ? '🔑 PATCHED' : '✅ LOGIN OK';
                const lines  = [`<b>MajorLogin — ${status}</b>`, ''];
                lines.push(`👤 UID: <code>${uid}</code>`);
                lines.push(`🆔 open_id: <code>${openId || '?'}</code>`);
                if (reqInfo.client_version) lines.push(`📱 ver: ${reqInfo.client_version}`);
                lines.push(`🌏 region: ${region}`);
                lines.push(`🌐 ip: ${clientIp}`);
                lines.push(`🎫 token: <code>${token}</code>`);
                if (ttl)     lines.push(`⏱ ttl: ${ttl}s`);
                if (banStr)  { lines.push(''); lines.push(banStr); }
                if (patches.length) lines.push(`🔧 patch:\n  ${patches.join('\n  ')}`);
                if (queueStr) { lines.push(''); lines.push(queueStr); }

                tglog.send(lines.join('\n'));

                const newHeaders = cleanHeaders();
                newHeaders['content-length'] = patched.length;
                res.writeHead(proxyRes.statusCode, newHeaders);
                res.end(patched);
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

    console.log('[MAJORLOGIN] Active → pure binary patch mode (no proto decode/re-encode)');
}

module.exports = { init };
