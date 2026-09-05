'use strict';
// modules/keys.js
// Engine penyimpanan key — pakai JSON flat file di db/keys.json
// Ga butuh PHP atau database eksternal

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYS_FILE = path.join(__dirname, '..', 'db', 'keys.json');

// ============ LOAD / SAVE ============
function _load() {
    try {
        if (fs.existsSync(KEYS_FILE)) {
            return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
        }
    } catch (_) {}
    return {};
}

function _save(data) {
    try {
        const dir = path.dirname(KEYS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.log(`[KEYS] Save error: ${e.message}`);
    }
}

// ============ GENERATE KEY ============
// Format: XXXX-XXXX-XXXX-XXXX (uppercase, no confusing chars)
function generateKey() {
    const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const parts = [];
    for (let i = 0; i < 4; i++) {
        let part = '';
        for (let j = 0; j < 4; j++) {
            part += pool[Math.floor(Math.random() * pool.length)];
        }
        parts.push(part);
    }
    return parts.join('-');
}

// ============ PUBLIC API ============

/**
 * Buat key baru
 * @param {number} durationHours - berapa jam key valid (default 24)
 * @param {string} note - catatan opsional (nama pembeli dll)
 * @returns {{ key, expires_at, duration_hours, note }}
 */
function create(durationHours = 24, note = '') {
    const db = _load();

    let key;
    let attempt = 0;
    do {
        key = generateKey();
        attempt++;
    } while (db[key] && attempt < 20);

    const now = Date.now();
    const expires = now + durationHours * 3600 * 1000;

    db[key] = {
        key,
        created_at: now,
        expires_at: expires,
        duration_hours: durationHours,
        status: 'active',
        note,
        used_by_ip: null,
        session_id: null,
        last_used: null,
        usage_count: 0
    };

    _save(db);
    return db[key];
}

/**
 * Cek apakah key valid
 * @returns {{ valid: boolean, reason?: string, entry?: object }}
 */
function check(key) {
    const db = _load();
    key = (key || '').toUpperCase().trim();
    const entry = db[key];

    if (!entry) return { valid: false, reason: 'Key tidak ditemukan' };
    if (entry.status === 'revoked') return { valid: false, reason: 'Key sudah direvoke' };
    if (Date.now() > entry.expires_at) {
        // Auto-update status
        if (entry.status === 'active') {
            entry.status = 'expired';
            db[key] = entry;
            _save(db);
        }
        return { valid: false, reason: 'Key sudah expired' };
    }
    if (entry.status !== 'active') return { valid: false, reason: `Status: ${entry.status}` };

    return { valid: true, entry };
}

/**
 * Tandai key dipakai oleh session
 */
function markUsed(key, ip, sessionId) {
    const db = _load();
    key = (key || '').toUpperCase().trim();
    if (!db[key]) return;
    db[key].used_by_ip = ip;
    db[key].session_id = sessionId;
    db[key].last_used  = Date.now();
    db[key].usage_count = (db[key].usage_count || 0) + 1;
    _save(db);
}

/**
 * Revoke key
 */
function revoke(key) {
    const db = _load();
    key = (key || '').toUpperCase().trim();
    if (!db[key]) return false;
    db[key].status = 'revoked';
    _save(db);
    return true;
}

/**
 * List semua key (dengan filter opsional)
 * @param {'all'|'active'|'expired'|'revoked'} filter
 */
function list(filter = 'all') {
    const db = _load();
    const now = Date.now();
    return Object.values(db)
        .map(entry => {
            // Auto-compute status
            if (entry.status === 'active' && now > entry.expires_at) {
                entry.status = 'expired';
            }
            return entry;
        })
        .filter(entry => filter === 'all' || entry.status === filter)
        .sort((a, b) => b.created_at - a.created_at);
}

/**
 * Hapus key yang sudah expired/revoked (cleanup)
 */
function cleanup() {
    const db = _load();
    const now = Date.now();
    let count = 0;
    for (const key of Object.keys(db)) {
        const e = db[key];
        if (e.status === 'revoked' || now > e.expires_at) {
            delete db[key];
            count++;
        }
    }
    _save(db);
    return count;
}

module.exports = { create, check, markUsed, revoke, list, cleanup };
