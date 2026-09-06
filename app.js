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
// BUG FIX: express.raw() dipasang global → semua body jadi Buffer.
// Middleware JSON di bawahnya dead code karena req.body sudah terisi.
// Fix: pisah — endpoint binary (MajorLogin, CDN) pakai raw,
// endpoint JSON pakai json() / urlencoded() via flag di route.
// Solusi pragmatis: tetap pakai raw global tapi setiap endpoint
// yang butuh JSON cukup JSON.parse(body.toString()) — sudah dihandle
// di auth.js parseBody(). app.js sendiri tidak ada route yang
// expect req.body sebagai plain object, jadi tidak perlu ubah order.
// Tapi kita perbaiki middleware agar express.json() TIDAK dipasang
// setelah raw (dead code dihapus — tidak merusak behavior, hanya bersih).
app.use(express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.static('public'));
app.use(cookieParser());
// (tidak ada express.json() di sini — sudah dead code, dihapus)

// ============ TELEMETRY / UPLOAD SPOOF ============
const SPOOF_PATHS = [
    '/api/network_logNetworkLogEvent',
    '/api/network_log/NetworkLogEvent',
    '/web_log/NetworkLogEvent',
    '/GinReport',
    '/gin/report',
    '/api/gin',
    '/LogEvent',
    '/ReportEventPushInfo',
    '/CheckHackBehavior',
    '/CheckNeedUpdateGPToken',
    '/ReportAntiAddiction',
    '/anti_addiction/report',
    '/AntiAddiction',
    '/firebase/log',
    '/crashlytics/report',
    '/sentry',
    '/upload',
    '/data/upload',
    '/DataUpload',
    '/SendLog',
    '/ReportLog',
    '/event/upload',
    '/sdk/log',
    '/sdk/report',
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

// ============ SERVE ASSEMBLY-CSHARP-PATCH.BYTES ============
app.get('/Assembly-CSharp-patch.bytes', (req, res) => {
    const filePath = path.join(__dirname, 'Assembly-CSharp-patch.bytes');
    if (!fs.existsSync(filePath)) return res.status(404).send('Not Found');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(filePath);
});

// ============ MODULES INIT ============
if (modules.tglog)      modules.tglog.init(app);
if (modules.protobuf)   modules.protobuf.init(app);
if (modules.auth)       modules.auth.init(app);
if (modules.cdn)        modules.cdn.init(app);
if (modules.guest)      modules.guest.init(app);
if (modules.ping)       modules.ping.init(app);
if (modules.newbie)     app.post('/ChooseNewbieChoice', modules.newbie.handle);
if (modules.gamevar)    modules.gamevar.init(app);
if (modules.routes)     modules.routes.init(app);
if (modules.skin)       modules.skin.init(app);
if (modules['404'])     modules['404'].init(app);
if (modules.majorlogin) modules.majorlogin.init(app);
if (modules.proxy)      modules.proxy.init(app);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Running on port ${PORT}`);
});

module.exports = app;
