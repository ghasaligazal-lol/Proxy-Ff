'use strict';
// modules/cdn.js
// Serve lokal: cache_res, fileinfo, codepatch, hotpatchs
// TIDAK download asset game — semua gameassetbundles (kecuali codepatch) diproxy ke Garena CDN

const path  = require('path');
const fs    = require('fs');
const https = require('https');

const BASE_DIR = path.resolve(__dirname, '..', 'public', 'cdn');

const VERSION             = '1.132.6';  // FIX: sync dengan gamevar.js default version
const LOCAL_VERSIONS_MAX  = ['2.131.22', '2.130.22', '1.132.6', '1.126.3'];
const LOCAL_VERSIONS_ASTC = ['1.132.6', '1.126.3', '1.125.1'];

// ─── Cache_res in-memory cache ─────────────────────────────────────────────
let _cacheResCache = null;
let _cacheResMtime = 0;

function getCacheResBuffer() {
    const candidates = [
        path.join(BASE_DIR, 'cache_res'),
        path.join(BASE_DIR, 'android_max_astc', VERSION, 'gameassetbundles', 'cache_res'),
        path.join(BASE_DIR, 'live', 'ABHotUpdates', 'cache_res'),
        path.join(__dirname, '..', 'public', 'api', 'live', 'ABHotUpdates', 'cache_res'),
        path.join(__dirname, '..', 'public', 'api', 'live', 'cache_res'),
        path.join(__dirname, '..', 'public', 'api', 'cache_res'),
    ];
    for (const filePath of candidates) {
        if (!fs.existsSync(filePath)) continue;
        try {
            const stat  = fs.statSync(filePath);
            const mtime = stat.mtimeMs;
            if (_cacheResCache && mtime === _cacheResMtime) return _cacheResCache;
            _cacheResCache = fs.readFileSync(filePath);
            _cacheResMtime = mtime;
            console.log(`[CDN] cache_res loaded from ${filePath} (${_cacheResCache.length}B)`);
            return _cacheResCache;
        } catch (e) {
            console.log(`[CDN] cache_res read error (${filePath}): ${e.message}`);
        }
    }
    return null;
}

// ─── Info / fileinfo cache ──────────────────────────────────────────────────
let _infoCache = null;
let _infoMtime = 0;

