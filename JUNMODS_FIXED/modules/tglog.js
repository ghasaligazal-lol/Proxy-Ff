'use strict';
// modules/tglog.js
// Key/generate commands DIHAPUS — hanya terima notifikasi login

const https = require('https');

const BOT_TOKEN = process.env.TG_BOT_TOKEN || '8785327072:AAGYOdijJsrZk8d2bokk5u1r8Pz3YpxGk6Y';
const CHAT_ID   = process.env.TG_CHAT_ID   || '8223477911';

// ─── Queue kirim TG ──────────────────────────────────────────────────────────
const _queue  = [];
let _sending  = false;

function _flush() {
    if (_sending || _queue.length === 0) return;
    _sending = true;
    const { chatId, text, parseMode } = _queue.shift();
    const body    = JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode || 'HTML' });
    const options = {
        hostname: 'api.telegram.org',
        path:     `/bot${BOT_TOKEN}/sendMessage`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
        // Drain body supaya socket tidak stuck
        res.resume();
        res.on('end', () => {
            _sending = false;
            setTimeout(_flush, 300);
        });
    });

    req.setTimeout(15000, () => {
        console.error('[TGLOG] Timeout, destroying request');
        req.destroy();
        _sending = false;
        setTimeout(_flush, 2000);
    });

    req.on('error', err => {
        console.error('[TGLOG] Send error:', err.message);
        _sending = false;
        setTimeout(_flush, 1000);
    });
    req.write(body);
    req.end();
}

// Kirim ke CHAT_ID default
function send(text, parseMode = 'HTML') {
    if (!text) return;
    const truncated = text.length > 3800 ? text.substring(0, 3800) + '\n...[truncated]' : text;
    _queue.push({ chatId: CHAT_ID, text: truncated, parseMode });
    _flush();
}

// Reply ke chat tertentu
function reply(toChatId, text, parseMode = 'HTML') {
    if (!text) return;
    const truncated = text.length > 3800 ? text.substring(0, 3800) + '\n...[truncated]' : text;
    _queue.push({ chatId: String(toChatId), text: truncated, parseMode });
    _flush();
}

// ─── Bot API helper ───────────────────────────────────────────────────────────
function apiGet(method, params = {}) {
    return new Promise((resolve) => {
        const qs      = new URLSearchParams(params).toString();
        const options = {
            hostname: 'api.telegram.org',
            path:     `/bot${BOT_TOKEN}/${method}${qs ? '?' + qs : ''}`,
            method:   'GET'
        };
        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
                catch (_) { resolve(null); }
            });
        });
        req.setTimeout(30000, () => { req.destroy(); resolve(null); });
        req.on('error', () => resolve(null));
        req.end();
    });
}

// ─── Admin check ──────────────────────────────────────────────────────────────
const _chatIdNum    = Number(CHAT_ID);
const _adminIdValid = !isNaN(_chatIdNum) && _chatIdNum !== 0;
const ADMIN_IDS     = _adminIdValid ? new Set([_chatIdNum]) : new Set();

function isAdmin(fromId) {
    if (ADMIN_IDS.size === 0) return String(fromId) === String(CHAT_ID);
    return ADMIN_IDS.has(fromId);
}

// ─── Command handler (hanya status & help) ───────────────────────────────────
async function handleCommand(msg) {
    const text   = (msg.text || '').trim();
    const fromId = msg.from?.id;
    const chatId = msg.chat?.id;

    if (!isAdmin(fromId)) {
        reply(chatId, `❌ Akses ditolak.\nID lo: <code>${fromId}</code>`);
        return;
    }

    const parts   = text.split(/\s+/);
    const command = parts[0].replace(/^\//, '').split('@')[0].toLowerCase();

    if (command === 'status') {
        reply(chatId,
            `📊 <b>Status Server</b>\n\n`
            + `✅ Proxy: Online\n`
            + `🔓 Key Validation: OFF (semua open_id diizinkan)\n`
            + `🤖 Bot: Active\n`
            + `⏰ Uptime: ${Math.floor(process.uptime() / 60)}m`
        );
        return;
    }

    if (command === 'start' || command === 'help') {
        reply(chatId,
            `🤖 <b>Bot Commands</b>\n\n`
            + `/status — status server\n`
            + `/help — tampilkan ini\n\n`
            + `<i>Notifikasi login masuk otomatis ke sini.</i>`
        );
        return;
    }
}

// ─── Long Polling ─────────────────────────────────────────────────────────────
let _lastUpdateId = 0;
let _pollBackoff  = 0;

async function _poll() {
    const result = await apiGet('getUpdates', {
        offset:          _lastUpdateId + 1,
        timeout:         20,
        allowed_updates: JSON.stringify(['message'])
    });

    if (result && result.ok && Array.isArray(result.result)) {
        _pollBackoff = 0;
        for (const update of result.result) {
            if (update.update_id > _lastUpdateId) _lastUpdateId = update.update_id;
            if (update.message?.text?.startsWith('/')) {
                handleCommand(update.message).catch(err =>
                    console.error('[TGLOG] Command error:', err.message)
                );
            }
        }
        setImmediate(_poll);
    } else {
        _pollBackoff = Math.min(_pollBackoff + 2000, 30000);
        console.error(`[TGLOG] Poll failed, retry in ${_pollBackoff}ms`);
        setTimeout(_poll, _pollBackoff);
    }
}

// ─── Middleware (request logging) ─────────────────────────────────────────────
const LOG_PATHS = [
    '/MajorLogin', '/GetLoginData',
    '/ver.php', '/api/gamevar',
];

function init(app) {
    console.log(`[TGLOG] Active → chat ${CHAT_ID}`);
    _poll().catch(err => console.error('[TGLOG] Poll start error:', err.message));
    console.log('[TGLOG] Bot polling started');

    app.use((req, res, next) => {
        const rawIp       = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp    = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const isImportant = LOG_PATHS.some(p => req.path === p || req.path.startsWith(p));
        if (isImportant) {
            const start = Date.now();
            console.log(`[REQ] ${req.method} ${req.path} | ip=${clientIp} | ua=${(req.headers['user-agent'] || '').substring(0, 60)}`);
            res.on('finish', () => {
                console.log(`[RES] ${req.method} ${req.path} | ${res.statusCode} | ${Date.now() - start}ms | ip=${clientIp}`);
            });
        }
        next();
    });
}

module.exports = { init, send };
