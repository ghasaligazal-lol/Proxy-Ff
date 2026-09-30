'use strict';
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const cookieParser = require('cookie-parser');

const app  = express();
const PORT = process.env.PORT || 3030;

function loadModules() {
    const dir = path.join(__dirname, 'modules');
    const loaded = {};
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        const name = path.basename(file, '.js');
        try { loaded[name] = require(path.join(dir, file)); }
        catch (err) { console.log(`[MODULES] ERROR ${file}: ${err.message}`); }
    }
    return loaded;
}

const m = loadModules();

app.use(express.raw({ type: '*/*', limit: '10mb' }));
app.use(cookieParser());


// Native lib endpoint — arm64-v8a only
function serveLib(req, res, filename, label) {
    const filePath = path.join(__dirname, 'public', 'cdn', filename);
    if (!fs.existsSync(filePath)) {
        console.log(`[${label}] ERROR: file not found at ${filePath}`);
        return res.status(404).send(`${filename} not found`);
    }
    const stat = fs.statSync(filePath);
    const size = stat.size;
    const ip = req.headers['x-forwarded-for'] || req.ip || '-';
    console.log(`[${label}] serving ${size}B (${(size/1024/1024).toFixed(2)}MB) to ${ip}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=300');
    fs.createReadStream(filePath).pipe(res);
}

// arm64-v8a (64-bit) only
app.get('/libmain.so', (req, res) => serveLib(req, res, 'libmain.so', 'LIBMAIN-64'));
if (m.cdn)        m.cdn.init(app);      // harus sebelum static
if (m.gamevar)    m.gamevar.init(app);   // /lamdo/ver.php endpoint
app.use(express.static('public'));
if (m.ping)       m.ping.init(app);
if (m.majorlogin) m.majorlogin.init(app);
if (m.proxy)      m.proxy.init(app);    // catch-all, paling akhir

app.listen(PORT, '0.0.0.0', () => console.log(`[SERVER] port ${PORT}`));
module.exports = app;
