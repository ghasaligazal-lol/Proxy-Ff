'use strict';
// modules/gamevar.js
// Hanya gamevar yang VALID dikenal client — "server only" vars sudah dibuang semua.
// Config dinamis (RunSpeed, Sensi, bodyMode) dibaca dari modules/config.js via lazy load.

let _cfg = null;
function getConfig() {
    if (!_cfg) {
        try { _cfg = require('./config'); } catch (_) { _cfg = null; }
    }
    return _cfg ? _cfg.load() : { runSpeed: null, bodyMode: 'full', sensi: {} };
}

// ── Gamevar NORMAL (HS-only mode / tanpa mod) ─────────────────────────────────
// Hanya baris yang valid dikenal game client. Tidak ada "server only" flag.
const gamevarNormalLines = [
    "var_name,comment,var_type,var_value,var_region,var_platform",
    "var_name,comment,var_type,var_value,var_region,var_platform",
    "EnableVariableFFVoiceIDC,EnableVariableFFVoiceIDC,bool,false,,",
    "EnableYieldMutexDuringAsyncLoad,EnableYieldMutexDuringAsyncLoad,bool,false,,",
    "NinthProgressLoadingDuration,NinthProgressLoadingDuration,float,0,,",
    "EnableUGCScrollViewCulling,EnableUGCScrollViewCulling,bool,false,,",  // FIX: hapus duplikat (sebelumnya muncul 2x → trigger Abnormal Data)
    "ReservedInt01,ReservedInt01,int,5,,",
    "NinthLevelPortalRadius,NinthLevelPortalRadius,float,20,,",
    "Enable2018ABstreamed,Enable2018ABstreamed,bool,false,,ios",
    "EnableAsyncCullResultsRelease,EnableAsyncCullResultsRelease,bool,false,,ios",
    "ReservedInt02,ReservedInt02,int,30,,",
    "EnableUGCHalfwayJoin,EnableUGCHalfwayJoin,bool,false,,",
    "LadderMatchSplashRegionOn,LadderMatchSplashRegionOn,string,PK;EUROPE;TH;SG;TW;BR,,",
    "SwapWeaponCD,SwapWeaponCD,float,0,,",
    "SwitchWeaponInterval,SwitchWeaponInterval,float,0,,",
    "FreeMoveAngularSpeed,FreeMoveAngularSpeed,float,9999.9,,",
    "FreeMoveAngularSpeedStand,FreeMoveAngularSpeedStand,float,9999.9,,",
    "FreeMoveAngularSpeedCrouch,FreeMoveAngularSpeedCrouch,float,9999.9,,",
    "FreeMoveAngularSpeedCreep,FreeMoveAngularSpeedCreep,float,9999.9,,",

    // === GIN/GGP DISABLE — harus ada sebelum login ===
    // GIN connect lewat TCP langsung setelah game init.
    // Tanpa baris ini GIN SDK tetap jalan meski CECNLHCONMI di-delete dari GetLoginData,
    // karena game cek gamevar terlebih dahulu lalu apply ke GIN SDK config.
    "DisableGinReport,DisableGinReport,bool,true,,",
    "DisableGGPReport,DisableGGPReport,bool,true,,",
    "EnableGinReport,EnableGinReport,bool,false,,",
    "EnableGGPReport,EnableGGPReport,bool,false,,",
    "EnableGinConnect,EnableGinConnect,bool,false,,",
    "EnableGGPConnect,EnableGGPConnect,bool,false,,",
    "IsDisableDataReport,IsDisableDataReport,bool,true,,",
    "EnableDataUpload,EnableDataUpload,bool,false,,",
    "DisableUploadData,DisableUploadData,bool,true,,",
    "EnableAnticheatUpload,EnableAnticheatUpload,bool,false,,",
    "EnableSecurityReport,EnableSecurityReport,bool,false,,",
    "EnableClientDataForward,EnableClientDataForward,bool,false,,",
    "EnableReportSystemTimeDelta,EnableReportSystemTimeDelta,bool,false,,",
    "GinInfoBRAliveThreshold,GinInfoBRAliveThreshold,int,0,,",
    "DisableGinInfoSend,DisableGinInfoSend,int,1,,",
    "EarlyInitGGP,EarlyInitGGP,bool,false,,",

    // === ANTICHEAT DISABLE ===
    "CleanFFAntiState,CleanFFAntiState,bool,true,,",
    "FFAntihackDefenceLevel,FFAntihackDefenceLevel,string,0,,",
    "FFAntihackLightInitOnThread,FFAntihackLightInitOnThread,bool,false,,",
    "FFAntihackSDKDetailEncryptBySHA1,FFAntihackSDKDetailEncryptBySHA1,bool,false,,",
    "EnableFFAntihackInfoExtra,EnableFFAntihackInfoExtra,bool,false,,",
    "CheckHacker,CheckHacker,bool,false,,",
    "DebugHack,DebugHack,bool,true,,",
    "TestModeEnabled,TestModeEnabled,bool,true,,",
    "NeedProcessAH,NeedProcessAH,bool,true,,",
    "AntiHackResetSubgameInterval,AntiHackResetSubgameInterval,int,0,,",
    "FFANTIHACKEXT_SPLIT_THRESHOLD,FFANTIHACKEXT_SPLIT_THRESHOLD,int,0,,",
    "EnablePlatformCheck,EnablePlatformCheck,bool,false,,",
    "EnableSupCheck,EnableSupCheck,bool,false,,",
    "EnableMMKPlatformCheck,EnableMMKPlatformCheck,bool,false,,",
    "EnableIceWallHacker,EnableIceWallHacker,bool,false,,",
    "EnableIceWallHackerKill,EnableIceWallHackerKill,bool,false,,",
    "EnableHipHackerKill,EnableHipHackerKill,bool,false,,",
    "EnableSendHackStoreLog,EnableSendHackStoreLog,bool,false,,",
    "KickUserInMatchGame,KickUserInMatchGame,bool,false,,",
    "EnableCheckFileStates,EnableCheckFileStates,bool,false,,",
    "OptionalDeepFileCheck,OptionalDeepFileCheck,bool,false,,",
    "EnableFileCacherReadOpt,EnableFileCacherReadOpt,bool,false,,",
    "EnableFileCacherReadOpt_2022,EnableFileCacherReadOpt_2022,bool,false,,",
    "EnableGGPDecryptFailureProtection,EnableGGPDecryptFailureProtection,bool,false,,",
    "BlocklistMaxNum,BlocklistMaxNum,int,0,,",
    "Reportee_Damager_RecentlyMaxCnt,Reportee_Damager_RecentlyMaxCnt,int,0,,",
    "Reportee_Killer_RecentlyMaxCnt,Reportee_Killer_RecentlyMaxCnt,int,0,,",
    "EnableIngameQuickReport,EnableIngameQuickReport,bool,false,,",
    "BugReportIntervalOnLowMemory,BugReportIntervalOnLowMemory,int,0,,",
    "BugReportMaxCountPerSession,BugReportMaxCountPerSession,int,0,,",
    "IsAlbumScreenShotNeedAntiMod,IsAlbumScreenShotNeedAntiMod,bool,false,,",
    "SystemAlbumImageAntiModStrategy,SystemAlbumImageAntiModStrategy,int,0,,",
    "AlbumImageAntiModSecs,AlbumImageAntiModSecs,int,0,,",
];

