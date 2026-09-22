'use strict';
// gamevar.js — OB55 FIXED — disync dari referensi 203.57.85.108:7777

function getConfig() {
    try {
        const cfgMod = require('./config');
        return cfgMod.load();
    } catch (_) {
        return { runSpeed: 3.0, sensi: {} };
    }
}

function getGamevarLines() {
    const cfg = getConfig();

    const lines = [
        // Header wajib 2x (ikut referensi)
        "var_name,comment,var_type,var_value,var_region,var_platform",
        "var_name,comment,var_type,var_value,var_region,var_platform",

        // GGP SO loader — referensi: true
        "LoadGppLibSOToABHotUpdate,LoadGppLibSOToABHotUpdate,bool,true,,",
        "EnableReplaceGGPSO,EnableReplaceGGPSO,bool,true,,",
        "EnableReplaceGGPSO_2022,EnableReplaceGGPSO_2022,bool,true,,",

        // iOS-only (ikut referensi)
        "DelGameObjectTypeSet,DelGameObjectTypeSet,int,0,,ios",
        "UseCompactForBaseObjectMgr,UseCompactForBaseObjectMgr,int,0,,ios",
        "Enable2018ABstreamed,Enable2018ABstreamed,bool,false,,ios",

        // Baris kosong pemisah (ikut referensi persis)
        "",

        // Anticheat disable block — DIURUTKAN SAMA DENGAN REFERENSI
        "FFAntihackDefenceLevel,FFAntihackDefenceLevel,string,0,,",
        "FFAntihackLightInitOnThread,FFAntihackLightInitOnThread,bool,false,,",
        // FIX: typo di referensi ikut apa adanya (ClientUsingVersion_FFI,ClientUsingVersion_MAX — tanpa semicolon)
        "FFAntihackEmulatorCheckDisbaledClientVariant,FFAntihackEmulatorCheckDisbaledClientVariant,string,ClientUsingVersion_FFI,ClientUsingVersion_MAX,ClientUsingVersion_NORMAL,,",
        "FFAntihackSDKDetailEncryptBySHA1,FFAntihackSDKDetailEncryptBySHA1,bool,false,,",
        "EnableFFAntihackInfoExtra,EnableFFAntihackInfoExtra,bool,false,,",
        "FFANTIHACKEXT_SPLIT_THRESHOLD,FFANTIHACKEXT_SPLIT_THRESHOLD,int,0,,",

        // GIN disable
        "DisableGinInfoSend,DisableGinInfoSend,int,1,,",
        "GinInfoBRAliveThreshold,GinInfoBRAliveThreshold,int,0,,",
        "AntiHackResetSubgameInterval,AntiHackResetSubgameInterval,int,0,,",

        // Platform/check disable
        "EnablePlatformCheck,EnablePlatformCheck,bool,false,,",
        "EnableSupCheck,EnableSupCheck,bool,false,,",
        "EnableMMKPlatformCheck,EnableMMKPlatformCheck,bool,false,,",
        "EnableFileInfoEncryptionAndroid,EnableFileInfoEncryptionAndroid,bool,false,,",
        "EnableCheckFileStates,EnableCheckFileStates,bool,false,,",
        "EnableNativeCheck,EnableNativeCheck,bool,false,,",
        "EnableSendLibs,EnableSendLibs,bool,false,,",

        // Region disable antihack — ikut referensi
        "FFAntihackDisabledRegions,FFAntihackDisabledRegions,string,IND,BD,NA,,",
        "FFAntihackDisabledClientVariant,FFAntihackDisabledClientVariant,string,ClientUsingVersion_MAX_HPE,ClientUsingVersion_FFI,ClientUsingVersion_NORMAL,ClientUsingVersion_MAX|IND,ClientUsingVersion_MAX|BD,ClientUsingVersion_NORMAL|BD,,",
        "EnableMtpLiteDataRegion,EnableMtpLiteDataRegion,string,BR,EUROPE,ME,US,RU,SAC,SG,TH,TW,VN,PK,ZA,,",

        // Tutorial
        "ForceTutorial_ChangeHudABTest,ForceTutorial_ChangeHudABTest,float,-1,,",

        // GGP disable total — ikut referensi
        "GGPUpdateFlag,GGPUpdateFlag,int,0,,",
        "GGPSDKPackageNameList,GGPSDKPackageNameList,string,,,",
        "EnableGGPDecryptFailureProtection,EnableGGPDecryptFailureProtection,bool,false,,",
        "EnableReplaceGGPSO,EnableReplaceGGPSO,bool,false,,",
        "EnableReplaceGGPSO_2022,EnableReplaceGGPSO_2022,bool,false,,",
        "EarlyInitGGP,EarlyInitGGP,bool,false,,",
        "LoadUmaIndexerAfterGGP,LoadUmaIndexerAfterGGP,bool,false,,",
        "GGPLoginOnce,GGPLoginOnce,bool,false,,",
        "EnableGGPOnLowMemory,EnableGGPOnLowMemory,bool,false,,",
        "EnableLobbySocialAreaStartGGP,EnableLobbySocialAreaStartGGP,bool,false,,",
        "EnableLobbySocialAreaSubGameGGP,EnableLobbySocialAreaSubGameGGP,bool,false,,",
    ];

    // RunSpeed dynamic dari dashboard
    const rs = (cfg.runSpeed !== null && cfg.runSpeed !== undefined && !isNaN(parseFloat(cfg.runSpeed)))
        ? parseFloat(cfg.runSpeed)
        : 4.0;  // FIX: default 3.0 ikut referensi (sebelumnya 6.0)
    lines.push(`RunSpeed,RunSpeed,float,${rs},,`);

    // DashSpeedScale = sama dengan RunSpeed (ikut referensi)
    lines.push(`DashSpeedScale,DashSpeedScale,float,${rs},,`);

    // Sensitivity dynamic dari dashboard
    const s = cfg.sensi || {};
    const sensiKeys = [
        'SensitivityMaxSetting', 'Sensitivity1PMaxSetting',
        'X1ScopeMaxSetting', 'X2ScopeMaxSetting',
        'X4ScopeMaxSetting', 'X8ScopeMaxSetting', 'FreeLookMaxSetting'
    ];
    for (const k of sensiKeys) {
        const val = (s[k] !== undefined && !isNaN(parseFloat(s[k]))) ? parseFloat(s[k]) : 9.5;
        lines.push(`${k},${k},float,${val},,`);
    }

    return lines;
}

