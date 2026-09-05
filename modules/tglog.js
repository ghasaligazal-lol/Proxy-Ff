'use strict';
// modules/tglog.js
// Kirim log [MAJORLOGIN] otomatis ke Telegram

const https = require('https');

const BOT_TOKEN = process.env.TG_BOT_TOKEN || '8614102278:AAEU5S0VR4J7q1CRu6G5taIF-jifiB4zDMo';
const CHAT_ID   = process.env.TG_CHAT_ID   || '7711546886';

function send(text) {
    const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
    const options = {
        hostname: 'api.telegram.org',
        path:     `/bot${BOT_TOKEN}/sendMessage`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
        // silent — ga perlu handle response
        res.resume();
    });
    req.on('error', err => console.error('[TGLOG] Send error:', err.message));
    req.write(body);
    req.end();
}

function init(app) {
    console.log('[TGLOG] Telegram log active → chat', CHAT_ID);
}

module.exports = { init, send };
