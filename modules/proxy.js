'use strict';
// modules/proxy.js — FIXED
// Bug fixes:
// - require('../gamevar') diganti env langsung (cegah circular/undefined)
// - ChooseNewbieChoice + NewbieChoice ditambah ke loginProxy route
// - Telemetry spoof lebih komprehensif

const { createProxyMiddleware } = require('http-proxy-middleware');
const zlib = require('zlib');

const PROXY_URL            = (process.env.PROXY_URL || 'https://proxy-reza-kontolodon-memek-luu.up.railway.app/').replace(/\/$/, '');
const GARENA_LOGIN_SERVER  = 'https://loginbp.ggpolarbear.com';
const GARENA_CLIENT_SERVER = 'https://clientbp.ggpolarbear.com';

// ===== TELEMETRY SPOOF =====
const TELEMETRY_PATHS = [
    '/LogEvent', '/ReportEventPushInfo', '/CheckHackBehavior', '/CheckNeedUpdateGPToken',
    '/GinReport', '/gin/report', '/gin/connect', '/gin/keepalive', '/gin/disconnect', '/gin/upload', '/gin/batch',
    '/GGP', '/GGPReport', '/ggp/report', '/ggp/connect', '/ggp/keepalive', '/ggp/upload',
    '/AntiAddiction', '/ReportAntiAddiction',
    '/AnticheatReport', '/anticheat/report', '/anticheat/upload', '/AnticheatUpload',
    '/CheckHackData', '/ReportHackData', '/ReportClientData', '/ClientDataForward',
    '/SecurityReport', '/ReportSecurityEvent', '/DataReport', '/DataUploadEvent',
    '/api/network_log', '/network_log', '/networklog', '/api/logNetworkLogEvent', '/logNetworkLogEvent',
    '/ffanti/upload', '/ffanti/report', '/ffanti/connect',
    '/FFAnti', '/FFAntiReport', '/FFAntiUpload', '/ReportFFAnti', '/CheckFFAnti',
    '/AbnormalDataReport', '/ReportAbnormalData', '/AbnormalData',
    '/ClientDetectionReport', '/DetectionReport', '/ReportDetection',
    '/AndroidAppDetect', '/AppDetectionUpload',
    '/ModifierDetect', '/ModDetect', '/ReportModifier',
    '/HackLibReport', '/LibHashReport', '/AHLReport',
    '/gamesecurity/ban', '/ban',
];

function isTelemetryPath(p) {
    const lower = p.toLowerCase();
    if (TELEMETRY_PATHS.some(t => p === t || p.startsWith(t + '?'))) return true;
    return (
        lower.includes('logevent') || lower.includes('networklog') ||
        lower.includes('reportevent') || lower.includes('antiaddiction') ||
        lower.includes('anticheat') || lower.includes('hackdata') ||
        lower.includes('clientdata') || lower.includes('dataforward') ||
        lower.includes('securityreport') || lower.includes('ginreport') ||
        lower.includes('ggpreport') || lower.includes('/gin/') || lower.includes('/ggp/') ||
        lower.includes('ffanti') || lower.includes('abnormal') ||
        lower.includes('detection') || lower.includes('libhash') ||
        lower.includes('ahlreport') || lower.includes('modifie') ||
        (lower.includes('report') && lower.includes('event'))
    );
}

function sendSpoofOK(res, isBinary) {
    if (isBinary) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': '0' });
        res.end();
    } else {
        const body = JSON.stringify({ code: 0, message: 'ok' });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
        res.end(body);
    }
}

// ===== BAN PATCH =====
const BAN_INFO_KEY   = 'AEBBNFBNIDB';
const LGEBP_KEY      = 'LGEBPFEFOHC'; // is_in_blacklist field di GetLoginData

