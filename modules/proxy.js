// modules/proxy.js - FORWARD + TELEMETRY SPOOF
// CLEAN VERSION: tanpa mail inject, skin inject, login reward, account TG log
const { createProxyMiddleware } = require('http-proxy-middleware');
const { MY_IP } = require('../gamevar');
const zlib   = require('zlib');
const tglog  = require('./tglog');

const GARENA_LOGIN_SERVER  = 'https://loginbp.ggpolarbear.com';
const GARENA_CLIENT_SERVER = 'https://clientbp.ggpolarbear.com';

const TELEMETRY_PATHS = [
    '/LogEvent',
    '/ReportEventPushInfo',
    '/CheckHackBehavior',
    '/CheckNeedUpdateGPToken',
    '/GinReport', '/gin/report', '/gin/connect', '/gin/keepalive',
    '/gin/disconnect', '/gin/upload', '/gin/batch',
    '/GGP', '/GGPReport', '/ggp/report', '/ggp/connect',
    '/ggp/keepalive', '/ggp/upload',
    '/AntiAddiction', '/ReportAntiAddiction',
    '/AnticheatReport', '/anticheat/report', '/anticheat/upload',
    '/AnticheatUpload', '/CheckHackData', '/ReportHackData',
    '/ReportClientData', '/ClientDataForward',
    '/SecurityReport', '/ReportSecurityEvent',
    '/DataReport', '/DataUploadEvent',
    '/api/network_log', '/network_log', '/networklog',
    '/api/logNetworkLogEvent', '/logNetworkLogEvent',
    '/ffanti/upload', '/ffanti/report', '/ffanti/connect',
    '/FFAnti', '/FFAntiReport', '/FFAntiUpload', '/ReportFFAnti', '/CheckFFAnti',
    '/AbnormalDataReport', '/ReportAbnormalData', '/AbnormalData',
    '/ClientDetectionReport', '/DetectionReport', '/ReportDetection',
    '/AndroidAppDetect', '/AppDetectionUpload',
    '/ModifierDetect', '/ModDetect', '/ReportModifier',
    '/HackLibReport', '/LibHashReport', '/AHLReport',
    '/gamesecurity/ban', '/ban',
];

