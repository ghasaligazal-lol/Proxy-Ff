'use strict';

const express = require('express');
const https   = require('https');
const zlib    = require('zlib');

const app  = express();
const PORT = process.env.PORT || 3000;

const LOGIN_HOST  = 'loginbp.ggpolarbear.com';
const CLIENT_HOST = 'clientbp.ggpolarbear.com';

app.use((req, res, next) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { req.rawBody = Buffer.concat(chunks); next(); });
});

function patchJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return token;
        const pad = parts[1].length % 4;
        const b64 = parts[1].replace(/-/g,'+').replace(/_/g,'/') + (pad ? '='.repeat(4-pad) : '');
        const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
        payload.emulator_score = 100;
        payload.is_emulator    = true;
        const newPayload = Buffer.from(JSON.stringify(payload))
            .toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
        return `${parts[0]}.${newPayload}.${parts[2]}`;
    } catch (_) { return token; }
}

function patchJSON(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 10) return;
    if (Array.isArray(obj)) { obj.forEach(i => patchJSON(i, depth+1)); return; }
    if ('emulator_score'   in obj) obj.emulator_score   = 100;
    if ('is_emulator'      in obj) obj.is_emulator      = true;
    if ('is_emulator_pool' in obj) obj.is_emulator_pool = true;
    if (obj.token && typeof obj.token === 'string' && obj.token.split('.').length === 3)
        obj.token = patchJWT(obj.token);
    for (const k of Object.keys(obj)) patchJSON(obj[k], depth+1);
}

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
        d.on('error',() => resolve(buf));
        d.end(buf);
    });
}

const LOGIN_PATHS = [
    '/MajorLogin','/MajorRegister','/Register','/GenerateNickname',
    '/GetRecommendNickname','/GetAccountBriefInfoBeforeLogin',
    '/ChooseNewbieChoice','/ChooseRegion','/CreateAccount','/Ping',
];

app.all('*', (req, res) => {
    const targetHost = LOGIN_PATHS.some(p => req.path.startsWith(p))
        ? LOGIN_HOST : CLIENT_HOST;

    const upHeaders = { ...req.headers, host: targetHost, 'accept-encoding': 'identity' };
    delete upHeaders['content-length'];
    if (req.rawBody?.length) upHeaders['content-length'] = String(req.rawBody.length);

    console.log(`→ ${req.method} ${req.path} [${targetHost}]`);

    const upReq = https.request({
        hostname: targetHost, port: 443,
        path: req.url, method: req.method, headers: upHeaders,
    }, async upRes => {
        const ct  = (upRes.headers['content-type'] || '').toLowerCase();
        const enc = (upRes.headers['content-encoding'] || '').toLowerCase();
        const chunks = [];
        upRes.on('data', c => chunks.push(c));
        upRes.on('end', async () => {
            let raw = Buffer.concat(chunks);
            if (ct.includes('application/json') && raw.length) {
                try {
                    const decoded = await decode(raw, enc);
                    const parsed  = JSON.parse(decoded.toString('utf8'));
                    patchJSON(parsed, 0);
                    raw = Buffer.from(JSON.stringify(parsed));
                    const h = { ...upRes.headers };
                    delete h['content-encoding']; delete h['transfer-encoding'];
                    h['content-length'] = String(raw.length);
                    res.writeHead(upRes.statusCode, h);
                    return res.end(raw);
                } catch (_) {}
            }
            res.writeHead(upRes.statusCode, upRes.headers);
            res.end(raw);
        });
    });

    upReq.on('error', err => {
        console.log(`✗ ${err.message}`);
        if (!res.headersSent) res.status(502).end();
    });
    upReq.setTimeout(30000, () => upReq.destroy());
    if (req.rawBody?.length) upReq.write(req.rawBody);
    upReq.end();
});

app.listen(PORT, () => {
    console.log(`[EMU-PROXY] port=${PORT} — forward + patch emulator_score=100`);
});
