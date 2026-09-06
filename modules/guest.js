// modules/guest.js
const crypto = require('crypto');

function init(app) {
    app.post('/api/guest_login', (req, res) => {
        const newGuestId = "GUEST_" + Math.floor(10000000 + Math.random() * 90000000);
        const newSessionToken = crypto.randomBytes(16).toString('hex');
        console.log(`[GUEST] ${newGuestId}`);
        res.json({
            code: 0,
            message: "Success",
            open_id: newGuestId,
            token: newSessionToken,
            is_new_account: true
        });
    });
}

module.exports = { init };