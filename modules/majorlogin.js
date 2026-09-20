'use strict';
// modules/majorlogin.js — v15
//
// FIX:
// 1. Pass-through raw → signature valid (dari v14)
// 2. Binary patch field 12 (blacklist) langsung di raw buffer SEBELUM pass-through
//    → ban_reason=0, expire_duration=0, ban_time=0 tanpa re-encode seluruh proto
//    → signature tetap valid? TIDAK — byte berubah = signature invalid
//
// CONCLUSION: Tidak bisa patch binary DAN jaga signature sekaligus.
// Solusi real: Zero-out field 12 dengan ukuran SAMA (in-place, sama persis byte count)
// → signature masih invalid karena konten berubah
//
// SOLUSI FINAL: strip field 12 tidak bisa. Yang bisa:
// - Pass-through raw (signature valid) → akun banned tetap kena ban screen
// - Re-encode (signature invalid) → SignatureCheckFailed
//
// WORKAROUND: Force login via Guest account baru jika MajorLogin return ban.
// Decode response untuk deteksi ban → jika banned, return spoofed response
// dengan ban_reason=0 DAN recalculate signature... tapi kita tidak punya key.
//
// REAL SOLUTION: Patch di Assembly-CSharp-patch.bytes untuk disable
// signature check di client-side. Itu sudah ada di .bytes patch yang dipakai.
// Jadi: pass-through raw, client skip signature check karena patch bytes,
// dan client baca proto normal → akun banned tetap kena ban screen dari proto.
//
// UNTUK BAN: patch di GetMatchmakingBlacklist (JSON, bisa di-patch).
// MajorLogin ban = ban screen awal, GetMatchmakingBlacklist ban = ban saat match.
// Dua-duanya perlu di-patch.
//
// v15: Pass-through raw + decode untuk TG log + deteksi ban untuk warning.

const https    = require('https');
const protobuf = require('protobufjs');
const path     = require('path');
const tglog    = require('./tglog');

let RAFIN = null;
protobuf.load(path.join(__dirname, '..', 'MajorLoginRes.proto'))
    .then(root => {
        RAFIN = root.lookupType('freefire.RAFIN');
        console.log('[MAJORLOGIN] v15 Proto loaded');
    })
    .catch(err => console.error('[MAJORLOGIN] Proto load err:', err.message));

function decodeReqFields(buf) {
    const out = {};
    try {
        const r = protobuf.Reader.create(buf);
        while (r.pos < r.len) {
            const tag = r.uint32(), fn = tag >>> 3, wt = tag & 7;
            if (wt === 0) { r.uint64(); }
            else if (wt === 2) {
                const str = r.bytes().toString('utf8');
                if (fn === 22) out.open_id        = str;
                if (fn === 57) out.client_version = str;
            } else if (wt === 5) { r.fixed32();
            } else if (wt === 1) { r.fixed64();
            } else { break; }
        }
    } catch (_) {}
    return out;
}

// ── Binary excise field dari proto buffer ───────────────────────────────────
// Hapus field N sepenuhnya dari buffer — ukuran buffer berubah tapi
// protobuf wire format tetap valid untuk field lain
function encodeVarint(val) {
    const out = [];
    while (val > 0x7f) { out.push((val & 0x7f) | 0x80); val >>>= 7; }
    out.push(val & 0x7f);
    return Buffer.from(out);
}

function readVarint(buf, pos) {
    let val = 0, shift = 0, bytes = 0;
    while (pos + bytes < buf.length) {
        const b = buf[pos + bytes];
        val |= (b & 0x7f) << shift;
        bytes++; shift += 7;
        if (!(b & 0x80)) break;
        if (shift >= 35) break;
    }
    return { val, bytes };
}