function patchBanInfo(jsonObj) {
    // Patch AEBBNFBNIDB (ban_mode, unban_time)
    if (jsonObj && typeof jsonObj[BAN_INFO_KEY] === 'object' && jsonObj[BAN_INFO_KEY] !== null) {
        const b = jsonObj[BAN_INFO_KEY];
        b.ban_mode = 0; b.unban_time = 0; b.hint_string = '';
        b.ban_time = 0; b.ban_reason = 0; b.ban_type = '';
        b.expire_duration = 0; b.ban_reason_detail = '';
    }
    // Patch LGEBPFEFOHC (is_in_blacklist bool di GetLoginData)
    if (jsonObj && jsonObj[LGEBP_KEY] !== undefined) jsonObj[LGEBP_KEY] = false;

    if (jsonObj && Array.isArray(jsonObj.blacklist)) jsonObj.blacklist = [];
    if (jsonObj && jsonObj.blacklist_info !== undefined) jsonObj.blacklist_info = null;

    function zapBL(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 10) return;
        if (Array.isArray(obj)) { obj.forEach(i => zapBL(i, depth + 1)); return; }
        if ('is_in_blacklist' in obj) {
            obj.is_in_blacklist = false; obj.ban_time = 0; obj.ban_reason = 0;
            obj.ban_reason_detail = ''; obj.ban_expire_duration = 0; obj.ban_type = '';
            if (obj.expire_duration !== undefined) obj.expire_duration = 0;
        }
        if ('ban_mode' in obj) { obj.ban_mode = 0; }
        if ('unban_time' in obj) { obj.unban_time = 0; }
        if ('matchmaking_blacklist' in obj) {
            const mbl = obj.matchmaking_blacklist;
            if (typeof mbl === 'number') obj.matchmaking_blacklist = 0;
            else if (mbl && typeof mbl === 'object') {
                mbl.is_in_blacklist = false; mbl.ban_time = 0; mbl.ban_reason = 0;
                mbl.ban_reason_detail = ''; mbl.ban_expire_duration = 0; mbl.ban_type = '';
            }
        }
        if ('championship_is_in_blacklist' in obj) obj.championship_is_in_blacklist = false;
        if (LGEBP_KEY in obj) obj[LGEBP_KEY] = false;
        for (const k of Object.keys(obj)) zapBL(obj[k], depth + 1);
    }
    zapBL(jsonObj, 0);
}

function patchMatchmakingBL(jsonObj, urlPath) {
    if (!urlPath.includes('GetMatchmakingBlacklist') || !jsonObj || typeof jsonObj !== 'object') return;
    // Zero semua kemungkinan struktur blacklist di GetMatchmakingBlacklist
    jsonObj.blacklist = []; jsonObj.blacklist_info = null;
    if (jsonObj.blacklist_list !== undefined) jsonObj.blacklist_list = [];
    if (jsonObj.bl_list !== undefined) jsonObj.bl_list = [];
    if (jsonObj.is_in_blacklist !== undefined) jsonObj.is_in_blacklist = false;
    if (jsonObj.ban_time !== undefined) jsonObj.ban_time = 0;
    if (jsonObj.ban_reason !== undefined) jsonObj.ban_reason = 0;
    if (jsonObj.matchmaking_blacklist !== undefined) {
        if (typeof jsonObj.matchmaking_blacklist === 'number') jsonObj.matchmaking_blacklist = 0;
        else if (typeof jsonObj.matchmaking_blacklist === 'object') {
            jsonObj.matchmaking_blacklist = { is_in_blacklist: false, ban_time: 0, ban_reason: 0 };
        }
    }
}

// ===== GIN/GGP PATCH =====
const GIN_CONFIG_KEY = 'CECNLHCONMI';
const GRTC_URL_KEY   = 'LJAPOJNBOFE';
const TRACEROUTE_KEY = 'FOGGNIHIBPG';
const SERVERNODE_KEY = 'HDNAPFEGDGG';

