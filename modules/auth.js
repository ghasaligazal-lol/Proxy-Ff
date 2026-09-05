'use strict';
// modules/auth.js
// Key validation — pakai keys.js sebagai backend
// POST /auth/login  { key }  → { success, sessionId }
// POST /auth/logout
// GET  /auth/status → { valid, expires_at, remaining }

const crypto = require('crypto');
const keys   = require('./keys');

const sessions = new Map(); // sessionId → { key, ip, expires }

function getClientIp(req) {
    const raw = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    return raw.split(',')[0].trim().replace('::ffff:', '');
}

function checkAuth(req, res, next) {
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });

    const session = sessions.get(sessionId);
    if (!session) return res.status(401).json({ error: 'Invalid session' });
    if (Date.now() > session.expires) {
        sessions.delete(sessionId);
        return res.status(401).json({ error: 'Session expired' });
    }

    req.session = session;
    next();
}

function init(app) {
    // POST /auth/login
    app.post('/auth/login', (req, res) => {
        let body = req.body;
        // Support binary body yang masuk sebagai Buffer
        if (Buffer.isBuffer(body)) {
            try { body = JSON.parse(body.toString()); } catch (_) { body = {}; }
        }

        const inputKey = (body?.key || '').toString().trim();
        if (!inputKey) {
            return res.json({ success: false, message: 'Key tidak boleh kosong' });
        }

        const result = keys.check(inputKey);
        if (!result.valid) {
            return res.json({ success: false, message: result.reason });
        }

        const sessionId = crypto.randomBytes(16).toString('hex');
        const ip        = getClientIp(req);
        const expiresAt = result.entry.expires_at;

        sessions.set(sessionId, { key: inputKey, ip, expires: expiresAt });
        keys.markUsed(inputKey, ip, sessionId);

        console.log(`[AUTH] Login OK — key: ${inputKey} ip: ${ip}`);
        res.json({
            success:    true,
            sessionId,
            expires_at: expiresAt,
            remaining:  Math.floor((expiresAt - Date.now()) / 1000)
        });
    });

    // POST /auth/logout
    app.post('/auth/logout', (req, res) => {
        const sessionId = req.cookies?.sessionId || req.headers['x-session-id'];
        if (sessionId) sessions.delete(sessionId);
        res.json({ success: true });
    });

    // GET /auth/status
    app.get('/auth/status', (req, res) => {
        const sessionId = req.cookies?.sessionId || req.headers['x-session-id'];
        if (!sessionId || !sessions.has(sessionId)) {
            return res.json({ valid: false });
        }
        const session = sessions.get(sessionId);
        if (Date.now() > session.expires) {
            sessions.delete(sessionId);
            return res.json({ valid: false, reason: 'expired' });
        }
        res.json({
            valid:      true,
            key:        session.key,
            expires_at: session.expires,
            remaining:  Math.floor((session.expires - Date.now()) / 1000)
        });
    });

    // GET /auth/checkkey?key=XXXX-XXXX-XXXX-XXXX (buat cek dari luar)
    app.get('/auth/checkkey', (req, res) => {
        const inputKey = (req.query.key || '').toString().trim();
        if (!inputKey) return res.json({ valid: false, reason: 'No key' });
        const result = keys.check(inputKey);
        if (!result.valid) return res.json({ valid: false, reason: result.reason });
        const e = result.entry;
        res.json({
            valid:      true,
            expires_at: e.expires_at,
            remaining:  Math.floor((e.expires_at - Date.now()) / 1000),
            note:       e.note || ''
        });
    });
}

module.exports = { init, checkAuth };