function getInfoContent() {
    const candidates = [
        path.join(BASE_DIR, 'live', 'ABHotUpdates', 'fileinfo'),
        path.join(__dirname, '..', 'public', 'api', 'live', 'ABHotUpdates', 'fileinfo'),
        path.join(__dirname, '..', 'public', 'api', 'live', 'fileinfo'),
    ];
    for (const fp of candidates) {
        if (!fs.existsSync(fp)) continue;
        try {
            const stat  = fs.statSync(fp);
            const mtime = stat.mtimeMs;
            if (_infoCache && mtime === _infoMtime) return _infoCache;
            _infoCache = fs.readFileSync(fp, 'utf8');
            _infoMtime = mtime;
            console.log(`[CDN] fileinfo loaded from ${fp}`);
            return _infoCache;
        } catch (e) {
            console.log(`[CDN] fileinfo read error: ${e.message}`);
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

// ─── Path resolution ─────────────────────────────────────────────────────────
function safeLocalPath(urlPath) {
    let p;
    try { p = decodeURIComponent(urlPath); } catch (_) { p = urlPath; }
    p = p.replace(/\\/g, '/');
    if (p.includes('\0') || p.includes('..')) return null;

    const candidates = [
        path.join(BASE_DIR, p.replace(/^\/+/, '')),
        path.join(BASE_DIR, p.replace(/^\/live\/ABHotUpdates\/?/, '')),
    ];

    const abMatch = /^\/live\/ABHotUpdates\/(gameassetbundles\/.+)$/.exec(p);
    if (abMatch) {
        for (const ver of LOCAL_VERSIONS_MAX) {
            candidates.push(path.join(BASE_DIR, 'android_max_astc', ver, abMatch[1]));
        }
    }

    const abVerFileinfo = /^\/live\/ABHotUpdates\/android_max_astc\/[^/]+\/fileinfo$/.exec(p);
    if (abVerFileinfo) {
        for (const ver of LOCAL_VERSIONS_MAX) {
            candidates.push(path.join(BASE_DIR, 'android_max_astc', ver, 'fileinfo'));
        }
        candidates.push(path.join(BASE_DIR, 'live', 'ABHotUpdates', 'fileinfo'));
    }

    const abVerAsset = /^\/live\/ABHotUpdates\/android_max_astc\/[^/]+\/(gameassetbundles\/.+)$/.exec(p);
    if (abVerAsset) {
        for (const ver of LOCAL_VERSIONS_MAX) {
            candidates.push(path.join(BASE_DIR, 'android_max_astc', ver, abVerAsset[1]));
        }
        candidates.push(path.join(BASE_DIR, 'live', 'ABHotUpdates', abVerAsset[1]));
    }

    const abVerOptional = /^\/live\/ABHotUpdates\/android_max_astc\/[^/]+\/(optional\/.+)$/.exec(p);
    if (abVerOptional) {
        for (const ver of LOCAL_VERSIONS_MAX) {
            candidates.push(path.join(BASE_DIR, 'android_max_astc', ver, abVerOptional[1]));
        }
        candidates.push(path.join(BASE_DIR, 'android_max_astc', 'optional', ...abVerOptional[1].split('/').slice(1)));
    }

    const astcFileinfo = /^\/live\/ABHotUpdates\/android_astc\/[^/]+\/fileinfo$/.exec(p);
    if (astcFileinfo) {
        for (const ver of LOCAL_VERSIONS_ASTC) {
            candidates.push(path.join(BASE_DIR, 'android_astc', ver, 'fileinfo'));
        }
        for (const ver of LOCAL_VERSIONS_MAX) {
            candidates.push(path.join(BASE_DIR, 'android_max_astc', ver, 'fileinfo'));
        }
        candidates.push(path.join(BASE_DIR, 'live', 'ABHotUpdates', 'fileinfo'));
    }

    const astcAsset = /^\/live\/ABHotUpdates\/android_astc\/[^/]+\/(gameassetbundles\/.+)$/.exec(p);
    if (astcAsset) {
        for (const ver of LOCAL_VERSIONS_ASTC) {
            candidates.push(path.join(BASE_DIR, 'android_astc', ver, astcAsset[1]));
        }
        for (const ver of LOCAL_VERSIONS_MAX) {
            candidates.push(path.join(BASE_DIR, 'android_max_astc', ver, astcAsset[1]));
        }
        candidates.push(path.join(BASE_DIR, 'live', 'ABHotUpdates', astcAsset[1]));
    }

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

// ─── Local send dengan Range support ─────────────────────────────────────────
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
        .on('error', () => { if (!res.headersSent) res.status(500).end(); })
        .pipe(res);
}

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

// ─── Upstream proxy ───────────────────────────────────────────────────────────
function upstreamTarget(reqPath) {
    let p = reqPath;
    if (!p.startsWith('/')) p = '/' + p;

    if (p.startsWith('/IconCDN/')) return `https://dl.cdn.freefiremobile.com${p}`;
    if (/^\/OB\d+\//.test(p)) return `https://dl.cdn.freefiremobile.com/common${p}`;
    if (p.startsWith('/common/')) return `https://dl.cdn.freefiremobile.com${p}`;
    if (p.startsWith('/android_max_astc/') || p.startsWith('/android_astc/')) {
        return `https://dl.cdn.freefiremobile.com/live/ABHotUpdates${p}`;
    }
    if (!p.includes('/live/ABHotUpdates/')) p = `/live/ABHotUpdates${p}`;
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

// ─── Init ─────────────────────────────────────────────────────────────────────
function init(app) {

    // ─── Hotpatchs routes ────────────────────────────────────────────────────
    // Format: /hotpatchs/<hash>/android_astc/<ver>/fileinfo
    //         /hotpatchs/<hash>/android_astc/<ver>/gameassetbundles/<file>
    // File di filesystem dengan nama pakai ~ encoding, serve langsung tanpa proxy upstream
    app.get(/^\/hotpatchs\/[a-f0-9]+\/(.+)$/, (req, res) => {
        const subpath = req.params[0];
        const fsPath  = path.join(__dirname, '..', 'public', 'hotpatchs',
                            req.path.replace(/^\/hotpatchs\//, ''));

        // Cek path dengan ~ (literal) dan tanpa ~ (decoded)
        // CATATAN: ~2F = / jadi decoded path bisa jadi multi-level → pakai path literal dulu
        const decoded = fsPath.replace(/~2F/g, '/').replace(/~2B/g, '+').replace(/~3D/g, '=');

        let filePath = null;
        // Cek path literal dulu (nama file dengan ~ encoding)
        if (fs.existsSync(fsPath) && fs.statSync(fsPath).isFile()) {
            filePath = fsPath;
        }
        // Jika tidak ketemu, coba decoded (tapi hanya kalau path decoded valid)
        if (!filePath) {
            try {
                const resolved = path.resolve(decoded);
                const hotpatchBase = path.resolve(__dirname, '..', 'public', 'hotpatchs');
                if (resolved.startsWith(hotpatchBase) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
                    filePath = resolved;
                }
            } catch (_) {}
        }

        if (!filePath) {
            console.log('[HOTPATCHS] MISS:', req.path);
            return res.status(404).send('Not found');
        }

        console.log('[HOTPATCHS] HIT:', filePath);
        const isFileinfo = subpath.endsWith('fileinfo');
        res.setHeader('Content-Type', isFileinfo ? 'text/plain; charset=utf-8' : 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.setHeader('Accept-Ranges', 'bytes');
        return sendLocal(req, res, filePath);
    });

    // /cdn/cache_res — in-memory cache
    app.get('/cdn/cache_res', (req, res) => {
        const buf = getCacheResBuffer();
        if (!buf) {
            console.log('[CDN] cache_res NOT FOUND — 404');
            return res.status(404).send('cache_res not found');
        }
        console.log(`[CDN] cache_res HIT (${buf.length}B)`);
        return sendBuffer(req, res, buf);
    });

    // /cdn/info & /cdn/live/ABHotUpdates/fileinfo
    app.get(['/cdn/info', '/cdn/live/ABHotUpdates/fileinfo'], (req, res) => {
        const content = getInfoContent();
        if (!content) {
            console.log('[CDN] fileinfo NOT FOUND — 404');
            return res.status(404).send('fileinfo not found');
        }
        const buf = Buffer.from(content, 'utf8');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Length', String(buf.length));
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.setHeader('Accept-Ranges', 'bytes');
        return res.status(200).end(buf);
    });

    // /cdn/live/ABHotUpdates/android_max_astc/:ver/fileinfo
    app.get('/cdn/live/ABHotUpdates/android_max_astc/:ver/fileinfo', (req, res) => {
        const candidates = [
            ...LOCAL_VERSIONS_MAX.map(v => path.join(BASE_DIR, 'android_max_astc', v, 'fileinfo')),
            path.join(BASE_DIR, 'live', 'ABHotUpdates', 'fileinfo'),
        ];
        for (const fp of candidates) {
            if (fs.existsSync(fp)) {
                console.log(`[CDN] fileinfo (ABHotUpdates/ver) → ${fp}`);
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader('Cache-Control', 'public, max-age=60');
                return fs.createReadStream(fp).pipe(res);
            }
        }
        return res.status(404).send('fileinfo not found');
    });

    // /cdn/android_max_astc/:ver/fileinfo
    app.get('/cdn/android_max_astc/:ver/fileinfo', (req, res) => {
        const ver      = req.params.ver.replace(/[^0-9.]/g, '');
        const filePath = path.join(BASE_DIR, 'android_max_astc', ver, 'fileinfo');
        if (!fs.existsSync(filePath)) {
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

    // versioned cache_res (path dari SX2 format)
    app.get(/^\/live\/ABHotUpdates\/android_max_astc\/[^/]+\/gameassetbundles\/(cache_res\.\S+)$/, (req, res) => {
        const filename = req.params[0];
        const apiDir   = path.join(__dirname, '..', 'public', 'api', 'live', 'ABHotUpdates');
        const decoded = filename.replace(/~2F/g, '/').replace(/~2B/g, '+').replace(/~3D/g, '=');
        const candidates = [
            path.join(apiDir, filename),
            path.join(apiDir, decoded),
        ];
        for (const fp of candidates) {
            if (fs.existsSync(fp)) {
                console.log(`[CDN] versioned cache_res → ${fp} (${fs.statSync(fp).size}B)`);
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Cache-Control', 'public, max-age=3600');
                res.setHeader('Accept-Ranges', 'bytes');
                return fs.createReadStream(fp).pipe(res);
            }
        }
        // Fallback ke cache_res utama di /public/cdn/cache_res
        const buf = getCacheResBuffer();
        if (buf) {
            console.log(`[CDN] versioned cache_res MISS ${filename} → fallback main cache_res (${buf.length}B)`);
            return sendBuffer(req, res, buf);
        }
        console.log(`[CDN] versioned cache_res MISS: ${filename} (no fallback)`);
        return res.status(404).send('Not found');
    });

    // optional resources: coba lokal dulu, lalu proxy upstream, spoof 200-empty kalau gagal
    app.get(/^\/live\/ABHotUpdates\/android_max_astc\/optional\//, (req, res) => {
        const fullPath = req.path;
        const local = safeLocalPath(fullPath);
        if (local) {
            console.log(`[CDN] optional LOCAL HIT ${local}`);
            return sendLocal(req, res, local);
        }

        const target = `https://dl.cdn.freefiremobile.com${fullPath}`;
        console.log(`[CDN] optional → upstream ${target}`);
        const u = new URL(target);
        const upHeaders = {
            'User-Agent':      req.headers['user-agent'] || 'Dalvik/2.1.0',
            'Accept':          req.headers.accept || '*/*',
            'Accept-Language': req.headers['accept-language'] || 'id-ID,en-US;q=0.9',
            'Connection':      'keep-alive',
            'Host':            u.host,
        };
        if (req.headers.range) upHeaders.Range = req.headers.range;

        const r = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: upHeaders, agent: AGENT }, upstreamRes => {
            const status = upstreamRes.statusCode || 502;
            if (status === 200 || status === 206) {
                res.statusCode = status;
                for (const h of ['content-type','content-length','content-range','accept-ranges','etag','last-modified','cache-control']) {
                    if (upstreamRes.headers[h] !== undefined) res.setHeader(h, upstreamRes.headers[h]);
                }
                upstreamRes.pipe(res);
                upstreamRes.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
            } else {
                console.log(`[CDN] optional upstream ${status} ${fullPath} → spoof 200 empty`);
                upstreamRes.resume();
                if (!res.headersSent) {
                    res.setHeader('Content-Type', 'application/octet-stream');
                    res.setHeader('Content-Length', '0');
                    res.setHeader('Accept-Ranges', 'bytes');
                    res.status(200).end();
                }
            }
        });
        r.setTimeout(15000, () => { r.destroy(new Error('optional upstream timeout')); });
        r.on('error', err => {
            console.log(`[CDN] optional upstream error: ${err.message} → spoof 200 empty`);
            if (!res.headersSent) {
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Content-Length', '0');
                res.setHeader('Accept-Ranges', 'bytes');
                res.status(200).end();
            }
        });
    });

    // gameassetbundles NON-codepatch → PROXY ke Garena CDN (game download sendiri dari CDN)
    // Proxy bukan mendownload asset game — hanya meneruskan request dari game ke Garena CDN
    app.get(/^\/live\/ABHotUpdates\/android_max_astc\/[^/]+\/gameassetbundles\/(?!cache_res)/, (req, res) => {
        const fullPath = req.path;
        const target = `https://dl.cdn.freefiremobile.com${fullPath}`;
        console.log(`[CDN] gameassetbundles passthrough → ${target}`);
        return proxyUpstream(req, res, target);
    });

    // fileinfo android_astc (non-max)
    app.get(/^\/live\/ABHotUpdates\/android_astc\/[^/]+\/fileinfo$/, (req, res) => {
        const candidates = [
            path.join(__dirname, '..', 'public', 'api', 'live', 'ABHotUpdates', 'fileinfo'),
            path.join(__dirname, '..', 'public', 'api', 'live', 'fileinfo'),
            path.join(BASE_DIR, 'fileinfo'),
            ...LOCAL_VERSIONS_ASTC.map(v => path.join(BASE_DIR, 'android_astc', v, 'fileinfo')),
            ...LOCAL_VERSIONS_MAX.map(v => path.join(BASE_DIR, 'android_max_astc', v, 'fileinfo')),
            path.join(BASE_DIR, 'live', 'ABHotUpdates', 'fileinfo'),
        ];
        for (const fp of candidates) {
            if (fs.existsSync(fp)) {
                console.log(`[CDN] android_astc fileinfo → ${fp}`);
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader('Cache-Control', 'public, max-age=60');
                return fs.createReadStream(fp).pipe(res);
            }
        }
        const target = `https://core-gmc.freefiremobile.com${req.path}`;
        console.log(`[CDN] android_astc fileinfo NOT FOUND → upstream ${target}`);
        return proxyUpstream(req, res, target);
    });

    // fileinfo android_max_astc versioned (SX2 format)
    app.get(/^\/live\/ABHotUpdates\/android_max_astc\/[^/]+\/fileinfo$/, (req, res) => {
        const candidates = [
            path.join(__dirname, '..', 'public', 'api', 'live', 'ABHotUpdates', 'fileinfo'),
            path.join(__dirname, '..', 'public', 'api', 'live', 'fileinfo'),
            path.join(BASE_DIR, 'live', 'ABHotUpdates', 'fileinfo'),
        ];
        for (const fp of candidates) {
            if (fs.existsSync(fp)) {
                console.log(`[CDN] versioned fileinfo → ${fp}`);
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.setHeader('Cache-Control', 'public, max-age=60');
                return fs.createReadStream(fp).pipe(res);
            }
        }
        return res.status(404).send('fileinfo not found');
    });

    // /cdn/* catch-all — lokal dulu, lalu upstream
    app.use('/cdn', (req, res) => {
        const reqPath = req.path || '/';
        console.log(`[CDN] ${req.method} ${reqPath} range=${req.headers.range || '-'}`);

        const local = safeLocalPath(reqPath);
        if (local) {
            console.log(`[CDN] LOCAL HIT ${local} (${fs.statSync(local).size}B)`);
            return sendLocal(req, res, local);
        }

        if (reqPath.includes('cache_res')) {
            console.log(`[CDN] CACHE_RES MISS: ${reqPath}`);
            return res.status(404).send('cache_res not found locally');
        }

        // UGC: spoof 200-empty kalau upstream gagal (cegah NullRef saat join group)
        if (reqPath.includes('ugcres') || reqPath.includes('ugc') || reqPath.includes('optionalugc')) {
            const ugcTarget = upstreamTarget(reqPath);
            console.log(`[CDN] UGC MISS → upstream ${ugcTarget}`);
            const u = new URL(ugcTarget);
            const ugcHeaders = {
                'User-Agent':  req.headers['user-agent'] || 'Dalvik/2.1.0',
                'Accept':      req.headers.accept || '*/*',
                'Connection':  'keep-alive',
                'Host':        u.host,
            };
            if (req.headers.range) ugcHeaders.Range = req.headers.range;
            const r = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: ugcHeaders, agent: AGENT }, upstreamRes => {
                const status = upstreamRes.statusCode || 502;
                if (status === 200 || status === 206) {
                    res.statusCode = status;
                    for (const h of ['content-type','content-length','content-range','accept-ranges','etag','cache-control']) {
                        if (upstreamRes.headers[h] !== undefined) res.setHeader(h, upstreamRes.headers[h]);
                    }
                    upstreamRes.pipe(res);
                    upstreamRes.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.destroy(); });
                } else {
                    console.log(`[CDN] UGC upstream ${status} ${reqPath} → spoof 200 empty`);
                    upstreamRes.resume();
                    if (!res.headersSent) {
                        res.setHeader('Content-Type', 'application/octet-stream');
                        res.setHeader('Content-Length', '0');
                        res.setHeader('Accept-Ranges', 'bytes');
                        res.status(200).end();
                    }
                }
            });
            r.setTimeout(15000, () => { r.destroy(new Error('ugc upstream timeout')); });
            r.on('error', err => {
                console.log(`[CDN] UGC upstream error: ${err.message} → spoof 200 empty`);
                if (!res.headersSent) {
                    res.setHeader('Content-Type', 'application/octet-stream');
                    res.setHeader('Content-Length', '0');
                    res.setHeader('Accept-Ranges', 'bytes');
                    res.status(200).end();
                }
            });
            return;
        }

        return proxyUpstream(req, res, upstreamTarget(reqPath));
    });

    console.log(`[CDN] Active — version ${VERSION}, cache_res in-memory + fileinfo ready`);
}

module.exports = { init, getCacheResBuffer, getInfoContent, proxyUpstream };
