'use strict';
// modules/keys.js

const fs   = require('fs');
const path = require('path');

const KEYS_FILE = path.join(__dirname, '..', 'db', 'keys.json');

function _load() {
    try {
        if (fs.existsSync(KEYS_FILE)) return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
    } catch (_) {}
    return {};
}

function _save(data) {
    try {
        const dir = path.dirname(KEYS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(KEYS_FILE, JSON.stringify(data, null, 2));
    } catch (e) { console.log(`[KEYS] Save error: ${e.message}`); }
}

function generateKey() {
    const pool = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const parts = [];
    for (let i = 0; i < 4; i++) {
        let part = '';
        for (let j = 0; j < 4; j++) part += pool[Math.floor(Math.random() * pool.length)];
        parts.push(part);
    }
    return parts.join('-');
}

// Validasi format key XXXX-XXXX-XXXX-XXXX
function isValidKeyFormat(key) {
    return /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key);
}

// create(durationHours, note, customKey, maxDevice, maxIp)
function create(durationHours = 24, note = '', customKey = '', maxDevice = 0, maxIp = 0) {
    const db = _load();

    let key;
    if (customKey) {
        key = customKey.toUpperCase().trim();
        if (!isValidKeyFormat(key)) return { error: 'Format key salah. Gunakan XXXX-XXXX-XXXX-XXXX' };
        if (db[key]) return { error: 'Key sudah ada di database' };
    } else {
        let attempt = 0;
        do { key = generateKey(); attempt++; } while (db[key] && attempt < 20);
    }

    const now = Date.now();
    db[key] = {
        key, created_at: now,
        expires_at: now + durationHours * 3600 * 1000,
        duration_hours: durationHours, status: 'active', note,
        max_device: maxDevice || 0,   // 0 = unlimited
        max_ip:     maxIp     || 0,   // 0 = unlimited
        open_id: null, bound_at: null,
        used_by_ip: null, session_id: null,
        last_used: null, last_uid: null, last_login: null, usage_count: 0,
        device_ids: [], ip_list: []   // track device & ip yang sudah pernah connect
    };
    _save(db);
    return db[key];
}

function check(key) {
    const db  = _load();
    key       = (key || '').toUpperCase().trim();
    const entry = db[key];
    if (!entry) return { valid: false, reason: 'Key tidak ditemukan' };
    if (entry.status === 'revoked') return { valid: false, reason: 'Key sudah direvoke' };
    if (Date.now() > entry.expires_at) {
        if (entry.status === 'active') { entry.status = 'expired'; db[key] = entry; _save(db); }
        return { valid: false, reason: 'Key sudah expired' };
    }
    if (entry.status !== 'active') return { valid: false, reason: `Status: ${entry.status}` };
    return { valid: true, entry };
}

function markUsed(key, ip, sessionId) {
    const db = _load();
    key = (key || '').toUpperCase().trim();
    if (!db[key]) return;
    db[key].used_by_ip  = ip;
    db[key].session_id  = sessionId;
    db[key].last_used   = Date.now();
    db[key].usage_count = (db[key].usage_count || 0) + 1;

    // Track IP list
    if (ip) {
        if (!db[key].ip_list) db[key].ip_list = [];
        if (!db[key].ip_list.includes(ip)) db[key].ip_list.push(ip);
    }

    _save(db);
}

// Cek apakah IP boleh pakai key ini (berdasarkan max_ip)
function checkIpLimit(key, ip) {
    const db = _load();
    key = (key || '').toUpperCase().trim();
    if (!db[key]) return { ok: false, reason: 'Key tidak ditemukan' };
    const entry = db[key];
    const maxIp = entry.max_ip || 0;
    if (maxIp <= 0) return { ok: true }; // unlimited
    const ipList = entry.ip_list || [];
    if (ipList.includes(ip)) return { ok: true }; // IP sudah pernah pakai
    if (ipList.length >= maxIp) return { ok: false, reason: `Limit IP tercapai (maks ${maxIp} IP)` };
    return { ok: true };
}

// Cek apakah device boleh pakai key ini (berdasarkan max_device)
function checkDeviceLimit(key, deviceId) {
    const db = _load();
    key = (key || '').toUpperCase().trim();
    if (!db[key]) return { ok: false, reason: 'Key tidak ditemukan' };
    const entry = db[key];
    const maxDev = entry.max_device || 0;
    if (maxDev <= 0) return { ok: true }; // unlimited
    const devList = entry.device_ids || [];
    if (devList.includes(deviceId)) return { ok: true }; // device sudah terdaftar
    if (devList.length >= maxDev) return { ok: false, reason: `Limit device tercapai (maks ${maxDev} device)` };
    return { ok: true };
}

// Daftarkan device ke key
function registerDevice(key, deviceId) {
    if (!deviceId) return;
    const db = _load();
    key = (key || '').toUpperCase().trim();
    if (!db[key]) return;
    if (!db[key].device_ids) db[key].device_ids = [];
    if (!db[key].device_ids.includes(deviceId)) db[key].device_ids.push(deviceId);
    _save(db);
}

function updateLoginInfo(openId, uid) {
    if (!openId || !uid) return false;
    const db    = _load();
    const entry = Object.values(db).find(e => e.open_id === openId);
    if (!entry) return false;
    db[entry.key].last_uid   = uid;
    db[entry.key].last_login = Date.now();
    _save(db);
    return true;
}

function revoke(key) {
    const db = _load();
    key = (key || '').toUpperCase().trim();
    if (!db[key]) return false;
    db[key].status = 'revoked';
    _save(db);
    return true;
}

function list(filter = 'all') {
    const db  = _load();
    const now = Date.now();
    let dirty = false;
    const entries = Object.values(db).map(entry => {
        if (entry.status === 'active' && now > entry.expires_at) {
            db[entry.key].status = 'expired';
            entry.status = 'expired';
            dirty = true;
        }
        return entry;
    });
    if (dirty) _save(db);
    return entries
        .filter(entry => filter === 'all' || entry.status === filter)
        .sort((a, b) => b.created_at - a.created_at);
}

function cleanup() {
    const db  = _load();
    const now = Date.now();
    let count = 0;
    for (const key of Object.keys(db)) {
        const e = db[key];
        if (e.status === 'revoked' || now > e.expires_at) { delete db[key]; count++; }
    }
    _save(db);
    return count;
}

function getDb() { return _load(); }

function bindOpenId(key, openId) {
    const db = _load();
    key = (key || '').toUpperCase().trim();
    if (!db[key]) return { ok: false, reason: 'Key tidak ditemukan' };
    if (db[key].status === 'revoked') return { ok: false, reason: 'Key sudah direvoke' };
    if (Date.now() > db[key].expires_at) return { ok: false, reason: 'Key sudah expired' };
    const existing = Object.values(db).find(e => e.open_id === openId && e.key !== key);
    if (existing) return { ok: false, reason: 'Open ID sudah terdaftar di key lain' };
    db[key].open_id  = openId;
    db[key].bound_at = Date.now();
    _save(db);
    return { ok: true };
}

module.exports = {
    create, check, markUsed, updateLoginInfo, revoke, list, cleanup, getDb,
    bindOpenId, checkIpLimit, checkDeviceLimit, registerDevice, isValidKeyFormat
};
