// modules/cdn.js
// Railway-safe CDN handler:
// - Explicit local-file resolution for /cdn/* and /cdn/live/ABHotUpdates/*
// - Supports Range/HEAD so game downloaders can resume correctly
// - Never returns a JSON success body for a missing binary asset
// - Falls back to upstream only for non-local assets
// - Upstream proxy: streaming chunked, 90s socket timeout, retry 1x on ECONNRESET

'use strict';

const path = require('path');
const fs = require('fs');
const https = require('https');

const BASE_DIR = path.resolve(__dirname, '..', 'public', 'cdn');
const VERSION = '1.130.22';

// Semua versi android_astc yang tersedia secara lokal
const LOCAL_VERSIONS = ['1.126.3', '1.130.22', '2.130.22'];

// Keep-alive agent: reuse TCP connections ke CDN Garena, hindari cold-connect overhead
const AGENT = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 10000,
    maxSockets: 16,
    timeout: 90000,
});

function safeLocalPath(urlPath) {
    let p;
    try {
        // Express req.path is normally decoded; decode once for clients that percent-encode.
        p = decodeURIComponent(urlPath);
    } catch (_) {
        p = urlPath;
    }

    // Prevent path traversal.
    p = p.replace(/\\/g, '/');
    if (p.includes('\0') || p.includes('..')) return null;

    const candidates = [
        // Direct match: /cdn/<path>
        path.join(BASE_DIR, p.replace(/^\/+/, '')),
        // Strip /live/ABHotUpdates prefix: game requests /cdn/live/ABHotUpdates/gameassetbundles/X
        // but file stored at /cdn/android_astc/<version>/gameassetbundles/X or /cdn/live/ABHotUpdates/gameassetbundles/X
        path.join(BASE_DIR, p.replace(/^\/live\/ABHotUpdates\/?/, '')),
    ];

    // Fallback: jika request ke /live/ABHotUpdates/gameassetbundles/<file>,
    // coba semua versi android_astc yang tersedia lokal
    const abMatch = /^\/live\/ABHotUpdates\/(gameassetbundles\/.+)$/.exec(p);
    if (abMatch) {
        for (const ver of LOCAL_VERSIONS) {
            candidates.push(path.join(BASE_DIR, 'android_astc', ver, abMatch[1]));
        }
    }

    // Fallback khusus codepatch: /live/ABHotUpdates/android_astc/<ver>/gameassetbundles/codepatch/<file>
    // → /cdn/live/ABHotUpdates/gameassetbundles/codepatch/<file>
    const codepatchMatch = /^\/live\/ABHotUpdates\/android_astc\/[^/]+\/(gameassetbundles\/codepatch\/.+)$/.exec(p);
    if (codepatchMatch) {
        candidates.push(path.join(BASE_DIR, 'live', 'ABHotUpdates', codepatchMatch[1]));
        for (const ver of LOCAL_VERSIONS) {
            candidates.push(path.join(BASE_DIR, 'android_astc', ver, codepatchMatch[1]));
        }
    }

    // Fallback: request ke /android_astc/<ver>/gameassetbundles/<file>
    // → cek semua LOCAL_VERSIONS jika versi tidak cocok
    const astcMatch = /^\/android_astc\/[^/]+\/(gameassetbundles\/.+)$/.exec(p);
    if (astcMatch) {
        for (const ver of LOCAL_VERSIONS) {
            candidates.push(path.join(BASE_DIR, 'android_astc', ver, astcMatch[1]));
        }
        // Dan dari live/ABHotUpdates
        candidates.push(path.join(BASE_DIR, 'live', 'ABHotUpdates', astcMatch[1]));
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
            .on('error', err => {
                console.log(`[CDN] LOCAL STREAM ERROR: ${err.message}`);
                if (!res.headersSent) res.status(500).end();
            })
            .pipe(res);
    }

    // Range request
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) {
        return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    }

    let start, end;

    if (!m[1] && m[2]) {
        // Suffix range: bytes=-N
        const suffix = Number(m[2]);
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = m[1] ? Number(m[1]) : 0;
        end   = m[2] ? Number(m[2]) : size - 1;
    }

    if (
        !Number.isInteger(start) || !Number.isInteger(end) ||
        start < 0 || end < start || start >= size
    ) {
        return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    }

    end = Math.min(end, size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));

    return fs.createReadStream(filePath, { start, end })
        .on('error', err => {
            console.log(`[CDN] RANGE STREAM ERROR: ${err.message}`);
            if (!res.headersSent) res.status(500).end();
        })
        .pipe(res);
}

