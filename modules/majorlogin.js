'use strict';
// modules/majorlogin.js — Binary string-patch RAFIN response
// Strategi: patch buffer langsung (string replace di binary)
// Tidak re-encode proto → tidak ada risiko field mapping salah

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const crypto   = require('crypto');
const tglog    = require('./tglog');
const { MY_IP } = require('../gamevar');

let MajorLoginRes = null;
let RAFIN         = null;

protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        MajorLoginRes = root.lookupType('freefire.MajorLoginRes');
        RAFIN         = root.lookupType('freefire.RAFIN');
        const msg = '[MAJORLOGIN] Proto loaded OK';
        console.log(msg);
        tglog.send(`✅ <b>Server Start</b>\n${msg}`);
    })
    .catch(err => {
        const msg = `[MAJORLOGIN] Proto load FAILED: ${err.message}`;
        console.error(msg);
        tglog.send(`❌ <b>Proto FAILED</b>\n${msg}`);
    });

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
                const val  = typeof long.toNumber === 'function' ? long.toNumber() : Number(long);
                if (fieldNum === 98) out.is_vpn = val;
            } else if (wireType === 2) {
                const bytes = reader.bytes();
                const str   = bytes.toString('utf8');
                if (fieldNum === 22)  out.open_id        = str;
                if (fieldNum === 23)  out.open_id_type   = str;
                if (fieldNum === 29)  out.access_token   = str.substring(0, 20) + '...';
                if (fieldNum === 57)  out.client_version = str;
                if (fieldNum === 83)  out.version_code   = str;
                if (fieldNum === 20)  out.client_ip      = str;
                if (fieldNum === 11)  out.network_type   = str;
            } else if (wireType === 5) { reader.fixed32();
            } else if (wireType === 1) { reader.fixed64();
            } else { break; }
        }
    } catch (_) {}
    return out;
}

const BAN_REASON_MAP = {
    0: 'UNKNOWN', 1: 'IN_GAME_AUTO', 2: 'REFUND',
    3: 'OTHERS',  4: 'SKINMOD',      1014: 'IN_GAME_AUTO_NEW'
};
function formatBlacklist(bl) {
    if (!bl || !bl.ban_reason) return null;
    const reason = BAN_REASON_MAP[bl.ban_reason] || `code_${bl.ban_reason}`;
    const exp    = bl.expire_duration ? `${bl.expire_duration}s` : 'permanent';
    return `🚫 BAN: ${reason} | expire: ${exp}`;
}
function formatQueue(q) {
    if (!q || q.allow) return null;
    return `⏳ QUEUE pos:${q.queue_position} wait:${q.need_wait_secs}s`;
}

/**
 * patchRafinBuf — patch binary proto buffer langsung
 * Cari string lama di buffer, replace dengan string baru (zero-padded ke panjang sama)
 * Tidak perlu decode/encode proto → tidak ada risiko field mapping salah
 */
