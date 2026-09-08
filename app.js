'use strict';
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');
const https        = require('https');

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
// PENTING: express.raw() harus SETELAH route /api/* didaftarkan,
// atau pakai express.json() untuk /api/* dan express.raw() untuk sisanya.
// Solusi: pasang express.json() dulu untuk content-type application/json,
// lalu express.raw() untuk sisanya (game traffic).
app.use((req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) {
        // Parse JSON body langsung jadi object — untuk /api/* endpoints
        express.json({ limit: '10mb' })(req, res, next);
    } else {
        // Parse semua lainnya jadi Buffer — untuk game traffic
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
    '/CheckNeedUpdateGPToken',
    '/ReportAntiAddiction', '/anti_addiction/report', '/AntiAddiction',
    '/firebase/log', '/crashlytics/report', '/sentry',
    '/upload', '/data/upload', '/DataUpload',
    '/SendLog', '/ReportLog', '/event/upload',
    '/sdk/log', '/sdk/report',
    '/GinReport', '/gin/report', '/api/gin',
    '/gin/connect', '/gin/keepalive', '/gin/disconnect',
    '/gin/upload', '/gin/batch',
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
    // GRTC/SDK validate endpoints - spoof supaya SDK ga bisa report ke Garena
    '/grtc/report', '/grtc/validate', '/grtc/sdk',
    '/sdk/validate', '/sdk/report', '/sdk/check',
    '/noop',  // dummy endpoint untuk redirect idevent/idnetwork
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
app.post('/GetLoginData', (req, res) => {
    const body = req.body;
    const zlib = require('zlib');
    const { MY_IP } = require('./gamevar');

    const GARENA_IMG_DOMAINS = [
        'https://dl.bs.freefiremobile.com',
        'https://dl.dir.freefiremobile.com',
        'https://dl.cdn.freefiremobile.com',
        'https://dl.ak.freefiremobile.com',
        'https://dl.gmc.freefiremobile.com',
        'https://core-bs.freefiremobile.com',
        'https://core-gmc.freefiremobile.com',
    ];
    const proxyBase = MY_IP.replace(/\/$/, '');
    const proxyHost = proxyBase.replace(/^https?:\/\//, '').replace(/\/$/, '');

    function patchGetLoginData(jsonObj) {
        if (jsonObj && typeof jsonObj['CECNLHCONMI'] === 'object' && jsonObj['CECNLHCONMI'] !== null) {
            const g = jsonObj['CECNLHCONMI'];
            const orig = g.ggp_url;
            g.is_report_to_ggp   = false;
            g.is_transfer_report = false;
            g.is_enable_ggp      = false;
            g.is_get_feature     = false;
            g.is_get_flag        = false;
            g.is_enable_tcp      = false;
            g.is_enable_gin_tcp  = false;
            g.is_report_gin      = false;
            g.is_gin_active      = false;
            g.is_ggp_active      = false;
            g.enable_gin         = false;
            g.enable_ggp         = false;
            if (g.ggp_port !== undefined) g.ggp_port = 0;
            if (g.gin_port !== undefined) g.gin_port = 0;
            // Set ke 0.0.0.0 supaya TCP connect GAGAL, bukan ke proxyHost
            g.ggp_url = '0.0.0.0';
            if (g.gin_url    !== undefined) g.gin_url    = '0.0.0.0';
            if (g.ffanti_url !== undefined) g.ffanti_url = '';
            if (g.grtc_url   !== undefined) g.grtc_url   = '';
            if (g.tp_url     !== undefined) g.tp_url     = '';
            console.log(`[GetLoginData-PATCH] CECNLHCONMI: ggp_url ${orig} → 0.0.0.0 (dead), semua flag GIN/GGP=false`);
        }
        // Patch LJAPOJNBOFE (GRTC/SDK URL list)
        if (jsonObj && jsonObj['LJAPOJNBOFE'] !== undefined) {
            const orig = jsonObj['LJAPOJNBOFE'];
            jsonObj['LJAPOJNBOFE'] = '';
            console.log(`[GetLoginData-PATCH] LJAPOJNBOFE: "${String(orig).substring(0,40)}..." → ""`);
        }
        // Patch POEPGJPHCMJ (idevent URL)
        if (jsonObj && jsonObj['POEPGJPHCMJ'] !== undefined) {
            jsonObj['POEPGJPHCMJ'] = proxyBase + '/noop';
        }
        // Patch EMFPDECPCDG (idnetwork URL)
        if (jsonObj && jsonObj['EMFPDECPCDG'] !== undefined) {
            jsonObj['EMFPDECPCDG'] = proxyBase + '/noop';
        }
        // Patch PDJHKBDIHGL (gateway URL)
        if (jsonObj && jsonObj['PDJHKBDIHGL'] !== undefined) {
            jsonObj['PDJHKBDIHGL'] = proxyBase + '/noop';
        }
        if (jsonObj && typeof jsonObj['AEBBNFBNIDB'] === 'object' && jsonObj['AEBBNFBNIDB'] !== null) {
            const b = jsonObj['AEBBNFBNIDB'];
            b.ban_mode    = 0;
            b.unban_time  = 0;
            b.hint_string = '';
            console.log('[GetLoginData-PATCH] ban_mode → 0');
        }
        return jsonObj;
    }

    const options = {
        hostname: 'clientbp.ggpolarbear.com',
        path:     '/GetLoginData',
        method:   'POST',
        headers: {
            ...req.headers,
            'Host':           'clientbp.ggpolarbear.com',
            'Content-Length': Buffer.isBuffer(body) ? body.length : 0
        }
    };

    const proxyReq = https.request(options, (proxyRes) => {
        const encoding = proxyRes.headers['content-encoding'];
        const chunks = [];
        let stream = proxyRes;
        if (encoding === 'gzip')    stream = proxyRes.pipe(zlib.createGunzip());
        else if (encoding === 'deflate') stream = proxyRes.pipe(zlib.createInflate());
        else if (encoding === 'br') stream = proxyRes.pipe(zlib.createBrotliDecompress());

        stream.on('data', c => chunks.push(c));
        stream.on('end', () => {
            const rawBody = Buffer.concat(chunks);
            const ct = proxyRes.headers['content-type'] || '';
            const headers = Object.assign({}, proxyRes.headers);
            delete headers['content-encoding'];
            delete headers['content-length'];
            delete headers['transfer-encoding'];

            if (ct.includes('application/json')) {
                let parsed;
                try { parsed = JSON.parse(rawBody.toString('utf8')); } catch(_) { parsed = null; }
                if (parsed && typeof parsed === 'object') {
                    patchGetLoginData(parsed);
                    let jsonStr = JSON.stringify(parsed);
                    for (const domain of GARENA_IMG_DOMAINS) {
                        jsonStr = jsonStr.split(domain).join(proxyBase + '/cdn');
                    }
                    const patched = Buffer.from(jsonStr, 'utf8');
                    headers['content-length'] = String(patched.length);
                    res.writeHead(proxyRes.statusCode, headers);
                    return res.end(patched);
                }
            }
            headers['content-length'] = String(rawBody.length);
            res.writeHead(proxyRes.statusCode, headers);
            res.end(rawBody);
        });
        stream.on('error', () => {
            if (!res.headersSent) res.writeHead(502);
            res.end();
        });
    });

    proxyReq.on('error', (err) => {
        console.log(`[GetLoginData] Proxy error: ${err.message}`);
        if (!res.headersSent) res.status(502).send('Proxy Error');
    });

    if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
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
// URUTAN PENTING:
// 1. Internal API routes (config, gamevar, dll) — HARUS sebelum proxy
// 2. modules['404'] — DIHAPUS dari sini, proxy.js punya onError sendiri
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
// NOTE: modules['404'] SENGAJA TIDAK dipasang di sini karena app.use() tanpa
// path filter akan intercept semua termasuk /api/* sebelum proxy catch-all.
// 404 untuk unknown game endpoints ditangani oleh proxy.js onError.
if (modules.proxy)      modules.proxy.init(app);

// Fallback 404 untuk browser request yang benar-benar tidak match
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
