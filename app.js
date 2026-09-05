'use strict';
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');
const https        = require('https');

const app  = express();
const PORT = process.env.PORT || 3030;

// ============ MODULES LOADER ============
function loadModules() {
    const modulesPath = path.join(__dirname, 'modules');
    if (!fs.existsSync(modulesPath)) return {};
    const loaded = {};
    const files = fs.readdirSync(modulesPath).filter(f => f.endsWith('.js'));
    for (const file of files) {
        // Skip getkey & telegram — dihapus sesuai permintaan
        if (file === 'getkey.js' || file === 'telegram.js') continue;
        try {
            const mod  = require(path.join(modulesPath, file));
            const name = path.basename(file, '.js');
            loaded[name] = mod;
        } catch (err) {
            console.log(`[MODULES] ERROR load ${file}: ${err.message}`);
        }
    }
    return loaded;
}

const modules = loadModules();

// ============ MIDDLEWARE ============
app.use(express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.static('public'));
app.use(cookieParser());

app.use((req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) {
        express.json()(req, res, next);
    } else if (ct.includes('application/x-www-form-urlencoded')) {
        express.urlencoded({ extended: true })(req, res, next);
    } else {
        next();
    }
});

// ============ TELEMETRY / UPLOAD SPOOF ============
// Semua endpoint upload, anticheat report, dan event log di-spoof dengan
// response 200 OK yang valid supaya game tidak detect data upload dimatikan.
// JANGAN return 204/drop — game ngecek response body untuk confirm upload sukses.

const SPOOF_PATHS = [
    // Network log (sudah ada sebelumnya)
    '/api/network_logNetworkLogEvent',
    '/api/network_log/NetworkLogEvent',
    '/web_log/NetworkLogEvent',

    // GGP / GIN anticheat report
    '/GinReport',
    '/gin/report',
    '/api/gin',

    // idevent LogEvent — di-catch via hostname check di bawah
    // (idevent.ggblueshark.com diroute ke proxy, path-nya /LogEvent)
    '/LogEvent',

    // clientbp telemetry & report
    '/ReportEventPushInfo',
    '/CheckHackBehavior',
    '/CheckNeedUpdateGPToken',

    // Anti-addiction upload
    '/ReportAntiAddiction',
    '/anti_addiction/report',
    '/AntiAddiction',

    // Firebase / Crashlytics (kadang di-proxy)
    '/firebase/log',
    '/crashlytics/report',
    '/sentry',

    // Generic upload paths
    '/upload',
    '/data/upload',
    '/DataUpload',
    '/SendLog',
    '/ReportLog',
    '/event/upload',
    '/sdk/log',
    '/sdk/report',
];

// Helper: kirim response "OK" yang meyakinkan buat game
function spoofOK(req, res) {
    // Beberapa endpoint expect protobuf kosong, beberapa expect JSON {}
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) {
        res.status(200).json({ code: 0, message: 'ok' });
    } else {
        // Protobuf / binary — kirim empty 200 dengan content-length 0
        res.status(200).set('Content-Type', 'application/octet-stream').end();
    }
}

// Mount semua spoof path
for (const p of SPOOF_PATHS) {
    app.all(p, spoofOK);
}

// Catch-all untuk path yang mengandung keyword upload/log/report/event
// supaya endpoint baru yang belum terdaftar juga kena
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
        lower.includes('/gin/') ||
        lower.includes('crashlytics') ||
        (lower.includes('report') && lower.includes('event')) ||
        (lower.includes('upload') && !lower.includes('cdn'));
    if (isUpload) return spoofOK(req, res);
    next();
});

// ============ PROXY /GetLoginData ============
app.post('/GetLoginData', (req, res) => {
    const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
    const body     = req.body;

    const options = {
        hostname: 'loginbp.ggblueshark.com',
        path:     '/GetLoginData',
        method:   'POST',
        headers: {
            ...req.headers,
            'Host':           'loginbp.ggblueshark.com',
            'Content-Length': Buffer.isBuffer(body) ? body.length : 0
        }
    };

    const proxyReq = https.request(options, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
            const buffer = Buffer.concat(chunks);
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(buffer);
        });
    });

    proxyReq.on('error', (err) => {
        console.log(`[LOGIN] Proxy error: ${err.message}`);
        if (!res.headersSent) res.status(502).send('Proxy Error');
    });

    if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
    proxyReq.end();
});


// ============ SERVE HOTPATCHS (fileinfo + bundles) ============
app.use('/hotpatchs', express.static(path.join(__dirname, 'public', 'hotpatchs'), {
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Accept-Ranges', 'bytes');
    }
}));

// ============ SERVE ASSEMBLY-CSHARP-PATCH.BYTES (root path) ============
app.get('/Assembly-CSharp-patch.bytes', (req, res) => {
    const filePath = path.join(__dirname, 'Assembly-CSharp-patch.bytes');
    if (!fs.existsSync(filePath)) return res.status(404).send('Not Found');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(filePath);
});

// ============ MODULES INIT ============
// Urutan penting — proxy paling akhir (catch-all)
if (modules.tglog)     modules.tglog.init(app);     // ← telegram logger, init pertama
if (modules.protobuf)  modules.protobuf.init(app);
if (modules.auth)      modules.auth.init(app);
if (modules.cdn)       modules.cdn.init(app);
if (modules.guest)     modules.guest.init(app);
if (modules.ping)      modules.ping.init(app);
if (modules.newbie)    app.post('/ChooseNewbieChoice', modules.newbie.handle);
if (modules.gamevar)   modules.gamevar.init(app);
if (modules.routes)    modules.routes.init(app);
if (modules.skin)      modules.skin.init(app);
if (modules['404'])    modules['404'].init(app);
if (modules.majorlogin) modules.majorlogin.init(app); // ← intercept MajorLogin sebelum proxy
if (modules.proxy)     modules.proxy.init(app); // selalu terakhir

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Running on port ${PORT}`);
});

module.exports = app;
