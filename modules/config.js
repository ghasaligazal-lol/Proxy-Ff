'use strict';
// modules/config.js — Simpan & baca config dashboard (bodyMode, speed, sensi)
const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'db', 'gameconfig.json');

const DEFAULTS = {
    bodyMode: 'full',
    runSpeed: null,
    sensi: {
        SensitivityMaxSetting:   9.5,
        Sensitivity1PMaxSetting: 9.5,
        X1ScopeMaxSetting:       9.5,
        X2ScopeMaxSetting:       9.5,
        X4ScopeMaxSetting:       9.5,
        X8ScopeMaxSetting:       9.5,
        FreeLookMaxSetting:      9.5,
    }
};

function load() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
            return Object.assign({}, DEFAULTS, JSON.parse(raw));
        }
    } catch (_) {}
    return Object.assign({}, DEFAULTS);
}

function save(data) {
    try {
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('[CONFIG] Save error:', e.message);
        return false;
    }
}

function init(app) {
    // GET config — untuk dashboard
    app.get('/api/config', (req, res) => {
        res.json(load());
    });

    // POST config — simpan dari dashboard
    app.post('/api/config', (req, res) => {
        try {
            let body = req.body;
            if (Buffer.isBuffer(body)) {
                try { body = JSON.parse(body.toString('utf8')); } catch (_) { body = {}; }
            }
            if (typeof body !== 'object' || !body) body = {};

            // Validasi bodyMode
            const bodyMode = (body.bodyMode === 'hs_only') ? 'hs_only' : 'full';

            // Validasi runSpeed
            let runSpeed = null;
            if (body.runSpeed !== null && body.runSpeed !== undefined && body.runSpeed !== '') {
                const v = parseFloat(body.runSpeed);
                if (!isNaN(v) && v >= 0 && v <= 10) runSpeed = v;
            }

            // Validasi sensi
            const sensiKeys = [
                'SensitivityMaxSetting', 'Sensitivity1PMaxSetting',
                'X1ScopeMaxSetting', 'X2ScopeMaxSetting',
                'X4ScopeMaxSetting', 'X8ScopeMaxSetting', 'FreeLookMaxSetting'
            ];
            const sensi = {};
            for (const k of sensiKeys) {
                const v = parseFloat(body.sensi?.[k]);
                sensi[k] = (!isNaN(v) && v >= 0 && v <= 999.99) ? v : 9.5;
            }

            const cfg = { bodyMode, runSpeed, sensi };
            if (save(cfg)) {
                console.log('[CONFIG] Saved:', JSON.stringify(cfg));
                res.json({ ok: true, config: cfg });
            } else {
                res.status(500).json({ ok: false, error: 'Save failed' });
            }
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    console.log('[CONFIG] Active → GET/POST /api/config');
}

module.exports = { load, save, init };
