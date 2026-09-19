'use strict';
// modules/majorlogin.js — v12
//
// FIX v12: SignatureCheckFailed
// OB55 mengirim signature header (x-gg-sign / x-sign / x-rpc-sign) yang
// di-compute dari original response body. Proxy re-encode → body berubah →
// signature invalid → game reject dengan "Response signature check failed".
//
// Solusi: STRIP semua signature headers dari response sebelum dikirim ke client.
// Game akan skip signature check jika header tidak ada.
//
// Selain itu: tetap pakai proto decode→patch→encode untuk patch blacklist,
// server_url, ffanti dll. Binary surgery sebagai fallback.

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

const PROXY_URL = (process.env.PROXY_URL || '').replace(/\/$/, '');

// Header signature yang harus di-strip dari response Garena
const SIG_HEADERS = [
    'x-gg-sign', 'x-sign', 'x-rpc-sign', 'x-signature',
    'x-garena-sign', 'x-response-sign', 'x-gg-signature',
    'x-ff-sign', 'signature',
];

let RAFIN = null;

protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        console.log('[MAJORLOGIN] v12 Proto loaded OK');
    })
    .catch(err => console.error('[MAJORLOGIN] Proto load FAILED:', err.message));

function decodeReqFields(buf) {
    const out = {};
    try {
        const r = protobuf.Reader.create(buf);
        while (r.pos < r.len) {
            const tag = r.uint32();
            const fn  = tag >>> 3, wt = tag & 7;
            if (wt === 0) {
                const v = r.uint64();
                if (fn === 98) out.is_vpn = typeof v.toNumber === 'function' ? v.toNumber() : Number(v);
            } else if (wt === 2) {
                const bytes = r.bytes(), str = bytes.toString('utf8');
                if (fn === 22) out.open_id        = str;
                if (fn === 57) out.client_version = str;
                if (fn === 20) out.client_ip      = str;
            } else if (wt === 5) { r.fixed32();
            } else if (wt === 1) { r.fixed64();
            } else { break; }
        }
    } catch (_) {}
    return out;
}

// Binary surgery — null-fill domain berbahaya in-place (ukuran buffer tidak berubah)
function binaryPatchFallback(buf) {
    const b = Buffer.from(buf);
    let patched = false;
    const DANGER = [
        'csoversea.stronghold.freefiremobile.com',
        'gin.freefiremobile.com', 'vodka.freefiremobile.com',
        'gamesecurity.sea.freefiremobile.com', 'ffanti.',
    ];
    for (const domain of DANGER) {
        const needle = Buffer.from(domain, 'utf8');
        let off = 0;
        while (off < b.length - needle.length) {
            const idx = b.indexOf(needle, off);
            if (idx === -1) break;
            b.fill(0x00, idx, idx + needle.length);
            patched = true; off = idx + needle.length;
        }
    }
    return { buf: b, patched };
}

const BAN_MAP = { 0:'UNKNOWN',1:'IN_GAME_AUTO',2:'REFUND',3:'OTHERS',4:'SKINMOD',1014:'IN_GAME_AUTO_NEW' };

// Strip signature headers — returns clean header object
function stripSigHeaders(headers) {
    const out = { ...headers };
    for (const h of SIG_HEADERS) {
        delete out[h];
        // juga coba lowercase variants
        for (const key of Object.keys(out)) {
            if (key.toLowerCase() === h) delete out[key];
        }
    }
    return out;
}

