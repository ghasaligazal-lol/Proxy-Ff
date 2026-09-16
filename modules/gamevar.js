'use strict';
// gamevar.js — OB55 FIXED
// BUG FIX: require('./modules/config') → require('./config') (path relatif dari dalam modules/)

let _cfg = null;
function getConfig() {
    if (!_cfg) {
        try { _cfg = require('./config'); } catch (_) { _cfg = null; }  // FIX: was './modules/config'
    }
    return _cfg ? _cfg.load() : { runSpeed: 6.0, sensi: {} };
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

function getVerConfig(clientIp = '74.125.24.139', myDomain = MY_IP, gameVersion = null, releaseVersion = null) {
    return {
        "abhotupdate_cdn_url":               "https://core-gmc.freefiremobile.com/live/ABHotUpdates/",
        "abhotupdate_check":                 "",
        "anti_hack_open":                    false,
        "appstore_url":                      REDIRECT_URL,
        "backup_appstore_url":               "",
        "backup_cdn_url":                    "https://dl.gmc.freefiremobile.com/live/ABHotUpdates/",
        "billboard_bg_url":                  "https://dl.cdn.freefiremobile.com/common/OB23/version/Patch_Bg.png",
        "billboard_cdn_url":                 REDIRECT_URL,
        "billboard_msg":                     "",
        "cdn_active":                        "https://dl.gmc.freefiremobile.com/",
        "cdn_ip_list":                       [],
        "cdn_port":                          6072,
        "cdn_url":                           "https://dl.gmc.freefiremobile.com/live/ABHotUpdates/",
        "client_ip":                         clientIp,
        "code":                              0,
        "core_ip_list":                      ["0.0.0.0","50.109.27.134","129.226.2.163","129.226.1.13","129.226.1.16"],
        "core_url":                          "csoversea.castle.freefiremobile.com",
        "country_code":                      "ID",
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
        "gamevar":                           getGamevarLines().join("\n"),
        "garena_hint":                       false,
        "garena_login":                      false,
        "gdpr_version":                      1,
        "ggp_url":                           "",
        "gop_url":                           "",
        "grey_update_percent":               0,
        "guest_login":                       true,
        "high_frame_default":                0,
        "hotfile_force_update":              true,
        "hs_config":                         { "nome": "", "porta": 6072 },
        "img_cdn_url":                       "https://dl.gmc.freefiremobile.com/common/",
        "is_firewall_open":                  false,
        "is_review_server":                  false,
        "is_server_open":                    true,
        "is_update_btn_show":                false,
        "is_use_multi_download":             true,
        "latest_release_version":            releaseVersion || "OB55",
        "login_download_optionalpack":       "optionalclothres:shaders|optionalpetres:optionalpetres_commonab_shader|optionallobbyres:",
        "login_failed_count":                4,
        "login_notice":                      "Welcome to Proxy Server!",
        "maintain_msg":                      "",
        "maintain_url":                      REDIRECT_URL,
        "maintenance_announcement":          null,
        "maintenance_region":                null,
        "max_store":                         "",
        "max_video":                         "",
        "max_web":                           "",
        "min_hint_size":                     1,
        "multi_region":                      "ID",
        "need_check_ip_list":                [],
        "need_track_hotupdate":              true,
        "network_log_server":                myDomain + "api/network_log",
        "notice_url":                        myDomain,
        "patchnote_url":                     "https://whatsapp.com/channel/0029VbBnIVuCMY0POm5gqO1P",
        "quality_level":                     0,
        "graphic_level":                     0,
        "remote_option_version":             "optionallocres:51|optionalavatarres:744|optionalclothres:1187|optionalfootballres:47|optionalfullscreencgres:334|optionalhuntinggroundres:178|optionalinfection:121|optionalingameres:480|optionallobbyres:634|optionallonewolfres:77|optionallonewolfstrikeoutres:23|optionalludores:40|optionalmap1res:391|optionalmap2res:125|optionalmap4res:110|optionalmaphippores:90|optionalmapres:343|optionalnewblast:138|optionalpetres:876|optionalrushb:123|optionalrushingpetsres:88|optionalsnowduelres:59|optionaltrainingres:88|optionalugcres:551|optionalvoiceres:360|optionalwerewolves:173|optionalmapponyres:200|optionalsocialres:111|optionalwerunres:83|optionalugcoldparadiseres:32|optionalmultiregionres:25",
        "remote_option_version_astc":        "optionallocres:51|optionalavatarres:747|optionalclothres:1187|optionalfootballres:38|optionalfullscreencgres:318|optionalhuntinggroundres:178|optionalinfection:116|optionalingameres:449|optionallobbyres:617|optionallonewolfres:139|optionallonewolfstrikeoutres:96|optionalludores:144|optionalmap1res:391|optionalmap2res:159|optionalmap4res:144|optionalmaphippores:92|optionalmapres:377|optionalnewblast:138|optionalpetres:876|optionalrushb:227|optionalrushingpetsres:192|optionalsnowduelres:59|optionaltrainingres:84|optionalugcres:521|optionalvoiceres:393|optionalwerewolves:277|optionalmapponyres:200|optionalsocialres:106|optionalwerunres:74|optionalugcoldparadiseres:32|optionalmultiregionres:26",
        "remote_version":                    gameVersion || "2.132.3",
        "res_url":                           "https://dl.gmc.freefiremobile.com/live/ABHotUpdates/",
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
