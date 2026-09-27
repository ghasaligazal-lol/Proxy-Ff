'use strict';
// modules/gamevar.js — serve /lamdo/ver.php
// Return gamevar yang sama dengan server referensi (mrlightvn.fun/lamdo/ver.php)
// Berdasarkan log target: MajorLogin → loginbp.ggpolarbear.com (asli),
// GetLoginData → clientbp.ppmainecoonghj.com (asli / dari MajorLogin response).
// GIN + GRTC dibiarkan aktif (pure passthrough, tidak di-patch).

const PROXY_URL   = (process.env.PROXY_URL || 'https://proxy-reza-kontolodon-memek-luu.up.railway.app').replace(/\/$/, '');

// Server asli Garena — game akan connect ke sini (via AdAway redirect ke proxy untuk MajorLogin)
const LOGIN_SERVER  = 'https://loginbp.ggpolarbear.com';
const CLIENT_SERVER = 'https://clientbp.ppmainecoonghj.com';
const CDN_URL       = 'https://dl.cdn.freefiremobile.com/live/ABHotUpdates/';

function makeGamevar(req) {
    // ABHotUpdates CDN → proxy sendiri (untuk serve hotpatchs/codepatch)
    const abHotUpdateCdn = PROXY_URL + '/hotpatchs/';

    return {
        // Login server → asli (AdAway redirect ke proxy, proxy passthrough)
        login_url:             LOGIN_SERVER,
        // Client server → asli (dari MajorLogin response server_url)
        server_url:            CLIENT_SERVER,
        // CDN URLs
        cdn_url:               CDN_URL,
        abhotupdate_cdn_url:   abHotUpdateCdn,
        // Anti-cheat: biarkan default (tidak di-disable supaya tidak terdeteksi)
        anti_hack_url:         '',
        tp_url:                '',
        // Versi
        version:               req.query.version || '1.132.8',
        // Feature flags — ikuti log target (semua default/normal)
        force_update:          false,
        maintenance:           false,
        // Extra fields yang mungkin dibaca game
        whitelist_url:         '',
        report_url:            '',
    };
}

function init(app) {
    // /lamdo/ver.php — game request ini via verAddr dari localconfig.json
    app.get('/lamdo/ver.php', (req, res) => {
        const gv = makeGamevar(req);
        const ver = req.query.version || '?';
        const region = req.query.region || '?';
        console.log(`[GAMEVAR] ver.php v=${ver} region=${region}`);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        return res.status(200).json(gv);
    });

    // Alias kalau ada yang request /ver.php langsung
    app.get('/ver.php', (req, res) => {
        const gv = makeGamevar(req);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        return res.status(200).json(gv);
    });

    console.log(`[GAMEVAR] Active — PROXY_URL=${PROXY_URL}`);
}

module.exports = { init };
