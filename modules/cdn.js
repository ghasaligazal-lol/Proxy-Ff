'use strict'
// modules/cdn.js
// Struktur ikutin Jun (dl-xpanel.junofficial.web.id):
//   /cdn/android_max_astc/       — asset max ASTC
//   /cdn/IconCDN/android/        — icon weapon/skin
//   /cdn/live/ABHotUpdates/      — hotupdate patch
//   /cdn/common/                 — common assets
//   /cdn/cache_res               — cache_res file (diakses game langsung)
//   /cdn/info                    — info file metadata (Jun style)
//   /cdn/localconfig.json        — config lokal

const path  = require('path');
const fs    = require('fs');
const https = require('https');

const BASE_DIR = path.resolve(__dirname, '..', 'public', 'cdn');

const VERSION       = '2.130.22';
const VERSION_ASTC  = '2.130.22';
const LOCAL_VERSIONS_MAX = ['2.130.22'];

// ─── Cache_res in-memory cache (Jun style) ─────────────────────────────────
const CACHE_RES_TTL = 60 * 1000; // 60 detik TTL
let _cacheResCache = null;
let _cacheResMtime = 0;

function getCacheResBuffer() {
    const filePath = path.join(BASE_DIR, 'cache_res');
    if (!fs.existsSync(filePath)) return null;
    try {
        const stat = fs.statSync(filePath);
        const mtime = stat.mtimeMs;
        if (_cacheResCache && mtime === _cacheResMtime) {
            return _cacheResCache; // serve dari cache
        }
        _cacheResCache = fs.readFileSync(filePath);
        _cacheResMtime = mtime;
        console.log(`[CDN] cache_res loaded into memory (${_cacheResCache.length}B)`);
        return _cacheResCache;
    } catch (e) {
        console.log(`[CDN] cache_res read error: ${e.message}`);
        return null;
    }
}

// ─── Info file cache (Jun style — /cdn/info) ───────────────────────────────
// Format info: list nama asset + hash dari cache_res/fileinfo
// Jun serve ini sebagai plain text, game pakai untuk cross-check asset
let _infoCache = null;
let _infoMtime = 0;

function getInfoContent() {
    // Prioritas: public/cdn/live/ABHotUpdates/fileinfo → public/api/live/fileinfo
    const candidates = [
        path.join(BASE_DIR, 'live', 'ABHotUpdates', 'fileinfo'),
        path.join(__dirname, '..', 'public', 'api', 'live', 'fileinfo'),
    ];
    for (const fp of candidates) {
        if (!fs.existsSync(fp)) continue;
        try {
            const stat = fs.statSync(fp);
            const mtime = stat.mtimeMs;
            if (_infoCache && mtime === _infoMtime) return _infoCache;
            _infoCache = fs.readFileSync(fp, 'utf8');
            _infoMtime = mtime;
            console.log(`[CDN] info loaded from ${fp} (${_infoCache.length} chars)`);
            return _infoCache;
        } catch (e) {
            console.log(`[CDN] info read error: ${e.message}`);
        }
    }
    return null;
}

const AGENT = new https.Agent({
    keepAlive:      true,
    keepAliveMsecs: 10000,
    maxSockets:     16,
    timeout:        90000,
});

// ---------- PATH RESOLUTION ----------
function safeLocalPath(urlPath) {
    let p;
    try { p = decodeURIComponent(urlPath); } catch (_) { p = urlPath; }
    p = p.replace(/\\/g, '/');
    if (p.includes('\0') || p.includes('..')) return null;

    const candidates = [
        // Direct match
        path.join(BASE_DIR, p.replace(/^\/+/, '')),
        // Strip /live/ABHotUpdates prefix
        path.join(BASE_DIR, p.replace(/^\/live\/ABHotUpdates\/?/, '')),
    ];

    // Fallback: live/ABHotUpdates → android_max_astc/<ver>
    const abMatch = /^\/live\/ABHotUpdates\/(gameassetbundles\/.+)$/.exec(p);
    if (abMatch) {
        for (const ver of LOCAL_VERSIONS_MAX) {
            candidates.push(path.join(BASE_DIR, 'android_max_astc', ver, abMatch[1]));
        }
    }

    // Fallback: android_max_astc/<any ver> → versi lokal
    const maxMatch = /^\/android_max_astc\/[^/]+\/(gameassetbundles\/.+)$/.exec(p);
    if (maxMatch) {
        for (const ver of LOCAL_VERSIONS_MAX) {
            candidates.push(path.join(BASE_DIR, 'android_max_astc', ver, maxMatch[1]));
        }
        candidates.push(path.join(BASE_DIR, 'live', 'ABHotUpdates', maxMatch[1]));
    }

    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        if (resolved === BASE_DIR || resolved.startsWith(BASE_DIR + path.sep)) {
            if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
                return resolved;
            }
        }
    }
    return null;
}

