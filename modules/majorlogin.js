'use strict';
// modules/majorlogin.js — v20
//
// Field numbers yang di-excise dari MajorLogin response:
// [A] field 10  (server_url)              → excise + inject proxyUrl
// [B] field 12  (blacklist)               → excise jika banned
// [C] field 14  (tp_url)                  → excise
// [D] field 16  (ano_url)                 → excise
// [E] field 24  (ffanti_url)              → excise
// [F] field 25  (ff_anti_config_desc)     → excise
// [G] field 36  (connection_seed_enabled) → excise (OB55)
// [H] field 37  (connection_seed)         → excise (OB55)
//
// Field 22 (ak) dan field 23 (aiv) adalah encryption keys → JANGAN di-excise!
//
// PASSTHROUGH MODE: body tidak dimodifikasi karena game verify HMAC signature.
// Ban & GIN ditangani via gamevar + patch di response GetLoginData / ver.php.

const https    = require('https');
const crypto   = require('crypto');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

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
        console.log('[MAJORLOGIN] v20 Proto loaded');
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
    // Proper proto parser — baca dari awal, skip field dengan benar
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
            if (fn !== fieldNum) {
                for (let i = tagStart; i < pos; i++) out.push(buf[i]);
            }
        } else if (wireType === 2) {
            const { val: len, bytes: lb } = readVarint(buf, pos);
            pos += lb;
            const end = pos + len;
            if (fn === fieldNum) {
                pos = end; // excise
            } else {
                for (let i = tagStart; i < end; i++) out.push(buf[i]);
                pos = end;
            }
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

function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body     = req.body;
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const reqInfo  = Buffer.isBuffer(body) && body.length > 0 ? decodeReqFields(body) : {};
        const proxyUrl = PROXY_URL || `https://${req.headers.host}`;

        const options = {
            hostname: 'loginbp.ggpolarbear.com',
            path: '/MajorLogin', method: 'POST',
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

                if (proxyRes.statusCode === 404 && rawBuf.toString('utf8').includes('account_not_found')) {
                    const h = { ...proxyRes.headers, 'content-length': rawBuf.length };
                    delete h['transfer-encoding'];
                    res.writeHead(404, h); return res.end(rawBuf);
                }

                if (proxyRes.statusCode !== 200 || rawBuf.length === 0) {
                    const h = { ...proxyRes.headers, 'content-length': rawBuf.length };
                    delete h['transfer-encoding'];
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
                                console.log(`[MAJORLOGIN] v20 session stored uid=${uid}`);
                            }
                        }
                        if (obj.blacklist?.ban_reason && obj.blacklist.ban_reason !== 0) {
                            isBanned = true;
                            banStr = `🚫 BAN: ${BAN_MAP[obj.blacklist.ban_reason]||obj.blacklist.ban_reason}`;
                        }
                    }
                } catch (_) {}

                // PASSTHROUGH — body tidak dimodifikasi (game verify HMAC signature)
                const outBuf = rawBuf;

                const lines = [`<b>MajorLogin v20 (passthrough)</b>`, ''];
                lines.push(`👤 <code>${uid}</code> | 🌏 ${region}`);
                lines.push(`🆔 <code>${reqInfo.open_id||'?'}</code> | 🌐 ${clientIp}`);
                lines.push(`🎫 <code>${token}</code>${ttl ? ` ⏱${ttl}s` : ''}`);
                lines.push(`📦 ${rawBuf.length}b (unmodified)`);
                if (banStr) { lines.push(''); lines.push(banStr); }
                tglog.send(lines.join('\n'));

                console.log(`[MAJORLOGIN] v20 uid=${uid} passthrough ${rawBuf.length}b ban=${isBanned}`);

                const h = { ...proxyRes.headers };
                delete h['transfer-encoding'];
                res.writeHead(proxyRes.statusCode, h);
                res.end(outBuf);
            });

            proxyRes.on('error', err => {
                if (!res.headersSent) res.status(502).send('Error');
            });
        });

        proxyReq.on('error', err => {
            tglog.send(`❌ MajorLogin v20: ${err.message}`);
            if (!res.headersSent) res.status(502).send('Proxy Error');
        });

        proxyReq.setTimeout(30000, () => {
            proxyReq.destroy();
            if (!res.headersSent) res.status(504).send('Timeout');
        });

        if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });

    console.log('[MAJORLOGIN] v20 active — passthrough mode, session store active');
}

module.exports = { init, getSession, aesDecrypt, aesEncrypt };
