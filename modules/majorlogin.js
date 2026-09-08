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
    return `🚫 BAN (original): ${reason} | expire: ${exp}`;
}
function formatQueue(q) {
    if (!q || q.allow) return null;
    return `⏳ QUEUE pos:${q.queue_position} wait:${q.need_wait_secs}s`;
}

/**
 * patchStringInBuf — patch binary proto buffer langsung
 * Cari string lama di buffer, replace dengan string baru (zero-padded ke panjang sama)
 */
function patchStringInBuf(buf, oldStr, newStr) {
    const oldBytes = Buffer.from(oldStr, 'utf8');
    const idx = buf.indexOf(oldBytes);
    if (idx === -1) return { buf, patched: false };

    const newBytes = Buffer.from(newStr, 'utf8');

    if (newBytes.length === oldBytes.length) {
        const result = Buffer.from(buf);
        newBytes.copy(result, idx);
        return { buf: result, patched: true };
    }

    let lengthVarintIdx = -1;
    let lengthVarintSize = 0;

    if (idx >= 1 && buf[idx - 1] === oldBytes.length) {
        lengthVarintIdx = idx - 1;
        lengthVarintSize = 1;
    }
    else if (idx >= 2) {
        const b0 = buf[idx - 2], b1 = buf[idx - 1];
        if ((b0 & 0x80) && ((b0 & 0x7f) | ((b1 & 0x7f) << 7)) === oldBytes.length) {
            lengthVarintIdx = idx - 2;
            lengthVarintSize = 2;
        }
    }

    if (lengthVarintIdx === -1) {
        console.log(`[MAJORLOGIN] patchStringInBuf: varint not found for "${oldStr.substring(0,30)}", using zero-pad`);
        const padded = Buffer.alloc(oldBytes.length, 0x20);
        newBytes.copy(padded, 0, 0, Math.min(newBytes.length, padded.length));
        const result = Buffer.from(buf);
        padded.copy(result, idx);
        return { buf: result, patched: true };
    }

    const newLen = newBytes.length;
    let newVarint;
    if (newLen < 128) {
        newVarint = Buffer.from([newLen]);
    } else {
        newVarint = Buffer.from([(newLen & 0x7f) | 0x80, newLen >> 7]);
    }

    const before = buf.slice(0, lengthVarintIdx);
    const after  = buf.slice(idx + oldBytes.length);
    const result = Buffer.concat([before, newVarint, newBytes, after]);
    return { buf: result, patched: true };
}

/**
 * PATCH BARU: Hapus field blacklist (field number 12, wire type 2) dari RAFIN proto.
 *
 * Proto wire format:
 *   tag = (field_number << 3) | wire_type
 *   field 12, wire_type 2 (LEN) → tag = (12 << 3) | 2 = 98 = 0x62
 *   Layout: [0x62] [varint length] [submessage bytes...]
 *
 * Strategi: scan seluruh buffer cari tag 0x62, decode length varint,
 * lalu cek apakah submessage berisi field ban_reason (field 1, wire 0 = 0x08)
 * dengan nilai != 0. Kalau iya → zero-out seluruh segment (tag+length+bytes)
 * sehingga proto parser skip field itu (null bytes di proto = field tidak ada).
 *
 * Fallback: kalau RAFIN sudah ter-decode, rebuild tanpa field blacklist.
 */
