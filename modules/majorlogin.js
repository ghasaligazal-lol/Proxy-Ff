'use strict';
// modules/majorlogin.js — v19
//
// FIX v19: field numbers excise diperbaiki sesuai proto:
// [A] field 10  (server_url)          → excise + inject proxyUrl
// [B] field 12  (blacklist)           → excise jika banned
// [C] field 14  (tp_url)              → excise
// [D] field 16  (ano_url)             → excise
// [E] field 24  (ffanti_url)          → excise  ← FIX (v18 salah excise field 22=AK!)
// [F] field 25  (ff_anti_config_desc) → excise  ← FIX (v18 salah excise field 23=AIV!)
// [G] field 36  (connection_seed_enabled) → excise (OB55)
// [H] field 37  (connection_seed)         → excise (OB55)
//
// Field 22 (ak) dan field 23 (aiv) adalah encryption keys → JANGAN di-excise!

const https    = require('https');
const crypto   = require('crypto');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

// Session store: simpan ak+aiv per UID untuk decrypt GetLoginData
// { uid: { ak: Buffer, aiv: Buffer, ts: Date.now() } }
const _sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 menit

function storeSession(uid, ak, aiv) {
    _sessions.set(String(uid), { ak, aiv, ts: Date.now() });
    // Cleanup expired
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

// Export fungsi untuk dipakai proxy.js


const PROXY_URL = (process.env.PROXY_URL || '').replace(/\/$/, '');

let RAFIN = null;
protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        console.log('[MAJORLOGIN] v19 Proto loaded');
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
    const tagBuf = encodeVarint((fieldNum << 3) | 2);
    const out = [];
    let pos = 0, found = false;
    while (pos < buf.length) {
        let match = pos + tagBuf.length <= buf.length;
        for (let i = 0; i < tagBuf.length && match; i++) {
            if (buf[pos + i] !== tagBuf[i]) match = false;
        }
        if (!match) { out.push(buf[pos]); pos++; continue; }
        let cur = pos + tagBuf.length;
        const { val: len, bytes: lb } = readVarint(buf, cur);
        cur += lb + len;
        found = true; pos = cur;
    }
    return { buf: Buffer.from(out), found };
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

                // Decode untuk log + deteksi ban
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
                                console.log(`[MAJORLOGIN] v19 session stored uid=${uid}`);
                            }
                        }
                        if (obj.blacklist?.ban_reason && obj.blacklist.ban_reason !== 0) {
                            isBanned = true;
                            banStr = `🚫 BAN: ${BAN_MAP[obj.blacklist.ban_reason]||obj.blacklist.ban_reason}`;
                        }
                    }
                } catch (_) {}

                // Binary surgery
                let outBuf = rawBuf;
                const patchLog = [];

                // [A] server_url (field 10) → excise + inject proxy URL
                { const { buf: ex } = exciseField(outBuf, 10);
                  outBuf = injectStringField(ex, 10, proxyUrl);
                  patchLog.push(`url→proxy`); }

                // [B] blacklist (field 12) → excise jika banned
                if (isBanned) {
                    const { buf: ex, found } = exciseField(outBuf, 12);
                    if (found) { outBuf = ex; patchLog.push('bl excised'); }
                }

                // [C] tp_url (field 14) → excise
                { const { buf: ex, found } = exciseField(outBuf, 14);
                  if (found) { outBuf = ex; patchLog.push('tp excised'); } }

                // [D] ano_url (field 16) → excise
                { const { buf: ex, found } = exciseField(outBuf, 16);
                  if (found) { outBuf = ex; patchLog.push('ano excised'); } }

                // [E] ffanti_url (field 24) — FIX: v18 salah excise field 22=AK!
                { const { buf: ex, found } = exciseField(outBuf, 24);
                  if (found) { outBuf = ex; patchLog.push('ffanti excised'); } }

                // [F] ff_anti_config_desc (field 25) — FIX: v18 salah excise field 23=AIV!
                { const { buf: ex, found } = exciseField(outBuf, 25);
                  if (found) { outBuf = ex; patchLog.push('ffcfg excised'); } }

                // [G] connection_seed_enabled (field 36) — OB55 new
                { const { buf: ex, found } = exciseField(outBuf, 36);
                  if (found) { outBuf = ex; patchLog.push('seed_en excised'); } }

                // [H] connection_seed (field 37) — OB55 new
                { const { buf: ex, found } = exciseField(outBuf, 37);
                  if (found) { outBuf = ex; patchLog.push('seed excised'); } }

                const lines = [`<b>MajorLogin v18</b>`, ''];
                lines.push(`👤 <code>${uid}</code> | 🌏 ${region}`);
                lines.push(`🆔 <code>${reqInfo.open_id||'?'}</code> | 🌐 ${clientIp}`);
                lines.push(`🎫 <code>${token}</code>${ttl ? ` ⏱${ttl}s` : ''}`);
                lines.push(`📦 ${rawBuf.length}b→${outBuf.length}b`);
                lines.push(`🔧 ${patchLog.join(' | ')}`);
                if (banStr) { lines.push(''); lines.push(banStr); }
                tglog.send(lines.join('\n'));

                console.log(`[MAJORLOGIN] v19 uid=${uid} ${patchLog.join(', ')}`);

                const h = { ...proxyRes.headers, 'content-length': outBuf.length };
                delete h['transfer-encoding'];
                delete h['content-encoding'];
                res.writeHead(proxyRes.statusCode, h);
                res.end(outBuf);
            });

            proxyRes.on('error', err => {
                if (!res.headersSent) res.status(502).send('Error');
            });
        });

        proxyReq.on('error', err => {
            tglog.send(`❌ MajorLogin v18: ${err.message}`);
            if (!res.headersSent) res.status(502).send('Proxy Error');
        });

        if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });

    console.log('[MAJORLOGIN] v19 active — binary surgery: field nums fixed');
}

module.exports = { init, getSession, aesDecrypt, aesEncrypt };
