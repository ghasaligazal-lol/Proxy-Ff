'use strict';
// modules/majorlogin.js — v8
//
// v8 vs v7:
//   - Proto FfAntiConfigDesc sudah lengkap (region, hpe_enable, ffi_enable, mtp_lite_data_enable, ffm_enable, ffo_enable)
//   - Patch ff_anti_config_desc sekarang zero semua field baru juga
//   - Minor: log lebih informatif

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

const PROXY_URL = (process.env.PROXY_URL || 'https://proxy-reza-kontolodon-memek-luu.up.railway.app/').replace(/\/$/, '');

let RAFIN = null;

protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        console.log('[MAJORLOGIN] v8 Proto loaded OK');
        tglog.send('✅ <b>Server Start v8</b>\nProto loaded OK');
    })
    .catch(err => {
        console.error('[MAJORLOGIN] Proto load FAILED:', err.message);
        tglog.send(`❌ <b>Proto FAILED</b>\n${err.message}`);
    });

// Decode request fields untuk logging
function decodeReqFields(buf) {
    const out = {};
    try {
        const reader = protobuf.Reader.create(buf);
        while (reader.pos < reader.len) {
            const tag      = reader.uint32();
            const fieldNum = tag >>> 3;
            const wireType = tag & 0x7;
            if (wireType === 0) {
                const val = reader.uint64();
                if (fieldNum === 98) out.is_vpn = typeof val.toNumber === 'function' ? val.toNumber() : Number(val);
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

                // 404 account_not_found → pass-through
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

                // Proto belum loaded → pass-through
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
                let banStr   = null;

                try {
                    // Decode
                    const decoded = RAFIN.decode(rawBuf);
                    const obj     = RAFIN.toObject(decoded, {
                        defaults: false,
                        longs:    String,
                        enums:    Number,
                        bytes:    Buffer,
                        keepCase: true,
                    });

                    uid    = obj.account_id  || '?';
                    region = obj.lock_region || '?';
                    token  = (obj.token || '').substring(0, 20) + '...';
                    ttl    = obj.ttl || 0;

                    // Detect ban sebelum patch
                    if (obj.blacklist && obj.blacklist.ban_reason && obj.blacklist.ban_reason !== 0) {
                        const reason = BAN_REASON_MAP[obj.blacklist.ban_reason] || `code_${obj.blacklist.ban_reason}`;
                        banStr = `🚫 BAN detected: ${reason}`;
                    }

                    // --- PATCHES ---

                    if (obj.server_url && obj.server_url !== PROXY_URL) {
                        patchLog.push(`server_url patched`);
                        obj.server_url = PROXY_URL;
                    }

                    if (obj.tp_url) {
                        patchLog.push('tp_url cleared');
                        obj.tp_url = '';
                    }

                    if (obj.ano_url) {
                        patchLog.push('ano_url cleared');
                        obj.ano_url = '';
                    }

                    if (obj.ffanti_url) {
                        patchLog.push('ffanti_url cleared');
                        obj.ffanti_url = '';
                    }

                    // ff_anti_config_desc — disable semua field
                    if (obj.ff_anti_config_desc) {
                        obj.ff_anti_config_desc.enable               = false;
                        obj.ff_anti_config_desc.config_url           = '';
                        obj.ff_anti_config_desc.hpe_enable           = false;
                        obj.ff_anti_config_desc.ffi_enable           = false;
                        obj.ff_anti_config_desc.mtp_lite_data_enable = false;
                        obj.ff_anti_config_desc.ffm_enable           = false;
                        obj.ff_anti_config_desc.ffo_enable           = false;
                        patchLog.push('ff_anti_config_desc disabled');
                    }

                    if (obj.blacklist) {
                        obj.blacklist.ban_reason      = 0;
                        obj.blacklist.expire_duration = 0;
                        obj.blacklist.ban_time        = 0;
                        obj.blacklist.ban_type        = '';
                        patchLog.push('blacklist cleared');
                    }

                    if (obj.queue_info && !obj.queue_info.allow) {
                        obj.queue_info.allow = true;
                        patchLog.push('queue forced allow');
                    }

                    // --- ENCODE ULANG ---
                    const msg  = RAFIN.fromObject(obj);
                    const verr = RAFIN.verify(msg);
                    if (verr) throw new Error('verify: ' + verr);

                    const encoded = RAFIN.encode(msg).finish();
                    outBuf = Buffer.from(encoded);

                    // Sanity check size
                    const sizeDiff = Math.abs(outBuf.length - rawBuf.length);
                    const maxDiff  = Math.max(rawBuf.length * 0.3, 100);
                    if (sizeDiff > maxDiff) {
                        console.warn(`[MAJORLOGIN] Size mismatch raw=${rawBuf.length} out=${outBuf.length} diff=${sizeDiff} → pass-through raw`);
                        tglog.send(`⚠️ <b>MajorLogin size mismatch</b>\nraw=${rawBuf.length}b out=${outBuf.length}b diff=${sizeDiff}\npass-through (no patches)`);
                        outBuf   = rawBuf;
                        patchLog = ['SIZE_MISMATCH → raw pass-through'];
                    } else {
                        console.log(`[MAJORLOGIN] uid=${uid} region=${region} ${rawBuf.length}b→${outBuf.length}b patches=[${patchLog.join(', ')}]`);
                    }

                } catch (err) {
                    console.error('[MAJORLOGIN] Patch error:', err.message, '→ pass-through raw');
                    tglog.send(`⚠️ <b>MajorLogin patch error</b>\n${err.message}\nraw pass-through`);
                    outBuf   = rawBuf;
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

    console.log('[MAJORLOGIN] v8 active — FfAntiConfigDesc complete');
}

module.exports = { init };
