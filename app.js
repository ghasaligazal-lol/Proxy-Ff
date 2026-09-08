'use strict';
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');
const https        = require('https');
const zlib         = require('zlib');

const app  = express();
const PORT = process.env.PORT || 3030;

// ============ MODULES LOADER ============
const SKIP_MODULES = new Set(['auth', 'keys', 'getkey', 'telegram']);

function loadModules() {
    const modulesPath = path.join(__dirname, 'modules');
    if (!fs.existsSync(modulesPath)) return {};
    const loaded = {};
    const files = fs.readdirSync(modulesPath).filter(f => f.endsWith('.js'));
    for (const file of files) {
        const name = path.basename(file, '.js');
        if (SKIP_MODULES.has(name)) continue;
        try {
            const mod = require(path.join(modulesPath, file));
            loaded[name] = mod;
        } catch (err) {
            console.log(`[MODULES] ERROR load ${file}: ${err.message}`);
        }
    }
    return loaded;
}

const modules = loadModules();

// ============ MIDDLEWARE ============
app.use((req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) {
        express.json({ limit: '10mb' })(req, res, next);
    } else {
        express.raw({ type: '*/*', limit: '10mb' })(req, res, next);
    }
});
app.use(express.static('public'));
app.use(cookieParser());

// ============ TELEMETRY / UPLOAD SPOOF ============
const SPOOF_PATHS = [
    '/api/network_logNetworkLogEvent',
    '/api/network_log/NetworkLogEvent',
    '/web_log/NetworkLogEvent',
    '/LogEvent', '/ReportEventPushInfo',
    '/CheckHackBehavior',
    '/CheckNeedUpdateGPToken',  // GIN token refresh — selalu spoof
    '/ReportAntiAddiction', '/anti_addiction/report', '/AntiAddiction',
    '/firebase/log', '/crashlytics/report', '/sentry',
    '/upload', '/data/upload', '/DataUpload',
    '/SendLog', '/ReportLog', '/event/upload',
    '/sdk/log', '/sdk/report',
    '/GinReport', '/gin/report', '/api/gin',
    '/gin/connect', '/gin/keepalive', '/gin/disconnect',
    '/gin/upload', '/gin/batch',
    '/vodka', '/vodka/report', '/vodka/upload',
    '/GGP', '/ggp/report',
    '/GGPReport', '/ggp/upload',
    '/ggp/connect', '/ggp/keepalive',
    '/CheckHackData', '/ReportHackData',
    '/ReportClientData', '/ClientDataForward',
    '/AnticheatReport',
    '/anticheat/report', '/anticheat/upload',
    '/AnticheatUpload',
    '/SecurityReport', '/ReportSecurityEvent',
    '/DataReport', '/DataUploadEvent',
    '/DisableUpload',
    '/grtc/report', '/grtc/validate', '/grtc/sdk',
    '/sdk/validate', '/sdk/report', '/sdk/check',
    '/noop',
    '/report', '/Report',
];

function spoofOK(req, res) {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) {
        res.status(200).json({ code: 0, message: 'ok' });
    } else {
        res.status(200).set('Content-Type', 'application/octet-stream').end();
    }
}

for (const p of SPOOF_PATHS) {
    app.all(p, spoofOK);
}

// Wildcard upload/telemetry catcher
app.all('*', (req, res, next) => {
    const lower = req.path.toLowerCase();
    const isUpload =
        lower.includes('logevent') ||
        lower.includes('networklog') ||
        lower.includes('datareport') ||
        lower.includes('sendlog') ||
        lower.includes('reportlog') ||
        lower.includes('anticheat') ||
        lower.includes('antiaddiction') ||
        lower.includes('crashlytics') ||
        lower.includes('securityreport') ||
        lower.includes('hackdata') ||
        lower.includes('clientdata') ||
        lower.includes('dataforward') ||
        lower.includes('checkhack') ||
        lower.includes('/gin/') ||
        lower.includes('/ggp/') ||
        lower.includes('/vodka') ||
        lower.includes('ginreport') ||
        lower.includes('ggpreport') ||
        lower.includes('ggpupload') ||
        lower.includes('ginupload') ||
        (lower.includes('report') && lower.includes('event')) ||
        (lower.includes('upload') && !lower.includes('cdn'));
    if (isUpload) return spoofOK(req, res);
    next();
});

