'use strict';
// modules/majorlogin.js — v11
//
// FIX v11 vs v10:
// 1. RAFIN.verify() DIHAPUS — ini penyebab utama pass-through:
//    protobufjs verify() strict-check enum values, nilai enum yang tidak
//    terdefinisi di .proto (misal ban_reason dari server baru) langsung throw
//    → catch → pass-through raw → SEMUA patch gagal.
//    proto3 wire format tidak butuh verify() untuk encode dengan benar.
//
// 2. Binary surgery FALLBACK untuk fields kritis (ffanti_url, ffm_enable, ffo_enable):
//    Kalau decode/encode tetap gagal, minimal jalankan binary surgery pada raw buffer
//    untuk clear ffanti_url dan force ff_anti_config_desc.enable=false.
//    Lebih baik patch parsial daripada zero patch.
//
// 3. keepCase: false (default) → protobufjs naming canonical, lebih aman saat fromObject.
//
// 4. Tambah logging ukuran rawBuf untuk debug kalau pass-through terjadi lagi.

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

const PROXY_URL = (process.env.PROXY_URL || 'https://proxy-reza-kontolodon-memek-luu.up.railway.app/').replace(/\/$/, '');

let RAFIN = null;

protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        console.log('[MAJORLOGIN] v11 Proto loaded OK');
        tglog.send('✅ <b>Server Start v11</b>\nProto loaded OK');
    })
    .catch(err => {
        console.error('[MAJORLOGIN] Proto load FAILED:', err.message);
        tglog.send(`❌ <b>Proto FAILED</b>\n${err.message}`);
    });

// Decode request untuk logging saja
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

// ===== BINARY SURGERY FALLBACK =====
// Dipakai kalau protobuf decode/encode gagal.
// Clear semua string domain berbahaya dengan null-fill,
// dan set byte boolean enable=false pada ff_anti_config_desc.