function exciseField(buf, fieldNum, wireType) {
    const targetTag = (fieldNum << 3) | wireType;
    const tagBuf    = encodeVarint(targetTag);
    const out       = [];
    let   pos       = 0;
    let   removed   = false;

    while (pos < buf.length) {
        let tagMatch = pos + tagBuf.length <= buf.length;
        for (let i = 0; i < tagBuf.length && tagMatch; i++) {
            if (buf[pos + i] !== tagBuf[i]) tagMatch = false;
        }
        if (!tagMatch) { out.push(buf[pos]); pos++; continue; }

        let cur = pos + tagBuf.length;
        if (wireType === 2) {
            const { val: len, bytes: lb } = readVarint(buf, cur);
            cur += lb + len;
        } else if (wireType === 0) {
            while (cur < buf.length && (buf[cur] & 0x80)) cur++;
            cur++;
        } else if (wireType === 1) { cur += 8;
        } else if (wireType === 5) { cur += 4; }

        removed = true;
        pos = cur;
    }
    return { buf: Buffer.from(out), removed };
}

// ── In-place zero server_url dari binary RAFIN ──────────────────────────────
// Ganti content string DALAM BUFFER dengan null bytes (ukuran sama → signature aman)
// Targetkan field 10 (server_url), 14 (tp_url), 16 (ano_url) dengan nilai clientbp/loginbp
// Cari literal string dan zero in-place tanpa mengubah buffer length
function zeroServerUrls(buf) {
    // Pattern: semua URL yang mengandung kata kunci server game Garena
    // Zero hanya content byte string, bukan tag/length byte
    const TARGET_PATTERNS = [
        // Domain yang ketahuan dipakai Garena
        'ppmainecoonghj.com',
        'ggpolarbear.com',
        'ggblueshark.com',
        // Pattern umum clientbp/loginbp — semua subdomain
        'clientbp.',
        'loginbp.',
    ];

    let patched = false;
    for (const pattern of TARGET_PATTERNS) {
        const needle = Buffer.from(pattern, 'utf8');
        let pos = 0;
        while (pos <= buf.length - needle.length) {
            let match = true;
            for (let i = 0; i < needle.length; i++) {
                if (buf[pos + i] !== needle[i]) { match = false; break; }
            }
            if (match) {
                // Mundur untuk cari awal string proto (setelah tag+length)
                // Cari awal URL: mundur sampai ketemu "https://" atau "http://"
                let urlStart = pos;
                // Mundur max 20 byte untuk cari "http"
                for (let back = 1; back <= Math.min(20, pos); back++) {
                    if (buf[pos - back] === 0x68 && // 'h'
                        buf[pos - back + 1] === 0x74 && // 't'
                        buf[pos - back + 2] === 0x74) { // 't'
                        urlStart = pos - back;
                        break;
                    }
                }
                // Cari akhir string: maju sampai bukan printable URL char atau buffer end
                let urlEnd = urlStart;
                while (urlEnd < buf.length && buf[urlEnd] >= 0x21 && buf[urlEnd] <= 0x7e) urlEnd++;

                // Zero seluruh URL range
                buf.fill(0, urlStart, urlEnd);
                patched = true;
                console.log('[MAJORLOGIN] zeroServerUrl: zeroed', urlEnd - urlStart, 'bytes at pos', urlStart);
                pos = urlEnd;
            } else {
                pos++;
            }
        }
    }
    return patched;
}

const BAN_MAP = {0:'UNKNOWN',1:'IN_GAME_AUTO',2:'REFUND',3:'OTHERS',4:'SKINMOD',1014:'IN_GAME_AUTO_NEW'};

