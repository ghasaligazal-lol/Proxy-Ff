'use strict';
// modules/majorlogin.js — v13
//
// FIX v13 vs v12:
// keepCase: true → toObject() hasilkan snake_case sesuai proto field names
// → fromObject() bisa map semua field → encode tidak kosong
//
// Sebelumnya keepCase:false → toObject() hasilkan camelCase (accountId, serverUrl)
// tapi fromObject() expect snake_case → semua field di-drop → buf kosong
// → game terima null body → error (bukan SignatureCheckFailed sebenarnya)
//
// Strip signature headers tetap dilakukan untuk jaga-jaga.

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

const PROXY_URL = (process.env.PROXY_URL || '').replace(/\/$/, '');

const SIG_HEADERS = [
    'x-gg-sign','x-sign','x-rpc-sign','x-signature',
    'x-garena-sign','x-response-sign','x-gg-signature','x-ff-sign','signature',
];

let RAFIN = null;

protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        console.log('[MAJORLOGIN] v13 Proto loaded OK');
    })
    .catch(err => console.error('[MAJORLOGIN] Proto load FAILED:', err.message));

function decodeReqFields(buf) {
    const out = {};
    try {
        const r = protobuf.Reader.create(buf);
        while (r.pos < r.len) {
            const tag = r.uint32(), fn = tag >>> 3, wt = tag & 7;
            if (wt === 0) {
                const v = r.uint64();
                if (fn === 98) out.is_vpn = typeof v.toNumber === 'function' ? v.toNumber() : Number(v);
            } else if (wt === 2) {
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

// Binary surgery — null-fill domain berbahaya in-place (ukuran tidak berubah)
function binaryFallback(buf) {
    const b = Buffer.from(buf);
    let patched = false;
    for (const d of [
        'csoversea.stronghold.freefiremobile.com',
        'gin.freefiremobile.com','vodka.freefiremobile.com',
        'gamesecurity.sea.freefiremobile.com','ffanti.',
    ]) {
        const n = Buffer.from(d,'utf8');
        let off = 0;
        while (off < b.length - n.length) {
            const i = b.indexOf(n, off);
            if (i === -1) break;
            b.fill(0, i, i + n.length);
            patched = true; off = i + n.length;
        }
    }
    return { buf: b, patched };
}

function stripSigHeaders(h) {
    const out = { ...h };
    for (const key of Object.keys(out)) {
        if (SIG_HEADERS.includes(key.toLowerCase())) delete out[key];
    }
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
                'host': 'loginbp.ggpolarbear.com',
                'content-length': Buffer.isBuffer(body) ? body.length : 0,
            }
        };
        delete options.headers['transfer-encoding'];

        const proxyReq = https.request(options, (proxyRes) => {
            const chunks = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
                const rawBuf = Buffer.concat(chunks);
                console.log(`[MAJORLOGIN] v13 rawBuf=${rawBuf.length}b status=${proxyRes.statusCode}`);

                // 404 pass-through
                if (proxyRes.statusCode === 404 && rawBuf.toString('utf8').includes('account_not_found')) {
                    const h = stripSigHeaders({...proxyRes.headers,'content-length':rawBuf.length});
                    delete h['transfer-encoding'];
                    res.writeHead(404, h); return res.end(rawBuf);
                }

                if (proxyRes.statusCode !== 200 || rawBuf.length === 0) {
                    const h = stripSigHeaders({...proxyRes.headers,'content-length':rawBuf.length});
                    delete h['transfer-encoding'];
                    res.writeHead(proxyRes.statusCode, h); return res.end(rawBuf);
                }

                let outBuf = rawBuf; // default: pass-through raw jika semua gagal
                let uid = '?', region = '?', token = '?', ttl = 0;
                let patchLog = [], banStr = null;

                if (RAFIN) {
                    try {
                        // keepCase: TRUE → snake_case field names sesuai proto
                        // WAJIB untuk fromObject() bisa map field dengan benar
                        const obj = RAFIN.toObject(RAFIN.decode(rawBuf), {
                            defaults: false,
                            longs:    String,
                            enums:    Number,
                            bytes:    Buffer,
                            keepCase: true,   // ← FIX UTAMA v13
                        });

                        uid    = obj.account_id  || '?';
                        region = obj.lock_region || '?';
                        token  = (obj.token || '').substring(0, 20) + '...';
                        ttl    = obj.ttl || 0;

                        if (obj.blacklist?.ban_reason && obj.blacklist.ban_reason !== 0) {
                            banStr = `🚫 BAN: ${BAN_MAP[obj.blacklist.ban_reason] || obj.blacklist.ban_reason}`;
                        }

                        // ── PATCHES ──────────────────────────────────────────

                        // server_url → proxy
                        if (obj.server_url !== undefined && obj.server_url !== proxyUrl) {
                            obj.server_url = proxyUrl;
                            patchLog.push('server_url→proxy');
                        }

                        // tp_url, ano_url, ffanti_url → clear
                        for (const k of ['tp_url','ano_url','ffanti_url']) {
                            if (obj[k]) { obj[k] = ''; patchLog.push(`${k} cleared`); }
                        }

                        // ff_anti_config_desc → disable
                        if (obj.ff_anti_config_desc) {
                            const f = obj.ff_anti_config_desc;
                            for (const k of ['enable','hpe_enable','ffi_enable',
                                             'mtp_lite_data_enable','ffm_enable','ffo_enable']) {
                                f[k] = false;
                            }
                            f.config_url = '';
                            patchLog.push('ffanti disabled');
                        }

                        // blacklist → clear
                        if (obj.blacklist) {
                            const bl = obj.blacklist;
                            bl.ban_reason = 0; bl.expire_duration = 0;
                            bl.ban_time   = 0; bl.ban_type        = '';
                            patchLog.push('blacklist cleared');
                        }

                        // queue_info → force allow
                        if (obj.queue_info && !obj.queue_info.allow) {
                            obj.queue_info.allow = true;
                            patchLog.push('queue allow');
                        }

                        // connection_seed → disable (OB55)
                        if (obj.connection_seed_enabled) {
                            obj.connection_seed_enabled = false;
                            patchLog.push('conn_seed=false');
                        }
                        if (obj.connection_seed) obj.connection_seed = '';

                        // ── ENCODE ───────────────────────────────────────────
                        const encoded = RAFIN.encode(RAFIN.fromObject(obj)).finish();
                        outBuf = Buffer.from(encoded);

                        if (outBuf.length === 0) {
                            // Encode kosong → fallback ke binary surgery
                            console.error('[MAJORLOGIN] v13 encode=0b → binary fallback');
                            const { buf } = binaryFallback(rawBuf);
                            outBuf = buf;
                            patchLog.push('encode_empty→binary_fallback');
                        } else {
                            console.log(`[MAJORLOGIN] v13 OK uid=${uid} ${rawBuf.length}b→${outBuf.length}b [${patchLog.join(', ')}]`);
                        }

                    } catch (err) {
                        console.error('[MAJORLOGIN] v13 proto error:', err.message);
                        const { buf } = binaryFallback(rawBuf);
                        outBuf = buf;
                        patchLog = [`proto_err→binary: ${err.message.substring(0,60)}`];
                    }
                } else {
                    const { buf, patched } = binaryFallback(rawBuf);
                    outBuf = buf;
                    patchLog = [`no_proto: binary=${patched}`];
                }

                // TG log
                const lines = [`<b>MajorLogin v13</b>`,'']; 
                lines.push(`👤 <code>${uid}</code> | 🌏 ${region}`);
                lines.push(`🆔 <code>${reqInfo.open_id||'?'}</code> | 🌐 ${clientIp}`);
                lines.push(`🎫 <code>${token}</code>${ttl ? ` ⏱${ttl}s` : ''}`);
                if (patchLog.length) lines.push(`🔧 ${patchLog.join(', ')}`);
                if (banStr) { lines.push(''); lines.push(banStr); }
                tglog.send(lines.join('\n'));

                const outHeaders = stripSigHeaders({
                    ...proxyRes.headers,
                    'content-length': outBuf.length,
                });
                delete outHeaders['transfer-encoding'];
                delete outHeaders['content-encoding'];
                res.writeHead(proxyRes.statusCode, outHeaders);
                res.end(outBuf);
            });

            proxyRes.on('error', err => {
                console.error('[MAJORLOGIN] Response error:', err.message);
                if (!res.headersSent) res.status(502).send('MajorLogin Error');
            });
        });

        proxyReq.on('error', err => {
            console.error('[MAJORLOGIN] Proxy error:', err.message);
            tglog.send(`❌ <b>MajorLogin Error</b>\n${err.message}`);
            if (!res.headersSent) res.status(502).send('MajorLogin Proxy Error');
        });

        if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });

    console.log('[MAJORLOGIN] v13 active — keepCase:true fix, sig strip, binary fallback');
}

module.exports = { init };