const _ginDomainPattern = new RegExp(
    '("(?:[^"\\\\]|\\\\.)*(?:' + [
        'gin\\.freefiremobile\\.com',
        'grtc\\.garenanow\\.com',
        'garenanow\\.com',
        'ffanti\\.',
        'ggpolarbear\\.com/gin',
        'ggpolarbear\\.com/ggp',
        '124\\.158\\.134\\.7',
        '124\\.158\\.135\\.168',
        '202\\.181\\.82\\.79',
        '202\\.81\\.117\\.206',
        'stronghold\\.freefiremobile\\.com',
        'vodka\\.freefiremobile\\.com',
        'gamesecurity\\.sea\\.freefiremobile\\.com',
        'ano\\.freefiremobile\\.com',
        'ggp\\.freefiremobile\\.com',
    ].join('|') + ')(?:[^"\\\\]|\\\\.)*")',
    'gi'
);

function patchStringLevelGin(jsonStr) {
    return jsonStr.replace(_ginDomainPattern, '""');
}

function delKeyRecursive(obj, key, depth) {
    if (!obj || typeof obj !== 'object' || depth > 10) return;
    if (Array.isArray(obj)) { for (const item of obj) delKeyRecursive(item, key, depth + 1); return; }
    if (Object.prototype.hasOwnProperty.call(obj, key)) delete obj[key];
    for (const k of Object.keys(obj)) delKeyRecursive(obj[k], key, depth + 1);
}

function zeroFieldRecursive(obj, field, replacement, depth) {
    if (!obj || typeof obj !== 'object' || depth > 10) return;
    if (Array.isArray(obj)) { for (const item of obj) zeroFieldRecursive(item, field, replacement, depth + 1); return; }
    if (obj[field] !== undefined) obj[field] = replacement;
    for (const k of Object.keys(obj)) zeroFieldRecursive(obj[k], field, replacement, depth + 1);
}

