// modules/newbie.js
const https = require('https');

function handle(req, res, next) {
    console.log(`[NEWBIE] Choose newbie choice`);

    const options = {
        hostname: 'clientbp.ggpolarbear.com',
        path: '/ChooseNewbieChoice',
        method: 'POST',
        headers: {
            ...req.headers,
            'Host': 'clientbp.ggpolarbear.com',
            'Content-Length': req.body?.length || 0
        }
    };

    const proxyReq = https.request(options, (proxyRes) => {
        let responseData = [];
        proxyRes.on('data', (chunk) => responseData.push(chunk));
        proxyRes.on('end', () => {
            const buffer = Buffer.concat(responseData);
            try {
                const successResponse = Buffer.from([0x08, 0x01]);
                const resetField = Buffer.from([0x10, 0x01]);
                const modified = Buffer.concat([successResponse, resetField]);
                console.log(`[NEWBIE] Guest reset enabled`);
                res.writeHead(200, {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': modified.length
                });
                res.end(modified);
                return;
            } catch (err) {
                console.log(`[NEWBIE] Error: ${err.message}`);
            }
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(buffer);
        });
    });

    proxyReq.on('error', (err) => {
        console.log(`[NEWBIE] Proxy error: ${err.message}`);
        res.status(500).send('Proxy Error');
    });

    if (req.body) {
        proxyReq.write(req.body);
    }
    proxyReq.end();
}

module.exports = { handle }; 