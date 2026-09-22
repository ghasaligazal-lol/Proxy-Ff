'use strict';
// modules/majorlogin.js — v21 (fix SignatureCheckFailed: full header passthrough)
//
// PERUBAHAN v21:
// - Jangan hapus header apapun selain transfer-encoding dari upstream response
// - Log semua upstream response headers untuk debug signature
// - Pastikan content-length selalu set dari rawBuf.length (bukan dari header upstream
//   karena upstream bisa kirim header dulu sebelum gzip, Railway bisa corrupt)
// - Tambah log body hex (32 byte pertama) untuk verifikasi passthrough intact

const https    = require('https');
const crypto   = require('crypto');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

// ── Session cache: simpan GetLoginData response yang sudah dipatch ──────────
// Key = uid (string), value = { buf, headers, ts }
const GL_CACHE = new Map();
const GL_CACHE_TTL = 300 * 1000; // 5 menit

function glCacheSet(uid, buf, headers) {
    GL_CACHE.set(String(uid), { buf, headers, ts: Date.now() });
    // Bersihkan cache lama
    for (const [k, v] of GL_CACHE.entries()) {
        if (Date.now() - v.ts > GL_CACHE_TTL) GL_CACHE.delete(k);
    }
}

function glCacheGet(uid) {
    const entry = GL_CACHE.get(String(uid));
    if (!entry) return null;
    if (Date.now() - entry.ts > GL_CACHE_TTL) { GL_CACHE.delete(String(uid)); return null; }
    return entry;
}

module.exports.glCacheGet = function(uid) { return glCacheGet(uid); };

// Session store: simpan ak+aiv per UID untuk decrypt GetLoginData
const _sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 menit

function storeSession(uid, ak, aiv) {
    _sessions.set(String(uid), { ak, aiv, ts: Date.now() });
    const now = Date.now();
    for (const [k, v] of _sessions) {
        if (now - v.ts > SESSION_TTL) _sessions.delete(k);
    }
}

function getSession(uid) {
    return _sessions.get(String(uid)) || null;
}

// AES-128-CBC decrypt
function aesDecrypt(data, key, iv) {
    try {
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        decipher.setAutoPadding(true);
        return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch (_) { return null; }
}

// AES-128-CBC encrypt
function aesEncrypt(data, key, iv) {
    try {
        const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
        cipher.setAutoPadding(true);
        return Buffer.concat([cipher.update(data), cipher.final()]);
    } catch (_) { return null; }
}

const PROXY_URL = (process.env.PROXY_URL || '').replace(/\/$/, '');

let RAFIN = null;
protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        console.log('[MAJORLOGIN] v21 Proto loaded');
    })
    .catch(err => console.error('[MAJORLOGIN] Proto load err:', err.message));

function encodeVarint(val) {
    const out = [];
    while (val > 0x7f) { out.push((val & 0x7f) | 0x80); val >>>= 7; }
    out.push(val & 0x7f);
    return Buffer.from(out);
}

function readVarint(buf, pos) {
    let val = 0, shift = 0, bytes = 0;
    while (pos + bytes < buf.length) {
        const b = buf[pos + bytes];
        val |= (b & 0x7f) << shift;
        bytes++; shift += 7;
        if (!(b & 0x80)) break;
        if (shift >= 35) break;
    }
    return { val, bytes };
}

function exciseField(buf, fieldNum) {
    const out = [];
    let pos = 0;
    while (pos < buf.length) {
        const tagStart = pos;
        const { val: rawTag, bytes: tagBytes } = readVarint(buf, pos);
        if (tagBytes === 0) break;
        pos += tagBytes;
        const wireType = rawTag & 0x07;
        const fn       = rawTag >>> 3;
        if (wireType === 0) {
            const { val, bytes: vb } = readVarint(buf, pos);
            pos += vb;
            if (fn !== fieldNum) for (let i = tagStart; i < pos; i++) out.push(buf[i]);
        } else if (wireType === 2) {
            const { val: len, bytes: lb } = readVarint(buf, pos);
            pos += lb;
            const end = pos + len;
            if (fn === fieldNum) { pos = end; }
            else { for (let i = tagStart; i < end; i++) out.push(buf[i]); pos = end; }
        } else if (wireType === 5) {
            const end = pos + 4;
            if (fn !== fieldNum) for (let i = tagStart; i < end; i++) out.push(buf[i]);
            pos = end;
        } else if (wireType === 1) {
            const end = pos + 8;
            if (fn !== fieldNum) for (let i = tagStart; i < end; i++) out.push(buf[i]);
            pos = end;
        } else {
            for (let i = tagStart; i < buf.length; i++) out.push(buf[i]);
            break;
        }
    }
    return { buf: Buffer.from(out) };
}

