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
app.use(express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.static('public'));
app.use(cookieParser());

// ============ TELEMETRY / UPLOAD SPOOF ============
// ROOT CAUSE BLACKLIST (dari log analisis):
//   #1 "Nonaktifkan data upload" + "modifier" → GIN TCP tembus langsung ke
//      gin.freefiremobile.com karena patchGetLoginData() tidak patch CECNLHCONMI.
//      Bukti: debugger 02:43 — CECNLHCONMI.is_enable_ggp masih TRUE di client.
//      BackendLog: Proto_GET_TOKEN_NTF lalu Proto_CLIENT_DATA_FORWARD_NTF → BL.
//      GIN mengirim AHLR (hash library) ke server → server detect libmemek/mod.
//
//   #2 "modifier" detect → EventTypeAndroidApplicationDetection detection code
//      [352,353,...] sudah ada di semua sesi tapi tidak trigger BL sendiri.
//      Yang trigger BL adalah CLIENT_DATA_FORWARD_NTF yang isinya AHLR dengan
//      AHLC berbeda tiap sesi ($7a94XX$$, $2LJaSU7$$, $9XJC37Y$$) = signature
//      anomaly detection.
//
//   FIX: patchGetLoginData() harus matiin semua flag CECNLHCONMI (sama dengan
//        patchGinUrl() di proxy.js). Dan intercept CheckHackBehavior di sini.

const SPOOF_PATHS = [
    // ── Telemetry & log upload ──
    '/api/network_logNetworkLogEvent',
    '/api/network_log/NetworkLogEvent',
    '/web_log/NetworkLogEvent',
    '/LogEvent', '/ReportEventPushInfo',
    '/CheckHackBehavior',           // ← KRITIS: intercept di app.js juga
    '/CheckNeedUpdateGPToken',
    '/ReportAntiAddiction', '/anti_addiction/report', '/AntiAddiction',
    '/firebase/log', '/crashlytics/report', '/sentry',
    '/upload', '/data/upload', '/DataUpload',
    '/SendLog', '/ReportLog', '/event/upload',
    '/sdk/log', '/sdk/report',
    // ── GIN / GGP ──
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
        lower.includes('checkhack') ||        // ← tambahan
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
        // ===== CECNLHCONMI — matiin GIN/GGP TCP =====
        // BUG SEBELUMNYA: patch hanya set ggp_url ke proxy host, tapi flag
        // is_enable_ggp, is_enable_tcp, is_get_feature, is_get_flag masih TRUE.
        // Client baca flag-flag itu → connect TCP ke gin.freefiremobile.com langsung
        // (bypass proxy!) → Proto_GET_TOKEN_NTF → CLIENT_DATA_FORWARD_NTF → BLACKLIST.
        //
        // FIX: matiin SEMUA flag sekaligus, sama persis dengan patchGinUrl() di proxy.js.
        if (jsonObj && typeof jsonObj['CECNLHCONMI'] === 'object' && jsonObj['CECNLHCONMI'] !== null) {
            const g = jsonObj['CECNLHCONMI'];
            const orig = g.ggp_url;
            // Flag utama
            g.is_report_to_ggp   = false;
            g.is_transfer_report = false;
            g.is_enable_ggp      = false;
            g.is_get_feature     = false;
            g.is_get_flag        = false;
            g.is_enable_tcp      = false;
            // Flag tambahan (ada di beberapa versi client)
            g.is_enable_gin_tcp  = false;
            g.is_report_gin      = false;
            g.is_gin_active      = false;
            g.is_ggp_active      = false;
            g.enable_gin         = false;
            g.enable_ggp         = false;
            // Port ke 0 — kalau client tetap coba connect, port invalid → gagal
            if (g.ggp_port !== undefined) g.ggp_port = 0;
            if (g.gin_port !== undefined) g.gin_port = 0;
            // Redirect URL ke proxy (defense-in-depth)
            g.ggp_url = proxyHost;
            if (g.gin_url !== undefined) g.gin_url = proxyHost;
            console.log(`[GetLoginData-PATCH] CECNLHCONMI: ggp_url ${orig} → ${proxyHost}, semua flag GIN/GGP=false`);
        }
        // ===== AEBBNFBNIDB — clear ban =====
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
                    // Patch image URLs
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
if (modules.config)     modules.config.init(app);   // ← FIX: register /api/config sebelum catch-all
if (modules['404'])     modules['404'].init(app);
if (modules.proxy)      modules.proxy.init(app);  // catch-all — HARUS PALING AKHIR

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Running on port ${PORT}`);
});

module.exports = app;
