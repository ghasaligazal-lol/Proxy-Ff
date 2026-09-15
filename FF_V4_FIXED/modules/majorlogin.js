'use strict';
// modules/majorlogin.js — v6 FINAL
//
// PENDEKATAN: decode proto → patch object → encode ulang.
// Tidak ada binary surgery sama sekali.
//
// Kenapa v4/v5 binary surgery gagal:
//   - indexOf domain string bisa match di content field lain (false positive)
//   - Ubah panjang string (server_url baru > lama) → Buffer.concat → total length berubah
//   - Proto parser baca field berikutnya dari offset salah → ProtoException "Unconsumed data"
//
// Kenapa v5 (majorlogin.js terpisah) tidak jalan:
//   - app.js memasukkan 'majorlogin' di SKIP_MODULES → tidak pernah di-load
//   - Semua /MajorLogin request jatuh ke proxy.js loginProxy binary surgery lama
//
// v6 fix:
//   1. app.js sudah hapus 'majorlogin' dari SKIP_MODULES dan tambah majorlogin.init(app)
//   2. Di sini: decode RAFIN → patch field langsung di JS object → encode ulang
//   3. Kalau decode/encode error → pass-through raw (lebih baik login tanpa patch daripada corrupt)
//   4. MajorLogin path di proxy.js routing sudah dihapus (tidak boleh double-handle)

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

const PROXY_URL  = (process.env.PROXY_URL || 'https://proxy-reza-kontolodon-memek-luu.up.railway.app/').replace(/\/$/, '');

let RAFIN = null;

protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        console.log('[MAJORLOGIN] Proto loaded OK');
        tglog.send('✅ <b>Server Start</b>\nProto loaded OK');
    })
    .catch(err => {
        console.error('[MAJORLOGIN] Proto load FAILED:', err.message);
        tglog.send(`❌ <b>Proto FAILED</b>\n${err.message}`);
    });

// Decode request fields untuk keperluan logging saja
function decodeReqFields(buf) {
    const out = {};
    try {
        const reader = protobuf.Reader.create(buf);
        while (reader.pos < reader.len) {
            const tag      = reader.uint32();
            const fieldNum = tag >>> 3;
            const wireType = tag & 0x7;
            if (wireType === 0) {
                const long = reader.uint64();
                if (fieldNum === 98) out.is_vpn = typeof long.toNumber === 'function' ? long.toNumber() : Number(long);
            } else if (wireType === 2) {
                const bytes = reader.bytes();
                const str   = bytes.toString('utf8');
                if (fieldNum === 22) out.open_id        = str;
                if (fieldNum === 57) out.client_version = str;
                if (fieldNum === 20) out.client_ip      = str;
            } else if (wireType === 5) { reader.fixed32();
            } else if (wireType === 1) { reader.fixed64();
            } else { break; }
        }
    } catch (_) {}
    return out;
}

const BAN_REASON_MAP = {
    0: 'UNKNOWN', 1: 'IN_GAME_AUTO', 2: 'REFUND',
    3: 'OTHERS',  4: 'SKINMOD', 1014: 'IN_GAME_AUTO_NEW'
};

