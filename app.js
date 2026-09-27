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

if (m.cdn)        m.cdn.init(app);      // harus sebelum static
if (m.gamevar)    m.gamevar.init(app);   // /lamdo/ver.php endpoint
app.use(express.static('public'));
if (m.ping)       m.ping.init(app);
if (m.majorlogin) m.majorlogin.init(app);
if (m.proxy)      m.proxy.init(app);    // catch-all, paling akhir

app.listen(PORT, '0.0.0.0', () => console.log(`[SERVER] port ${PORT}`));
module.exports = app;