function patchBlacklistField(buf) {
    // Tag untuk field 12, wire type 2 (LEN/submessage)
    const BLACKLIST_TAG = 0x62; // (12 << 3) | 2

    let result = Buffer.from(buf);
    let patched = false;
    let pos = 0;

    while (pos < result.length) {
        // Cari tag byte
        const tagByte = result[pos];

        if (tagByte !== BLACKLIST_TAG) {
            pos++;
            continue;
        }

        // Kemungkinan ketemu field 12 submessage
        // Decode varint length setelah tag
        let lengthPos = pos + 1;
        let msgLen = 0;
        let shift = 0;
        let varintSize = 0;

        while (lengthPos + varintSize < result.length) {
            const b = result[lengthPos + varintSize];
            msgLen |= (b & 0x7f) << shift;
            shift += 7;
            varintSize++;
            if (!(b & 0x80)) break;
            if (varintSize > 4) { msgLen = -1; break; } // too long, bukan varint valid
        }

        if (msgLen <= 0 || msgLen > 1000) {
            // Bukan varint valid / terlalu besar untuk blacklist submessage → skip
            pos++;
            continue;
        }

        const submsgStart = lengthPos + varintSize;
        const submsgEnd   = submsgStart + msgLen;

        if (submsgEnd > result.length) {
            pos++;
            continue;
        }

        // Cek apakah submessage ini punya field ban_reason (field 1, wire 0) = tag 0x08
        // dan nilainya != 0 (artinya ada ban)
        const submsg = result.slice(submsgStart, submsgEnd);
        let hasBanReason = false;
        let scanPos = 0;

        try {
            while (scanPos < submsg.length) {
                const st  = submsg[scanPos];
                const sfn = st >>> 3;
                const swt = st & 0x7;
                scanPos++;
                if (swt === 0) {
                    // varint
                    let val = 0, sh = 0;
                    while (scanPos < submsg.length) {
                        const b = submsg[scanPos++];
                        val |= (b & 0x7f) << sh;
                        sh += 7;
                        if (!(b & 0x80)) break;
                    }
                    if (sfn === 1 && val !== 0) { // ban_reason != 0
                        hasBanReason = true;
                        break;
                    }
                } else if (swt === 2) {
                    // LEN — skip
                    let slen = 0, ssh = 0;
                    while (scanPos < submsg.length) {
                        const b = submsg[scanPos++];
                        slen |= (b & 0x7f) << ssh;
                        ssh += 7;
                        if (!(b & 0x80)) break;
                    }
                    scanPos += slen;
                } else if (swt === 5) { scanPos += 4;
                } else if (swt === 1) { scanPos += 8;
                } else { break; }
            }
        } catch (_) {}

        if (hasBanReason) {
            // Zero-out seluruh segment: tag + varint + submessage
            // Proto parser akan skip null bytes → blacklist field jadi tidak ada
            const segEnd = submsgEnd;
            result.fill(0x00, pos, segEnd);
            console.log(`[MAJORLOGIN] 🔧 Blacklist field CLEARED: pos=${pos} len=${msgLen} (ban_reason was non-zero)`);
            patched = true;
            pos = segEnd;
        } else {
            pos++;
        }
    }

    return { buf: result, patched };
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

                // ── Patch 0: BLACKLIST FIELD CLEAR (PALING KRITIS) ───────────
                // Field 12 (blacklist) di RAFIN proto harus di-zero-out
                // supaya game tidak trigger UIAccountForbiddenPopWndController
                const blResult = patchBlacklistField(buf);
                if (blResult.patched) {
                    buf = blResult.buf;
                    modified = true;
                    patchLog.push('blacklist_field: CLEARED (field 12 zeroed)');
                }

                // ── Patch 1: server_url → proxyBase ──────────────────────────
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

                // ── Patch 3: ffanti_url → kosong ─────────────────────────────
                // Field ano_url (field 16) dan ffanti_url bisa juga kena validasi
                const ffantiPrefixes = ['https://ffanti.', 'ffanti.', 'ff.anti.'];
                for (const prefix of ffantiPrefixes) {
                    const ffIdx = buf.indexOf(Buffer.from(prefix, 'utf8'));
                    if (ffIdx !== -1) {
                        let lenIdx2 = ffIdx - 1;
                        if (lenIdx2 >= 0 && buf[lenIdx2] > 0 && buf[lenIdx2] < 200) {
                            const oldLen2 = buf[lenIdx2];
                            buf[lenIdx2] = 0;
                            for (let i = 0; i < oldLen2 && ffIdx + i < buf.length; i++) {
                                buf[ffIdx + i] = 0;
                            }
                            modified = true;
                            patchLog.push(`ffanti_url: dikosongkan`);
                        }
                        break;
                    }
                }

                // ── Logging & TG ──────────────────────────────────────────────
                let uid = '?', region = '?', token = '?', ttl = 0;
                let banStr = null, queueStr = null;
                try {
                    if (RAFIN) {
                        // Decode SEBELUM patch untuk log saja (decode dari buf asli tidak mungkin
                        // karena kita sudah zero-out, jadi log ban reason dari decode sebelum clear)
                        // Kita log dari parsing manual jika perlu, atau skip decode setelah clear
                        const rafinObj = RAFIN.toObject(RAFIN.decode(buf), { defaults: true, longs: String });
                        uid    = rafinObj.account_id || '?';
                        region = rafinObj.lock_region || '?';
                        token  = (rafinObj.token || '').substring(0, 20) + '...';
                        ttl    = rafinObj.ttl || 0;
                        // blacklist sudah di-clear, jadi blacklist di rafinObj harusnya null/0
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
                if (banStr)   { lines.push(''); lines.push(banStr + ' ← CLEARED'); }
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

    console.log('[MAJORLOGIN] Active → binary-patch mode + BLACKLIST CLEAR');
}

module.exports = { init };