// ── Gamevar FULL MOD ─────────────────────────────────────────────────────────
// Hanya var yang BENAR-BENAR dikenal client (tidak ada "server only" di log).
// RunSpeed dan Sensi di-inject dynamic dari config dashboard.
function getFullGamevarLines() {
    const cfg = getConfig();

    const lines = [
        "var_name,comment,var_type,var_value,var_region,var_platform",
        "var_name,comment,var_type,var_value,var_region,var_platform",

        // ── Gamevar client-side yang valid ──────────────────────────────────
        "EnableVariableFFVoiceIDC,EnableVariableFFVoiceIDC,bool,false,,",
        "EnableYieldMutexDuringAsyncLoad,EnableYieldMutexDuringAsyncLoad,bool,false,,",
        "NinthProgressLoadingDuration,NinthProgressLoadingDuration,float,0,,",
        "EnableUGCScrollViewCulling,EnableUGCScrollViewCulling,bool,false,,",
        "ReservedInt01,ReservedInt01,int,5,,",
        "NinthLevelPortalRadius,NinthLevelPortalRadius,float,20,,",
        "Enable2018ABstreamed,Enable2018ABstreamed,bool,false,,ios",
        "EnableAsyncCullResultsRelease,EnableAsyncCullResultsRelease,bool,false,,ios",
        "ReservedInt02,ReservedInt02,int,30,,",
        "EnableUGCHalfwayJoin,EnableUGCHalfwayJoin,bool,false,,",
        "LadderMatchSplashRegionOn,LadderMatchSplashRegionOn,string,PK;EUROPE;TH;SG;TW;BR,,",

        // ── Frame rate ──────────────────────────────────────────────────────
        "ShowHighFrameRateSetting,ShowHighFrameRateSetting,bool,true,,",
        "Real60FrameSwitch,Real60FrameSwitch,bool,true,,",

        // ── Movement (valid client vars) ────────────────────────────────────
        "SwapWeaponCD,SwapWeaponCD,float,0,,",
        "SwitchWeaponInterval,SwitchWeaponInterval,float,0,,",
        "FreeMoveAngularSpeed,FreeMoveAngularSpeed,float,9999.9,,",
        "FreeMoveAngularSpeedStand,FreeMoveAngularSpeedStand,float,9999.9,,",
        "FreeMoveAngularSpeedCrouch,FreeMoveAngularSpeedCrouch,float,9999.9,,",
        "FreeMoveAngularSpeedCreep,FreeMoveAngularSpeedCreep,float,9999.9,,",

        // ── Sensitivity (dynamic dari dashboard) ────────────────────────────

        // ── GIN/GGP DISABLE (wajib ada di full mod juga) ────────────────────
        "DisableGinReport,DisableGinReport,bool,true,,",
        "DisableGGPReport,DisableGGPReport,bool,true,,",
        "EnableGinReport,EnableGinReport,bool,false,,",
        "EnableGGPReport,EnableGGPReport,bool,false,,",
        "EnableGinConnect,EnableGinConnect,bool,false,,",
        "EnableGGPConnect,EnableGGPConnect,bool,false,,",
        "IsDisableDataReport,IsDisableDataReport,bool,true,,",
        "EnableDataUpload,EnableDataUpload,bool,false,,",
        "DisableUploadData,DisableUploadData,bool,true,,",
        "EnableAnticheatUpload,EnableAnticheatUpload,bool,false,,",
        "EnableSecurityReport,EnableSecurityReport,bool,false,,",
        "EnableClientDataForward,EnableClientDataForward,bool,false,,",
        "EnableReportSystemTimeDelta,EnableReportSystemTimeDelta,bool,false,,",
        "GinInfoBRAliveThreshold,GinInfoBRAliveThreshold,int,0,,",
        "DisableGinInfoSend,DisableGinInfoSend,int,1,,",
        "EarlyInitGGP,EarlyInitGGP,bool,false,,",

        // ── Anticheat disable ────────────────────────────────────────────────
        "CleanFFAntiState,CleanFFAntiState,bool,true,,",
        "FFAntihackDefenceLevel,FFAntihackDefenceLevel,string,0,,",
        "FFAntihackLightInitOnThread,FFAntihackLightInitOnThread,bool,false,,",
        "FFAntihackSDKDetailEncryptBySHA1,FFAntihackSDKDetailEncryptBySHA1,bool,false,,",
        "EnableFFAntihackInfoExtra,EnableFFAntihackInfoExtra,bool,false,,",
        "CheckHacker,CheckHacker,bool,false,,",
        "DebugHack,DebugHack,bool,true,,",
        "TestModeEnabled,TestModeEnabled,bool,true,,",
        "NeedProcessAH,NeedProcessAH,bool,true,,",
        "AntiHackResetSubgameInterval,AntiHackResetSubgameInterval,int,0,,",
        "FFANTIHACKEXT_SPLIT_THRESHOLD,FFANTIHACKEXT_SPLIT_THRESHOLD,int,0,,",
        "EnablePlatformCheck,EnablePlatformCheck,bool,false,,",
        "EnableSupCheck,EnableSupCheck,bool,false,,",
        "EnableMMKPlatformCheck,EnableMMKPlatformCheck,bool,false,,",
        "EnableIceWallHacker,EnableIceWallHacker,bool,false,,",
        "EnableIceWallHackerKill,EnableIceWallHackerKill,bool,false,,",
        "EnableHipHackerKill,EnableHipHackerKill,bool,false,,",
        "EnableSendHackStoreLog,EnableSendHackStoreLog,bool,false,,",
        "KickUserInMatchGame,KickUserInMatchGame,bool,false,,",
        "EnableCheckFileStates,EnableCheckFileStates,bool,false,,",
        "OptionalDeepFileCheck,OptionalDeepFileCheck,bool,false,,",
        "EnableFileCacherReadOpt,EnableFileCacherReadOpt,bool,false,,",
        "EnableFileCacherReadOpt_2022,EnableFileCacherReadOpt_2022,bool,false,,",
        "EnableGGPDecryptFailureProtection,EnableGGPDecryptFailureProtection,bool,false,,",
        "BlocklistMaxNum,BlocklistMaxNum,int,0,,",
        "Reportee_Damager_RecentlyMaxCnt,Reportee_Damager_RecentlyMaxCnt,int,0,,",
        "Reportee_Killer_RecentlyMaxCnt,Reportee_Killer_RecentlyMaxCnt,int,0,,",
        "EnableIngameQuickReport,EnableIngameQuickReport,bool,false,,",
        "BugReportIntervalOnLowMemory,BugReportIntervalOnLowMemory,int,0,,",
        "BugReportMaxCountPerSession,BugReportMaxCountPerSession,int,0,,",
        "IsAlbumScreenShotNeedAntiMod,IsAlbumScreenShotNeedAntiMod,bool,false,,",
        "SystemAlbumImageAntiModStrategy,SystemAlbumImageAntiModStrategy,int,0,,",
        "AlbumImageAntiModSecs,AlbumImageAntiModSecs,int,0,,",
    ];

    // Sensi — dynamic
    const s = cfg.sensi || {};
    const sensiKeys = [
        'SensitivityMaxSetting', 'Sensitivity1PMaxSetting',
        'X1ScopeMaxSetting', 'X2ScopeMaxSetting',
        'X4ScopeMaxSetting', 'X8ScopeMaxSetting', 'FreeLookMaxSetting'
    ];
    for (const k of sensiKeys) {
        const v = (s[k] !== undefined && s[k] !== null) ? s[k] : 9.5;
        lines.push(`${k},${k},float,${v},,`);
    }

    // RunSpeed — dynamic (hanya kalau di-set)
    if (cfg.runSpeed !== null && cfg.runSpeed !== undefined) {
        lines.push(`RunSpeed,,float,${cfg.runSpeed},,`);
    }

    return lines;
}

