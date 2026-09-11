'use strict';
// gamevar.js — Speed + Sensi ONLY mode
// Mode ini hanya inject RunSpeed dan Sensitivity.
// Tidak ada cache_res patch → game download asset dari Garena resmi.
// GIN/anticheat disable tetap ada (wajib untuk bypass).

let _cfg = null;
function getConfig() {
    if (!_cfg) {
        try { _cfg = require('./modules/config'); } catch (_) { _cfg = null; }
    }
    return _cfg ? _cfg.load() : { runSpeed: null, sensi: {} };
}

// ── Gamevar lines ─────────────────────────────────────────────────────────────
// Hanya var yang valid dikenal client. RunSpeed + Sensi di-inject dynamic dari config.
function getGamevarLines() {
    const cfg = getConfig();

    const lines = [
        "var_name,comment,var_type,var_value,var_region,var_platform",
        "var_name,comment,var_type,var_value,var_region,var_platform",

        // ── Base valid vars ──────────────────────────────────────────────────
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

        // ── Movement base ────────────────────────────────────────────────────
        "SwapWeaponCD,SwapWeaponCD,float,0,,",
        "SwitchWeaponInterval,SwitchWeaponInterval,float,0,,",
        "FreeMoveAngularSpeed,FreeMoveAngularSpeed,float,9999.9,,",
        "FreeMoveAngularSpeedStand,FreeMoveAngularSpeedStand,float,9999.9,,",
        "FreeMoveAngularSpeedCrouch,FreeMoveAngularSpeedCrouch,float,9999.9,,",
        "FreeMoveAngularSpeedCreep,FreeMoveAngularSpeedCreep,float,9999.9,,",

        // ── Social unlock (akun baru bisa squad langsung) ───────────────────
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

        // ── ANO disable ──────────────────────────────────────────────────────
        "ANODisabledRegions,ANODisabledRegions,string,IND;NA;ID;BR;TH;SG;TW;VN;PK;EUROPE;ME;US;RU;SAC;ZA;BD,,",
        "ANODisabledClientVariant,ANODisabledClientVariant,string,ClientUsingVersion_MAX_HPE;ClientUsingVersion_FFI;ClientUsingVersion_MAX;ClientUsingVersion_NORMAL,,",
        "ANOEmulatorCheckDisbaledClientVariant,ANOEmulatorCheckDisbaledClientVariant,string,ClientUsingVersion_FFI;ClientUsingVersion_MAX;ClientUsingVersion_NORMAL,,",
        "EnableMtpLiteDataRegion,EnableMtpLiteDataRegion,string,,,",

        // ── GIN/GGP disable (wajib) ─────────────────────────────────────────
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

    // ── Sensitivity (dynamic dari dashboard) ────────────────────────────────
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

    // ── RunSpeed (dynamic dari dashboard) ───────────────────────────────────
    if (cfg.runSpeed !== null && cfg.runSpeed !== undefined) {
        lines.push(`RunSpeed,,float,${cfg.runSpeed},,`);
    }

    return lines;
}

// ============================================================
const MY_IP       = process.env.PROXY_URL || 'https://proxy-reza-kontolodon-memek-luu.up.railway.app/';
const REDIRECT_URL = 'https://whatsapp.com/channel/0029Vb8eX0Z1NCrYCXEXuu0K';

function getVerConfig(clientIp = '74.125.24.139', myDomain = MY_IP) {
    return {
        "abhotupdate_cdn_url":               "https://core-gmc.freefiremobile.com/live/ABHotUpdates/",
        // speed_sensi mode: tidak override cache_res → game download dari Garena resmi
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
        "latest_release_version":            "OB54",
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
        "multi_region":                      "BR",
        "need_check_ip_list":                [],
        "need_track_hotupdate":              true,
        "network_log_server":                myDomain + "api/network_log",
        "notice_url":                        myDomain,
        "patchnote_url":                     "https://whatsapp.com/channel/0029VbBnIVuCMY0POm5gqO1P",
        "quality_level":                     0,
        "graphic_level":                     0,
        "remote_option_version":             "optionallocres:50|optionalavatarres:791|optionalclothres:1228|optionalfootballres:27|optionalfullscreencgres:319|optionalhuntinggroundres:246|optionalinfection:125|optionalingameres:503|optionallobbyres:640|optionallonewolfres:86|optionallonewolfstrikeoutres:59|optionalludores:42|optionalmap1res:385|optionalmap2res:156|optionalmap4res:139|optionalmaphippores:118|optionalmapres:357|optionalnewblast:163|optionalpetres:910|optionalrushb:108|optionalrushingpetsres:84|optionalsnowduelres:65|optionalsocialres:223|optionaltrainingres:297|optionalugcres:844|optionalvoiceres:344|optionalwerewolves:153|optionalwerunres:92|optionalmapponyres:204|optionalugcoldparadiseres:34|optionalmultiregionres:29",
        "remote_option_version_astc":        "optionallocres:50|optionalavatarres:753|optionalclothres:1228|optionalfootballres:29|optionalfullscreencgres:306|optionalhuntinggroundres:216|optionalinfection:124|optionalingameres:461|optionallobbyres:640|optionallonewolfres:206|optionallonewolfstrikeoutres:155|optionalludores:175|optionalmap1res:385|optionalmap2res:192|optionalmap4res:175|optionalmaphippores:120|optionalmapres:391|optionalnewblast:162|optionalpetres:910|optionalrushb:241|optionalrushingpetsres:217|optionalsnowduelres:65|optionalsocialres:215|optionaltrainingres:267|optionalugcres:786|optionalvoiceres:379|optionalwerewolves:286|optionalwerunres:81|optionalmapponyres:204|optionalugcoldparadiseres:33|optionalmultiregionres:27",
        "remote_version":                    "1.130.22",
        "res_url":                           "https://dl.gmc.freefiremobile.com/live/ABHotUpdates/",
        "server_url":                        "https://loginbp.ggpolarbear.com/",
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
        console.log(`[GAMEVAR] /ver.php ip=${clientIp}`);
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
        const cfg = {
            verAddr:       MY_IP,
            resetGuest:    true,
            testCodePatch: false   // speed_sensi: tidak load Assembly patch
        };
        res.setHeader('Content-Type', 'application/json');
        res.json(cfg);
    });

    console.log('[GAMEVAR] Active → /ver.php /api/gamevar /localconfig.json (speed+sensi mode)');
}

module.exports = { getVerConfig, getGamevarLines, MY_IP, init };