function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body     = req.body;
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const reqInfo  = Buffer.isBuffer(body) && body.length > 0 ? decodeReqFields(body) : {};
        const proxyUrl = PROXY_URL || `https://${req.headers.host}`;

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
            const chunks = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
                const rawBuf = Buffer.concat(chunks);

                // Log semua headers dari Garena untuk debug
                const sigFound = SIG_HEADERS.filter(h =>
                    Object.keys(proxyRes.headers).some(k => k.toLowerCase() === h)
                );
                if (sigFound.length > 0) {
                    console.log(`[MAJORLOGIN] v12 Signature headers found & stripped: ${sigFound.join(', ')}`);
                }

                // 404 account_not_found → pass-through
                if (proxyRes.statusCode === 404 && rawBuf.toString('utf8').includes('account_not_found')) {
                    const h = stripSigHeaders({ ...proxyRes.headers, 'content-length': rawBuf.length });
                    delete h['transfer-encoding'];
                    res.writeHead(404, h);
                    return res.end(rawBuf);
                }

                if (proxyRes.statusCode !== 200 || rawBuf.length === 0) {
                    const h = stripSigHeaders({ ...proxyRes.headers, 'content-length': rawBuf.length });
                    delete h['transfer-encoding'];
                    res.writeHead(proxyRes.statusCode, h);
                    return res.end(rawBuf);
                }

                let outBuf = null;
                let uid = '?', region = '?', token = '?', ttl = 0;
                let patchLog = [], banStr = null, decodeOK = false;

                // ===== PROTO DECODE → PATCH → ENCODE =====
                if (RAFIN) {
                    try {
                        const decoded = RAFIN.decode(rawBuf);
                        const obj     = RAFIN.toObject(decoded, {
                            defaults: false, longs: String,
                            enums: Number, bytes: Buffer, keepCase: false,
                        });
                        decodeOK = true;

                        uid    = obj.accountId  || '?';
                        region = obj.lockRegion || '?';
                        token  = (obj.token || '').substring(0, 20) + '...';
                        ttl    = obj.ttl || 0;

                        if (obj.blacklist?.banReason && obj.blacklist.banReason !== 0) {
                            banStr = `🚫 BAN: ${BAN_MAP[obj.blacklist.banReason] || obj.blacklist.banReason}`;
                        }

                        // Patch server_url → proxy
                        if (obj.serverUrl !== undefined) {
                            if (obj.serverUrl !== proxyUrl) { obj.serverUrl = proxyUrl; patchLog.push('server_url→proxy'); }
                        } else if (obj.server_url !== undefined && obj.server_url !== proxyUrl) {
                            obj.server_url = proxyUrl; patchLog.push('server_url→proxy');
                        }

                        // Clear tp_url, ano_url, ffanti_url
                        for (const [k1, k2] of [['tpUrl','tp_url'],['anoUrl','ano_url'],['ffantiUrl','ffanti_url']]) {
                            const k = obj[k1] !== undefined ? k1 : k2;
                            if (obj[k]) { obj[k] = ''; patchLog.push(`${k2} cleared`); }
                        }

                        // Disable ff_anti_config_desc
                        const ffd = obj.ffAntiConfigDesc || obj.ff_anti_config_desc;
                        if (ffd) {
                            for (const k of ['enable','hpeEnable','ffiEnable','mtpLiteDataEnable','ffmEnable','ffoEnable',
                                             'hpe_enable','ffi_enable','mtp_lite_data_enable','ffm_enable','ffo_enable']) {
                                ffd[k] = false;
                            }
                            for (const k of ['configUrl','config_url']) ffd[k] = '';
                            patchLog.push('ffanti disabled');
                        }

                        // Clear blacklist
                        const bl = obj.blacklist;
                        if (bl) {
                            for (const k of ['banReason','ban_reason','expireDuration','expire_duration',
                                             'banTime','ban_time']) bl[k] = 0;
                            for (const k of ['banType','ban_type']) bl[k] = '';
                            patchLog.push('blacklist cleared');
                        }

                        // Force queue allow
                        const qi = obj.queueInfo || obj.queue_info;
                        if (qi && !qi.allow) { qi.allow = true; patchLog.push('queue allow'); }

                        // Disable connection seed (OB55)
                        for (const k of ['connectionSeedEnabled','connection_seed_enabled']) {
                            if (obj[k]) { obj[k] = false; patchLog.push('conn_seed=false'); break; }
                        }
                        for (const k of ['connectionSeed','connection_seed']) {
                            if (obj[k]) { obj[k] = ''; break; }
                        }

                        // Encode — TANPA verify()
                        outBuf = Buffer.from(RAFIN.encode(RAFIN.fromObject(obj)).finish());
                        console.log(`[MAJORLOGIN] v12 proto OK uid=${uid} ${rawBuf.length}b→${outBuf.length}b [${patchLog.join(', ')}]`);

                    } catch (err) {
                        console.error('[MAJORLOGIN] v12 proto error:', err.message, '→ binary fallback');
                        const { buf, patched } = binaryPatchFallback(rawBuf);
                        outBuf = buf;
                        patchLog = [`fallback: binary_surgery=${patched}`];
                    }
                } else {
                    // RAFIN belum load → binary fallback
                    const { buf, patched } = binaryPatchFallback(rawBuf);
                    outBuf = buf;
                    patchLog = [`no_proto: binary_surgery=${patched}`];
                }

                // TG log
                const lines = [`<b>MajorLogin v12</b>`, ''];
                lines.push(`👤 UID: <code>${uid}</code>`);
                lines.push(`🆔 open_id: <code>${reqInfo.open_id || '?'}</code>`);
                if (reqInfo.client_version) lines.push(`📱 ${reqInfo.client_version}`);
                lines.push(`🌏 ${region} | 🌐 ${clientIp}`);
                lines.push(`🎫 <code>${token}</code>`);
                if (ttl) lines.push(`⏱ ${ttl}s`);
                if (patchLog.length) lines.push(`🔧 ${patchLog.join(', ')}`);
                if (sigFound?.length) lines.push(`🔑 sig stripped: ${sigFound.join(', ')}`);
                if (banStr) { lines.push(''); lines.push(banStr); }
                tglog.send(lines.join('\n'));

                // Strip signature headers sebelum kirim ke client
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

    console.log('[MAJORLOGIN] v12 active — sig headers stripped, proto decode/encode, binary fallback');
}

module.exports = { init };