function patchStringInBuf(buf, oldStr, newStr) {
    const oldBytes = Buffer.from(oldStr, 'utf8');
    const idx = buf.indexOf(oldBytes);
    if (idx === -1) return { buf, patched: false };

    // Hitung varint length prefix sebelum string
    // Proto wire: field_tag (varint) + length (varint) + bytes
    // Kita cukup ganti content string saja, tapi panjang harus diupdate di length varint
    // Cara paling aman: ganti old content dengan new content zero-padded ke panjang sama
    // Jika new lebih pendek → pad dengan spasi sebelum null (proto mengabaikan trailing \x00)
    // Jika new lebih panjang → truncate (seharusnya tidak terjadi karena proxy URL lebih pendek)

    const newBytes = Buffer.from(newStr, 'utf8');

    if (newBytes.length === oldBytes.length) {
        // Sama panjang — replace langsung
        const result = Buffer.from(buf);
        newBytes.copy(result, idx);
        return { buf: result, patched: true };
    }

    // Panjang berbeda — harus update length varint
    // Cari length varint: mundur dari idx sampai ketemu varint yang nilainya = oldBytes.length
    // Proto varint: 1-2 byte untuk string <128 byte, 2 byte untuk ≥128 byte
    let lengthVarintIdx = -1;
    let lengthVarintSize = 0;

    // Coba 1 byte sebelum string
    if (idx >= 1 && buf[idx - 1] === oldBytes.length) {
        lengthVarintIdx = idx - 1;
        lengthVarintSize = 1;
    }
    // Coba 2 byte sebelum string (multi-byte varint)
    else if (idx >= 2) {
        const b0 = buf[idx - 2], b1 = buf[idx - 1];
        if ((b0 & 0x80) && ((b0 & 0x7f) | ((b1 & 0x7f) << 7)) === oldBytes.length) {
            lengthVarintIdx = idx - 2;
            lengthVarintSize = 2;
        }
    }

    if (lengthVarintIdx === -1) {
        // Tidak bisa update varint — fallback: zero-pad new string ke old length
        console.log(`[MAJORLOGIN] patchStringInBuf: varint not found for "${oldStr.substring(0,30)}", using zero-pad`);
        const padded = Buffer.alloc(oldBytes.length, 0x20); // pad spasi
        newBytes.copy(padded, 0, 0, Math.min(newBytes.length, padded.length));
        const result = Buffer.from(buf);
        padded.copy(result, idx);
        return { buf: result, patched: true };
    }

    // Encode new length sebagai varint
    const newLen = newBytes.length;
    let newVarint;
    if (newLen < 128) {
        newVarint = Buffer.from([newLen]);
    } else {
        newVarint = Buffer.from([(newLen & 0x7f) | 0x80, newLen >> 7]);
    }

    // Susun buffer baru
    const before = buf.slice(0, lengthVarintIdx);
    const after  = buf.slice(idx + oldBytes.length);
    const result = Buffer.concat([before, newVarint, newBytes, after]);
    return { buf: result, patched: true };
}

