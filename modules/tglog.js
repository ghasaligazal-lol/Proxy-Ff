'use strict';
// modules/tglog.js

const https = require('https');
const keys  = require('./keys');

const BOT_TOKEN = process.env.TG_BOT_TOKEN || '8785327072:AAGYOdijJsrZk8d2bokk5u1r8Pz3YpxGk6Y';
const CHAT_ID   = process.env.TG_CHAT_ID   || '8223477911';

// ─── Queue kirim TG ──────────────────────────────────────────────────────────
const _queue = [];
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
        res.resume();
        // BUG FIX 1: Pastikan res body di-consume habis supaya _sending tidak stuck
        res.on('end', () => {
            _sending = false;
            setTimeout(_flush, 300);
        });
    });

    // BUG FIX 1: Socket timeout pada _flush — tanpa ini _sending bisa stuck true selamanya
    req.setTimeout(15000, () => {
        console.error('[TGLOG] _flush timeout, destroying request');
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

// send ke CHAT_ID default (untuk log server)
function send(text, parseMode = 'HTML') {
    if (!text) return;
    const truncated = text.length > 3800 ? text.substring(0, 3800) + '\n...[truncated]' : text;
    _queue.push({ chatId: CHAT_ID, text: truncated, parseMode });
    _flush();
}

// reply ke chat pengirim command
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
        req.setTimeout(30000, () => {
            req.destroy();
            resolve(null);
        });
        req.on('error', () => resolve(null));
        req.end();
    });
}

// ─── Command handler ──────────────────────────────────────────────────────────

// BUG FIX 2: parseInt(CHAT_ID) bisa NaN kalau CHAT_ID tidak valid.
// Pakai Number() + isNaN guard, fallback ke string-compare di isAdmin.
const _chatIdNum = Number(CHAT_ID);
const _adminIdValid = !isNaN(_chatIdNum) && _chatIdNum !== 0;
const ADMIN_IDS = _adminIdValid ? new Set([_chatIdNum]) : new Set();

function isAdmin(fromId) {
    // Kalau ADMIN_IDS kosong (env tidak valid), bandingkan string langsung
    if (ADMIN_IDS.size === 0) return String(fromId) === String(CHAT_ID);
    return ADMIN_IDS.has(fromId);
}

