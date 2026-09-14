'use strict';
// modules/ping.js
// BUGFIX: Game expect Ping response dalam format PROTOBUF, bukan JSON.
// Sebelumnya return res.json({code:0, server_time:...}) → game decode proto
// → "Invalid wire-type; this usually means you have over-written a file" → DataTypeError.
//
// Ping proto response (freefire.PingRes atau PingResponse):
//   field 1 (varint) = error_code (0 = OK)
//   field 2 (varint) = server_time (unix seconds)
// Encode manual karena tidak ada .proto file untuk PingRes.

function encodePingProto() {
    const serverTime = Math.floor(Date.now() / 1000);
    const bytes = [];

    // field 1, wire_type 0 (varint) = tag 0x08, value 0 (OK)
    bytes.push(0x08, 0x00);

    // field 2, wire_type 0 (varint) = tag 0x10, value = serverTime
    bytes.push(0x10);
    let n = serverTime;
    while (n > 0x7f) {
        bytes.push((n & 0x7f) | 0x80);
        n >>>= 7;
    }
    bytes.push(n & 0x7f);

    return Buffer.from(bytes);
}

function init(app) {
    app.post('/Ping', (req, res) => {
        const buf = encodePingProto();
        res.status(200)
           .set('Content-Type', 'application/octet-stream')
           .set('Content-Length', String(buf.length))
           .end(buf);
    });

    // GET juga buat healthcheck browser
    app.get('/Ping', (req, res) => {
        res.json({ code: 0, server_time: Math.floor(Date.now() / 1000) });
    });

    console.log('[PING] Active → /Ping (protobuf binary response)');
}

module.exports = { init };
