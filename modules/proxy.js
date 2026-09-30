'use strict';
// modules/proxy.js — pure forward, no patch

const { createProxyMiddleware } = require('http-proxy-middleware');

const GARENA_LOGIN_SERVER  = 'https://loginbp.ppmainecoonghj.com';
const GARENA_CLIENT_SERVER = 'https://clientbp.ppmainecoonghj.com';

function getMlMod() {
    try { return require('./majorlogin'); } catch (_) { return null; }
}

// ── Login proxy ───────────────────────────────────────────────────────────────
const loginProxy = createProxyMiddleware({
    target: GARENA_LOGIN_SERVER,
    changeOrigin: true,
    secure: false,
    on: {
        proxyReq: (proxyReq, req) => {
            proxyReq.setHeader('host', new URL(GARENA_LOGIN_SERVER).host);
            proxyReq.removeHeader('accept-encoding');
            proxyReq.setHeader('accept-encoding', 'identity');
            if (Buffer.isBuffer(req.body) && req.body.length > 0) {
                proxyReq.setHeader('content-length', req.body.length);
                proxyReq.write(req.body);
            }
        },
        error: (err, req, res) => {
            if (!res.headersSent) res.status(502).end();
        },
    },
});

// ── Client proxy ─────────────────────────────────────────────────────────────
const clientProxy = createProxyMiddleware({
    target: GARENA_CLIENT_SERVER,
    changeOrigin: true,
    secure: false,
    on: {
        proxyReq: (proxyReq, req) => {
            proxyReq.setHeader('host', new URL(GARENA_CLIENT_SERVER).host);
            if (Buffer.isBuffer(req.body) && req.body.length > 0) {
                proxyReq.setHeader('content-length', req.body.length);
                proxyReq.write(req.body);
            }
        },
        error: (err, req, res) => {
            if (!res.headersSent) res.status(502).end();
        },
    },
});

// ── Route lists ───────────────────────────────────────────────────────────────
const LOGIN_PATHS = [
    '/MajorRegister', '/GenerateNickname', '/GetRecommendNickname',
    '/GetAccountBriefInfoBeforeLogin', '/ChooseRegion', '/Register',
    '/CheckVersion', '/GetServerList', '/GetRegionConfig', '/ChooseNewbieChoice',
];

const CLIENT_PATHS = [
    '/GetLoginData', '/AccountPersonalShow', '/GetPersonalShow',
    '/GetPlayerAccountPersonalShowGet', '/GetRoleBasicInfo',
];

function init(app) {
    app.all('*', (req, res, next) => {
        // Skip yang sudah di-handle modul lain
        if (req.path.startsWith('/cdn/'))       return next();
        if (req.path.startsWith('/hotpatchs/')) return next();
        if (req.path.startsWith('/live/'))      return next();
        if (req.path.startsWith('/api/'))       return next();
        if (req.path === '/MajorLogin')         return next();
        if (req.path === '/Ping')               return next();

        // Serve GetLoginData dari prefetch cache kalau ada
        if (req.path === '/GetLoginData' || req.path.startsWith('/GetLoginData?')) {
            const ml = getMlMod();
            if (ml && Buffer.isBuffer(req.body) && req.body.length > 0) {
                try {
                    const pb = require('protobufjs');
                    const r  = pb.Reader.create(req.body);
                    while (r.pos < r.len) {
                        const tag = r.uint32();
                        if ((tag >>> 3) === 1 && (tag & 7) === 0) {
                            const cached = ml.glCacheGet(r.uint64().toString());
                            if (cached) {
                                res.writeHead(200, cached.headers);
                                return res.end(cached.buf);
                            }
                            break;
                        }
                        try {
                            const wt = tag & 7;
                            if (wt === 0) r.uint64();
                            else if (wt === 2) r.skip(r.uint32());
                            else if (wt === 5) r.skip(4);
                            else if (wt === 1) r.skip(8);
                            else break;
                        } catch (_) { break; }
                    }
                } catch (_) {}
            }
        }

        // AdAway redirect: Host header menunjuk ke Garena server
        const host = (req.headers['host'] || '').toLowerCase();
        if (host.includes('loginbp.') || host.includes('ggpolarbear')) return loginProxy(req, res, next);
        if (host.includes('clientbp.') || host.includes('ppmainecoonghj')) return clientProxy(req, res, next);

        // Route by path
        if (LOGIN_PATHS.some(p => req.path === p || req.path.startsWith(p + '?'))) return loginProxy(req, res, next);
        if (CLIENT_PATHS.some(p => req.path === p || req.path.startsWith(p + '?'))) return clientProxy(req, res, next);

        return clientProxy(req, res, next);
    });

    console.log('[PROXY] active — pure forward');
}

module.exports = { init };
