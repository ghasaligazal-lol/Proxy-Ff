// modules/cdn.js
// [SX2 Bypass] Railway-safe CDN handler
// - Local file serve untuk: fileinfo, cache_res, codepatch (Assembly-CSharp-patch)
// - 302 REDIRECT ke Garena CDN untuk semua file lain yang tidak ada lokal
//   → client download langsung dari Garena, Railway tidak perlu buffering file besar
//   → ikutin pola SX2: proxy hanya file kritis, sisanya redirect ke CDN asli
// - Range/HEAD support untuk file lokal
// - android_max_astc/2.131.22 support

'use strict';

const path = require('path');
const fs   = require('fs');
const https = require('https');

const BASE_DIR    = path.resolve(__dirname, '..', 'public', 'cdn');
const VERSION     = '1.130.22';
const VERSION_MAX = '2.131.22';

// CDN Garena langsung — tujuan redirect untuk file yang tidak ada lokal
const GARENA_CDN_BASE = 'https://dl.cdn.freefiremobile.com/live/ABHotUpdates/';

const LOCAL_VERSIONS     = ['1.126.3', '1.130.22', '2.130.22'];
const LOCAL_MAX_VERSIONS = ['2.131.22'];

// Keep-alive agent — dipakai hanya untuk HEAD check jika diperlukan
const AGENT = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 10000,
    maxSockets: 8,
    timeout: 30000,
});

// ─── Path resolver ───────────────────────────────────────────────────────────
function safeLocalPath(urlPath) {
    let p;
    try { p = decodeURIComponent(urlPath); } catch (_) { p = urlPath; }

    p = p.replace(/\\/g, '/');
    if (p.includes('\0') || p.includes('..')) return null;

    const candidates = [
        path.join(BASE_DIR, p.replace(/^\/+/, '')),
        path.join(BASE_DIR, p.replace(/^\/live\/ABHotUpdates\/?/, '')),
    ];

    // ── android_max_astc ──
    const maxFileInfoMatch = /^\/live\/ABHotUpdates\/android_max_astc\/[^/]+\/fileinfo$/.exec(p);
    if (maxFileInfoMatch) {
        for (const ver of LOCAL_MAX_VERSIONS)
            candidates.push(path.join(BASE_DIR, 'android_max_astc', ver, 'fileinfo'));
    }

    const maxAstcMatch = /^\/live\/ABHotUpdates\/android_max_astc\/[^/]+\/(gameassetbundles\/.+)$/.exec(p);
    if (maxAstcMatch) {
        for (const ver of LOCAL_MAX_VERSIONS)
            candidates.push(path.join(BASE_DIR, 'android_max_astc', ver, maxAstcMatch[1]));
    }

    const maxAstcDirect = /^\/android_max_astc\/[^/]+\/(gameassetbundles\/.+)$/.exec(p);
    if (maxAstcDirect) {
        for (const ver of LOCAL_MAX_VERSIONS)
            candidates.push(path.join(BASE_DIR, 'android_max_astc', ver, maxAstcDirect[1]));
    }
    // ─────────────────────

    // android_astc fallback
    const abMatch = /^\/live\/ABHotUpdates\/(gameassetbundles\/.+)$/.exec(p);
    if (abMatch) {
        for (const ver of LOCAL_VERSIONS)
            candidates.push(path.join(BASE_DIR, 'android_astc', ver, abMatch[1]));
    }

    const codepatchMatch = /^\/live\/ABHotUpdates\/android_astc\/[^/]+\/(gameassetbundles\/codepatch\/.+)$/.exec(p);
    if (codepatchMatch) {
        candidates.push(path.join(BASE_DIR, 'live', 'ABHotUpdates', codepatchMatch[1]));
        for (const ver of LOCAL_VERSIONS)
            candidates.push(path.join(BASE_DIR, 'android_astc', ver, codepatchMatch[1]));
    }

    const astcMatch = /^\/android_astc\/[^/]+\/(gameassetbundles\/.+)$/.exec(p);
    if (astcMatch) {
        for (const ver of LOCAL_VERSIONS)
            candidates.push(path.join(BASE_DIR, 'android_astc', ver, astcMatch[1]));
        candidates.push(path.join(BASE_DIR, 'live', 'ABHotUpdates', astcMatch[1]));
    }

    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        if (resolved === BASE_DIR || resolved.startsWith(BASE_DIR + path.sep)) {
            if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
        }
    }
    return null;
}

// ─── Local file sender (dengan Range support) ────────────────────────────────
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
            .on('error', err => { if (!res.headersSent) res.status(500).end(); })
            .pipe(res);
    }

    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();

    let start, end;
    if (!m[1] && m[2]) {
        const suffix = Number(m[2]);
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = m[1] ? Number(m[1]) : 0;
        end   = m[2] ? Number(m[2]) : size - 1;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size)
        return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();

    end = Math.min(end, size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    return fs.createReadStream(filePath, { start, end })
        .on('error', err => { if (!res.headersSent) res.status(500).end(); })
        .pipe(res);
}

// ─── Redirect URL builder ─────────────────────────────────────────────────────
// Bangun URL Garena CDN untuk redirect
// Semua android_max_astc → android_astc di Garena (path yang sama, cuma variant beda)
function buildRedirectUrl(reqPath) {
    let p = reqPath;
    if (!p.startsWith('/')) p = '/' + p;

    // Strip /live/ABHotUpdates jika ada (sudah di base path)
    p = p.replace(/^\/live\/ABHotUpdates\/?/, '/');

    // android_max_astc/<ver>/ → android_astc/<ver_max>/
    p = p.replace(/\/android_max_astc\/[^/]+\//g, `/android_astc/${VERSION_MAX}/`);

    // Normalisasi versi placeholder
    p = p.replace('/OB54/', `/${VERSION}/`);
    p = p.replace(/\/1\.126\.3\//g, `/${VERSION}/`);
    p = p.replace(/\/2\.130\.22\//g, `/${VERSION}/`);

    // Pastikan mulai dengan /
    if (!p.startsWith('/')) p = '/' + p;

    return `${GARENA_CDN_BASE}${p.replace(/^\//, '')}`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
function init(app) {
    app.use('/cdn', (req, res) => {
        const reqPath = req.path || '/';
        const method  = req.method;
        console.log(`[CDN] ${method} ${reqPath} range=${req.headers.range || '-'}`);

        // 1. Cek file lokal
        const local = safeLocalPath(reqPath);
        if (local) {
            const size = fs.statSync(local).size;
            console.log(`[CDN] LOCAL HIT ${local} (${size} bytes)`);
            return sendLocal(req, res, local);
        }

        // 2. cache_res kritis — harus ada lokal, jangan redirect ke Garena
        //    karena hash/content beda antara proxy vs Garena asli
        if (reqPath.includes('cache_res')) {
            console.log(`[CDN] CACHE_RES MISS (no local file): ${reqPath}`);
            return res.status(404).send('cache_res not found locally');
        }

        // 3. Semua file lain → 302 redirect ke Garena CDN langsung
        //    Client download dari Garena, Railway tidak perlu buffering
        //    Ini persis cara SX2: proxy hanya file kritis, sisanya ke CDN asli
        const redirectUrl = buildRedirectUrl(reqPath);
        console.log(`[CDN] REDIRECT → ${redirectUrl}`);
        return res.redirect(302, redirectUrl);
    });
}

module.exports = { init };
