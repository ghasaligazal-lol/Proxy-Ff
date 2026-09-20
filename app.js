'use strict';
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');

const app  = express();
const PORT = process.env.PORT || 3030;

// ============ MODULES LOADER ============
// BUGFIX: hapus 'majorlogin' dari SKIP_MODULES — sebelumnya di-skip sehingga
// tidak pernah di-load sama sekali, MajorLogin jatuh ke proxy binary surgery.
const SKIP_MODULES = new Set(['auth', 'keys', 'getkey', 'telegram', 'skin', 'guest', 'newbie', '404', 'user-agent']);

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
app.use(cookieParser());
// FIX: express.static dipasang SETELAH cdn.init agar /hotpatchs/ routes di cdn.js
// diprioritaskan → lihat bawah di MODULES INIT section

// ============ TELEMETRY / UPLOAD SPOOF ============
const SPOOF_PATHS = [
    '/api/network_logNetworkLogEvent',
    '/api/network_log/NetworkLogEvent',
    '/api/network_log',
    '/web_log/NetworkLogEvent',
    '/web_log',
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
    '/ffanti/upload', '/ffanti/report', '/ffanti/connect',
    '/FFAnti', '/FFAntiReport', '/FFAntiUpload', '/ReportFFAnti',
    '/AbnormalDataReport', '/ReportAbnormalData',
    '/ClientDetectionReport', '/DetectionReport',
    '/AndroidAppDetect', '/AppDetectionUpload',
    '/ModifierDetect', '/ReportModifier',
    '/HackLibReport', '/LibHashReport', '/AHLReport',
    '/gamesecurity/ban', '/ban',
    '/NetworkSelfTest', '/api/selftest', '/selftest',
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
    app.all(p + '/*', spoofOK);
}

app.all('*', (req, res, next) => {
    const p = req.path.toLowerCase();
    const SPOOF_KEYWORDS = [
        'report', 'logevent', 'anticheat', 'hackdata', 'modifier',
        'ginreport', 'ggpreport', 'ffanti', 'detection', 'abnormal',
        'network_log', 'web_log', 'dataupload', 'securityreport',
        'clientdata', 'dataforward', 'uploaddata', 'sendhack',
        'checkhack', 'libhash', 'ahlreport',
    ];
    if (SPOOF_KEYWORDS.some(k => p.includes(k))) {
        return spoofOK(req, res);
    }
    next();
});

// ============ MODULES INIT ============
// FIX URUTAN: cdn HARUS dulu sebelum express.static agar /hotpatchs/ routes
// tidak di-intercept oleh express.static terlebih dahulu (404 assembly-csharp-patch fix)
if (modules.config)      modules.config.init(app);
if (modules.tglog)       modules.tglog.init(app);
if (modules.protobuf)    modules.protobuf.init(app);
if (modules.cdn)         modules.cdn.init(app);  // HARUS sebelum express.static
// FIX: express.static dipasang di sini, SETELAH cdn.init, sehingga /hotpatchs/
// dan /cdn/ routes di cdn.js sudah registered dan diprioritaskan
app.use(express.static('public'));
if (modules.ping)        modules.ping.init(app);
if (modules.gamevar)     modules.gamevar.init(app);
if (modules.routes)      modules.routes.init(app);
if (modules.majorlogin)  modules.majorlogin.init(app);  // BUGFIX: harus sebelum proxy
if (modules.proxy)       modules.proxy.init(app);        // catch-all — HARUS PALING AKHIR

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Running on port ${PORT}`);
});

module.exports = app;