const MY_IP        = process.env.PROXY_URL || 'https://proxy-reza-kontolodon-memek-luu.up.railway.app/';
const REDIRECT_URL = 'https://whatsapp.com/channel/0029Vb8eX0Z1NCrYCXEXuu0K';

function getVerConfig(clientIp, myDomain, gameVersion, releaseVersion) {
    clientIp       = clientIp       || '74.125.24.139';
    myDomain       = (myDomain       || MY_IP).replace(/\/$/, '') + '/';
    gameVersion    = gameVersion    || '1.132.6';
    releaseVersion = releaseVersion || 'OB55';

    return {
        // ── Status ────────────────────────────────────────────────────────────
        "code":                                 0,
        "is_server_open":                       false,
        "is_review_server":                     false,
        "is_firewall_open":                     false,
        "force_to_restart_app":                 false,
        "is_update_btn_show":                   false,

        // ── Version ───────────────────────────────────────────────────────────
        "remote_version":                       gameVersion,
        "latest_release_version":               releaseVersion,

        // ── Optional resource versions (OB55 dari log) ────────────────────────
        "remote_option_version":                "optionallocres:51|optionalavatarres:832|optionalclothres:1270|optionalfootballres:27|optionalfullscreencgres:319|optionalhuntinggroundres:246|optionalinfection:125|optionalingameres:516|optionallobbyres:667|optionallonewolfres:86|optionallonewolfstrikeoutres:59|optionalludores:42|optionalmap1res:391|optionalmap2res:156|optionalmap4res:139|optionalmaphippores:118|optionalmapres:360|optionalnewblast:163|optionalpetres:943|optionalrushb:108|optionalrushingpetsres:84|optionalsnowduelres:65|optionalsocialres:223|optionaltrainingres:302|optionalugcres:860|optionalvoiceres:349|optionalwerewolves:153|optionalwerunres:92|optionalmapponyres:204|optionalugcoldparadiseres:34|optionalmultiregionres:29",
        "remote_option_version_astc":           "optionallocres:51|optionalavatarres:794|optionalclothres:1270|optionalfootballres:29|optionalfullscreencgres:306|optionalhuntinggroundres:216|optionalinfection:124|optionalingameres:476|optionallobbyres:668|optionallonewolfres:206|optionallonewolfstrikeoutres:155|optionalludores:175|optionalmap1res:391|optionalmap2res:192|optionalmap4res:175|optionalmaphippores:120|optionalmapres:394|optionalnewblast:162|optionalpetres:943|optionalrushb:241|optionalrushingpetsres:217|optionalsnowduelres:65|optionalsocialres:215|optionaltrainingres:274|optionalugcres:802|optionalvoiceres:384|optionalwerewolves:286|optionalwerunres:81|optionalmapponyres:204|optionalugcoldparadiseres:33|optionalmultiregionres:27",

        // ── CDN ───────────────────────────────────────────────────────────────
        // FIX: cdn_url ikut referensi (dl.gmc, bukan core-gmc)
        "cdn_url":                              "https://dl.gmc.freefiremobile.com/live/ABHotUpdates/",
        // FIX: abhotupdate_cdn_url → proxy domain kita (referensi: http://203.57.85.108:7777/hotpatchs/...)
        "abhotupdate_cdn_url":                  myDomain + "hotpatchs/444f6f88e15564f0/",
        // FIX: typo referensi "assembly-cssharp-patch" → pakai itu juga biar hash cocok
        "abhotupdate_check":                    "cache_res;assetindexer;SH-Gpp;assembly-cssharp-patch",
        "backup_cdn_url":                       "https://dl.gmc.freefiremobile.com/live/ABHotUpdates/",
        "res_url":                              "https://dl.gmc.freefiremobile.com/live/ABHotUpdates/",
        "img_cdn_url":                          "https://dl.gmc.freefiremobile.com/common/",
        "cdn_active":                           "https://dl.gmc.freefiremobile.com/",
        "cdn_ip_list":                          [],
        "cdn_port":                             6072,

        // ── Server URLs (proxy intercept) ─────────────────────────────────────
        // (game pakai ini untuk MajorLogin, proxy.js intercept lewat Host header)
        "server_url":                           myDomain,
        "notice_url":                           myDomain,
        "test_url":                             myDomain,
        "network_log_server":                   myDomain + "api/network_log",
        "web_log_server":                       myDomain + "web_log",

        // ── Anticheat ─────────────────────────────────────────────────────────
        "anti_hack_open":                       false,
        "ggp_url":                              "",
        "gop_url":                              "",

        // ── Billboard ─────────────────────────────────────────────────────────
        "billboard_cdn_url":                    REDIRECT_URL,
        "billboard_msg":                        "Perbaikan",
        "billboard_bg_url":                     "https://dl.cdn.freefiremobile.com/common/OB23/version/Patch_Bg.png",
        "patchnote_url":                        REDIRECT_URL,

        // ── Client info ───────────────────────────────────────────────────────
        "client_ip":                            clientIp,
        "country_code":                         "ID",
        "multi_region":                         "",
        "gdpr_version":                         0,

        // ── Store / web ───────────────────────────────────────────────────────
        "appstore_url":                         REDIRECT_URL,
        "backup_appstore_url":                  "",
        "max_store":                            "",
        "max_web":                              "",
        "max_video":                            "",
        "web_url":                              "",

        // ── Maintenance ───────────────────────────────────────────────────────
        "maintain_msg":                         "",
        "maintain_url":                         REDIRECT_URL,
        "maintenance_announcement":             null,
        "maintenance_region":                   null,

        // ── Network check ─────────────────────────────────────────────────────
        "need_check_ip_list":                   [],
        "need_track_hotupdate":                 true,

        // ── Login ─────────────────────────────────────────────────────────────
        "free_guest_login":                     true,
        "guest_login":                          true,
        "garena_login":                         false,
        "garena_hint":                          false,
        // FIX: login_failed_count ikut referensi = 2 (sebelumnya 10)
        "login_failed_count":                   2,
        "login_download_optionalpack":          "optionalclothres:shaders|optionalpetres:optionalpetres_commonab_shader|optionallobbyres:",
        "login_notice":                         "Welcome!",
        "free_rematch":                         true,

        // ── Download ──────────────────────────────────────────────────────────
        "use_login_optional_download":          true,
        "use_background_download":              false,
        "use_background_download_lobby":        false,
        "use_backgound_download_mem_thredshold": 2.79999995231628,
        "is_use_multi_download":                true,
        "hotfile_force_update":                 true,
        "use_multithread_hash":                 true,

        // ── Asset bundle check ────────────────────────────────────────────────
        "should_check_ab_load":                 false,
        "should_check_ab_exist":                true,
        "should_check_ab_size":                 true,
        "enable_hash_pdcache":                  true,
        "use_regional_gamevar":                 true,
        "force_refresh_restype":                "optionalavatarres",

        // ── Device / display ──────────────────────────────────────────────────
        "quality_level":                        0,
        "graphic_level":                        0,
        "show_high_framerate_UI":               false,
        "high_frame_default":                   0,
        "enable_clear_mem_when_autopause":      true,
        "enable_reduce_rate":                   false,
        "enable_min_resolution_height":         false,
        "enable_min_height":                    false,
        "enable_unmap_web_view_vm":             false,
        "resolution_reduceRate_blit_type":      null,
        "space_required_in_GB":                 1.48,
        "min_hint_size":                        1,
        "apply_skin":                           0,

        // ── Whitelist device ──────────────────────────────────────────────────
        "device_whitelist_version":             "",
        "device_whitelist_sp_version":          "",
        "device_whitelist_priority":            0,
        "device_whitelist_sp_priority":         0,
        "whitelist_mask":                       0,
        "whitelist_info":                       "",
        "whitelist_sp_mask":                    0,
        "whitelist_sp_info":                    "",

        // ── Core (game server) ────────────────────────────────────────────────
        "core_url":                             "csoversea.castle.freefiremobile.com",
        "core_ip_list":                         ["0.0.0.0","50.109.27.134","129.226.2.163","129.226.1.13","129.226.1.16"],
        "hs_config":                            { "nome": "", "porta": 6072 },

        // ── Gamevar ───────────────────────────────────────────────────────────
        "gamevar":                              getGamevarLines().join("\n"),
    };
}