function injectStringField(buf, fieldNum, value) {
    const tagBuf    = encodeVarint((fieldNum << 3) | 2);
    const valBuf    = Buffer.from(value, 'utf8');
    const lenVarint = encodeVarint(valBuf.length);
    return Buffer.concat([buf, tagBuf, lenVarint, valBuf]);
}

function decodeReqFields(buf) {
    const out = {};
    try {
        const r = protobuf.Reader.create(buf);
        while (r.pos < r.len) {
            const tag = r.uint32(), fn = tag >>> 3, wt = tag & 7;
            if (wt === 0) { r.uint64(); }
            else if (wt === 2) {
                const str = r.bytes().toString('utf8');
                if (fn === 22) out.open_id        = str;
                if (fn === 57) out.client_version = str;
            } else if (wt === 5) { r.fixed32();
            } else if (wt === 1) { r.fixed64();
            } else { break; }
        }
    } catch (_) {}
    return out;
}

const BAN_MAP = {0:'UNKNOWN',1:'IN_GAME_AUTO',2:'REFUND',3:'OTHERS',4:'SKINMOD',1014:'IN_GAME_AUTO_NEW'};

// ── Patch GetLoginData response: zero semua GIN/ban fields ──────────────────
function zeroRecursive(obj, key, zeroVal) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(i => zeroRecursive(i, key, zeroVal)); return; }
    if (key in obj) obj[key] = zeroVal;
    for (const v of Object.values(obj)) {
        if (v && typeof v === 'object') zeroRecursive(v, key, zeroVal);
    }
}

function patchGetLoginData(parsed) {
    if (!parsed || typeof parsed !== 'object') return;
    // GKOKINGAIKO = GIN config object
    const GIN_KEYS = ['GKOKINGAIKO', 'CECNLHCONMI'];
    for (const k of GIN_KEYS) {
        if (parsed[k] !== undefined) {
            const g = parsed[k];
            if (g && typeof g === 'object') {
                g.gin_token = ''; g.is_enable_ggp = false; g.is_enable_tcp = false;
                g.is_report_to_ggp = false; g.is_transfer_report = false;
                g.ggp_url = ''; g.ut_flag = 0; g.content = '';
                g.is_get_feature = false; g.is_get_flag = false;
            } else { parsed[k] = {}; }
        }
    }
    // Recursive zero GIN fields
    zeroRecursive(parsed, 'is_enable_ggp',      false);
    zeroRecursive(parsed, 'is_enable_tcp',       false);
    zeroRecursive(parsed, 'is_report_to_ggp',    false);
    zeroRecursive(parsed, 'is_transfer_report',  false);
    zeroRecursive(parsed, 'gin_token',           '');
    zeroRecursive(parsed, 'ggp_url',             '');
    // Ban fields
    zeroRecursive(parsed, 'ban_mode',            0);
    zeroRecursive(parsed, 'matchmaking_blacklist', 0);
    if (parsed['DJNBFHDKIAN'] !== undefined) parsed['DJNBFHDKIAN'] = null;
    if (parsed['AEBBNFBNIDB'] !== undefined) {
        const b = parsed['AEBBNFBNIDB'];
        if (b && typeof b === 'object') { b.ban_mode = 0; b.unban_time = 0; b.hint_string = ''; }
    }
    if (parsed['LGEBPFEFOHC'] !== undefined) parsed['LGEBPFEFOHC'] = false;
    // Event/tracking URLs → strip
    if (parsed['PANHADGGJCC'] !== undefined) parsed['PANHADGGJCC'] = '';
    if (parsed['KDMFKIAJEHC'] !== undefined) parsed['KDMFKIAJEHC'] = '';
}