// ============ PROXY /GetLoginData (GIN + BAN PATCH) ============
// PENTING: Route ini harus di-register SEBELUM modules.tglog.init() dan modules.proxy.init()
// agar tidak di-intercept oleh catch-all proxy handler.
app.all('/GetLoginData', (req, res) => {
    // Lazy-require untuk pastikan modules sudah loaded
    const { MY_IP } = require('./gamevar');
    const { applyAllJsonPatches, patchImageUrls, patchStringLevelGin } = require('./modules/proxy');

    const body = req.body;

    // Forward headers yang aman — pastikan Accept-Encoding tidak mengandung 'br'
    // karena beberapa build zlib Node tidak support brotli decompress
    const safeHeaders = {};
    const FORWARD_HEADERS = ['content-type', 'user-agent', 'accept-language', 'accept',
                             'connection', 'authorization', 'cookie'];
    for (const h of FORWARD_HEADERS) {
        if (req.headers[h]) safeHeaders[h] = req.headers[h];
    }
    safeHeaders['Host']            = 'clientbp.ggpolarbear.com';
    safeHeaders['Accept-Encoding'] = 'gzip, deflate';

    // Body bisa berupa Buffer (protobuf binary) atau object (JSON parsed)
    let bodyBuf;
    if (Buffer.isBuffer(body) && body.length > 0) {
        bodyBuf = body;
    } else if (body && typeof body === 'object' && Object.keys(body).length > 0) {
        bodyBuf = Buffer.from(JSON.stringify(body), 'utf8');
    } else {
        bodyBuf = null;
    }

    safeHeaders['Content-Length'] = bodyBuf ? bodyBuf.length : 0;

    const options = {
        hostname: 'clientbp.ggpolarbear.com',
        path:     '/GetLoginData',
        method:   'POST',
        headers:  safeHeaders,
    };

    const proxyReq = https.request(options, (proxyRes) => {
        const encoding = proxyRes.headers['content-encoding'];
        const chunks = [];
        let stream = proxyRes;
        if (encoding === 'gzip')    stream = proxyRes.pipe(zlib.createGunzip());
        else if (encoding === 'deflate') stream = proxyRes.pipe(zlib.createInflate());
        else if (encoding === 'br') {
            try { stream = proxyRes.pipe(zlib.createBrotliDecompress()); }
            catch(e) { console.log('[GetLoginData] brotli not supported, reading raw'); }
        }

        stream.on('data', c => chunks.push(c));
        stream.on('end', () => {
            const rawBody = Buffer.concat(chunks);
            const headers = Object.assign({}, proxyRes.headers);
            delete headers['content-encoding'];
            delete headers['content-length'];
            delete headers['transfer-encoding'];

            // Coba parse sebagai JSON — Garena mungkin tidak set content-type dengan benar
            let parsed = null;
            try { parsed = JSON.parse(rawBody.toString('utf8')); } catch(_) {}

            if (parsed && typeof parsed === 'object') {
                applyAllJsonPatches(parsed, '/GetLoginData');
                let jsonStr = patchImageUrls(JSON.stringify(parsed));
                jsonStr = patchStringLevelGin(jsonStr); // String-level fallback WAJIB
                const patched = Buffer.from(jsonStr, 'utf8');
                headers['content-type']   = 'application/json';
                headers['content-length'] = String(patched.length);
                res.writeHead(proxyRes.statusCode, headers);
                console.log('[GetLoginData-PATCH] JSON patched OK — CECNLHCONMI deleted, GIN blind');
                return res.end(patched);
            }

            // Fallback: response bukan JSON (tidak seharusnya terjadi untuk GetLoginData)
            // Tetap jalankan string-level patch sebagai last resort
            let rawStr = rawBody.toString('utf8');
            const patchedRaw = patchStringLevelGin(rawStr);
            const outBuf = Buffer.from(patchedRaw, 'utf8');
            console.log('[GetLoginData] WARNING: response bukan JSON — string-patch applied');
            headers['content-length'] = String(outBuf.length);
            res.writeHead(proxyRes.statusCode, headers);
            res.end(outBuf);
        });
        stream.on('error', (err) => {
            console.log(`[GetLoginData] Decompress error: ${err.message}`);
            if (!res.headersSent) res.writeHead(502);
            res.end();
        });
    });

    proxyReq.on('error', (err) => {
        console.log(`[GetLoginData] Proxy error: ${err.message}`);
        if (!res.headersSent) res.status(502).send('Proxy Error');
    });

    if (bodyBuf && bodyBuf.length > 0) proxyReq.write(bodyBuf);
    proxyReq.end();
});

// ============ SERVE ASSEMBLY-CSHARP-PATCH.BYTES ============
app.get('/Assembly-CSharp-patch.bytes', (req, res) => {
    const filePath = path.join(__dirname, 'Assembly-CSharp-patch.bytes');
    if (!fs.existsSync(filePath)) return res.status(404).send('Not Found');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(filePath);
});

// ============ MODULES INIT ============
// URUTAN WAJIB:
// 1. app.all('/GetLoginData') sudah registered di atas ← KUNCI
// 2. modules dengan route eksplisit
// 3. proxy.init() — catch-all PALING AKHIR
if (modules.tglog)      modules.tglog.init(app);
if (modules.protobuf)   modules.protobuf.init(app);
if (modules.cdn)        modules.cdn.init(app);
if (modules.guest)      modules.guest.init(app);
if (modules.ping)       modules.ping.init(app);
if (modules.newbie)     app.post('/ChooseNewbieChoice', modules.newbie.handle);
if (modules.gamevar)    modules.gamevar.init(app);
if (modules.routes)     modules.routes.init(app);
if (modules.skin)       modules.skin.init(app);
if (modules.majorlogin) modules.majorlogin.init(app);
if (modules.config)     modules.config.init(app);
if (modules.proxy)      modules.proxy.init(app);

// Fallback 404
app.use((req, res) => {
    const accept = req.headers['accept'] || '';
    if (accept.includes('text/html')) {
        res.status(404).type('text/html').send('<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>');
    } else {
        res.status(404).json({ code: 404, message: 'Not Found' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Running on port ${PORT}`);
});

module.exports = app;