function isTelemetryPath(path) {
    const lower = path.toLowerCase();
    if (TELEMETRY_PATHS.some(p => path === p || path.startsWith(p + '?'))) return true;
    return (
        lower.includes('logevent') ||
        lower.includes('networklog') ||
        lower.includes('reportevent') ||
        lower.includes('antiaddiction') ||
        lower.includes('anticheat') ||
        lower.includes('hackdata') ||
        lower.includes('clientdata') ||
        lower.includes('dataforward') ||
        lower.includes('securityreport') ||
        lower.includes('ginreport') ||
        lower.includes('ggpreport') ||
        lower.includes('ginupload') ||
        lower.includes('ggpupload') ||
        lower.includes('/gin/') ||
        lower.includes('/ggp/') ||
        lower.includes('ffanti') ||
        lower.includes('abnormal') ||
        lower.includes('detection') ||
        lower.includes('libhash') ||
        lower.includes('ahlreport') ||
        lower.includes('modifie') ||
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
const BAN_INFO_KEY = 'AEBBNFBNIDB';

function patchBanInfo(jsonObj) {
    if (jsonObj && typeof jsonObj[BAN_INFO_KEY] === 'object' && jsonObj[BAN_INFO_KEY] !== null) {
        const banInfo = jsonObj[BAN_INFO_KEY];
        banInfo.ban_mode    = 0;
        banInfo.unban_time  = 0;
        banInfo.hint_string = '';
        console.log('[BAN-PATCH] AEBBNFBNIDB → ban_mode:0');
    }

    if (jsonObj && Array.isArray(jsonObj.blacklist)) {
        if (jsonObj.blacklist.length > 0) {
            console.log(`[BL-PATCH] blacklist[] cleared: ${jsonObj.blacklist.length} entries`);
        }
        jsonObj.blacklist = [];
    }
    if (jsonObj && jsonObj.blacklist_info !== undefined && jsonObj.blacklist_info !== null) {
        jsonObj.blacklist_info = null;
    }

    function zapBlacklist(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 10) return;
        if (Array.isArray(obj)) { obj.forEach(i => zapBlacklist(i, depth + 1)); return; }
        if ('is_in_blacklist' in obj) {
            obj.is_in_blacklist     = false;
            obj.ban_time            = 0;
            obj.ban_reason          = 0;
            obj.ban_reason_detail   = '';
            obj.ban_expire_duration = 0;
            obj.ban_type            = '';
        }
        if ('matchmaking_blacklist' in obj) {
            const mbl = obj.matchmaking_blacklist;
            if (typeof mbl === 'number' && mbl !== 0) {
                obj.matchmaking_blacklist = 0;
            } else if (mbl && typeof mbl === 'object') {
                if (mbl.is_in_blacklist) {
                    mbl.is_in_blacklist = false;
                    if (mbl.ban_time            !== undefined) mbl.ban_time            = 0;
                    if (mbl.ban_reason          !== undefined) mbl.ban_reason          = 0;
                    if (mbl.ban_reason_detail   !== undefined) mbl.ban_reason_detail   = '';
                    if (mbl.ban_expire_duration !== undefined) mbl.ban_expire_duration = 0;
                    if (mbl.ban_type            !== undefined) mbl.ban_type            = '';
                }
            }
        }
        if ('championship_is_in_blacklist' in obj && obj.championship_is_in_blacklist) {
            obj.championship_is_in_blacklist = false;
        }
        for (const k of Object.keys(obj)) zapBlacklist(obj[k], depth + 1);
    }
    zapBlacklist(jsonObj, 0);

    return jsonObj;
}

function patchMatchmakingBL(jsonObj, urlPath) {
    if (!urlPath.includes('GetMatchmakingBlacklist')) return jsonObj;
    if (!jsonObj || typeof jsonObj !== 'object') return jsonObj;
    jsonObj.blacklist      = [];
    jsonObj.blacklist_info = null;
    if (jsonObj.blacklist_list !== undefined) jsonObj.blacklist_list = [];
    if (jsonObj.bl_list        !== undefined) jsonObj.bl_list        = [];
    return jsonObj;
}

// ===== GIN/GGP URL PATCH =====
const GIN_CONFIG_KEY = 'CECNLHCONMI';
const GRTC_URL_KEY   = 'LJAPOJNBOFE';
const TRACEROUTE_KEY = 'FOGGNIHIBPG';
const SERVERNODE_KEY = 'HDNAPFEGDGG';

const _ginDomainPattern = new RegExp(
    '("(?:[^"\\\\]|\\\\.)*(?:' + [
        'gin\\.freefiremobile\\.com',
        'grtc\\.garenanow\\.com',
        'ggblueshark\\.com',
        'ffanti\\.',
        'ggpolarbear\\.com/gin',
        'ggpolarbear\\.com/ggp',
        '124\\.158\\.134\\.7',
        '124\\.158\\.135\\.168',
        'stronghold\\.freefiremobile\\.com',
        'vodka\\.freefiremobile\\.com',
        'idevent\\.gg',
        'idnetwork\\.gg',
        'sggigateway\\.gg',
        'gamesecurity\\.sea\\.freefiremobile\\.com',
    ].join('|') + ')(?:[^"\\\\]|\\\\.)*")',
    'gi'
);

function patchStringLevelGin(jsonStr) {
    const result = jsonStr.replace(_ginDomainPattern, '""');
    if (result !== jsonStr) {
        console.log('[STRING-PATCH] GIN/anticheat domain ditemukan dan dihapus');
    }
    return result;
}

function removeKeyRecursive(obj, key, depth) {
    if (!obj || typeof obj !== 'object' || depth > 10) return;
    if (Array.isArray(obj)) {
        for (const item of obj) {
            if (item && typeof item === 'object') removeKeyRecursive(item, key, depth + 1);
        }
        return;
    }
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
        delete obj[key];
        console.log(`[GIN-PATCH] ${key} DELETED (depth ${depth})`);
    }
    for (const k of Object.keys(obj)) {
        const val = obj[k];
        if (val && typeof val === 'object') removeKeyRecursive(val, key, depth + 1);
    }
}

