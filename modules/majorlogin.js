'use strict';
// modules/majorlogin.js — v16
//
// ROOT CAUSE v15: server_url tidak di-patch → game connect ke
// clientbp.ppmainecoonghj.com langsung → SSL CA error → GetLoginData null
//
// FIX v16:
// - server_url field (field 10, wire type 2) di-excise dari binary
//   lalu di-inject ulang dengan proxy URL
// - AMAN: Assembly-CSharp-patch.bytes sudah disable signature check
// - Blacklist field 12 tetap di-excise jika detected
// - tp_url (field 14), ffanti_url (field 22), ff_anti_config_desc (field 23) di-excise

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

const PROXY_URL = (process.env.PROXY_URL || '').replace(/\/$/, '');

let RAFIN = null;
protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        console.log('[MAJORLOGIN] v16 Proto loaded');
    })
    .catch(err => console.error('[MAJORLOGIN] Proto load err:', err.message));

// ── Varint helpers ───────────────────────────────────────────────────────────
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

// ── Excise semua kemunculan field N (wire type 2) dari buffer ────────────────
function exciseField(buf, fieldNum) {
    const tagBuf = encodeVarint((fieldNum << 3) | 2);
    const out    = [];
    let   pos    = 0;
    let   found  = false;

    while (pos < buf.length) {
        // Match tag?
        let match = (pos + tagBuf.length <= buf.length);
        for (let i = 0; i < tagBuf.length && match; i++) {
            if (buf[pos + i] !== tagBuf[i]) match = false;
        }
        if (!match) { out.push(buf[pos]); pos++; continue; }

        // Skip field: tag + varint length + content
        let cur = pos + tagBuf.length;
        const { val: len, bytes: lb } = readVarint(buf, cur);
        cur += lb + len;
        found = true;
        pos   = cur;
    }
    return { buf: Buffer.from(out), found };
}

// ── Inject field (wire type 2, string) ke akhir buffer ──────────────────────
function injectStringField(buf, fieldNum, value) {
    const tagBuf     = encodeVarint((fieldNum << 3) | 2);
    const valBuf     = Buffer.from(value, 'utf8');
    const lenVarint  = encodeVarint(valBuf.length);
    return Buffer.concat([buf, tagBuf, lenVarint, valBuf]);
}

// ── Decode request untuk logging ─────────────────────────────────────────────
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

                // 404 pass-through
                if (proxyRes.statusCode === 404 && rawBuf.toString('utf8').includes('account_not_found')) {
                    const h = { ...proxyRes.headers, 'content-length': rawBuf.length };
                    delete h['transfer-encoding'];
                    res.writeHead(404, h); return res.end(rawBuf);
                }

                // Non-200 pass-through
                if (proxyRes.statusCode !== 200 || rawBuf.length === 0) {
                    const h = { ...proxyRes.headers, 'content-length': rawBuf.length };
                    delete h['transfer-encoding'];
                    res.writeHead(proxyRes.statusCode, h); return res.end(rawBuf);
                }

                // ── Decode untuk log + deteksi ban ───────────────────────────
                let uid = '?', region = '?', token = '?', ttl = 0;
                let banStr = null, isBanned = false, origServerUrl = '?';
                try {
                    if (RAFIN) {
                        const obj = RAFIN.toObject(RAFIN.decode(rawBuf), {
                            defaults: false, longs: String, enums: Number,
                            bytes: Buffer, keepCase: true,
                        });
                        uid           = obj.account_id  || '?';
                        region        = obj.lock_region || '?';
                        token         = (obj.token || '').substring(0, 20) + '...';
                        ttl           = obj.ttl || 0;
                        origServerUrl = obj.server_url  || '(empty)';
                        if (obj.blacklist?.ban_reason && obj.blacklist.ban_reason !== 0) {
                            isBanned = true;
                            banStr = `🚫 BAN: ${BAN_MAP[obj.blacklist.ban_reason]||obj.blacklist.ban_reason} type:${obj.blacklist.ban_type||'-'}`;
                        }
                    }
                } catch (_) {}

                // ── Binary surgery ───────────────────────────────────────────
                let outBuf = rawBuf;
                const patchLog = [];

                // [A] Excise field 10 (server_url) lalu inject proxyUrl
                {
                    const { buf: ex, found } = exciseField(outBuf, 10);
                    outBuf = injectStringField(ex, 10, proxyUrl);
                    patchLog.push(`server_url: "${origServerUrl}"→proxy (excise+inject ${rawBuf.length}b→${outBuf.length}b)`);
                }

                // [B] Excise field 12 (blacklist) jika banned
                if (isBanned) {
                    const { buf: ex, found } = exciseField(outBuf, 12);
                    if (found) { outBuf = ex; patchLog.push('blacklist field12 excised'); }
                }

                // [C] Excise field 14 (tp_url)
                {
                    const { buf: ex, found } = exciseField(outBuf, 14);
                    if (found) { outBuf = ex; patchLog.push('tp_url excised'); }
                }

                // [D] Excise field 22 (ffanti_url)
                {
                    const { buf: ex, found } = exciseField(outBuf, 22);
                    if (found) { outBuf = ex; patchLog.push('ffanti_url excised'); }
                }

                // [E] Excise field 23 (ff_anti_config_desc)
                {
                    const { buf: ex, found } = exciseField(outBuf, 23);
                    if (found) { outBuf = ex; patchLog.push('ff_anti_config excised'); }
                }

                // TG log
                const lines = [`<b>MajorLogin v16</b>`, ''];
                lines.push(`👤 <code>${uid}</code> | 🌏 ${region}`);
                lines.push(`🆔 <code>${reqInfo.open_id||'?'}</code> | 🌐 ${clientIp}`);
                lines.push(`🎫 <code>${token}</code>${ttl ? ` ⏱${ttl}s` : ''}`);
                lines.push(`📦 ${rawBuf.length}b → ${outBuf.length}b`);
                lines.push(`🔧 ${patchLog.join(' | ')}`);
                if (banStr) { lines.push(''); lines.push(banStr); }
                tglog.send(lines.join('\n'));

                console.log(`[MAJORLOGIN] v16 uid=${uid} ${patchLog.join(', ')}`);

                const h = {
                    ...proxyRes.headers,
                    'content-length': outBuf.length,
                };
                delete h['transfer-encoding'];
                delete h['content-encoding'];
                res.writeHead(proxyRes.statusCode, h);
                res.end(outBuf);
            });

            proxyRes.on('error', err => {
                console.error('[MAJORLOGIN] err:', err.message);
                if (!res.headersSent) res.status(502).send('Error');
            });
        });

        proxyReq.on('error', err => {
            console.error('[MAJORLOGIN] proxy err:', err.message);
            tglog.send(`❌ MajorLogin: ${err.message}`);
            if (!res.headersSent) res.status(502).send('Proxy Error');
        });

        if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });

    console.log('[MAJORLOGIN] v16 active — binary excise+inject server_url, blacklist, tp_url, ffanti');
}

module.exports = { init };