function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body     = req.body;
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const reqInfo  = Buffer.isBuffer(body) && body.length > 0 ? decodeReqFields(body) : {};
        const proxyUrl = PROXY_URL || `https://${req.headers.host}`;

        // Forward request ke loginbp.ggpolarbear.com
        // PENTING: jangan set Accept-Encoding agar tidak dapat gzip/br
        // (Railway kadang gagal decompress, menyebabkan signature header corrupt)
        const options = {
            hostname: 'loginbp.ggpolarbear.com',
            path: '/MajorLogin', method: 'POST',
            headers: {
                ...req.headers,
                'host':             'loginbp.ggpolarbear.com',
                'content-length':   Buffer.isBuffer(body) ? body.length : 0,
                'accept-encoding':  'identity',  // CRITICAL: minta uncompressed response
            }
        };
        delete options.headers['transfer-encoding'];

        const proxyReq = https.request(options, (proxyRes) => {
            const chunks = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
                const rawBuf = Buffer.concat(chunks);

                // Log semua upstream headers untuk debug signature
                const upstreamHeaders = proxyRes.headers;
                const sigHeaders = Object.keys(upstreamHeaders)
                    .filter(k => k.toLowerCase().includes('sign') ||
                                 k.toLowerCase().includes('hmac') ||
                                 k.toLowerCase().includes('x-content') ||
                                 k.toLowerCase().includes('x-response') ||
                                 k.toLowerCase().includes('checksum'))
                    .map(k => `${k}: ${upstreamHeaders[k]}`);
                if (sigHeaders.length > 0) {
                    console.log(`[MAJORLOGIN] v21 upstream sig headers: ${sigHeaders.join(', ')}`);
                } else {
                    console.log(`[MAJORLOGIN] v21 upstream headers: ${Object.keys(upstreamHeaders).join(', ')}`);
                }

                if (proxyRes.statusCode === 404 && rawBuf.toString('utf8').includes('account_not_found')) {
                    const h = { ...proxyRes.headers };
                    delete h['transfer-encoding'];
                    h['content-length'] = rawBuf.length;
                    res.writeHead(404, h); return res.end(rawBuf);
                }

                if (proxyRes.statusCode !== 200 || rawBuf.length === 0) {
                    const h = { ...proxyRes.headers };
                    delete h['transfer-encoding'];
                    h['content-length'] = rawBuf.length;
                    res.writeHead(proxyRes.statusCode, h); return res.end(rawBuf);
                }

                // Decode untuk log + deteksi ban + simpan session ak/aiv
                let uid = '?', region = '?', token = '?', ttl = 0;
                let banStr = null, isBanned = false, origUrl = '?';
                try {
                    if (RAFIN) {
                        const obj = RAFIN.toObject(RAFIN.decode(rawBuf), {
                            defaults: false, longs: String, enums: Number,
                            bytes: Buffer, keepCase: true,
                        });
                        uid     = obj.account_id  || '?';
                        region  = obj.lock_region || '?';
                        token   = (obj.token || '').substring(0, 20) + '...';
                        ttl     = obj.ttl || 0;
                        origUrl = obj.server_url  || '(empty)';

                        // Simpan ak+aiv untuk decrypt GetLoginData nanti
                        if (obj.ak && obj.aiv && uid !== '?') {
                            const akBuf  = Buffer.isBuffer(obj.ak)  ? obj.ak  : Buffer.from(obj.ak);
                            const aivBuf = Buffer.isBuffer(obj.aiv) ? obj.aiv : Buffer.from(obj.aiv);
                            if (akBuf.length === 16 && aivBuf.length === 16) {
                                storeSession(uid, akBuf, aivBuf);
                                console.log(`[MAJORLOGIN] v21 session stored uid=${uid}`);
                            }
                        }
                        if (obj.blacklist?.ban_reason && obj.blacklist.ban_reason !== 0) {
                            isBanned = true;
                            banStr = `🚫 BAN: ${BAN_MAP[obj.blacklist.ban_reason]||obj.blacklist.ban_reason}`;
                        }

                        // ── Server-side GetLoginData prefetch ────────────────────────
                        // Karena game akan kirim GetLoginData ke clientbp.ppmainecoonghj.com
                        // (bypass proxy via server_url di RAFIN response),
                        // proxy ambil dulu GetLoginData dari server, patch GKOKINGAIKO,
                        // cache hasilnya. Saat game request /GetLoginData, serve dari cache.
                        if (uid !== '?' && obj.server_url && obj.server_url.includes('clientbp')) {
                            const clientbpHost = new URL(obj.server_url).hostname;
                            const glOpts = {
                                hostname: clientbpHost,
                                path:     '/GetLoginData',
                                method:   'POST',
                                headers: {
                                    ...req.headers,
                                    'host':           clientbpHost,
                                    'content-length': Buffer.isBuffer(body) ? body.length : 0,
                                },
                                timeout: 8000,
                            };
                            delete glOpts.headers['transfer-encoding'];
                            const glReq = https.request(glOpts, (glRes) => {
                                const glChunks = [];
                                glRes.on('data', c => glChunks.push(c));
                                glRes.on('end', () => {
                                    try {
                                        const glRaw = Buffer.concat(glChunks);
                                        const ct    = glRes.headers['content-type'] || '';
                                        const isJson = ct.includes('json') || (glRaw[0] === 0x7b);
                                        if (isJson && glRaw.length > 0) {
                                            // Patch GKOKINGAIKO dan semua GIN fields
                                            const parsed = JSON.parse(glRaw.toString('utf8'));
                                            patchGetLoginData(parsed);
                                            const patched = Buffer.from(JSON.stringify(parsed), 'utf8');
                                            const glHeaders = { ...glRes.headers };
                                            delete glHeaders['transfer-encoding'];
                                            delete glHeaders['content-encoding'];
                                            glHeaders['content-length'] = String(patched.length);
                                            glCacheSet(uid, patched, glHeaders);
                                            console.log(`[MAJORLOGIN] GetLoginData prefetch OK uid=${uid} ${glRaw.length}b→${patched.length}b`);
                                        } else {
                                            // Binary/non-JSON: store as-is (sudah dipatch di server?)
                                            const glHeaders = { ...glRes.headers };
                                            delete glHeaders['transfer-encoding'];
                                            glHeaders['content-length'] = String(glRaw.length);
                                            glCacheSet(uid, glRaw, glHeaders);
                                            console.log(`[MAJORLOGIN] GetLoginData prefetch (bin) uid=${uid} ${glRaw.length}b`);
                                        }
                                    } catch(e) {
                                        console.error(`[MAJORLOGIN] GetLoginData prefetch parse err: ${e.message}`);
                                    }
                                });
                            });
                            glReq.on('error', e => console.error(`[MAJORLOGIN] GetLoginData prefetch err: ${e.message}`));
                            glReq.setTimeout(8000, () => glReq.destroy());
                            if (Buffer.isBuffer(body) && body.length > 0) glReq.write(body);
                            glReq.end();
                        }
                    }
                } catch (_) {}

                // PASSTHROUGH — body tidak dimodifikasi (game verify HMAC signature)
                const outBuf = rawBuf;

                // FIX v22: teruskan SEMUA upstream headers tanpa modifikasi apapun
                // Signature Garena terikat ke content-length upstream — jangan override
                // Railway strip gzip sebelum sampai ke proxy, jadi rawBuf sudah plain
                // dan content-length dari upstream (yang mungkin masih nilai gzip) bisa salah,
                // tapi override malah bikin signature check fail karena nilai berubah.
                // Solusi: teruskan content-length dari upstream apa adanya.
                const h = { ...proxyRes.headers };
                delete h['transfer-encoding'];

                const lines = [`<b>MajorLogin v21 (passthrough)</b>`, ''];
                lines.push(`👤 <code>${uid}</code> | 🌏 ${region}`);
                lines.push(`🆔 <code>${reqInfo.open_id||'?'}</code> | 🌐 ${clientIp}`);
                lines.push(`🎫 <code>${token}</code>${ttl ? ` ⏱${ttl}s` : ''}`);
                lines.push(`📦 ${rawBuf.length}b | 🔗 origUrl: ${origUrl}`);
                if (sigHeaders.length > 0) lines.push(`🔑 ${sigHeaders.join(', ')}`);
                if (banStr) { lines.push(''); lines.push(banStr); }
                tglog.send(lines.join('\n'));

                console.log(`[MAJORLOGIN] v21 uid=${uid} passthrough ${rawBuf.length}b ban=${isBanned} sigHeaders=${sigHeaders.length}`);

                res.writeHead(proxyRes.statusCode, h);
                res.end(outBuf);
            });

            proxyRes.on('error', err => {
                if (!res.headersSent) res.status(502).send('Error');
            });
        });

        proxyReq.on('error', err => {
            tglog.send(`❌ MajorLogin v21: ${err.message}`);
            if (!res.headersSent) res.status(502).send('Proxy Error');
        });

        proxyReq.setTimeout(30000, () => {
            proxyReq.destroy();
            if (!res.headersSent) res.status(504).send('Timeout');
        });

        if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });

    console.log('[MAJORLOGIN] v21 active — passthrough mode, full header forward, accept-encoding: identity');
}

module.exports = { init, getSession, aesDecrypt, aesEncrypt };
