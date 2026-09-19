# FF Proxy by Reza — OB55

## Deploy Railway
1. Upload repo ke GitHub → connect ke Railway
2. Set env variables:
   - `PROXY_URL` = URL Railway kamu (contoh: `https://xxx.up.railway.app/`)
   - `TG_BOT_TOKEN` = token bot Telegram
   - `TG_CHAT_ID` = chat ID Telegram kamu
   - `PORT` = 3030 (Railway set otomatis)

## Setup Device (TANPA ROOT)
1. Download `localconfig.json` dari dashboard → taruh di:
   `/storage/emulated/0/Android/data/com.dts.freefireth/files/localConfig.json`
2. Import `BypassReza.json` ke AdAway (blok domain anticheat)
3. Buka game — ver.php akan hit proxy, bukan Garena

## File Structure
```
public/
  cdn/
    cache_res           — cache_res file (binary)
    localconfig.json    — localConfig untuk device
    libAPKBYPASS.so     — bypass library
  api/
    live/
      ABHotUpdates/
        fileinfo        — fileinfo dengan hash codepatch diupdate
  index.html            — dashboard
```

## Modules
- `majorlogin.js` — intercept MajorLogin, patch proto, disable anticheat
- `gamevar.js` — serve ver.php dengan gamevar disable anticheat + RunSpeed
- `proxy.js` — forward ke loginbp/clientbp, patch JSON ban/GIN
- `cdn.js` — serve CDN files, intercept fileinfo
- `ping.js` — serve /Ping dalam format protobuf
- `config.js` — simpan/baca config speed+sensi dari dashboard
- `tglog.js` — notifikasi Telegram

## Changelog v2.1.0
- Fix: `require('../gamevar')` di proxy.js → langsung pakai `process.env.PROXY_URL`
- Fix: cdn.js tambah handler `/live/ABHotUpdates/android_astc/<ver>/fileinfo`
- Fix: gamevar config reload fresh dari disk (bukan cache module)
- Fix: IP FFRTC hardcoded (202.181.82.79 dll) ditambah ke gin domain pattern
- Fix: protobufjs pinned ke v7 (v8 ada breaking changes)
- Fix: localconfig.json tambah `testCodePatch: false`
