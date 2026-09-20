'use strict';
// modules/majorlogin.js — v17
//
// DIAGNOSIS: SignatureCheckFailed kembali muncul saat v16 (excise+inject server_url)
// Assembly-CSharp-patch.bytes user ini TIDAK disable signature check
// → body yang dimodif apapun → SignatureCheckFailed
//
// STRATEGI v17: pure pass-through raw, TANPA sentuh body
//
// Lalu bagaimana server_url diatasi?
// → proxy.js sudah spoof /ChooseRegion → server tidak set lock_region
// → MajorLogin response dari Garena TIDAK mengandung server_url (field 10 kosong)
// → game pakai server_url dari ver.php (= proxy) untuk GetLoginData
//
// Kalau server_url tetap muncul di response meski ChooseRegion di-spoof:
// → proxy.js handle Host: clientbp.ppmainecoonghj.com (AdAway redirect)
// → request GetLoginData tetap lewat proxy meski pakai domain Garena
//
// Yang penting: JANGAN sentuh binary RAFIN sama sekali

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

let RAFIN = null;
protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        console.log('[MAJORLOGIN] v17 Proto loaded');
    })
    .catch(err => console.error('[MAJORLOGIN] Proto load err:', err.message));

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
                console.log(`[MAJORLOGIN] v17 pass-through ${rawBuf.length}b status=${proxyRes.statusCode}`);

                // ── Decode hanya untuk logging — TIDAK re-encode ─────────────
                let uid = '?', region = '?', token = '?', ttl = 0;
                let banStr = null, serverUrl = '?';
                if (RAFIN && rawBuf.length > 0 && proxyRes.statusCode === 200) {
                    try {
                        const obj = RAFIN.toObject(RAFIN.decode(rawBuf), {
                            defaults: false, longs: String, enums: Number,
                            bytes: Buffer, keepCase: true,
                        });
                        uid       = obj.account_id  || '?';
                        region    = obj.lock_region || '?';
                        token     = (obj.token || '').substring(0, 20) + '...';
                        ttl       = obj.ttl || 0;
                        serverUrl = obj.server_url || '(empty)';
                        if (obj.blacklist?.ban_reason && obj.blacklist.ban_reason !== 0) {
                            banStr = `🚫 BAN: ${BAN_MAP[obj.blacklist.ban_reason]||obj.blacklist.ban_reason} type:${obj.blacklist.ban_type||'-'}`;
                        }
                    } catch (_) {}
                }

                const lines = [`<b>MajorLogin v17 (raw)</b>`, ''];
                lines.push(`👤 <code>${uid}</code> | 🌏 ${region}`);
                lines.push(`🆔 <code>${reqInfo.open_id||'?'}</code> | 🌐 ${clientIp}`);
                lines.push(`🎫 <code>${token}</code>${ttl ? ` ⏱${ttl}s` : ''}`);
                lines.push(`🔗 server_url: ${serverUrl}`);
                lines.push(`📦 ${rawBuf.length}b`);
                if (banStr) { lines.push(''); lines.push(banStr); }
                tglog.send(lines.join('\n'));

                // ── Pass-through RAW tanpa modifikasi apapun ─────────────────
                const h = {
                    ...proxyRes.headers,
                    'content-length': rawBuf.length,
                };
                delete h['transfer-encoding'];
                delete h['content-encoding'];
                res.writeHead(proxyRes.statusCode, h);
                res.end(rawBuf);
            });

            proxyRes.on('error', err => {
                console.error('[MAJORLOGIN] err:', err.message);
                if (!res.headersSent) res.status(502).send('Error');
            });
        });

        proxyReq.on('error', err => {
            console.error('[MAJORLOGIN] proxy err:', err.message);
            tglog.send(`❌ MajorLogin v17: ${err.message}`);
            if (!res.headersSent) res.status(502).send('Proxy Error');
        });

        if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });

    console.log('[MAJORLOGIN] v17 active — pure pass-through, no body modification');
}

module.exports = { init };