function patchAbnormalData(jsonObj) {
    if (!jsonObj || typeof jsonObj !== 'object') return jsonObj;

    if (jsonObj['AEDDPHHONNI'] !== undefined && jsonObj['AEDDPHHONNI']) {
        jsonObj['AEDDPHHONNI'] = '';
        console.log('[ABNORMAL-PATCH] AEDDPHHONNI cleared');
    }
    if (jsonObj['android_apps_to_detect_res'] !== undefined) {
        const apd = jsonObj['android_apps_to_detect_res'];
        if (apd && typeof apd === 'object' && !Array.isArray(apd)) {
            if (Array.isArray(apd['android_apps_to_detect_res'])) {
                apd['android_apps_to_detect_res'] = [];
            }
        } else if (Array.isArray(apd) && apd.length > 0) {
            jsonObj['android_apps_to_detect_res'] = [];
        }
    }
    if (jsonObj['LMDDDJPIMOK'] === true) { jsonObj['LMDDDJPIMOK'] = false; }
    if (jsonObj['OPICFECKHIA'] === true) { jsonObj['OPICFECKHIA'] = false; }
    if (jsonObj['HPLCNHDMBDN'] === true) { jsonObj['HPLCNHDMBDN'] = false; }
    if (jsonObj['GDHNPEMKNAM'] === true) { jsonObj['GDHNPEMKNAM'] = false; }

    return jsonObj;
}

function patchGinUrl(jsonObj) {
    removeKeyRecursive(jsonObj, GIN_CONFIG_KEY, 0);
    removeKeyRecursive(jsonObj, GRTC_URL_KEY, 0);

    if (jsonObj && Array.isArray(jsonObj[TRACEROUTE_KEY])) {
        jsonObj[TRACEROUTE_KEY] = [];
        console.log('[GIN-PATCH] FOGGNIHIBPG (traceroute list) dikosongkan');
    }
    if (jsonObj && Array.isArray(jsonObj[SERVERNODE_KEY])) {
        jsonObj[SERVERNODE_KEY] = [];
        console.log('[GIN-PATCH] HDNAPFEGDGG (server node list) dikosongkan');
    }

    const KILL_FLAGS = ['POEPGJPHCMJ', 'EMFPDECPCDG', 'PDJHKBDIHGL', 'IIPKMIOFCJP'];
    for (const f of KILL_FLAGS) {
        if (jsonObj && jsonObj[f] !== undefined) {
            jsonObj[f] = '';
        }
    }

    _zeroField(jsonObj, 'hacker_protection', 0, 0);
    _zeroField(jsonObj, 'ut_flag', 0, 0);

    if (jsonObj && jsonObj['android_apps_to_detect_res'] !== undefined) {
        const apd = jsonObj['android_apps_to_detect_res'];
        if (apd && typeof apd === 'object' && !Array.isArray(apd)) {
            if (Array.isArray(apd['android_apps_to_detect_res'])) {
                apd['android_apps_to_detect_res'] = [];
            }
        } else if (Array.isArray(apd)) {
            jsonObj['android_apps_to_detect_res'] = [];
        }
        console.log('[GIN-PATCH] android_apps_to_detect_res dikosongkan');
    }

    _zeroField(jsonObj, 'is_report_to_ggp',   false, 0);
    _zeroField(jsonObj, 'is_enable_ggp',       false, 0);
    _zeroField(jsonObj, 'is_enable_tcp',       false, 0);
    _zeroField(jsonObj, 'is_transfer_report',  false, 0);
    _zeroField(jsonObj, 'is_get_feature',      false, 0);
    _zeroField(jsonObj, 'is_get_flag',         false, 0);
    _zeroField(jsonObj, 'ggp_url',             '',    0);

    const ahcd = jsonObj && jsonObj['anti_hack_center_desc'];
    if (ahcd && typeof ahcd === 'object') {
        const inner = ahcd['anti_hack_center_desc'] || ahcd;
        if (inner && typeof inner === 'object') {
            if (inner['ban_list_url'] !== undefined) inner['ban_list_url'] = '';
            if (inner['link']         !== undefined) inner['link']         = '';
        }
    }
    _zeroField(jsonObj, 'ban_list_url', '', 0);

    return jsonObj;
}

