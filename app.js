'use strict';
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');
const https        = require('https');

const app  = express();
const PORT = process.env.PORT || 3030;

// ============ MODULES LOADER ============
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
app.use(express.static('public'));
app.use(cookieParser());

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
        console.log(`[SPOOF-WILDCARD] ${req.method} ${req.path} → blocked`);
        return spoofOK(req, res);
    }
    next();
});

// ============ PROXY /GetLoginData (GIN + BAN PATCH) ============
const _zlib = require('zlib');
const { MY_IP: _MY_IP } = require('./gamevar');

const _GARENA_IMG_DOMAINS = [
    'https://dl.bs.freefiremobile.com',
    'https://dl.dir.freefiremobile.com',
    'https://dl.cdn.freefiremobile.com',
    'https://dl.ak.freefiremobile.com',
    'https://dl.gmc.freefiremobile.com',
    'https://core-bs.freefiremobile.com',
    'https://core-gmc.freefiremobile.com',
];

let _patchGinUrl       = null;
let _patchStrGin       = null;
let _proxyFnsResolved  = false;

function _resolveProxyFns() {
    if (_proxyFnsResolved) return;
    _proxyFnsResolved = true;
    try {
        const proxyMod = require('./modules/proxy');
        _patchGinUrl = typeof proxyMod.patchGinUrl         === 'function' ? proxyMod.patchGinUrl         : null;
        _patchStrGin = typeof proxyMod.patchStringLevelGin === 'function' ? proxyMod.patchStringLevelGin : null;
        if (!_patchGinUrl) console.error('[GetLoginData] FATAL: patchGinUrl undefined');
        if (!_patchStrGin) console.error('[GetLoginData] FATAL: patchStringLevelGin undefined');
        else console.log('[GetLoginData] proxy patch functions resolved OK');
    } catch (e) {
        console.error('[GetLoginData] FATAL: require(proxy) crash:', e.message);
    }
}

app.post('/GetLoginData', (req, res) => {
    _resolveProxyFns();

    const body      = req.body;
    const proxyBase = _MY_IP.replace(/\/$/, '');

    function patchGetLoginData(jsonObj) {
        if (_patchGinUrl) _patchGinUrl(jsonObj);
        else console.error('[GetLoginData] patchGinUrl null — CECNLHCONMI skip!');

        if (jsonObj && jsonObj['AEDDPHHONNI'] !== undefined && jsonObj['AEDDPHHONNI']) {
            console.log(`[GetLoginData-PATCH] AEDDPHHONNI sig cleared`);
            jsonObj['AEDDPHHONNI'] = '';
        }

        const KILL_BOOL_FLAGS = ['LMDDDJPIMOK', 'OPICFECKHIA', 'HPLCNHDMBDN', 'GDHNPEMKNAM', 'JCONGGLPKGC', 'EJACMCCODEC'];
        for (const f of KILL_BOOL_FLAGS) {
            if (jsonObj && jsonObj[f] === true) {
                jsonObj[f] = false;
                console.log(`[GetLoginData-PATCH] ${f} → false`);
            }
        }

        if (jsonObj && jsonObj['android_apps_to_detect_res'] !== undefined) {
            const apd = jsonObj['android_apps_to_detect_res'];
            if (apd && typeof apd === 'object' && !Array.isArray(apd)) {
                if (Array.isArray(apd['android_apps_to_detect_res'])) {
                    apd['android_apps_to_detect_res'] = [];
                }
            } else if (Array.isArray(apd)) {
                jsonObj['android_apps_to_detect_res'] = [];
            }
            console.log('[GetLoginData-PATCH] android_apps_to_detect_res → []');
        }

        if (jsonObj && typeof jsonObj['AEBBNFBNIDB'] === 'object' && jsonObj['AEBBNFBNIDB'] !== null) {
            const b = jsonObj['AEBBNFBNIDB'];
            b.ban_mode    = 0;
            b.unban_time  = 0;
            b.hint_string = '';
            if (b.ban_reason  !== undefined) b.ban_reason  = 0;
            if (b.ban_type    !== undefined) b.ban_type    = 0;
            if (b.ban_context !== undefined) b.ban_context = '';
            console.log('[GetLoginData-PATCH] AEBBNFBNIDB → all_clear');
        }

        for (const key of Object.keys(jsonObj || {})) {
            if (key === 'AEBBNFBNIDB') continue;
            const sub = jsonObj[key];
            if (sub && typeof sub === 'object' && !Array.isArray(sub) && sub.ban_mode !== undefined && sub.ban_mode !== 0) {
                sub.ban_mode   = 0;
                sub.unban_time = 0;
                if (sub.hint_string !== undefined) sub.hint_string = '';
                if (sub.ban_reason  !== undefined) sub.ban_reason  = 0;
            }
        }

        const ahcd = jsonObj && jsonObj['anti_hack_center_desc'];
        if (ahcd && typeof ahcd === 'object') {
            const inner = ahcd['anti_hack_center_desc'] || ahcd;
            if (inner && typeof inner === 'object') {
                if (inner['ban_list_url'] !== undefined) inner['ban_list_url'] = '';
                if (inner['link']         !== undefined) inner['link']         = '';
            }
        }

        return jsonObj;
    }

    const options = {
        hostname: 'loginbp.ggpolarbear.com',
        path:     '/GetLoginData',
        method:   'POST',
        headers: {
            ...req.headers,
            'Host':           'loginbp.ggpolarbear.com',
            'Content-Length': Buffer.isBuffer(body) ? body.length : 0
        }
    };

    const proxyReq = https.request(options, (proxyRes) => {
        const encoding = proxyRes.headers['content-encoding'];
        const chunks = [];
        let stream = proxyRes;
        if (encoding === 'gzip')    stream = proxyRes.pipe(_zlib.createGunzip());
        else if (encoding === 'deflate') stream = proxyRes.pipe(_zlib.createInflate());
        else if (encoding === 'br') stream = proxyRes.pipe(_zlib.createBrotliDecompress());

        stream.on('data', c => chunks.push(c));
        stream.on('end', () => {
            const rawBody = Buffer.concat(chunks);
            const headers = Object.assign({}, proxyRes.headers);
            delete headers['content-encoding'];
            delete headers['content-length'];
            delete headers['transfer-encoding'];

            let parsed = null;
            try { parsed = JSON.parse(rawBody.toString('utf8')); } catch(_) {}
            if (parsed && typeof parsed === 'object') {
                patchGetLoginData(parsed);
                let jsonStr = JSON.stringify(parsed);
                for (const domain of _GARENA_IMG_DOMAINS) {
                    jsonStr = jsonStr.split(domain).join(proxyBase + '/cdn');
                }
                if (_patchStrGin) jsonStr = _patchStrGin(jsonStr);
                const patched = Buffer.from(jsonStr, 'utf8');
                headers['content-length'] = String(patched.length);
                res.writeHead(proxyRes.statusCode, headers);
                return res.end(patched);
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

// ============ MODULES INIT ============
if (modules.config)     modules.config.init(app);
if (modules.tglog)      modules.tglog.init(app);
if (modules.protobuf)   modules.protobuf.init(app);
if (modules.cdn)        modules.cdn.init(app);
if (modules.ping)       modules.ping.init(app);
if (modules.gamevar)    modules.gamevar.init(app);
if (modules.routes)     modules.routes.init(app);
if (modules.majorlogin) modules.majorlogin.init(app);
if (modules.proxy)      modules.proxy.init(app);  // catch-all — HARUS PALING AKHIR

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Running on port ${PORT}`);
});

module.exports = app;
