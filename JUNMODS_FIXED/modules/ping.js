// modules/ping.js
function init(app) {
    app.post('/Ping', async (req, res) => {
        res.json({ code: 0, server_time: Math.floor(Date.now() / 1000) });
    });
}

module.exports = { init };