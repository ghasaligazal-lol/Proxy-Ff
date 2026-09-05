// modules/proxy.js - FORWARD + TELEMETRY SPOOF
const { createProxyMiddleware } = require('http-proxy-middleware');
const { MY_IP } = require('../gamevar');
const zlib = require('zlib');

const GARENA_LOGIN_SERVER  = 'https://loginbp.ggpolarbear.com';
const GARENA_CLIENT_SERVER = 'https://clientbp.ggpolarbear.com';

// Path yang tidak boleh di-forward ke upstream — harus di-spoof di sini
// (endpoint ini kadang datang lewat catch-all proxy bukan route spesifik)
const TELEMETRY_PATHS = [
    '/LogEvent',
    '/ReportEventPushInfo',
    '/CheckHackBehavior',
    '/CheckNeedUpdateGPToken',
    '/GinReport',
    '/AntiAddiction',
    '/ReportAntiAddiction',
];

function isTelemetryPath(path) {
    const lower = path.toLowerCase();
    if (TELEMETRY_PATHS.some(p => path === p || path.startsWith(p + '?'))) return true;
    return (
        lower.includes('logevent') ||
        lower.includes('networklog') ||
        lower.includes('reportevent') ||
        lower.includes('antiaddiction') ||
        (lower.includes('report') && lower.includes('event')) ||
        lower.includes('ginreport')
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
    if (jsonObj && typeof jsonObj[BAN_INFO_KEY] === 'object' && jsonObj[BAN_INFO_KEY] !== null) {
        const banInfo = jsonObj[BAN_INFO_KEY];
        const before = { ban_mode: banInfo.ban_mode, unban_time: banInfo.unban_time, hint_string: banInfo.hint_string };
        banInfo.ban_mode    = 0;
        banInfo.unban_time  = 0;
        banInfo.hint_string = '';
        console.log(`[BAN-PATCH] AEBBNFBNIDB patched: ${JSON.stringify(before)} → ban_mode:0 unban_time:0 hint_string:""`);
    }
    return jsonObj;
}

// ===== GIN/GGP URL PATCH =====
// Field CECNLHCONMI.ggp_url di GetLoginData response masih nunjuk ke
// gin.freefiremobile.com (server Garena asli) — Gin konek langsung via TCP ke sana,
// bypass proxy, dan kirim CLIENT_DATA_FORWARD_NTF yang trigger BLACKLIST_NTF.
// Fix: redirect ggp_url ke proxy kita sendiri supaya Gin request lewat proxy.
const GIN_CONFIG_KEY = 'CECNLHCONMI';

function patchGinUrl(jsonObj) {
    if (jsonObj && typeof jsonObj[GIN_CONFIG_KEY] === 'object' && jsonObj[GIN_CONFIG_KEY] !== null) {
        const ginConf = jsonObj[GIN_CONFIG_KEY];
        const originalGgpUrl = ginConf.ggp_url;

        // Matiin semua flag report ke GGP/Gin
        ginConf.is_report_to_ggp     = false;
        ginConf.is_transfer_report   = false;
        ginConf.is_enable_ggp        = false;
        ginConf.is_get_feature       = false;
        ginConf.is_get_flag          = false;
        ginConf.is_enable_tcp        = false;

        // Redirect ggp_url ke proxy kita (supaya kalau game tetap connect, lewat sini)
        const proxyHost = MY_IP.replace(/^https?:\/\//, '').replace(/\/$/, '');
        ginConf.ggp_url = proxyHost;

        console.log(`[GIN-PATCH] CECNLHCONMI patched: ggp_url ${originalGgpUrl} → ${proxyHost}, semua flag GGP dimatiin`);
    }
    return jsonObj;
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
                        patchGinUrl(parsed);
                        patchMailList(parsed, req.url || '');
                        if (isLoginRewardEndpoint(req.url || '')) {
                            patchLoginReward(parsed, req.url || '');
                        }
                        // Patch URL gambar di JSON string setelah semua object patch
                        let jsonStr = patchImageUrls(JSON.stringify(parsed));
                        const patched = Buffer.from(jsonStr, 'utf8');
                        headers['content-length'] = String(patched.length);
                        res.writeHead(statusCode, headers);
                        res.end(patched);
                        console.log(`[CLIENT-PATCH] ${statusCode} ${req.method} ${req.url}`);
                        return;
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

const loginProxy = createProxyMiddleware({
    target: GARENA_LOGIN_SERVER,
    changeOrigin: true,
    secure: false,
    onProxyReq: (proxyReq, req, res) => {
        const host = new URL(GARENA_LOGIN_SERVER).host;
        proxyReq.setHeader('Host', host);
        proxyReq.setHeader('Origin', GARENA_LOGIN_SERVER);
        
        // ===== FORWARD HEADER ASLI DARI GAME =====
        // Ga ngubah apa-apa, pake header dari game
        if (req.headers['user-agent']) {
            proxyReq.setHeader('User-Agent', req.headers['user-agent']);
        }
        if (req.headers['accept-language']) {
            proxyReq.setHeader('Accept-Language', req.headers['accept-language']);
        }
        if (req.headers['accept-encoding']) {
            proxyReq.setHeader('Accept-Encoding', req.headers['accept-encoding']);
        }
        if (req.headers['accept']) {
            proxyReq.setHeader('Accept', req.headers['accept']);
        }
        if (req.headers['connection']) {
            proxyReq.setHeader('Connection', req.headers['connection']);
        }
        if (req.headers['content-type']) {
            proxyReq.setHeader('Content-Type', req.headers['content-type']);
        }
        
        // Forward body
        if (Buffer.isBuffer(req.body) && req.body.length > 0) {
            proxyReq.setHeader('Content-Length', req.body.length);
            proxyReq.write(req.body);
        }
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log(`[LOGIN] ${proxyRes.statusCode} ${req.method} ${req.url}`);
    },
    onError: (err, req, res) => {
        console.log(`[LOGIN] ERROR: ${err.message}`);
        res.status(502).json({ code: 502, message: 'Proxy error' });
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
        
        // Forward ke login server
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

module.exports = { init, loginProxy, clientProxy };