// ============================================================
const ALLOWED_IPS = ["117.18.20.142"];
const isGlobalMaintenance = false;
const MY_IP = process.env.PROXY_URL || "https://proxy-reza-kontolodon-memek-luu.up.railway.app/";
const REDIRECT_URL = "https://whatsapp.com/channel/0029Vb8eX0Z1NCrYCXEXuu0K";

function getVerConfig(clientIp = "74.125.24.139", myDomain = MY_IP) {
    const isAllowedUser = ALLOWED_IPS.includes(clientIp);
    const serverOpenStatus = isGlobalMaintenance ? isAllowedUser : true;

    const cfg = getConfig();
    const isHsOnly = cfg.bodyMode === 'hs_only';

    return {
        "abhotupdate_cdn_url":               myDomain + "live/ABHotUpdates/",
        // HS Only: hanya cache_res (body headshot). Full: tambah gameassetbundles
        "abhotupdate_check":                 isHsOnly
            ? "cache_res"
            : "cache_res;gameassetbundles/cache_res.UOT0J6aDCaQjwD02QTKoB6TYVuU~3D",
        "anti_hack_open":                    false,
        "appstore_url":                      REDIRECT_URL,
        "backup_appstore_url":               "",
        "backup_cdn_url":                    myDomain + "live/ABHotUpdates/",
        "billboard_bg_url":                  myDomain + "cdn/common/OB23/version/Patch_Bg.png",
        "billboard_cdn_url":                 REDIRECT_URL,
        "billboard_msg":                     "",
        "cdn_active":                        myDomain,
        "cdn_ip_list":                       [],
        "cdn_port":                          6072,
        "cdn_url":                           myDomain + "live/ABHotUpdates/",
        "client_ip":                         clientIp,
        "code":                              0,
        "core_ip_list":                      ["0.0.0.0","50.109.27.134","129.226.2.163","129.226.1.13","129.226.1.16"],
        "core_url":                          "csoversea.castle.freefiremobile.com",
        "country_code":                      "BR",
        "device_whitelist_sp_version":       "1.0.0",
        "device_whitelist_version":          "",
        "whitelist_mask":                    0,
        "whitelist_sp_mask":                 0,
        "whitelist_info":                    "",
        "whitelist_sp_info":                 "",
        "enable_clear_mem_when_autopause":   true,
        "enable_hash_pdcache":               true,
        "enable_min_height":                 false,
        "enable_min_resolution_height":      false,
        "enable_reduce_rate":                false,
        "enable_unmap_web_view_vm":          false,
        "force_refresh_restype":             "optionalavatarres",
        "force_to_restart_app":              false,
        "free_guest_login":                  true,
        "free_rematch":                      true,
        // Gamevar: HS Only = normal (no mod), Full = mod + dynamic sensi/speed
        "gamevar":                           isHsOnly
            ? gamevarNormalLines.join("\n")
            : getFullGamevarLines().join("\n"),
        "garena_hint":                       true,
        "garena_login":                      true,
        "gdpr_version":                      1,
        "ggp_url":                           "",
        "gop_url":                           "",
        "grey_update_percent":               0,
        "guest_login":                       true,
        "high_frame_default":                0,
        "hotfile_force_update":              true,
        "hs_config":                         { "nome": "", "porta": 6072 },
        "img_cdn_url":                       myDomain + "cdn/common/",
        "is_firewall_open":                  true,   // PATCH: blokir game dari connect TCP ke server luar
        "is_review_server":                  false,
        "is_server_open":                    serverOpenStatus,
        "is_update_btn_show":                false,
        "is_use_multi_download":             true,
        "latest_release_version":            "OB54",
        "login_download_optionalpack":       "optionalclothres:shaders|optionalpetres:optionalpetres_commonab_shader|optionallobbyres:",
        "login_failed_count":                4,
        "login_notice":                      serverOpenStatus ? "Welcome to Proxy Server!" : "Server Sedang Maintenance.",
        "maintain_msg":                      serverOpenStatus ? "" : "Server Sedang Maintenance.",
        "maintain_url":                      REDIRECT_URL,
        "maintenance_announcement":          null,
        "maintenance_region":                null,
        "max_store":                         "",
        "max_video":                         "",
        "max_web":                           "",
        "min_hint_size":                     1,
        "multi_region":                      "BR",
        "need_check_ip_list":                ["202.81.108.9"],
        "need_track_hotupdate":              true,
        "network_log_server":                myDomain + "api/network_log",
        "notice_url":                        myDomain,
        "patchnote_url":                     "https://whatsapp.com/channel/0029VbBnIVuCMY0POm5gqO1P",
        "quality_level":                     0,
        "graphic_level":                     0,
        // remote_option_version disync ke versi yang sudah ada di cache client
        "remote_option_version":             "optionallocres:50|optionalavatarres:711|optionalclothres:1228|optionalfootballres:27|optionalfullscreencgres:319|optionalhuntinggroundres:246|optionalinfection:116|optionalingameres:438|optionallobbyres:640|optionallonewolfres:86|optionallonewolfstrikeoutres:59|optionalludores:42|optionalmap1res:385|optionalmap2res:156|optionalmap4res:139|optionalmaphippores:118|optionalmapres:357|optionalnewblast:163|optionalpetres:910|optionalrushb:108|optionalrushingpetsres:84|optionalsnowduelres:59|optionalsocialres:223|optionaltrainingres:297|optionalugcres:844|optionalvoiceres:344|optionalwerewolves:153|optionalwerunres:92|optionalmapponyres:204|optionalugcoldparadiseres:32|optionalmultiregionres:29",
        "remote_option_version_astc":        "optionallocres:50|optionalavatarres:711|optionalclothres:1228|optionalfootballres:27|optionalfullscreencgres:306|optionalhuntinggroundres:178|optionalinfection:116|optionalingameres:438|optionallobbyres:640|optionallonewolfres:206|optionallonewolfstrikeoutres:155|optionalludores:175|optionalmap1res:385|optionalmap2res:159|optionalmap4res:175|optionalmaphippores:92|optionalmapres:374|optionalnewblast:162|optionalpetres:910|optionalrushb:241|optionalrushingpetsres:217|optionalsnowduelres:59|optionalsocialres:215|optionaltrainingres:267|optionalugcres:786|optionalvoiceres:379|optionalwerewolves:286|optionalwerunres:74|optionalmapponyres:200|optionalugcoldparadiseres:32|optionalmultiregionres:27",
        "remote_version":                    "2.131.22",
        "res_url":                           myDomain + "live/ABHotUpdates/",
        // server_url = proxy domain (WAJIB, jangan diganti ke loginbp).
        //
        // Alur yang benar:
        // 1. game baca ver.php → server_url = proxy
        // 2. game konek proxy/MajorLogin → majorlogin.js intercept (registered sebelum catch-all)
        // 3. majorlogin.js forward ke loginbp → dapat MajorLoginRes binary
        // 4. MajorLoginRes binary di-patch: "clientbp.ggpolarbear.com" → proxy domain
        // 5. game konek proxy/GetLoginData → CECNLHCONMI deleted → GIN blind
        //
        // Kalau server_url = loginbp → game bypass proxy → MajorLoginRes tidak di-patch
        // → game konek clientbp langsung untuk GetLoginData → CECNLHCONMI TIDAK di-patch → GIN detect!
        "server_url":                        myDomain,
        "should_check_ab_exist":             true,
        "should_check_ab_load":              false,
        "should_check_ab_size":              true,
        "show_high_framerate_UI":            true,
        "space_required_in_GB":             1.48,
        "test_url":                          myDomain,
        "use_background_download":           false,
        "use_background_download_lobby":     false,
        "use_backgound_download_mem_thredshold": 2.79999995231628,
        "use_login_optional_download":       true,
        "use_multithread_hash":              true,
        "use_regional_gamevar":              true,
        "web_log_server":                    myDomain + "web_log",
        "web_url":                           "",
        "apply_skin":                        0,
    };
}

function init(app) {
    app.get('/ver.php', (req, res) => {
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const config   = getVerConfig(clientIp, MY_IP);
        console.log(`[GAMEVAR] /ver.php ip=${clientIp} bodyMode=${getConfig().bodyMode}`);
        res.json(config);
    });

    app.get('/api/gamevar', (req, res) => {
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const config   = getVerConfig(clientIp, MY_IP);
        console.log(`[GAMEVAR] /api/gamevar ip=${clientIp}`);
        res.json(config);
    });

    app.get('/localconfig.json', (req, res) => {
        const path = require('path');
        const fs   = require('fs');
        const fp   = path.join(__dirname, '..', 'public', 'cdn', 'localconfig.json');
        if (fs.existsSync(fp)) return res.sendFile(fp);
        res.json({ code: 0 });
    });

    console.log('[GAMEVAR] Active → /ver.php /api/gamevar /localconfig.json');
}

module.exports = { getVerConfig, getFullGamevarLines, gamevarNormalLines, ALLOWED_IPS, MY_IP, init };