// ---------- LOCAL SEND (with Range support) ----------
function sendLocal(req, res, filePath) {
    const stat = fs.statSync(filePath);
    const size = stat.size;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (req.method === 'HEAD') {
        res.setHeader('Content-Length', String(size));
        return res.status(200).end();
    }

    const range = req.headers.range;
    if (!range) {
        res.setHeader('Content-Length', String(size));
        return fs.createReadStream(filePath)
            .on('error', () => { if (!res.headersSent) res.status(500).end(); })
            .pipe(res);
    }

    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();

    let start, end;
    if (!m[1] && m[2]) { const suf = Number(m[2]); start = Math.max(0, size - suf); end = size - 1; }
    else { start = m[1] ? Number(m[1]) : 0; end = m[2] ? Number(m[2]) : size - 1; }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size)
        return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();

    end = Math.min(end, size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    return fs.createReadStream(filePath, { start, end })
        .on('error', () => { if (!res.headersSent) res.status(500).end(); else res.destroy(); })
        .pipe(res);
}

// ---------- SEND BUFFER with Range support (untuk in-memory cache_res) ----------
function sendBuffer(req, res, buf) {
    const size = buf.length;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=60');

    if (req.method === 'HEAD') {
        res.setHeader('Content-Length', String(size));
        return res.status(200).end();
    }

    const range = req.headers.range;
    if (!range) {
        res.setHeader('Content-Length', String(size));
        return res.end(buf);
    }

    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();

    let start, end;
    if (!m[1] && m[2]) { const suf = Number(m[2]); start = Math.max(0, size - suf); end = size - 1; }
    else { start = m[1] ? Number(m[1]) : 0; end = m[2] ? Number(m[2]) : size - 1; }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size)
        return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();

    end = Math.min(end, size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    return res.end(buf.slice(start, end + 1));
}

// ---------- UPSTREAM PROXY ----------
function upstreamTarget(reqPath) {
    let p = reqPath;
    if (!p.startsWith('/')) p = '/' + p;

    if (p.startsWith('/android_max_astc/')) {
        return `https://dl.cdn.freefiremobile.com${p}`;
    }
    if (p.startsWith('/IconCDN/')) {
        return `https://dl.cdn.freefiremobile.com${p}`;
    }
    if (/^\/OB\d+\//.test(p)) {
        return `https://dl.cdn.freefiremobile.com/common${p}`;
    }
    if (p.startsWith('/common/')) {
        return `https://dl.cdn.freefiremobile.com${p}`;
    }

    // Default: live/ABHotUpdates
    if (!p.includes('/live/ABHotUpdates/')) {
        p = `/live/ABHotUpdates${p}`;
    }
    p = p.replace(/\/OB54\//g, `/${VERSION}/`);
    return `https://dl.cdn.freefiremobile.com${p}`;
}

function proxyUpstream(req, res, target, attempt) {
    attempt = attempt || 1;
    console.log(`[CDN] UPSTREAM ${target} (attempt ${attempt})`);

    const u = new URL(target);
    const headers = {
        'User-Agent':      req.headers['user-agent'] || 'Dalvik/2.1.0',
        'Accept':          req.headers.accept || '*/*',
        'Accept-Language': req.headers['accept-language'] || 'id-ID,en-US;q=0.9',
        'Connection':      'keep-alive',
        'Host':            u.host,
    };
    if (req.headers.range) headers.Range = req.headers.range;

    const r = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers, agent: AGENT }, upstreamRes => {
        const status = upstreamRes.statusCode || 502;
        res.statusCode = status;
        for (const h of ['content-type','content-length','content-range','accept-ranges','etag','last-modified','cache-control']) {
            if (upstreamRes.headers[h] !== undefined) res.setHeader(h, upstreamRes.headers[h]);
        }
        upstreamRes.pipe(res);
        upstreamRes.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
    });

    r.setTimeout(90000, () => { r.destroy(new Error('upstream timeout')); });
    r.on('error', err => {
        console.log(`[CDN] UPSTREAM ERROR (attempt ${attempt}): ${err.message}`);
        if (attempt === 1 && (err.code === 'ECONNRESET' || err.message === 'upstream timeout')) {
            return proxyUpstream(req, res, target, 2);
        }
        if (!res.headersSent) res.status(502).send('CDN upstream error');
    });
}

