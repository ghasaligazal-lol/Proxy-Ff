# Proxy FF — Structure Jun (dl-xpanel.junofficial.web.id)

## Folder Structure
```
app.js                 ← Entry point
gamevar.js             ← Config ver.php + gamevar lines
package.json
modules/
  app.js routes, loaded otomatis
  tglog.js             ← Telegram logger
  cdn.js               ← CDN local+proxy, handle cache_res & fileinfo
  auth.js              ← Key session auth
  keys.js              ← Key engine (JSON flat file)
  skin.js              ← Emote/skin inject
  gamevar.js           ← ver.php handler
  majorlogin.js        ← MajorLogin interceptor + Tg log
  proxy.js             ← Forward ke Garena + ban patch
  guest.js             ← Guest login
  ping.js              ← /Ping handler
  newbie.js            ← Newbie choice
  routes.js            ← Static routes
  404.js               ← Fallback 404
  user-agent.js        ← UA pool (unused, bisa dipakai proxy)
  protobuf.js          ← Protobuf helper
public/
  index.html           ← Landing page
  cdn/
    cache_res          ← Cache res file (dari Jun/upload)
    fileinfo           ← Tidak ada di sini, lihat live/ABHotUpdates/
    localconfig.json   ← { verAddr, resetGuest }
    libAPKBYPASS.so    ← .so bypass
    live/
      ABHotUpdates/
        fileinfo       ← List file CDN (diakses game)
        gameassetbundles/
          assembly-csharp-patch.*
          codepatch/
            assembly-csharp-patch.*
    android_max_astc/
      2.130.22/
        gameassetbundles/  ← Asset ASTC
    IconCDN/android/       ← Icon weapon/skin
    common/                ← Common assets
db/
  keys.json            ← Key database (auto-created)
  localconfig.json     ← (auto-created jika belum ada)
```

## Konfigurasi
Edit `gamevar.js` baris ini:
```js
const MY_IP = process.env.PROXY_URL || "https://DOMAIN-KAMU/";
```
Atau set env variable: `PROXY_URL=https://domain-kamu.railway.app/`

## Deploy Railway
1. Upload folder ini
2. Set `PROXY_URL` di Environment Variables
3. Opsional: `TG_BOT_TOKEN` dan `TG_CHAT_ID` buat Telegram log

## Endpoints Penting
- `GET /ver.php` atau `GET /api/gamevar` → Config game
- `GET /cdn/cache_res` → Cache res file
- `GET /cdn/live/ABHotUpdates/fileinfo` → Fileinfo
- `GET /localconfig.json` → Config lokal
- `POST /auth/login` → Login key
- `GET /auth/checkkey?key=XXXX` → Cek key