function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body     = req.body;
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');

        const reqInfo = Buffer.isBuffer(body) && body.length > 0 ? decodeReqFields(body) : {};
        const openId  = reqInfo.open_id || null;

        const proxyBase = MY_IP.replace(/\/$/, '');

        const options = {
            hostname: 'loginbp.ggpolarbear.com',
            path:     '/MajorLogin',
            method:   'POST',
            headers: {
                ...req.headers,
                'host':           'loginbp.ggpolarbear.com',
                'content-length': Buffer.isBuffer(body) ? body.length : 0
            }
        };
        delete options.headers['transfer-encoding'];

        const proxyReq = https.request(options, (proxyRes) => {
            const chunks = [];
            proxyRes.on('data', c => chunks.push(c));
            proxyRes.on('end', () => {
                let buf = Buffer.concat(chunks);
                const patchLog = [];
                let modified = false;

                // ── Patch 1: server_url → proxyBase ──────────────────────────
                // "https://clientbp.ggpolarbear.com" → proxy kita
                const serverUrls = [
                    'https://clientbp.ggpolarbear.com',
                    'http://clientbp.ggpolarbear.com',
                ];
                for (const su of serverUrls) {
                    const r = patchStringInBuf(buf, su, proxyBase);
                    if (r.patched) {
                        buf = r.buf;
                        modified = true;
                        patchLog.push(`server_url: ${su} → ${proxyBase}`);
                        break;
                    }
                }

                // ── Patch 2: tp_url → kosong ──────────────────────────────────
                // "csoversea.stronghold.freefiremobile.com;IP;IP;..." → ""
                // Cari prefix karena isinya dinamis (IP beda-beda)
                const tpPrefix = 'csoversea.stronghold.freefiremobile.com';
                const tpIdx = buf.indexOf(Buffer.from(tpPrefix, 'utf8'));
                if (tpIdx !== -1) {
                    let lenIdx = tpIdx - 1;
                    if (lenIdx >= 0 && buf[lenIdx] > 0 && buf[lenIdx] < 250) {
                        const oldLen = buf[lenIdx];
                        buf[lenIdx] = 0;
                        for (let i = 0; i < oldLen && tpIdx + i < buf.length; i++) {
                            buf[tpIdx + i] = 0;
                        }
                        modified = true;
                        patchLog.push(`tp_url: dikosongkan (${oldLen} bytes)`);
                    }
                }

                // ── Patch 3: ano_url + gin URLs → kosong ──────────────────────
                // ano_url (field 16) = jalur GIN alternatif yang bisa bypass patch
                // gin.freefiremobile.com adalah URL GIN yang sering hardcoded
                const ginPrefixes = [
                    'gin.freefiremobile.com',
                    'ffanti.freefiremobile.com',
                    'grtc.freefiremobile.com',
                ];
                for (const prefix of ginPrefixes) {
                    const gIdx = buf.indexOf(Buffer.from(prefix, 'utf8'));
                    if (gIdx !== -1) {
                        let lenIdx2 = gIdx - 1;
                        if (lenIdx2 >= 0 && buf[lenIdx2] > 0 && buf[lenIdx2] < 250) {
                            const oldLen2 = buf[lenIdx2];
                            buf[lenIdx2] = 0;
                            for (let i = 0; i < oldLen2 && gIdx + i < buf.length; i++) {
                                buf[gIdx + i] = 0;
                            }
                            modified = true;
                            patchLog.push(`${prefix}: dikosongkan (${oldLen2} bytes)`);
                        }
                    }
                }

                // ── Logging & TG ──────────────────────────────────────────────
                let uid = '?', region = '?', token = '?', ttl = 0;
                let banStr = null, queueStr = null;
                try {
                    if (RAFIN) {
                        const rafinObj = RAFIN.toObject(RAFIN.decode(buf), { defaults: true, longs: String });
                        uid    = rafinObj.account_id || '?';
                        region = rafinObj.lock_region || '?';
                        token  = (rafinObj.token || '').substring(0, 20) + '...';
                        ttl    = rafinObj.ttl || 0;
                        banStr   = rafinObj.blacklist  ? formatBlacklist(rafinObj.blacklist)  : null;
                        queueStr = rafinObj.queue_info ? formatQueue(rafinObj.queue_info)      : null;
                    }
                } catch (_) {}

                const status = modified ? '🔑 PATCHED' : '✅ LOGIN OK';
                const lines  = [`<b>MajorLogin — ${status}</b>`, ''];
                lines.push(`👤 UID: <code>${uid}</code>`);
                lines.push(`🆔 open_id: <code>${openId || '?'}</code>`);
                if (reqInfo.client_version) lines.push(`📱 ver: ${reqInfo.client_version}`);
                lines.push(`🌏 region: ${region}`);
                lines.push(`🌐 ip: ${clientIp}`);
                lines.push(`🎫 token: <code>${token}</code>`);
                if (ttl) lines.push(`⏱ ttl: ${ttl}s`);
                if (patchLog.length) lines.push(`🔧 patch:\n  ${patchLog.join('\n  ')}`);
                if (banStr)   { lines.push(''); lines.push(banStr); }
                if (queueStr) { lines.push(''); lines.push(queueStr); }

                console.log(`[MAJORLOGIN] uid=${uid} region=${region} modified=${modified} patches=[${patchLog.join(', ')}]`);
                tglog.send(lines.join('\n'));

                const newHeaders = { ...proxyRes.headers, 'content-length': buf.length };
                delete newHeaders['transfer-encoding'];
                res.writeHead(proxyRes.statusCode, newHeaders);
                res.end(buf);
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

    console.log('[MAJORLOGIN] Active → binary-patch mode (no proto re-encode)');
}

module.exports = { init };