function _zeroField(obj, field, replacement, depth) {
    if (!obj || typeof obj !== 'object' || depth > 10) return;
    if (Array.isArray(obj)) {
        for (const item of obj) {
            if (item && typeof item === 'object') _zeroField(item, field, replacement, depth + 1);
        }
        return;
    }
    if (obj[field] !== undefined && obj[field] !== replacement) {
        obj[field] = replacement;
    }
    for (const k of Object.keys(obj)) {
        const val = obj[k];
        if (val && typeof val === 'object') _zeroField(val, field, replacement, depth + 1);
    }
}

// ===== IMAGE URL PATCH =====
const PROXY_HOST_URL = MY_IP.replace(/\/$/, '');
const GARENA_IMG_DOMAINS = [
    'https://dl.bs.freefiremobile.com',
    'https://dl.dir.freefiremobile.com',
    'https://dl.cdn.freefiremobile.com',
    'https://dl.ak.freefiremobile.com',
    'https://dl.gmc.freefiremobile.com',
    'https://core-bs.freefiremobile.com',
    'https://core-gmc.freefiremobile.com',
];

function patchImageUrls(jsonStr) {
    let patched = jsonStr;
    for (const domain of GARENA_IMG_DOMAINS) {
        patched = patched.split(domain).join(`${PROXY_HOST_URL}/cdn`);
    }
    return patched;
}

function collectResponseBody(proxyRes) {
    return new Promise((resolve, reject) => {
        const encoding = proxyRes.headers['content-encoding'];
        const chunks = [];
        let stream = proxyRes;
        if (encoding === 'gzip') stream = proxyRes.pipe(zlib.createGunzip());
        else if (encoding === 'deflate') stream = proxyRes.pipe(zlib.createInflate());
        else if (encoding === 'br') stream = proxyRes.pipe(zlib.createBrotliDecompress());
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end',  ()    => resolve(Buffer.concat(chunks)));
        stream.on('error', err => {
            const raw = [];
            proxyRes.on('data', c => raw.push(c));
            proxyRes.on('end', () => resolve(Buffer.concat(raw)));
            proxyRes.on('error', reject);
        });
    });
}

// Client proxy — patch ban/GIN, tanpa skin/mail/reward inject
function createClientProxyWithBanPatch() {
    return createProxyMiddleware({
        target: GARENA_CLIENT_SERVER,
        changeOrigin: true,
        secure: false,
        selfHandleResponse: true,
        onProxyReq: (proxyReq, req, res) => {
            const host = new URL(GARENA_CLIENT_SERVER).host;
            proxyReq.setHeader('Host', host);
            proxyReq.setHeader('Origin', GARENA_CLIENT_SERVER);

            if (req.headers['user-agent'])       proxyReq.setHeader('User-Agent',       req.headers['user-agent']);
            if (req.headers['accept-language'])  proxyReq.setHeader('Accept-Language',  req.headers['accept-language']);
            if (req.headers['accept-encoding'])  proxyReq.setHeader('Accept-Encoding',  req.headers['accept-encoding']);
            if (req.headers['accept'])           proxyReq.setHeader('Accept',           req.headers['accept']);
            if (req.headers['content-type'])     proxyReq.setHeader('Content-Type',     req.headers['content-type']);

            if (Buffer.isBuffer(req.body) && req.body.length > 0) {
                proxyReq.setHeader('Content-Length', req.body.length);
                proxyReq.write(req.body);
            }
        },
        onProxyRes: async (proxyRes, req, res) => {
            const statusCode  = proxyRes.statusCode;
            const contentType = proxyRes.headers['content-type'] || '';

            const headers = Object.assign({}, proxyRes.headers);
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
                        // IMAGE URL patch
                        let jsonStr = patchImageUrls(JSON.stringify(parsed));
                        // String-level GIN domain fallback
                        jsonStr = patchStringLevelGin(jsonStr);
                        const patched = Buffer.from(jsonStr, 'utf8');
                        headers['content-length'] = String(patched.length);
                        res.writeHead(statusCode, headers);
                        res.end(patched);
                        console.log(`[CLIENT-PATCH] ${statusCode} ${req.method} ${req.url}`);
                        return;
                    }
                }

                headers['content-length'] = String(rawBody.length);
                res.writeHead(statusCode, headers);
                res.end(rawBody);
                console.log(`[CLIENT] ${statusCode} ${req.method} ${req.url}`);

            } catch (err) {
                console.log(`[CLIENT] body collect error: ${err.message}`);
                if (!res.headersSent) res.writeHead(502);
                res.end();
            }
        },
        onError: (err, req, res) => {
            console.log(`[CLIENT] ERROR: ${err.message}`);
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
    const n = Math.floor(100 + Math.random() * 900);
    return `${p}${s}${n}`;
}

