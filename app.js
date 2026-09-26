'use strict';

const express = require('express');
const https   = require('https');
const zlib    = require('zlib');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Target hosts (from ver.php → server_url in the real log) ───────────────
const LOGIN_HOST  = 'loginbp.ppmainecoonghj.com';
const CLIENT_HOST = 'clientbp.ppmainecoonghj.com';
const VER_HOST    = 'loginbp.ppmainecoonghj.com';   // ver.php lives here too

// ─── Collect raw request body ─────────────────────────────────────────────────
app.use((req, res, next) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { req.rawBody = Buffer.concat(chunks); next(); });
});

// ─── JWT payload patch ────────────────────────────────────────────────────────
function patchJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return token;
        const pad = parts[1].length % 4;
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
                  + (pad ? '='.repeat(4 - pad) : '');
        const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
        payload.emulator_score = 100;
        payload.is_emulator    = true;
        const newPayload = Buffer.from(JSON.stringify(payload))
            .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        return `${parts[0]}.${newPayload}.${parts[2]}`;
    } catch (_) { return token; }
}

// ─── Recursive JSON patch ─────────────────────────────────────────────────────
function patchJSON(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 15) return;
    if (Array.isArray(obj)) { obj.forEach(i => patchJSON(i, depth + 1)); return; }

    // Core emulator flags
    if ('emulator_score'    in obj) obj.emulator_score    = 100;
    if ('is_emulator'       in obj) obj.is_emulator       = true;
    if ('is_emulator_pool'  in obj) obj.is_emulator_pool  = true;
    if ('is_in_emulator_pool' in obj) obj.is_in_emulator_pool = true;  // ← was missing!

    // Patch any JWT token found anywhere in the response
    if (obj.token && typeof obj.token === 'string' && obj.token.split('.').length === 3)
        obj.token = patchJWT(obj.token);

    for (const k of Object.keys(obj)) patchJSON(obj[k], depth + 1);
}

// ─── Decompress helper ────────────────────────────────────────────────────────
function decode(buf, enc) {
    return new Promise(resolve => {
        const d = enc === 'gzip'    ? zlib.createGunzip()
                : enc === 'deflate' ? zlib.createInflate()
                : enc === 'br'      ? zlib.createBrotliDecompress()
                : null;
        if (!d) return resolve(buf);
        const out = [];
        d.on('data', c => out.push(c));
        d.on('end',  () => resolve(Buffer.concat(out)));
        d.on('error', () => resolve(buf));
        d.end(buf);
    });
}

// ─── Route → target host mapping ─────────────────────────────────────────────
const LOGIN_PATHS = [
    '/MajorLogin', '/MajorRegister', '/Register', '/GenerateNickname',
    '/GetRecommendNickname', '/GetAccountBriefInfoBeforeLogin',
    '/ChooseNewbieChoice', '/ChooseRegion', '/CreateAccount', '/Ping',
    '/ver.php',  // ← ver.php must also go through proxy!
];

function targetHost(path) {
    return LOGIN_PATHS.some(p => path.startsWith(p)) ? LOGIN_HOST : CLIENT_HOST;
}

// ─── Proxy all requests ───────────────────────────────────────────────────────
app.all('*', (req, res) => {
    const host = targetHost(req.path);

    const upHeaders = {
        ...req.headers,
        host: host,
        'accept-encoding': 'identity',   // disable compression so we can read the body
    };
    delete upHeaders['content-length'];
    if (req.rawBody?.length) upHeaders['content-length'] = String(req.rawBody.length);

    console.log(`→ ${req.method} ${req.path} [${host}]`);

    const upReq = https.request({
        hostname: host, port: 443,
        path: req.url, method: req.method, headers: upHeaders,
    }, async upRes => {
        const ct  = (upRes.headers['content-type']     || '').toLowerCase();
        const enc = (upRes.headers['content-encoding'] || '').toLowerCase();

        const chunks = [];
        upRes.on('data', c => chunks.push(c));
        upRes.on('end', async () => {
            let raw = Buffer.concat(chunks);

            // Patch any JSON response (includes ver.php, MajorLogin, GetLoginData…)
            if (ct.includes('application/json') && raw.length) {
                try {
                    const decoded = await decode(raw, enc);
                    const parsed  = JSON.parse(decoded.toString('utf8'));
                    patchJSON(parsed, 0);
                    raw = Buffer.from(JSON.stringify(parsed));
                    const h = { ...upRes.headers };
                    delete h['content-encoding'];
                    delete h['transfer-encoding'];
                    h['content-length'] = String(raw.length);
                    res.writeHead(upRes.statusCode, h);
                    return res.end(raw);
                } catch (_) { /* fall through to raw passthrough */ }
            }

            // For ver.php / non-JSON or parse error → try line-level patch
            // ver.php sometimes returns JSON with text/plain content-type
            if (req.path.includes('ver.php') && raw.length) {
                try {
                    const decoded = await decode(raw, enc);
                    const text    = decoded.toString('utf8').trim();
                    if (text.startsWith('{') || text.startsWith('[')) {
                        const parsed = JSON.parse(text);
                        patchJSON(parsed, 0);
                        raw = Buffer.from(JSON.stringify(parsed));
                        const h = { ...upRes.headers };
                        delete h['content-encoding'];
                        delete h['transfer-encoding'];
                        h['content-type']   = 'application/json';
                        h['content-length'] = String(raw.length);
                        res.writeHead(upRes.statusCode, h);
                        return res.end(raw);
                    }
                } catch (_) { /* fall through */ }
            }

            res.writeHead(upRes.statusCode, upRes.headers);
            res.end(raw);
        });
    });

    upReq.on('error', err => {
        console.error(`✗ ${err.message}`);
        if (!res.headersSent) res.status(502).end();
    });
    upReq.setTimeout(30_000, () => upReq.destroy());
    if (req.rawBody?.length) upReq.write(req.rawBody);
    upReq.end();
});

app.listen(PORT, () => {
    console.log(`[EMU-PROXY] port=${PORT} | hosts: ${LOGIN_HOST} / ${CLIENT_HOST}`);
    console.log(`[EMU-PROXY] patching: emulator_score=100, is_emulator=true, is_in_emulator_pool=true`);
});
