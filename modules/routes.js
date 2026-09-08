const path = require('path');

function init(app) {
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    });

    // Dashboard config (speed, sensi, body mode)
    app.get('/admin', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
    });
}

module.exports = { init };