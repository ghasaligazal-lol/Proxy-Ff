'use strict';
// modules/majorlogin.js — passthrough + prefetch GetLoginData

const https    = require('https');
const crypto   = require('crypto');
const protobuf = require('protobufjs');
const path     = require('path');

// ── GetLoginData prefetch cache ──────────────────────────────────────────────
const GL_CACHE     = new Map();
const GL_CACHE_TTL = 300 * 1000; // 5 menit

function glCacheSet(uid, buf, headers) {
    GL_CACHE.set(String(uid), { buf, headers, ts: Date.now() });
    for (const [k, v] of GL_CACHE.entries()) {
        if (Date.now() - v.ts > GL_CACHE_TTL) GL_CACHE.delete(k);
    }
}

function glCacheGet(uid) {
    const e = GL_CACHE.get(String(uid));
    if (!e) return null;
    if (Date.now() - e.ts > GL_CACHE_TTL) { GL_CACHE.delete(String(uid)); return null; }
    return e;
}

// ── Session store ak+aiv (untuk proxy.js decrypt GetLoginData) ────────────────
const _sessions  = new Map();
const SESSION_TTL = 30 * 60 * 1000;

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

function aesDecrypt(data, key, iv) {
    try {
        const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
        d.setAutoPadding(true);
        return Buffer.concat([d.update(data), d.final()]);
    } catch (_) { return null; }
}

function aesEncrypt(data, key, iv) {
    try {
        const c = crypto.createCipheriv('aes-128-cbc', key, iv);
        c.setAutoPadding(true);
        return Buffer.concat([c.update(data), c.final()]);
    } catch (_) { return null; }
}

// ── Proto ────────────────────────────────────────────────────────────────────
let RAFIN = null;
protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => { RAFIN = root.lookupType('freefire.RAFIN'); console.log('[MAJORLOGIN] proto loaded'); })
    .catch(err => console.error('[MAJORLOGIN] proto err:', err.message));

// ── Init ─────────────────────────────────────────────────────────────────────
function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body = req.body;

        const opts = {
            hostname: 'loginbp.ggpolarbear.com',
            path: '/MajorLogin',
            method: 'POST',
            headers: {
                ...req.headers,
                'host':            'loginbp.ggpolarbear.com',
                'content-length':  Buffer.isBuffer(body) ? body.length : 0,
                'accept-encoding': 'identity',
            },
        };
        delete opts.headers['transfer-encoding'];

        const upstream = https.request(opts, (upRes) => {
            const chunks = [];
            upRes.on('data', c => chunks.push(c));
            upRes.on('end', () => {
                const rawBuf = Buffer.concat(chunks);

                // Decode untuk ambil uid + server_url + ak/aiv
                if (upRes.statusCode === 200 && rawBuf.length > 0 && RAFIN) {
                    try {
                        const obj = RAFIN.toObject(RAFIN.decode(rawBuf), {
                            defaults: false, longs: String, enums: Number,
                            bytes: Buffer, keepCase: true,
                        });
                        const uid = String(obj.account_id || '');

                        // Simpan session ak+aiv
                        if (uid && obj.ak && obj.aiv) {
                            const ak  = Buffer.isBuffer(obj.ak)  ? obj.ak  : Buffer.from(obj.ak);
                            const aiv = Buffer.isBuffer(obj.aiv) ? obj.aiv : Buffer.from(obj.aiv);
                            if (ak.length === 16 && aiv.length === 16) {
                                storeSession(uid, ak, aiv);
                                console.log(`[MAJORLOGIN] session uid=${uid}`);
                            }
                        }

                        // Prefetch GetLoginData
                        if (uid && obj.server_url && obj.server_url.includes('clientbp')) {
                            const host = new URL(obj.server_url).hostname;
                            const glOpts = {
                                hostname: host,
                                path: '/GetLoginData',
                                method: 'POST',
                                headers: {
                                    ...req.headers,
                                    'host':           host,
                                    'content-length': Buffer.isBuffer(body) ? body.length : 0,
                                },
                                timeout: 8000,
                            };
                            delete glOpts.headers['transfer-encoding'];
                            const glReq = https.request(glOpts, (glRes) => {
                                const gc = [];
                                glRes.on('data', c => gc.push(c));
                                glRes.on('end', () => {
                                    const glRaw = Buffer.concat(gc);
                                    const h = { ...glRes.headers };
                                    delete h['transfer-encoding'];
                                    delete h['content-encoding'];
                                    h['content-length'] = String(glRaw.length);
                                    glCacheSet(uid, glRaw, h);
                                    console.log(`[MAJORLOGIN] GetLoginData prefetch uid=${uid} ${glRaw.length}b`);
                                });
                            });
                            glReq.on('error', e => console.error(`[MAJORLOGIN] prefetch err: ${e.message}`));
                            glReq.setTimeout(8000, () => glReq.destroy());
                            if (Buffer.isBuffer(body) && body.length > 0) glReq.write(body);
                            glReq.end();
                        }
                    } catch (_) {}
                }

                // Passthrough — tidak ada modifikasi body
                const h = { ...upRes.headers };
                delete h['transfer-encoding'];
                res.writeHead(upRes.statusCode, h);
                res.end(rawBuf);
            });

            upRes.on('error', () => { if (!res.headersSent) res.status(502).end(); });
        });

        upstream.on('error', () => { if (!res.headersSent) res.status(502).end(); });
        upstream.setTimeout(30000, () => { upstream.destroy(); if (!res.headersSent) res.status(504).end(); });
        if (Buffer.isBuffer(body) && body.length > 0) upstream.write(body);
        upstream.end();
    });

    console.log('[MAJORLOGIN] active');
}

module.exports = { init, getSession, aesDecrypt, aesEncrypt, glCacheGet };