function binaryPatchFallback(buf) {
    let patched = false;
    const b = Buffer.from(buf); // copy

    // Pattern: domain stronghold/ffanti/gin — null-fill in-place
    const DANGER_DOMAINS = [
        'csoversea.stronghold.freefiremobile.com',
        'gin.freefiremobile.com',
        'vodka.freefiremobile.com',
        'gamesecurity.sea.freefiremobile.com',
        'ffanti.',
    ];

    for (const domain of DANGER_DOMAINS) {
        const needle = Buffer.from(domain, 'utf8');
        let offset = 0;
        while (offset < b.length - needle.length) {
            const idx = b.indexOf(needle, offset);
            if (idx === -1) break;
            // null-fill the string content (keep length varint intact — same byte count)
            b.fill(0x00, idx, idx + needle.length);
            patched = true;
            offset = idx + needle.length;
        }
    }

    // Clear IP list patterns (stronghold IPs)
    const DANGER_IPS = ['34.126.76.45', '34.87.177.14', '34.87.170.230', '35.185.183.57'];
    for (const ip of DANGER_IPS) {
        const needle = Buffer.from(ip, 'utf8');
        let offset = 0;
        while (offset < b.length - needle.length) {
            const idx = b.indexOf(needle, offset);
            if (idx === -1) break;
            b.fill(0x00, idx, idx + needle.length);
            patched = true;
            offset = idx + needle.length;
        }
    }

    return { buf: b, patched };
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
                    const bodyStr = rawBuf.toString('utf8');
                    if (bodyStr.includes('account_not_found')) {
                        console.log('[MAJORLOGIN] 404 account_not_found');
                        tglog.send(`ℹ️ <b>MajorLogin 404</b>\nopen_id: ${reqInfo.open_id || '-'}`);
                        const h = { ...proxyRes.headers, 'content-length': rawBuf.length };
                        delete h['transfer-encoding'];
                        res.writeHead(404, h);
                        return res.end(rawBuf);
                    }
                }

                // Proto belum loaded → binary surgery fallback minimal
                if (!RAFIN) {
                    console.error('[MAJORLOGIN] RAFIN not loaded → binary fallback');
                    const { buf: patchedBuf, patched } = binaryPatchFallback(rawBuf);
                    const outBuf = patched ? patchedBuf : rawBuf;
                    const h = { ...proxyRes.headers, 'content-length': outBuf.length };
                    delete h['transfer-encoding'];
                    res.writeHead(proxyRes.statusCode, h);
                    return res.end(outBuf);
                }

                let outBuf   = null;
                let uid = '?', region = '?', token = '?', ttl = 0;
                let patchLog = [];
                let banStr   = null;
                let decodeOK = false;

                // ===== ATTEMPT: PROTOBUF DECODE → PATCH → ENCODE =====
                try {
                    const decoded = RAFIN.decode(rawBuf);
                    const obj     = RAFIN.toObject(decoded, {
                        defaults: false,   // skip default-value fields
                        longs:    String,
                        enums:    Number,  // keep as number so we can compare/set
                        bytes:    Buffer,
                        keepCase: false,   // canonical camelCase sesuai proto field names
                    });

                    decodeOK = true;

                    uid    = obj.accountId  || obj.account_id  || '?';
                    region = obj.lockRegion || obj.lock_region || '?';
                    token  = (obj.token || '').substring(0, 20) + '...';
                    ttl    = obj.ttl || 0;

                    if (obj.blacklist && obj.blacklist.banReason && obj.blacklist.banReason !== 0) {
                        const reason = BAN_REASON_MAP[obj.blacklist.banReason] || `code_${obj.blacklist.banReason}`;
                        banStr = `🚫 BAN detected: ${reason}`;
                    }

                    // --- PATCHES ---

                    // server_url → proxy
                    const suKey = obj.serverUrl !== undefined ? 'serverUrl' : 'server_url';
                    if (obj[suKey] && obj[suKey] !== PROXY_URL) {
                        patchLog.push('server_url→proxy');
                        obj[suKey] = PROXY_URL;
                    }

                    // tp_url → clear
                    const tpKey = obj.tpUrl !== undefined ? 'tpUrl' : 'tp_url';
                    if (obj[tpKey]) { obj[tpKey] = ''; patchLog.push('tp_url cleared'); }

                    // ano_url → clear
                    const anoKey = obj.anoUrl !== undefined ? 'anoUrl' : 'ano_url';
                    if (obj[anoKey]) { obj[anoKey] = ''; patchLog.push('ano_url cleared'); }

                    // ffanti_url → clear
                    const ffuKey = obj.ffantiUrl !== undefined ? 'ffantiUrl' : 'ffanti_url';
                    if (obj[ffuKey]) { obj[ffuKey] = ''; patchLog.push('ffanti_url cleared'); }

                    // ff_anti_config_desc → disable semua
                    const ffdKey = obj.ffAntiConfigDesc !== undefined ? 'ffAntiConfigDesc' : 'ff_anti_config_desc';
                    if (obj[ffdKey]) {
                        const ffd = obj[ffdKey];
                        ffd.enable             = false;
                        ffd.configUrl          = '';
                        ffd.config_url         = '';
                        ffd.hpeEnable          = false;
                        ffd.hpe_enable         = false;
                        ffd.ffiEnable          = false;
                        ffd.ffi_enable         = false;
                        ffd.mtpLiteDataEnable  = false;
                        ffd.mtp_lite_data_enable = false;
                        ffd.ffmEnable          = false;
                        ffd.ffm_enable         = false;
                        ffd.ffoEnable          = false;
                        ffd.ffo_enable         = false;
                        patchLog.push('ff_anti_config disabled');
                    }

                    // blacklist → clear ban
                    const blKey = obj.blacklist ? 'blacklist' : null;
                    if (blKey && obj[blKey]) {
                        obj[blKey].banReason      = 0;
                        obj[blKey].ban_reason      = 0;
                        obj[blKey].expireDuration  = 0;
                        obj[blKey].expire_duration = 0;
                        obj[blKey].banTime         = 0;
                        obj[blKey].ban_time        = 0;
                        obj[blKey].banType         = '';
                        obj[blKey].ban_type        = '';
                        patchLog.push('blacklist cleared');
                    }

                    // queue_info → force allow
                    const qiKey = obj.queueInfo !== undefined ? 'queueInfo' : 'queue_info';
                    if (obj[qiKey]) {
                        const qi = obj[qiKey];
                        if (!qi.allow && !qi.Allow) {
                            qi.allow = true;
                            patchLog.push('queue allow forced');
                        }
                    }

                    // connection_seed → disable (OB55)
                    const cseKey = obj.connectionSeedEnabled !== undefined ? 'connectionSeedEnabled' : 'connection_seed_enabled';
                    if (obj[cseKey]) { obj[cseKey] = false; patchLog.push('conn_seed_enabled=false'); }
                    const csKey = obj.connectionSeed !== undefined ? 'connectionSeed' : 'connection_seed';
                    if (obj[csKey]) { obj[csKey] = ''; patchLog.push('conn_seed cleared'); }

                    // --- ENCODE (TANPA verify() — ini yang bikin bug sebelumnya) ---
                    const msg  = RAFIN.fromObject(obj);
                    // TIDAK ada RAFIN.verify(msg) di sini — verify strict-check enum values
                    // dan bisa throw untuk enum unknown (misalnya ban_reason baru dari server)
                    outBuf = Buffer.from(RAFIN.encode(msg).finish());

                    console.log(`[MAJORLOGIN] v11 uid=${uid} region=${region} ${rawBuf.length}b→${outBuf.length}b patches=[${patchLog.join(', ')}]`);

                } catch (encErr) {
                    // Decode atau encode gagal → binary surgery fallback
                    console.error('[MAJORLOGIN] Proto patch error:', encErr.message, '→ binary fallback');
                    tglog.send(`⚠️ <b>MajorLogin proto error</b>\n${encErr.message}\n→ binary surgery fallback\nrawBuf=${rawBuf.length}b decodeOK=${decodeOK}`);

                    const { buf: patchedBuf, patched } = binaryPatchFallback(rawBuf);
                    outBuf   = patchedBuf;
                    patchLog = [`FALLBACK(${encErr.message.substring(0, 50)}): binary_surgery=${patched}`];

                    // Fallback tidak bisa patch server_url — log agar ketahuan
                    if (!patched) {
                        console.error('[MAJORLOGIN] Binary fallback: no dangerous domains found in raw buf');
                    }
                }

                // TG log
                const lines = [`<b>MajorLogin v11</b>`, ''];
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

    console.log('[MAJORLOGIN] v11 active — no verify(), dual-key patch, binary fallback');
}

module.exports = { init };
