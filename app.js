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
// Require proxy module dengan lazy-init + guard.
// Bug lama: require('./modules/proxy') dipanggil DI DALAM handler tiap request.
// Masalah: kalau proxy.js gagal load (circular dep / crash saat init), require()
// balik module cache kosong {} → _patchGinUrl = undefined → CECNLHCONMI tidak
// di-patch TANPA error/warning apapun → GIN tembus ke TCP langsung.
// Fix: resolve sekali saat handler pertama hit, cache permanen, log FATAL kalau null.
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

// Lazy-init: proxy.js harus di-require SETELAH modules.proxy.init() dipanggil di bawah.
// Kalau di-require sekarang (saat app.js load pertama kali), circular dep bisa
// kembalikan modul yang belum selesai init → exports kosong → fungsi undefined.
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
        if (!_patchGinUrl) console.error('[GetLoginData] FATAL: patchGinUrl undefined — CECNLHCONMI TIDAK di-patch! Cek proxy.js exports.');
        if (!_patchStrGin) console.error('[GetLoginData] FATAL: patchStringLevelGin undefined — string-level GIN domain bisa lolos!');
        else console.log('[GetLoginData] proxy patch functions resolved OK');
    } catch (e) {
        console.error('[GetLoginData] FATAL: require(proxy) crash:', e.message, '— semua GIN patch SKIP!');
    }
}

app.post('/GetLoginData', (req, res) => {
    _resolveProxyFns();  // idempoten, run sekali lalu noop

    const body      = req.body;
    const proxyBase = _MY_IP.replace(/\/$/, '');

    function patchGetLoginData(jsonObj) {
        // DELETE CECNLHCONMI sepenuhnya (recursive) + kosongkan field terkait
        if (_patchGinUrl) _patchGinUrl(jsonObj);
        else console.error('[GetLoginData] patchGinUrl null — CECNLHCONMI skip!');

        // ===== AEBBNFBNIDB — clear ban (semua reason termasuk modifier) =====
        if (jsonObj && typeof jsonObj['AEBBNFBNIDB'] === 'object' && jsonObj['AEBBNFBNIDB'] !== null) {
            const b = jsonObj['AEBBNFBNIDB'];
            const before = { ban_mode: b.ban_mode, ban_reason: b.ban_reason };
            b.ban_mode    = 0;
            b.unban_time  = 0;
            b.hint_string = '';
            if (b.ban_reason  !== undefined) b.ban_reason  = 0;
            if (b.ban_type    !== undefined) b.ban_type    = 0;
            if (b.ban_context !== undefined) b.ban_context = '';
            console.log(`[GetLoginData-PATCH] AEBBNFBNIDB: ${JSON.stringify(before)} → all_clear`);
        }

        // Scan field lain yang mengandung ban_mode > 0
        for (const key of Object.keys(jsonObj || {})) {
            if (key === 'AEBBNFBNIDB') continue;
            const sub = jsonObj[key];
            if (sub && typeof sub === 'object' && !Array.isArray(sub) && sub.ban_mode !== undefined && sub.ban_mode !== 0) {
                console.log(`[GetLoginData-PATCH] Extra ban at [${key}] ban_mode=${sub.ban_mode} → 0`);
                sub.ban_mode   = 0;
                sub.unban_time = 0;
                if (sub.hint_string !== undefined) sub.hint_string = '';
                if (sub.ban_reason  !== undefined) sub.ban_reason  = 0;
            }
        }

        // ── Patch anti_hack_center_desc — kosongkan link + ban_list_url ──
        // Game tidak auto-query ini, tapi dikosongkan supaya button Security Center
        // di lobby tidak buka halaman ban Garena yang asli.
        const ahcd = jsonObj && jsonObj['anti_hack_center_desc'];
        if (ahcd && typeof ahcd === 'object') {
            const inner = ahcd['anti_hack_center_desc'] || ahcd;
            if (inner && typeof inner === 'object') {
                if (inner['ban_list_url'] !== undefined) {
                    inner['ban_list_url'] = '';
                    console.log('[GetLoginData-PATCH] anti_hack_center_desc.ban_list_url → ""');
                }
                if (inner['link'] !== undefined) {
                    inner['link'] = '';
                    console.log('[GetLoginData-PATCH] anti_hack_center_desc.link → ""');
                }
            }
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
        if (encoding === 'gzip')    stream = proxyRes.pipe(_zlib.createGunzip());
        else if (encoding === 'deflate') stream = proxyRes.pipe(_zlib.createInflate());
        else if (encoding === 'br') stream = proxyRes.pipe(_zlib.createBrotliDecompress());

        stream.on('data', c => chunks.push(c));
        stream.on('end', () => {
            const rawBody = Buffer.concat(chunks);
            const ct = proxyRes.headers['content-type'] || '';
            const headers = Object.assign({}, proxyRes.headers);
            delete headers['content-encoding'];
            delete headers['content-length'];
            delete headers['transfer-encoding'];

            // Selalu coba parse JSON — patch CECNLHCONMI harus jalan regardless of content-type
            // Garena kadang return content-type: octet-stream padahal isinya JSON
            let parsed = null;
            try { parsed = JSON.parse(rawBody.toString('utf8')); } catch(_) {}
            if (parsed && typeof parsed === 'object') {
                patchGetLoginData(parsed);
                // Patch image URLs
                let jsonStr = JSON.stringify(parsed);
                for (const domain of _GARENA_IMG_DOMAINS) {
                    jsonStr = jsonStr.split(domain).join(proxyBase + '/cdn');
                }
                // String-level fallback — catch domain GIN yang mungkin masih tersisa di nested field
                if (_patchStrGin) jsonStr = _patchStrGin(jsonStr);
                const patched = Buffer.from(jsonStr, 'utf8');
                // Pertahankan content-type asli kalau ada, tapi update length
                headers['content-length'] = String(patched.length);
                res.writeHead(proxyRes.statusCode, headers);
                return res.end(patched);
            }
            // Fallback: bukan JSON, kirim raw
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
if (modules.config)     modules.config.init(app);   // harus sebelum gamevar
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
// BUGFIX: modules['404'] dihapus — 404.js pakai app.use() catch-all yang intercept SEBELUM
// proxy.js sempat handle. Akibatnya GenerateNickname, MajorRegister, dan semua endpoint
// yang belum di-register eksplisit → langsung balik HTML "404 Not Found",
// tidak pernah di-forward ke clientbp/loginbp oleh proxy.
// proxy.js sudah ada catch-all sendiri (app.all('*', ...)) — 404.js tidak perlu.
if (modules.proxy)      modules.proxy.init(app);  // catch-all — HARUS PALING AKHIR

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Running on port ${PORT}`);
});

module.exports = app;