function patchGinUrl(jsonObj) {
    delKeyRecursive(jsonObj, GIN_CONFIG_KEY, 0);
    delKeyRecursive(jsonObj, GRTC_URL_KEY, 0);
    if (jsonObj && Array.isArray(jsonObj[TRACEROUTE_KEY])) jsonObj[TRACEROUTE_KEY] = [];
    if (jsonObj && Array.isArray(jsonObj[SERVERNODE_KEY])) jsonObj[SERVERNODE_KEY] = [];
    for (const f of ['POEPGJPHCMJ', 'EMFPDECPCDG', 'PDJHKBDIHGL', 'IIPKMIOFCJP']) {
        if (jsonObj && jsonObj[f] !== undefined) jsonObj[f] = '';
    }
    zeroFieldRecursive(jsonObj, 'hacker_protection', 0, 0);
    zeroFieldRecursive(jsonObj, 'ut_flag', 0, 0);
    if (jsonObj && jsonObj['android_apps_to_detect_res'] !== undefined) {
        const apd = jsonObj['android_apps_to_detect_res'];
        if (Array.isArray(apd)) jsonObj['android_apps_to_detect_res'] = [];
        else if (apd && typeof apd === 'object' && Array.isArray(apd['android_apps_to_detect_res']))
            apd['android_apps_to_detect_res'] = [];
    }
    zeroFieldRecursive(jsonObj, 'is_report_to_ggp',   false, 0);
    zeroFieldRecursive(jsonObj, 'is_enable_ggp',      false, 0);
    zeroFieldRecursive(jsonObj, 'is_enable_tcp',      false, 0);
    zeroFieldRecursive(jsonObj, 'is_transfer_report', false, 0);
    zeroFieldRecursive(jsonObj, 'ggp_url',            '',    0);
    zeroFieldRecursive(jsonObj, 'gin_token',          '',    0);
    zeroFieldRecursive(jsonObj, 'is_get_feature',     false, 0);
    zeroFieldRecursive(jsonObj, 'is_get_flag',        false, 0);
    if (jsonObj && jsonObj['GKOKINGAIKO'] !== undefined) {
        const g = jsonObj['GKOKINGAIKO'];
        if (g && typeof g === 'object') {
            g.gin_token = ''; g.is_enable_ggp = false; g.is_enable_tcp = false;
            g.is_report_to_ggp = false; g.is_transfer_report = false;
            g.ggp_url = ''; g.ut_flag = 0;
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
    zeroFieldRecursive(jsonObj, 'ban_list_url', '', 0);
    if (jsonObj && jsonObj['ANOAAHKLDLA'] !== undefined) jsonObj['ANOAAHKLDLA'] = 0;
    if (jsonObj && jsonObj['GLPGCIJFDEB'] !== undefined) jsonObj['GLPGCIJFDEB'] = '';
}

function patchAbnormalData(jsonObj) {
    if (!jsonObj || typeof jsonObj !== 'object') return;
    if (jsonObj['AEDDPHHONNI'])   jsonObj['AEDDPHHONNI'] = '';
    if (jsonObj['android_apps_to_detect_res'] !== undefined) {
        const apd = jsonObj['android_apps_to_detect_res'];
        if (Array.isArray(apd) && apd.length > 0) jsonObj['android_apps_to_detect_res'] = [];
        else if (apd && typeof apd === 'object' && Array.isArray(apd['android_apps_to_detect_res']))
            apd['android_apps_to_detect_res'] = [];
    }
    if (jsonObj['LMDDDJPIMOK'] === true) jsonObj['LMDDDJPIMOK'] = false;
    if (jsonObj['OPICFECKHIA'] === true) jsonObj['OPICFECKHIA'] = false;
    if (jsonObj['HPLCNHDMBDN'] === true) jsonObj['HPLCNHDMBDN'] = false;
    if (jsonObj['GDHNPEMKNAM'] === true) jsonObj['GDHNPEMKNAM'] = false;
}

// ===== IMAGE URL PATCH =====
const GARENA_IMG_DOMAINS = [
    'https://dl.bs.freefiremobile.com', 'https://dl.dir.freefiremobile.com',
    'https://dl.cdn.freefiremobile.com', 'https://dl.ak.freefiremobile.com',
    'https://dl.gmc.freefiremobile.com', 'https://core-bs.freefiremobile.com',
    'https://core-gmc.freefiremobile.com',
];

function patchImageUrls(jsonStr) {
    let out = jsonStr;
    for (const d of GARENA_IMG_DOMAINS) out = out.split(d).join(`${PROXY_URL}/cdn`);
    return out;
}

// ===== collectResponseBody =====
function collectResponseBody(proxyRes) {
    return new Promise((resolve, reject) => {
        const enc = proxyRes.headers['content-encoding'];
        const chunks = [];
        let stream = proxyRes;
        if (enc === 'gzip')    stream = proxyRes.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = proxyRes.pipe(zlib.createInflate());
        else if (enc === 'br') stream = proxyRes.pipe(zlib.createBrotliDecompress());
        stream.on('data', c => chunks.push(c));
        stream.on('end',  () => resolve(Buffer.concat(chunks)));
        stream.on('error', () => {
            const raw = [];
            proxyRes.on('data', c => raw.push(c));
            proxyRes.on('end',  () => resolve(Buffer.concat(raw)));
            proxyRes.on('error', reject);
        });
    });
}

// ===== CLIENT PROXY =====
function createClientProxy() {
    return createProxyMiddleware({
        target: GARENA_CLIENT_SERVER,
        changeOrigin: true,
        secure: false,
        selfHandleResponse: true,
        onProxyReq: (proxyReq, req) => {
            proxyReq.setHeader('Host',   new URL(GARENA_CLIENT_SERVER).host);
            proxyReq.setHeader('Origin', GARENA_CLIENT_SERVER);
            ['user-agent','accept-language','accept-encoding','accept','content-type'].forEach(h => {
                if (req.headers[h]) proxyReq.setHeader(h, req.headers[h]);
            });
            if (Buffer.isBuffer(req.body) && req.body.length > 0) {
                proxyReq.setHeader('Content-Length', req.body.length);
                proxyReq.write(req.body);
            }
        },
        onProxyRes: async (proxyRes, req, res) => {
            const statusCode  = proxyRes.statusCode;
            const contentType = proxyRes.headers['content-type'] || '';
            const headers = { ...proxyRes.headers };
            delete headers['content-encoding'];
            delete headers['content-length'];
            delete headers['transfer-encoding'];

            try {
                const rawBody = await collectResponseBody(proxyRes);

                if (contentType.includes('application/json')) {
                    let parsed;
                    try { parsed = JSON.parse(rawBody.toString('utf8')); } catch (_) { parsed = null; }
                    if (parsed && typeof parsed === 'object') {
                        patchBanInfo(parsed);
                        patchMatchmakingBL(parsed, req.url || '');
                        patchGinUrl(parsed);
                        patchAbnormalData(parsed);
                        const jsonStr = patchStringLevelGin(patchImageUrls(JSON.stringify(parsed)));
                        const out = Buffer.from(jsonStr, 'utf8');
                        headers['content-length'] = String(out.length);
                        res.writeHead(statusCode, headers);
                        res.end(out);
                        return;
                    }
                }

                headers['content-length'] = String(rawBody.length);
                res.writeHead(statusCode, headers);
                res.end(rawBody);
            } catch (err) {
                console.log(`[CLIENT] error: ${err.message}`);
                if (!res.headersSent) { res.writeHead(502); res.end(); }
            }
        },
        onError: (err, req, res) => {
            if (!res.headersSent) res.status(502).json({ code: 502, message: 'Proxy error' });
        }
    });
}

// ===== NICKNAME FALLBACK =====
const NICK_PREFIXES = ['Jagoan','Pendekar','Sniper','Sultan','Gatotkaca','Booyah','Survivor','Pejuang','Garuda','Naga'];
const NICK_SUFFIXES = ['FF','GG','MAX','Pro','ID','Hebat','Keren','Jago'];
function generateFallbackNickname() {
    const p = NICK_PREFIXES[Math.floor(Math.random() * NICK_PREFIXES.length)];
    const s = NICK_SUFFIXES[Math.floor(Math.random() * NICK_SUFFIXES.length)];
    return `${p}${s}${Math.floor(100 + Math.random() * 900)}`;
}

// ===== LOGIN PROXY =====
const loginProxy = createProxyMiddleware({
    target: GARENA_LOGIN_SERVER,
    changeOrigin: true,
    secure: false,
    selfHandleResponse: true,
    onProxyReq: (proxyReq, req) => {
        proxyReq.setHeader('Host',   new URL(GARENA_LOGIN_SERVER).host);
        proxyReq.setHeader('Origin', GARENA_LOGIN_SERVER);
        proxyReq.removeHeader('accept-encoding');
        proxyReq.setHeader('Accept-Encoding', 'identity');
        ['user-agent','accept-language','accept','connection','content-type'].forEach(h => {
            if (req.headers[h]) proxyReq.setHeader(h, req.headers[h]);
        });
        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            proxyReq.setHeader('Content-Length', req.body.length);
            proxyReq.write(req.body);
        }
    },
    onProxyRes: (proxyRes, req, res) => {
        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
            let raw = Buffer.concat(chunks);
            const statusCode = proxyRes.statusCode;
            console.log(`[LOGIN] ${statusCode} ${req.method} ${req.path} (${raw.length}b)`);

            if (req.path === '/GenerateNickname' && statusCode >= 400) {
                const body = JSON.stringify({ code: 0, nickname: generateFallbackNickname() });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
                return res.end(body);
            }

            if (req.path === '/GetRecommendNickname' && statusCode >= 400) {
                const names = Array.from({length: 5}, () => generateFallbackNickname());
                const body  = JSON.stringify({ code: 0, nickname_list: names });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
                return res.end(body);
            }

            if (req.path === '/MajorRegister' && (statusCode === 400 || statusCode >= 500)) {
                try {
                    const bodyStr = raw.toString('utf8');
                    if (bodyStr.includes('INVALID_NAME') || bodyStr.includes('invalid_name') || statusCode >= 500) {
                        const uid  = Math.floor(17000000000 + Math.random() * 999999999);
                        const body = JSON.stringify({ code: 0, account_id: uid, region: 'ID' });
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
                        return res.end(body);
                    }
                } catch (_) {}
            }

            let outRaw = raw;
            const contentType = proxyRes.headers['content-type'] || '';
            const isJson = contentType.includes('application/json') || (() => {
                const s = raw.toString('utf8', 0, 1);
                return s === '{' || s === '[';
            })();

            if (isJson && raw.length > 0) {
                try {
                    const parsed = JSON.parse(raw.toString('utf8'));
                    patchGinUrl(parsed);
                    patchBanInfo(parsed);
                    if (parsed.gin_token !== undefined)   parsed.gin_token   = '';
                    if (parsed.CECNLHCONMI !== undefined) parsed.CECNLHCONMI = '';
                    const jsonStr = patchStringLevelGin(JSON.stringify(parsed));
                    outRaw = Buffer.from(jsonStr, 'utf8');
                    console.log(`[LOGIN] ${req.path} JSON patched ${raw.length}b→${outRaw.length}b`);
                } catch (pErr) {
                    console.log(`[LOGIN] ${req.path} JSON patch skip: ${pErr.message}`);
                    outRaw = raw;
                }
            }

            const headers = { ...proxyRes.headers };
            delete headers['content-encoding'];
            headers['content-length'] = outRaw.length;
            res.writeHead(statusCode, headers);
            res.end(outRaw);
        });
    },
    onError: (err, req, res) => {
        console.log(`[LOGIN] ERROR: ${err.message}`);
        if (!res.headersSent) res.status(502).json({ code: 502, message: 'Proxy error' });
    }
});

