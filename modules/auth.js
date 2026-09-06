'use strict';
// modules/auth.js

const crypto = require('crypto');
const keys   = require('./keys');


const sessions = new Map(); // sessionId → { key, ip, expires }

function getClientIp(req) {
    const raw = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    return raw.split(',')[0].trim().replace('::ffff:', '');
}

function getSession(sessionId) {
    if (!sessionId) return null;
    const session = sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expires) {
        sessions.delete(sessionId);
        return null;
    }
    return session;
}

function checkAuth(req, res, next) {
    const sessionId = req.cookies?.sessionId || req.headers['x-session-id'];
    if (!sessionId) return res.status(401).json({ error: 'No session' });
    const session = getSession(sessionId);
    if (!session) return res.status(401).json({ error: 'Invalid or expired session' });
    req.session = session;
    next();
}

function parseBody(req) {
    let body = req.body;
    if (Buffer.isBuffer(body)) {
        try { body = JSON.parse(body.toString()); } catch (_) { body = {}; }
    }
    return body || {};
}

function init(app) {
    // ─── POST /auth/login ─────────────────────────────────────────────────────
    app.post('/auth/login', (req, res) => {
        const body     = parseBody(req);
        const inputKey = (body?.key || '').toString().trim();
        if (!inputKey) return res.json({ success: false, message: 'Key tidak boleh kosong' });

        const result = keys.check(inputKey);
        if (!result.valid) return res.json({ success: false, message: result.reason });

        const ip = getClientIp(req);

        // Cek IP limit
        const ipCheck = keys.checkIpLimit(inputKey, ip);
        if (!ipCheck.ok) return res.json({ success: false, message: ipCheck.reason });

        const sessionId = crypto.randomBytes(16).toString('hex');
        const expiresAt = result.entry.expires_at;

        sessions.set(sessionId, { key: inputKey, ip, expires: expiresAt });
        keys.markUsed(inputKey, ip, sessionId);

        console.log(`[AUTH] Login OK — key: ${inputKey} ip: ${ip}`);
        res.json({ success: true, sessionId, expires_at: expiresAt, remaining: Math.floor((expiresAt - Date.now()) / 1000) });
    });

    // ─── POST /api/activate-key ───────────────────────────────────────────────
    // User input key saja → aktivasi (tanpa open_id)
    app.post('/api/activate-key', (req, res) => {
        const body   = parseBody(req);
        const rawKey = (body?.key || '').toString().trim();
        const ip     = getClientIp(req);

        if (!rawKey) return res.json({ success: false, message: 'Key tidak boleh kosong' });

        const checkResult = keys.check(rawKey);
        if (!checkResult.valid) {
            console.log(`[ACTIVATE] FAIL key=${rawKey} reason=${checkResult.reason} ip=${ip}`);
            return res.json({ success: false, message: checkResult.reason });
        }

        // Cek IP limit
        const ipCheck = keys.checkIpLimit(rawKey, ip);
        if (!ipCheck.ok) {
            return res.json({ success: false, message: ipCheck.reason });
        }

        console.log(`[ACTIVATE] OK key=${rawKey} ip=${ip}`);

        try {
            require('./tglog').send(
                `🔗 <b>Key Activated</b>\n`
                + `Key: <code>${rawKey}</code>\n`
                + `IP: ${ip}`
            );
        } catch (_) {}

        const e = checkResult.entry;
        res.json({
            success:    true,
            message:    'Aktivasi berhasil! Kamu bisa login sekarang.',
            expires_at: e.expires_at,
            remaining:  Math.floor((e.expires_at - Date.now()) / 1000)
        });
    });


    // ─── GET /api/check-device ────────────────────────────────────────────────
    app.get('/api/check-device', (req, res) => {
        const openId = (req.query.open_id || '').toString().trim();
        if (!openId) return res.json({ registered: false, reason: 'No open_id' });

        const db    = keys.getDb();
        const entry = Object.values(db).find(e => e.open_id === openId);
        if (!entry) return res.json({ registered: false });

        const now       = Date.now();
        const remaining = entry.expires_at - now;
        res.json({
            registered: true,
            status:     remaining > 0 ? entry.status : 'expired',
            remaining:  Math.max(0, Math.floor(remaining / 1000))
        });
    });

    // ─── POST /auth/logout ────────────────────────────────────────────────────
    app.post('/auth/logout', (req, res) => {
        const sessionId = req.cookies?.sessionId || req.headers['x-session-id'];
        if (sessionId) sessions.delete(sessionId);
        res.json({ success: true });
    });

    // ─── GET /auth/status ─────────────────────────────────────────────────────
    app.get('/auth/status', (req, res) => {
        const sessionId = req.cookies?.sessionId || req.headers['x-session-id'];
        const session   = getSession(sessionId);
        if (!session) return res.json({ valid: false });
        res.json({ valid: true, key: session.key, expires_at: session.expires, remaining: Math.floor((session.expires - Date.now()) / 1000) });
    });

    // ─── GET /auth/checkkey ───────────────────────────────────────────────────
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
            note:       e.note || '',
            max_device: e.max_device || 0,
            max_ip:     e.max_ip || 0,
            bound:      !!e.open_id
        });
    });
}

module.exports = { init, checkAuth, getSession };