function init(app) {
    app.get('/ver.php', (req, res) => {
        const rawIp       = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp    = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const gameVersion = req.query.version         || null;
        const releaseVer  = req.query.release_version || null;
        const config      = getVerConfig(clientIp, MY_IP, gameVersion, releaseVer);
        const rs = config.gamevar.match(/RunSpeed,RunSpeed,float,([\d.]+)/);
        console.log(`[GAMEVAR] /ver.php ip=${clientIp} ver=${gameVersion} rel=${releaseVer} RunSpeed=${rs ? rs[1] : 'N/A'}`);
        res.json(config);
    });

    app.get('/api/gamevar', (req, res) => {
        const rawIp       = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp    = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const gameVersion = req.query.version         || null;
        const releaseVer  = req.query.release_version || null;
        const config      = getVerConfig(clientIp, MY_IP, gameVersion, releaseVer);
        console.log(`[GAMEVAR] /api/gamevar ip=${clientIp} ver=${gameVersion}`);
        res.json(config);
    });

    app.get('/localconfig.json', (req, res) => {
        res.json({
            verAddr:       MY_IP,
            resetGuest:    true,
            testCodePatch: false
        });
    });

    console.log('[GAMEVAR] OB55 Active → /ver.php /api/gamevar /localconfig.json');
}

module.exports = { getVerConfig, getGamevarLines, MY_IP, init };