// ===== LOGIN PROXY (loginbp) =====
const loginProxy = createProxyMiddleware({
    target: GARENA_LOGIN_SERVER,
    changeOrigin: true,
    secure: false,
    selfHandleResponse: true,
    onProxyReq: (proxyReq, req, res) => {
        const host = new URL(GARENA_LOGIN_SERVER).host;
        proxyReq.setHeader('Host', host);
        proxyReq.setHeader('Origin', GARENA_LOGIN_SERVER);

        if (req.headers['user-agent'])       proxyReq.setHeader('User-Agent', req.headers['user-agent']);
        if (req.headers['accept-language'])  proxyReq.setHeader('Accept-Language', req.headers['accept-language']);
        if (req.headers['accept-encoding'])  proxyReq.setHeader('Accept-Encoding', req.headers['accept-encoding']);
        if (req.headers['accept'])           proxyReq.setHeader('Accept', req.headers['accept']);
        if (req.headers['connection'])       proxyReq.setHeader('Connection', req.headers['connection']);
        if (req.headers['content-type'])     proxyReq.setHeader('Content-Type', req.headers['content-type']);

        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            proxyReq.setHeader('Content-Length', req.body.length);
            proxyReq.write(req.body);
        }
    },
    onProxyRes: (proxyRes, req, res) => {
        const chunks = [];
        proxyRes.on('data', c => chunks.push(c));
        proxyRes.on('end', () => {
            const raw = Buffer.concat(chunks);
            const statusCode = proxyRes.statusCode;

            console.log(`[LOGIN] ${statusCode} ${req.method} ${req.path}`);

            if (req.path === '/GenerateNickname' && statusCode >= 400) {
                const fallback = generateFallbackNickname();
                const body = JSON.stringify({ code: 0, nickname: fallback });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
                return res.end(body);
            }

            if (req.path === '/GetRecommendNickname' && statusCode >= 400) {
                const names = Array.from({length: 5}, () => generateFallbackNickname());
                const body = JSON.stringify({ code: 0, nickname_list: names });
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
                return res.end(body);
            }

            if (req.path === '/MajorRegister' && (statusCode === 400 || statusCode === 500)) {
                let bodyStr = '';
                try { bodyStr = raw.toString('utf8'); } catch {}
                if (bodyStr.includes('INVALID_NAME') || bodyStr.includes('invalid_name') || statusCode >= 500) {
                    console.log(`[LOGIN] MajorRegister patched`);
                    const fakeUid = Math.floor(17000000000 + Math.random() * 999999999);
                    const body = JSON.stringify({ code: 0, account_id: fakeUid, region: 'ID' });
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
                    return res.end(body);
                }
            }

            const headers = { ...proxyRes.headers };
            delete headers['content-encoding'];
            headers['content-length'] = raw.length;
            res.writeHead(statusCode, headers);
            res.end(raw);
        });
    },
    onError: (err, req, res) => {
        console.log(`[LOGIN] ERROR: ${err.message}`);
        if (!res.headersSent) res.status(502).json({ code: 502, message: 'Proxy error' });
    }
});

const clientProxy = createClientProxyWithBanPatch();

