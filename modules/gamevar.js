'use strict';

// Normal gamevar/config endpoint. No disable, bypass, or feature modification.
const PROXY_URL = (process.env.PROXY_URL || '').replace(/\/$/, '');
const LOGIN_SERVER = 'https://loginbp.ggpolarbear.com/';
const CLIENT_SERVER = 'https://loginbp.ppmainecoonghj.com/';
const CDN_SERVER = 'https://dl.aw.freefiremobile.com/live/ABHotUpdates/';

// This is the normal gamevar block observed in the supplied reference log.
const NORMAL_GAMEVAR = [
  'var_name,comment,var_type,var_value,var_region,var_platform',
  'var_name,comment,var_type,var_value,var_region,var_platform',
  'LoadGppLibSOToABHotUpdate,LoadGppLibSOToABHotUpdate,bool,true,,',
  'EnableReplaceGGPSO,EnableReplaceGGPSO,bool,true,,',
  'EnableReplaceGGPSO_2022,EnableReplaceGGPSO_2022,bool,true,,',
  'DelGameObjectTypeSet,DelGameObjectTypeSet,int,0,,ios',
  'UseCompactForBaseObjectMgr,UseCompactForBaseObjectMgr,int,0,,ios',
  'Enable2018ABstreamed,Enable2018ABstreamed,bool,false,,ios',
  ''
].join('\n');

function makeVerConfig(req) {
  const version = req.query.version || '1.132.8';
  const release = req.query.release_version || 'OB55';
  const region = req.query.region || 'ID';
  const proxyBase = PROXY_URL ? PROXY_URL + '/' : '';

  return {
    code: 0,
    is_server_open: true,
    is_review_server: false,
    is_firewall_open: false,
    force_to_restart_app: false,
    is_update_btn_show: false,
    remote_version: version,
    latest_release_version: release,
    cdn_url: CDN_SERVER,
    backup_cdn_url: CDN_SERVER,
    res_url: CDN_SERVER,
    img_cdn_url: 'https://dl.aw.freefiremobile.com/common/',
    server_url: LOGIN_SERVER,
    network_log_server: 'https://idnetwork.ggblueshark.com/',
    web_log_server: 'https://networkselftest.ff.garena.com/api/',
    test_url: 'https://dl.cvs.freefiremobile.com/live/ABHotUpdates/nettest',
    client_ip: req.ip || '',
    country_code: region,
    ggp_url: 'gin.freefiremobile.com',
    gamevar: NORMAL_GAMEVAR,
    abhotupdate_check: 'cache_res;assetindexer;SH-Gpp;assembly-cssharp-patch',
    hotfile_force_update: true,
    need_track_hotupdate: true,
    use_multithread_hash: true,
    should_check_ab_load: false,
    should_check_ab_exist: true,
    use_regional_gamevar: true,
    enable_hash_pdcache: true,
    should_check_ab_size: true,
    multi_region: '',
    anti_hack_open: true,
    gop_url: '',
    billboard_msg: '',
    billboard_bg_url: 'https://dl.cdn.freefiremobile.com/common/OB23/version/Patch_Bg.png',
    patchnote_url: '',
    // Only use the proxy hotpatch path when PROXY_URL is explicitly configured.
    ...(proxyBase ? { abhotupdate_cdn_url: proxyBase + 'hotpatchs/' } : { abhotupdate_cdn_url: CDN_SERVER }),
  };
}

function init(app) {
  const handler = (req, res) => {
    const cfg = makeVerConfig(req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    console.log(`[GAMEVAR] normal ver.php v=${req.query.version || '?'} region=${req.query.region || '?'}`);
    return res.status(200).json(cfg);
  };

  app.get('/lamdo/ver.php', handler);
  app.get('/ver.php', handler);
  console.log('[GAMEVAR] Normal config active — no disable/bypass/modification flags');
}

module.exports = { init };