// ---------- INIT ----------
function init(app) {

    // ── /cdn/cache_res — serve dengan in-memory cache (Jun style) ──
    app.get('/cdn/cache_res', (req, res) => {
        const buf = getCacheResBuffer();
        if (!buf) {
            console.log('[CDN] cache_res NOT FOUND — 404');
            return res.status(404).send('cache_res not found');
        }
        console.log(`[CDN] cache_res HIT (cached: ${buf.length}B)`);
        return sendBuffer(req, res, buf);
    });

    // ── /cdn/info — Jun style info endpoint (plain text, game pakai ini) ──
    app.get('/cdn/info', (req, res) => {
        const content = getInfoContent();
        if (!content) {
            console.log('[CDN] info NOT FOUND — 404');
            return res.status(404).send('info not found');
        }
        const buf = Buffer.from(content, 'utf8');
        console.log(`[CDN] info HIT (${buf.length}B)`);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Length', String(buf.length));
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.setHeader('Accept-Ranges', 'bytes');
        return res.status(200).end(buf);
    });

    // ── /cdn/live/ABHotUpdates/fileinfo — serve fileinfo langsung ──
    app.get('/cdn/live/ABHotUpdates/fileinfo', (req, res) => {
        const filePath = path.join(BASE_DIR, 'live', 'ABHotUpdates', 'fileinfo');
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('fileinfo not found');
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=60');
        return fs.createReadStream(filePath).pipe(res);
    });

    // ── /cdn/android_max_astc/<ver>/fileinfo — serve per-version fileinfo ──
    app.get('/cdn/android_max_astc/:ver/fileinfo', (req, res) => {
        const ver = req.params.ver.replace(/[^0-9.]/g, '');
        const filePath = path.join(BASE_DIR, 'android_max_astc', ver, 'fileinfo');
        if (!fs.existsSync(filePath)) {
            // fallback ke live/ABHotUpdates/fileinfo
            const fallback = path.join(BASE_DIR, 'live', 'ABHotUpdates', 'fileinfo');
            if (fs.existsSync(fallback)) {
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader('Cache-Control', 'public, max-age=60');
                return fs.createReadStream(fallback).pipe(res);
            }
            return res.status(404).send('fileinfo not found');
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=60');
        return fs.createReadStream(filePath).pipe(res);
    });

    // ── Main CDN handler ──
    app.use('/cdn', (req, res) => {
        const reqPath = req.path || '/';
        console.log(`[CDN] ${req.method} ${reqPath} range=${req.headers.range || '-'}`);

        // Local file check
        const local = safeLocalPath(reqPath);
        if (local) {
            console.log(`[CDN] LOCAL HIT ${local} (${fs.statSync(local).size}B)`);
            return sendLocal(req, res, local);
        }

        // cache_res miss → 404 (jangan proxy, file harus lokal)
        if (reqPath.includes('cache_res')) {
            console.log(`[CDN] CACHE_RES MISS: ${reqPath}`);
            return res.status(404).send('cache_res not found locally');
        }

        return proxyUpstream(req, res, upstreamTarget(reqPath));
    });

    console.log('[CDN] Active — cache_res in-memory + /cdn/info endpoint ready');
}

module.exports = { init, getCacheResBuffer, getInfoContent };