function init(app) {
    app.all('*', (req, res, next) => {
        if (req.path.startsWith('/cdn/')) return next();
        if (req.path === '/ver.php' || req.path === '/api/gamevar' || req.path === '/localconfig.json') return next();
        if (req.path.startsWith('/api/') || req.path.startsWith('/telegram')) return next();
        if (req.path.match(/\.(jpg|png|gif|css|js|html?)$/i)) return next();

        if (isTelemetryPath(req.path)) {
            const isBin = (req.headers['content-type'] || '').includes('octet-stream');
            console.log(`[SPOOF] ${req.method} ${req.path} → 200 OK (telemetry blocked)`);
            return sendSpoofOK(res, isBin);
        }

        const ua = req.headers['user-agent'] || 'unknown';
        console.log(`[FORWARD] ${req.method} ${req.path} (UA: ${ua.substring(0,30)}...)`);

        const CLIENT_PATHS = [
            '/GetMatchmakingBlacklist',
            '/GetPlayerPersonalShow', '/GetMailList', '/GetCharacterRewardData',
            '/GetLoginReward', '/GetDailyLogin', '/GetAvatarInfo',
            '/GetClothesInfo', '/GetWeaponSkinInfo', '/GetCharInfo',
            '/GetUserInfo', '/GetAccountInfo',
            '/SetNickname', '/SetAvatar',
            '/GetNicknameList', '/CheckNickname',
            '/LoginGetDesc',
            '/GetCharacterConfig',
            '/GetServerConfig',
            '/GetActivityInfo',
            '/GetActivityList',
            '/GetNoticeInfo',
            '/GetBannerInfo',
            '/GetMaintainInfo',
            '/GetVersionConfig',
            '/GetFriendList', '/GetRankInfo', '/GetLeaderboard',
            '/GetGuildInfo', '/GetClanInfo',
            '/ClaimReward', '/ClaimDailyLogin',
            '/GetSeasonInfo', '/GetEventInfo',
            '/GetShopInfo', '/GetInventory', '/GetBagInfo',
            '/BuyItem', '/ExchangeItem',
            '/ChooseNewbieChoice',
            '/LoginGetAccountInfo', '/LoginGetSplash', '/LoginGetProfile',
            '/GetFriend', '/GetFriendListV2',
            '/GetPetList', '/GetPetInfo',
            '/GetLoadoutSchemeDesc', '/GetPresetLoadoutInfo',
            '/GetWorkshopSwitch', '/GetWorkshopInfo',
            '/GetBRRankingInfo', '/GetCSRankingInfo',
            '/GetAccountFreshInfo', '/GetAttendance',
            '/GetPlayerHippoRankingInfo',
            '/GetRankingMatchGrandmasterPositions', '/GetCSRankingMatchGrandmasterPositions',
            '/GetRankMasterLevel', '/GetCSRankMasterLevel',
            '/GetPrimeAccountInfo', '/GetAccountTeamTopUpInfo',
            '/GetStore', '/GetBackpack',
            '/GetOptCdnDesc',
            '/GetLimitedEventOpenInfo', '/GetCustomEventOpenInfo',
            '/GetGooglePlayAchievements',
            '/GetPlatformProfile',
        ];

        const LOGIN_OVERRIDE_PATHS = [
            '/GenerateNickname',
            '/GetRecommendNickname',
            '/MajorRegister',
            '/Register', '/CreateAccount',
        ];

        if (LOGIN_OVERRIDE_PATHS.some(p => req.path === p || req.path.startsWith(p))) {
            return loginProxy(req, res, next);
        }

        const isClientPath = CLIENT_PATHS.some(p => req.path === p || req.path.startsWith(p));
        if (isClientPath) {
            return clientProxy(req, res, next);
        }

        loginProxy(req, res, next);
    });

    app.get('/api/proxy/status', (req, res) => {
        res.json({
            status: 'online',
            mode: 'speed_sensi',
            targets: {
                login: GARENA_LOGIN_SERVER,
                client: GARENA_CLIENT_SERVER,
                cdn: 'handled_by_cdn_module'
            },
            timestamp: Date.now()
        });
    });

    console.log('[PROXY] Forward mode (speed+sensi only — no skin/mail inject)');
}

module.exports = { init, loginProxy, clientProxy, patchGinUrl, patchStringLevelGin };
