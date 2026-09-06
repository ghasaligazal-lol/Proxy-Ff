const path = require('path');

function init(app) {
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
    });
}

module.exports = { init };