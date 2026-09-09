// modules/404.js
function init(app) {
    app.use((req, res) => {
        const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace('::ffff:', '');
        console.log(`[404] ${req.method} ${req.path} ${clientIp}`);
        res.status(404).type('text/html').send(`<!DOCTYPE html>
<html><head><title>404</title></head>
<body><h1>404 Not Found</h1></body></html>`);
    });
}

module.exports = { init };