function msToHuman(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

function formatKeyEntry(e) {
    const now       = Date.now();
    const remaining = e.expires_at - now;
    const sisa      = remaining > 0 ? msToHuman(remaining) : 'EXPIRED';
    const status    = e.status === 'active' && remaining <= 0 ? 'expired' : e.status;
    return `<code>${e.key}</code>\n`
        + `  status: ${status} | sisa: ${sisa}\n`
        + `  open_id: ${e.open_id ? `<code>${e.open_id}</code>` : '—'}\n`
        + `  uid: ${e.last_uid || '—'} | note: ${e.note || '—'}`;
}

async function handleCommand(msg) {
    const text    = (msg.text || '').trim();
    const fromId  = msg.from?.id;
    const chatId  = msg.chat?.id;

    if (!isAdmin(fromId)) {
        reply(chatId, `❌ Akses ditolak.\nID lo: <code>${fromId}</code>`);
        return;
    }

    const parts   = text.split(/\s+/);
    const command = parts[0].replace(/^\//, '').split('@')[0].toLowerCase();
    const args    = parts.slice(1);

    if (command === 'generate' || command === 'gen') {
        // Usage: /generate [jam] [--key XXXX-XXXX-XXXX-XXXX] [--device N] [--ip N] [note...]
        // Contoh:
        //   /generate                    → auto key, 24 jam, unlimited
        //   /generate 48                 → auto key, 48 jam
        //   /generate 72 --device 2      → auto key, 72 jam, maks 2 device
        //   /generate 24 --ip 1 VIP      → auto key, 24 jam, maks 1 IP, note "VIP"
        //   /generate 48 --key ABCD-EFGH-IJKL-MNOP --device 3 note gw

        const GENERATE_USAGE =
            `📋 <b>Usage /generate:</b>\n\n`
            + `<code>/generate [jam] [--key XXXX-XXXX-XXXX-XXXX] [--device N] [--ip N] [note...]</code>\n\n`
            + `<b>Contoh:</b>\n`
            + `• <code>/generate</code> — auto key, 24 jam\n`
            + `• <code>/generate 48</code> — auto key, 48 jam\n`
            + `• <code>/generate 72 --device 2</code> — maks 2 device\n`
            + `• <code>/generate 24 --ip 1 VIP User</code> — maks 1 IP, note VIP User\n`
            + `• <code>/generate 48 --key ABCD-1234-EFGH-5678 --device 3</code> — custom key\n\n`
            + `<i>Semua flag opsional. Urutan bebas kecuali [jam] harus di awal jika dipakai. Default: 24 jam, unlimited device & IP.</i>`;

        // Parse args
        let hours = 24, maxDevice = 0, maxIp = 0, customKey = '';
        const noteWords = [];
        const errors = [];
        let i = 0;

        // Jam di posisi pertama (opsional)
        if (args.length > 0 && /^\d+$/.test(args[0])) {
            hours = parseInt(args[0]);
            i = 1;
        }

        while (i < args.length) {
            const arg = args[i];
            if (arg === '--device' || arg === '-d') {
                if (!args[i + 1] || !/^\d+$/.test(args[i + 1])) {
                    errors.push(`--device butuh angka, contoh: <code>--device 2</code>`);
                } else {
                    maxDevice = parseInt(args[i + 1]);
                }
                i += 2;
            } else if (arg === '--ip' || arg === '-i') {
                if (!args[i + 1] || !/^\d+$/.test(args[i + 1])) {
                    errors.push(`--ip butuh angka, contoh: <code>--ip 1</code>`);
                } else {
                    maxIp = parseInt(args[i + 1]);
                }
                i += 2;
            } else if (arg === '--key' || arg === '-k') {
                if (!args[i + 1]) {
                    errors.push(`--key butuh nilai, contoh: <code>--key ABCD-1234-EFGH-5678</code>`);
                } else {
                    customKey = args[i + 1].toUpperCase();
                    if (!keys.isValidKeyFormat(customKey)) {
                        errors.push(`Format --key salah. Harus: <code>XXXX-XXXX-XXXX-XXXX</code> (huruf/angka, 4 bagian, dipisah -).\nContoh: <code>--key ABCD-1234-EFGH-5678</code>`);
                        customKey = '';
                    }
                }
                i += 2;
            } else if (arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2)) {
                errors.push(`Flag tidak dikenal: <code>${arg}</code>. Flag yang valid: <code>--device</code>, <code>--ip</code>, <code>--key</code>`);
                i++;
            } else {
                noteWords.push(arg);
                i++;
            }
        }

        // Validasi durasi
        if (isNaN(hours) || hours < 1 || hours > 8760) {
            errors.push(`Durasi jam tidak valid: <code>${hours}</code>. Harus antara 1–8760.`);
        }

        // Ada error → kasih arahan
        if (errors.length > 0) {
            reply(chatId,
                `❌ <b>Command salah:</b>\n\n`
                + errors.map(e => `• ${e}`).join('\n')
                + `\n\n` + GENERATE_USAGE
            );
            return;
        }

        const note  = noteWords.join(' ');
        const entry = keys.create(hours, note, customKey, maxDevice, maxIp);
        if (entry.error) {
            reply(chatId,
                `❌ <b>Gagal buat key:</b> ${entry.error}\n\n`
                + GENERATE_USAGE
            );
            return;
        }

        const exp = new Date(entry.expires_at).toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
        reply(chatId,
            `✅ <b>Key dibuat</b>\n\n`
            + `🔑 <code>${entry.key}</code>\n\n`
            + `⏱ Durasi: ${hours} jam\n`
            + `📅 Expiry: ${exp}\n`
            + `📱 Max Device: ${maxDevice || '∞ (unlimited)'}\n`
            + `🌐 Max IP: ${maxIp || '∞ (unlimited)'}`
            + (note ? `\n📝 Note: ${note}` : '')
            + `\n\n<i>Kasih key ini ke user, minta aktivasi di website.</i>`
        );
        return;
    }

    if (command === 'list') {
        const filter  = (args[0] || 'all').toLowerCase();
        const entries = keys.list(filter);
        if (entries.length === 0) { reply(chatId, `📋 Tidak ada key dengan filter: <b>${filter}</b>`); return; }
        const batch = entries.slice(0, 10);
        const lines = [`📋 <b>Key List (${filter})</b> — ${entries.length} total\n`];
        for (const e of batch) lines.push(formatKeyEntry(e));
        if (entries.length > 10) lines.push(`\n<i>...dan ${entries.length - 10} lainnya</i>`);
        reply(chatId, lines.join('\n'));
        return;
    }

    if (command === 'revoke') {
        const key = (args[0] || '').toUpperCase();
        if (!key) { reply(chatId, 'Usage: /revoke XXXX-XXXX-XXXX-XXXX'); return; }
        const ok = keys.revoke(key);
        reply(chatId, ok ? `✅ Key <code>${key}</code> direvoke.` : `❌ Key <code>${key}</code> tidak ditemukan.`);
        return;
    }

    if (command === 'ban') {
        const openId = args[0] || '';
        if (!openId) { reply(chatId, 'Usage: /ban <open_id>'); return; }
        const db    = keys.getDb();
        const entry = Object.values(db).find(e => e.open_id === openId);
        if (!entry) { reply(chatId, `❌ open_id <code>${openId}</code> tidak terdaftar.`); return; }
        keys.revoke(entry.key);
        reply(chatId, `🔨 <b>BAN</b>\nopen_id: <code>${openId}</code>\nKey: <code>${entry.key}</code> → REVOKED`);
        return;
    }

    if (command === 'cleanup') {
        const count = keys.cleanup();
        reply(chatId, `🧹 Cleanup selesai. ${count} key dihapus (expired/revoked).`);
        return;
    }

    if (command === 'status') {
        const all     = keys.list('all');
        const active  = all.filter(e => e.status === 'active').length;
        const expired = all.filter(e => e.status === 'expired').length;
        const revoked = all.filter(e => e.status === 'revoked').length;
        const bound   = all.filter(e => e.open_id).length;
        reply(chatId, `📊 <b>Status Server</b>\n\n`
            + `Total key: ${all.length}\n`
            + `✅ Active: ${active}\n`
            + `⏰ Expired: ${expired}\n`
            + `🔨 Revoked: ${revoked}\n`
            + `🔗 Bound (punya open_id): ${bound}\n`
            + `\nKEY_VALIDATION: ${process.env.KEY_VALIDATION === '1' ? 'ON' : 'OFF'}`);
        return;
    }

    if (command === 'start' || command === 'help') {
        reply(chatId, `🤖 <b>Bot Commands</b>\n\n`
            + `/generate [jam] [--key XXXX-XXXX-XXXX-XXXX] [--device N] [--ip N] [note] — buat key\n`
            + `/gen — alias /generate\n`
            + `/list [all|active|expired|revoked] — lihat key\n`
            + `/revoke KEY — revoke key\n`
            + `/ban open_id — ban user by open_id\n`
            + `/cleanup — hapus key expired/revoked\n`
            + `/status — statistik server\n`
            + `/help — tampilkan ini`);
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

// ─── Middleware ───────────────────────────────────────────────────────────────
const LOG_PATHS = [
    '/MajorLogin', '/GetLoginData', '/auth/login', '/auth/logout',
    '/api/activate-key', '/api/check-device',
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
        if (isImportant) console.log(`[REQ] ${req.method} ${req.path} | ip=${clientIp} | ua=${(req.headers['user-agent'] || '').substring(0, 60)}`);
        const start = Date.now();
        res.on('finish', () => {
            if (isImportant) console.log(`[RES] ${req.method} ${req.path} | ${res.statusCode} | ${Date.now() - start}ms | ip=${clientIp}`);
        });
        next();
    });
}

module.exports = { init, send };