function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body     = req.body;
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const reqInfo  = Buffer.isBuffer(body) && body.length > 0 ? decodeReqFields(body) : {};

        const options = {
            hostname: 'loginbp.ggpolarbear.com',
            path:     '/MajorLogin',
            method:   'POST',
            headers: {
                ...req.headers,
                'host':           'loginbp.ggpolarbear.com',
                'content-length': Buffer.isBuffer(body) ? body.length : 0,
            }
        };
        delete options.headers['transfer-encoding'];

        const proxyReq = https.request(options, (proxyRes) => {
            const chunks = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
                const rawBuf = Buffer.concat(chunks);

                // 404 account_not_found → pass-through langsung
                if (proxyRes.statusCode === 404) {
                    if (rawBuf.toString('utf8').includes('account_not_found')) {
                        console.log('[MAJORLOGIN] 404 account_not_found');
                        tglog.send(`ℹ️ <b>MajorLogin 404</b>\nopen_id: ${reqInfo.open_id || '-'}`);
                        const h = { ...proxyRes.headers, 'content-length': rawBuf.length };
                        delete h['transfer-encoding'];
                        res.writeHead(404, h);
                        return res.end(rawBuf);
                    }
                }

                // Proto belum loaded → pass-through (lebih baik daripada corrupt)
                if (!RAFIN) {
                    console.error('[MAJORLOGIN] RAFIN not loaded → pass-through');
                    const h = { ...proxyRes.headers, 'content-length': rawBuf.length };
                    delete h['transfer-encoding'];
                    res.writeHead(proxyRes.statusCode, h);
                    return res.end(rawBuf);
                }

                let outBuf   = rawBuf;
                let uid = '?', region = '?', token = '?', ttl = 0;
                let patchLog = [];
                let banStr = null;

                try {
                    // Decode
                    const obj = RAFIN.toObject(RAFIN.decode(rawBuf), { defaults: true, longs: String });

                    uid    = obj.account_id || '?';
                    region = obj.lock_region || '?';
                    token  = (obj.token || '').substring(0, 20) + '...';
                    ttl    = obj.ttl || 0;

                    if (obj.blacklist && obj.blacklist.ban_reason && obj.blacklist.ban_reason !== 0) {
                        const reason = BAN_REASON_MAP[obj.blacklist.ban_reason] || `code_${obj.blacklist.ban_reason}`;
                        banStr = `🚫 BAN detected: ${reason}`;
                    }

                    // Patch: server_url → proxy
                    if (obj.server_url && obj.server_url !== PROXY_URL) {
                        patchLog.push(`server_url: "${obj.server_url}" → proxy`);
                        obj.server_url = PROXY_URL;
                    }

                    // Patch: tp_url (stronghold — GIN transport) → hapus
                    if (obj.tp_url) {
                        patchLog.push('tp_url cleared');
                        obj.tp_url = '';
                    }

                    // Patch: ano_url (ANO anticheat) → hapus
                    if (obj.ano_url) {
                        patchLog.push('ano_url cleared');
                        obj.ano_url = '';
                    }

                    // Patch: ffanti_url → hapus
                    if (obj.ffanti_url) {
                        patchLog.push('ffanti_url cleared');
                        obj.ffanti_url = '';
                    }

                    // Patch: ff_anti_config_desc → disable
                    if (obj.ff_anti_config_desc) {
                        obj.ff_anti_config_desc.enable     = false;
                        obj.ff_anti_config_desc.config_url = '';
                        patchLog.push('ff_anti_config_desc disabled');
                    }

                    // Patch: blacklist → clear ban
                    if (obj.blacklist) {
                        obj.blacklist.ban_reason      = 0;
                        obj.blacklist.expire_duration = 0;
                        obj.blacklist.ban_time        = 0;
                        obj.blacklist.ban_type        = '';
                        patchLog.push('blacklist cleared');
                    }

                    // Patch: queue_info → force allow
                    if (obj.queue_info && !obj.queue_info.allow) {
                        obj.queue_info.allow = true;
                        patchLog.push('queue forced allow');
                    }

                    // Encode ulang
                    const msg    = RAFIN.fromObject(obj);
                    const verr   = RAFIN.verify(msg);
                    if (verr) throw new Error('verify: ' + verr);
                    outBuf = Buffer.from(RAFIN.encode(msg).finish());

                    console.log(`[MAJORLOGIN] uid=${uid} region=${region} ${rawBuf.length}b→${outBuf.length}b patches=[${patchLog.join(', ')}]`);

                } catch (err) {
                    // Decode/encode gagal → pass-through raw agar client bisa login
                    console.error('[MAJORLOGIN] Patch error:', err.message, '→ pass-through raw');
                    tglog.send(`⚠️ <b>MajorLogin patch error</b>\n${err.message}\nraw pass-through`);
                    outBuf = rawBuf;
                    patchLog = [`FALLBACK: ${err.message}`];
                }

                // TG log
                const lines = [`<b>MajorLogin</b>`, ''];
                lines.push(`👤 UID: <code>${uid}</code>`);
                lines.push(`🆔 open_id: <code>${reqInfo.open_id || '?'}</code>`);
                if (reqInfo.client_version) lines.push(`📱 ver: ${reqInfo.client_version}`);
                lines.push(`🌏 region: ${region}`);
                lines.push(`🌐 ip: ${clientIp}`);
                lines.push(`🎫 token: <code>${token}</code>`);
                if (ttl) lines.push(`⏱ ttl: ${ttl}s`);
                if (patchLog.length) lines.push(`🔧 ${patchLog.join(', ')}`);
                if (banStr) { lines.push(''); lines.push(banStr); }
                tglog.send(lines.join('\n'));

                const outHeaders = { ...proxyRes.headers, 'content-length': outBuf.length };
                delete outHeaders['transfer-encoding'];
                delete outHeaders['content-encoding'];
                res.writeHead(proxyRes.statusCode, outHeaders);
                res.end(outBuf);
            });

            proxyRes.on('error', err => {
                console.error('[MAJORLOGIN] Response error:', err.message);
                if (!res.headersSent) res.status(502).send('MajorLogin Error');
            });
        });

        proxyReq.on('error', err => {
            console.error('[MAJORLOGIN] Proxy error:', err.message);
            tglog.send(`❌ <b>MajorLogin Proxy Error</b>\n${err.message}`);
            if (!res.headersSent) res.status(502).send('MajorLogin Proxy Error');
        });

        if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });

    console.log('[MAJORLOGIN] v6 active — decode→patch→encode');
}

module.exports = { init };