function upstreamTarget(reqPath) {
    let p = reqPath;
    if (!p.startsWith('/')) p = '/' + p;

    // Normalisasi ke path upstream: semua request harus lewat /live/ABHotUpdates/
    if (!p.includes('/live/ABHotUpdates/')) {
        p = `/live/ABHotUpdates${p}`;
    }

    // Ganti placeholder versi dengan VERSION aktif
    p = p.replace('/OB54/', `/${VERSION}/`);
    p = p.replace(/\/1\.126\.3\//g, `/${VERSION}/`);
    p = p.replace(/\/2\.130\.22\//g, `/${VERSION}/`);

    return `https://dl.cdn.freefiremobile.com${p}`;
}

// Coba proxy ke upstream. attempt=1 berarti pertama kali, attempt=2 berarti retry.
function proxyUpstream(req, res, target, attempt) {
    attempt = attempt || 1;
    console.log(`[CDN] UPSTREAM ${target} (attempt ${attempt})`);

    const u = new URL(target);
    const headers = {
        'User-Agent': req.headers['user-agent'] || 'Dalvik/2.1.0',
        'Accept': req.headers.accept || '*/*',
        'Accept-Language': req.headers['accept-language'] || 'id-ID,en-US;q=0.9',
        'Connection': 'keep-alive',
        'Host': u.host,
    };

    if (req.headers.range) headers.Range = req.headers.range;

    const r = https.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers,
        agent: AGENT,
    }, upstreamRes => {
        const status = upstreamRes.statusCode || 502;
        res.statusCode = status;

        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'cache-control']) {
            if (upstreamRes.headers[h] !== undefined) res.setHeader(h, upstreamRes.headers[h]);
        }

        // Streaming langsung pipe — tidak buffer di memory, Railway tidak cut duluan
        upstreamRes.pipe(res);

        upstreamRes.on('error', err => {
            console.log(`[CDN] UPSTREAM RES ERROR: ${err.message}`);
            if (!res.headersSent) res.status(502).end();
            else res.destroy();
        });
    });

    // 90 detik — cukup untuk file 2-3MB lewat Railway → CDN Garena
    r.setTimeout(90000, () => {
        console.log(`[CDN] UPSTREAM SOCKET TIMEOUT: ${target}`);
        r.destroy(new Error('upstream timeout'));
    });

    r.on('error', err => {
        console.log(`[CDN] UPSTREAM ERROR (attempt ${attempt}): ${err.message} — ${target}`);

        // Retry sekali untuk ECONNRESET / timeout — Railway kadang drop koneksi pertama
        if (attempt === 1 && (err.code === 'ECONNRESET' || err.message === 'upstream timeout')) {
            console.log(`[CDN] RETRYING ${target}`);
            return proxyUpstream(req, res, target, 2);
        }

        if (!res.headersSent) res.status(502).send('CDN upstream error');
    });
}

function init(app) {
    app.use('/cdn', (req, res) => {
        const reqPath = req.path || '/';
        console.log(`[CDN] ${req.method} ${reqPath} range=${req.headers.range || '-'}`);

        const local = safeLocalPath(reqPath);
        if (local) {
            const size = fs.statSync(local).size;
            console.log(`[CDN] LOCAL HIT ${local} (${size} bytes)`);
            return sendLocal(req, res, local);
        }

        // Jangan fabrikasi response sukses untuk cache_res yang tidak ada lokal.
        // cache_res adalah file kritis — jika tidak ada lokal, jangan proxy ke upstream
        // karena upstream mungkin punya versi berbeda yang tidak kompatibel.
        if (reqPath.includes('cache_res')) {
            console.log(`[CDN] CACHE_RES MISS (no local file): ${reqPath}`);
            return res.status(404).send('cache_res not found locally');
        }

        return proxyUpstream(req, res, upstreamTarget(reqPath));
    });
}

module.exports = { init };