function init(app) {
    app.post('/MajorLogin', (req, res) => {
        const body     = req.body;
        const rawIp    = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const clientIp = rawIp.split(',')[0].trim().replace('::ffff:', '');
        const reqInfo  = Buffer.isBuffer(body) && body.length > 0 ? decodeReqFields(body) : {};

        const options = {
            hostname: 'loginbp.ggpolarbear.com',
            path: '/MajorLogin', method: 'POST',
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

                // 404 pass-through
                if (proxyRes.statusCode === 404 && rawBuf.toString('utf8').includes('account_not_found')) {
                    const h = { ...proxyRes.headers, 'content-length': rawBuf.length };
                    delete h['transfer-encoding'];
                    res.writeHead(404, h); return res.end(rawBuf);
                }

                // Non-200 pass-through
                if (proxyRes.statusCode !== 200 || rawBuf.length === 0) {
                    const h = { ...proxyRes.headers, 'content-length': rawBuf.length };
                    delete h['transfer-encoding'];
                    res.writeHead(proxyRes.statusCode, h); return res.end(rawBuf);
                }

                // ── Decode untuk log + deteksi ban ───────────────────────────
                let uid = '?', region = '?', token = '?', ttl = 0;
                let banStr = null, isBanned = false;

                try {
                    if (RAFIN) {
                        const obj = RAFIN.toObject(RAFIN.decode(rawBuf), {
                            defaults: false, longs: String, enums: Number,
                            bytes: Buffer, keepCase: true,
                        });
                        uid    = obj.account_id  || '?';
                        region = obj.lock_region || '?';
                        token  = (obj.token || '').substring(0, 20) + '...';
                        ttl    = obj.ttl || 0;
                        // Deteksi ban: cek blacklist.ban_reason > 0 atau is_banned field
                        const bl = obj.blacklist;
                        const banReason = (bl && typeof bl.ban_reason === 'number') ? bl.ban_reason : 0;
                        const isBannedField32 = (typeof obj.is_banned === 'number') ? obj.is_banned : 0;
                        if (banReason > 0 || isBannedField32 > 0) {
                            isBanned = true;
                            banStr = `🚫 BAN: ${BAN_MAP[banReason]||banReason} | type: ${bl?.ban_type||'-'} | expire: ${bl?.expire_duration||0}s`;
                        }
                    }
                } catch (_) {}

                // ── Jika banned: excise field 12 (blacklist) dari binary ──────
                // Assembly-CSharp-patch.bytes menonaktifkan signature check di client
                // sehingga binary yang sudah dimodif tetap diterima game
                // ── Binary patch RAFIN response ─────────────────────────────
                // 1. zeroServerUrls: zero server_url in-place (ukuran sama → signature aman)
                //    Ini mencegah game bypass proxy via domain baru Garena
                // 2. excise field12 (blacklist) kalau banned (signature tetap ok via .bytes patch)
                let outBuf = Buffer.from(rawBuf); // copy supaya tidak mutate original
                const patchLog = [];

                // Zero server_url in-place SELALU (sebelum kirim ke client)
                if (zeroServerUrls(outBuf)) {
                    patchLog.push('server_url-zeroed-inplace');
                }

                if (isBanned) {
                    const { buf: excised, removed } = exciseField(outBuf, 12, 2);
                    if (removed) {
                        outBuf = excised;
                        patchLog.push(`blacklist field12 excised (${rawBuf.length}b→${outBuf.length}b)`);
                        console.log(`[MAJORLOGIN] v15 ban detected → field12 excised uid=${uid}`);
                    }
                }

                // TG log
                const lines = [`<b>MajorLogin v15</b>`, ''];
                lines.push(`👤 <code>${uid}</code> | 🌏 ${region}`);
                lines.push(`🆔 <code>${reqInfo.open_id||'?'}</code> | 🌐 ${clientIp}`);
                lines.push(`🎫 <code>${token}</code>${ttl ? ` ⏱${ttl}s` : ''}`);
                lines.push(`📦 raw=${rawBuf.length}b out=${outBuf.length}b`);
                if (patchLog.length) lines.push(`🔧 ${patchLog.join(', ')}`);
                if (banStr) { lines.push(''); lines.push(banStr); }
                tglog.send(lines.join('\n'));

                const h = {
                    ...proxyRes.headers,
                    'content-length': outBuf.length,
                };
                delete h['transfer-encoding'];
                delete h['content-encoding'];
                res.writeHead(proxyRes.statusCode, h);
                res.end(outBuf);
            });

            proxyRes.on('error', err => {
                console.error('[MAJORLOGIN] err:', err.message);
                if (!res.headersSent) res.status(502).send('Error');
            });
        });

        proxyReq.on('error', err => {
            console.error('[MAJORLOGIN] proxy err:', err.message);
            tglog.send(`❌ MajorLogin: ${err.message}`);
            if (!res.headersSent) res.status(502).send('Proxy Error');
        });

        if (Buffer.isBuffer(body) && body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });

    console.log('[MAJORLOGIN] v15 active — pass-through + field12 excise if banned');
}

module.exports = { init };
