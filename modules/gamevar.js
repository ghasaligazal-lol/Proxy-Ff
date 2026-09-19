'use strict';
// gamevar.js — OB55 FIXED
// BUG FIX: require('./modules/config') → require('./config') (path relatif dari dalam modules/)

function getConfig() {
    try {
        // FIX: always load fresh dari disk, bukan cache module
        // supaya perubahan dari dashboard langsung ngefek tanpa restart
        const cfgMod = require('./config');
        return cfgMod.load();
    } catch (_) {
        return { runSpeed: 6.0, sensi: {} };
    }
}

function getGamevarLines() {
    const cfg = getConfig();

    const lines = [
        "var_name,comment,var_type,var_value,var_region,var_platform",
        "var_name,comment,var_type,var_value,var_region,var_platform",

        // Base valid vars
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

        // Frame rate
        "ShowHighFrameRateSetting,ShowHighFrameRateSetting,bool,true,,",
        "Real60FrameSwitch,Real60FrameSwitch,bool,true,,",

        // Movement
        "SwapWeaponCD,SwapWeaponCD,float,0,,",
        "SwitchWeaponInterval,SwitchWeaponInterval,float,0,,",
        "FreeMoveAngularSpeed,FreeMoveAngularSpeed,float,9999.9,,",
        "FreeMoveAngularSpeedStand,FreeMoveAngularSpeedStand,float,9999.9,,",
        "FreeMoveAngularSpeedCrouch,FreeMoveAngularSpeedCrouch,float,9999.9,,",
        "FreeMoveAngularSpeedCreep,FreeMoveAngularSpeedCreep,float,9999.9,,",

        // Social unlock
        "EnableNewPlayerSocialFunction,EnableNewPlayerSocialFunction,bool,true,,",
        "NewPlayerSocialFunctionMaxLevel,NewPlayerSocialFunctionMaxLevel,int,0,,",
        "EnableSocialFunctionByLevel,EnableSocialFunctionByLevel,bool,false,,",
        "SocialFunctionUnlockLevel,SocialFunctionUnlockLevel,int,0,,",
        "EnableGroupInviteForNewPlayer,EnableGroupInviteForNewPlayer,bool,true,,",
        "NewbieGroupModeEnabled,NewbieGroupModeEnabled,bool,true,,",
        "EnableNewbieSquad,EnableNewbieSquad,bool,true,,",
        "DisableGroupForNewPlayer,DisableGroupForNewPlayer,bool,false,,",
        "NewPlayerGroupLimit,NewPlayerGroupLimit,int,0,,",
        "EnableTeamForNewAccount,EnableTeamForNewAccount,bool,true,,",

        // ANO disable
        "ANODisabledRegions,ANODisabledRegions,string,IND;NA;ID;BR;TH;SG;TW;VN;PK;EUROPE;ME;US;RU;SAC;ZA;BD,,",
        "ANODisabledClientVariant,ANODisabledClientVariant,string,ClientUsingVersion_MAX_HPE;ClientUsingVersion_FFI;ClientUsingVersion_MAX;ClientUsingVersion_NORMAL,,",
        "ANOEmulatorCheckDisbaledClientVariant,ANOEmulatorCheckDisbaledClientVariant,string,ClientUsingVersion_FFI;ClientUsingVersion_MAX;ClientUsingVersion_NORMAL,,",
        "EnableMtpLiteDataRegion,EnableMtpLiteDataRegion,string,,,",

        // OB55: FFM/FFO anticheat baru
        "EnableFFMCheat,EnableFFMCheat,bool,false,,",
        "EnableFFOCheat,EnableFFOCheat,bool,false,,",
        "EnableFFMDetect,EnableFFMDetect,bool,false,,",
        "EnableFFODetect,EnableFFODetect,bool,false,,",
        "FFMReportLevel,FFMReportLevel,int,0,,",
        "FFOReportLevel,FFOReportLevel,int,0,,",

        // OB55: connection seed disable
        "EnableConnectionSeed,EnableConnectionSeed,bool,false,,",
        "ConnectionSeedCheckLevel,ConnectionSeedCheckLevel,int,0,,",

        // GIN/GGP disable
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

        // Anticheat disable
        "CleanFFAntiState,CleanFFAntiState,bool,true,,",
        "FFAntihackDefenceLevel,FFAntihackDefenceLevel,string,0,,",
        "FFAntihackLightInitOnThread,FFAntihackLightInitOnThread,bool,false,,",
        "FFAntihackSDKDetailEncryptBySHA1,FFAntihackSDKDetailEncryptBySHA1,bool,false,,",
        "EnableFFAntihackInfoExtra,EnableFFAntihackInfoExtra,bool,false,,",
        "CheckHacker,CheckHacker,bool,false,,",
        "DebugHack,DebugHack,bool,false,,",
        "TestModeEnabled,TestModeEnabled,bool,false,,",
        "NeedProcessAH,NeedProcessAH,bool,false,,",
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

    // RunSpeed dynamic dari dashboard — default 6.0 kalau tidak diset
    const rs = (cfg.runSpeed !== null && cfg.runSpeed !== undefined && !isNaN(parseFloat(cfg.runSpeed)))
        ? parseFloat(cfg.runSpeed)
        : 6.0;  // FIX: default 6.0, dulu null = tidak di-inject sama sekali
    lines.push(`RunSpeed,,float,${rs},,`);

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
        "is_server_open":                       true,
        "is_review_server":                     false,
        "is_firewall_open":                     false,
        "force_to_restart_app":                 false,
        "is_update_btn_show":                   false,

        // ── Version ───────────────────────────────────────────────────────────
        "remote_version":                       gameVersion,
        "latest_release_version":               releaseVersion,

        // ── Optional resource versions (OB55 from log) ────────────────────────
        "remote_option_version":                "optionallocres:51|optionalavatarres:832|optionalclothres:1270|optionalfootballres:27|optionalfullscreencgres:319|optionalhuntinggroundres:246|optionalinfection:125|optionalingameres:516|optionallobbyres:667|optionallonewolfres:86|optionallonewolfstrikeoutres:59|optionalludores:42|optionalmap1res:391|optionalmap2res:156|optionalmap4res:139|optionalmaphippores:118|optionalmapres:360|optionalnewblast:163|optionalpetres:943|optionalrushb:108|optionalrushingpetsres:84|optionalsnowduelres:65|optionalsocialres:223|optionaltrainingres:302|optionalugcres:860|optionalvoiceres:349|optionalwerewolves:153|optionalwerunres:92|optionalmapponyres:204|optionalugcoldparadiseres:34|optionalmultiregionres:29",
        "remote_option_version_astc":           "optionallocres:51|optionalavatarres:794|optionalclothres:1270|optionalfootballres:29|optionalfullscreencgres:306|optionalhuntinggroundres:216|optionalinfection:124|optionalingameres:476|optionallobbyres:668|optionallonewolfres:206|optionallonewolfstrikeoutres:155|optionalludores:175|optionalmap1res:391|optionalmap2res:192|optionalmap4res:175|optionalmaphippores:120|optionalmapres:394|optionalnewblast:162|optionalpetres:943|optionalrushb:241|optionalrushingpetsres:217|optionalsnowduelres:65|optionalsocialres:215|optionaltrainingres:274|optionalugcres:802|optionalvoiceres:384|optionalwerewolves:286|optionalwerunres:81|optionalmapponyres:204|optionalugcoldparadiseres:33|optionalmultiregionres:27",

        // ── CDN ───────────────────────────────────────────────────────────────
        "cdn_url":                              "https://dl.gmc.freefiremobile.com/live/ABHotUpdates/",
        "abhotupdate_cdn_url":                  "https://core-gmc.freefiremobile.com/live/ABHotUpdates/",
        "abhotupdate_check":                    "cache_res;assetindexer;SH-Gpp;assembly-cssharp-patch",
        "backup_cdn_url":                       "https://dl.gmc.freefiremobile.com/live/ABHotUpdates/",
        "res_url":                              "https://dl.gmc.freefiremobile.com/live/ABHotUpdates/",
        "img_cdn_url":                          "https://dl.gmc.freefiremobile.com/common/",
        "cdn_active":                           "https://dl.gmc.freefiremobile.com/",
        "cdn_ip_list":                          [],
        "cdn_port":                             6072,

        // ── Server URLs (proxy intercept) ─────────────────────────────────────
        "server_url":                           myDomain,
        "notice_url":                           myDomain,
        "test_url":                             myDomain,
        "network_log_server":                   myDomain + "api/network_log",
        "web_log_server":                       myDomain + "web_log",

        // ── Anticheat (semua di-disable) ──────────────────────────────────────
        "anti_hack_open":                       false,
        "ggp_url":                              "",          // dari log: "gin.freefiremobile.com" → kita kosongkan
        "gop_url":                              "",

        // ── Billboard / patch notes ───────────────────────────────────────────
        "billboard_cdn_url":                    REDIRECT_URL,
        "billboard_msg":                        "",
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
        "need_check_ip_list":                   [],          // dari log: ["202.81.108.9"] → kita kosongkan
        "need_track_hotupdate":                 true,

        // ── Login ─────────────────────────────────────────────────────────────
        "free_guest_login":                     true,
        "guest_login":                          true,
        "garena_login":                         false,
        "garena_hint":                          false,
        "login_failed_count":                   2,           // OB55: 2 (sebelumnya 4)
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
        "show_high_framerate_UI":               false,       // OB55: false (sebelumnya true)
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

        // ── Gamevar (anticheat off + speed + sensi) ───────────────────────────
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
        const rs = config.gamevar.match(/RunSpeed,,float,([\d.]+)/);
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