const clientProxy = createClientProxy();

// FIX: path tambah /NewbieChoice, /AccountBrief, /CheckVersion
const LOGIN_PATHS = [
    '/MajorRegister', '/GenerateNickname', '/GetRecommendNickname',
    '/GetAccountBriefInfoBeforeLogin', '/ChooseNewbieChoice', '/NewbieChoice',
    '/ChooseRegion', '/Register', '/CreateAccount', '/Ping', '/GetLoginData',
    '/CheckVersion', '/GetServerList', '/GetRegionConfig',
];

function init(app) {
    app.all('*', (req, res, next) => {
        if (req.path.startsWith('/cdn/')) return next();
        if (req.path === '/ver.php' || req.path === '/api/gamevar' || req.path === '/localconfig.json') return next();
        if (req.path.startsWith('/api/') || req.path.startsWith('/telegram')) return next();
        if (req.path.match(/\.(jpg|png|gif|css|js|html?)$/i)) return next();

        if (isTelemetryPath(req.path)) {
            const isBin = (req.headers['content-type'] || '').includes('octet-stream');
            return sendSpoofOK(res, isBin);
        }

        if (req.path === '/MajorLogin') {
            console.warn('[PROXY] WARNING: /MajorLogin lolos ke proxy.js!');
            return loginProxy(req, res, next);
        }
        if (LOGIN_PATHS.some(p => req.path === p || req.path.startsWith(p + '?'))) {
            return loginProxy(req, res, next);
        }

        return clientProxy(req, res, next);
    });

    console.log('[PROXY] Active — MajorLogin via majorlogin.js, no root requirement');
}

module.exports = { init, loginProxy, clientProxy, patchGinUrl, patchStringLevelGin };
