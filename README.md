# Proxy FF — Speed + Sensi Only (Clean Build)

Mode ini hanya inject **RunSpeed** dan **Sensitivity** ke gamevar.
Tidak ada cache_res patch, tidak ada hitbox mod, tidak ada skin inject, tidak ada mail inject.
Asset game didownload langsung dari server Garena resmi → lebih aman.

## Yang Ada
- ✅ Bypass GIN / GGP / anticheat (wajib untuk proxy)
- ✅ Ban mode patch (MajorLogin + GetLoginData)
- ✅ RunSpeed inject (dynamic dari dashboard)
- ✅ Sensitivity inject (dynamic dari dashboard)
- ✅ Telemetry / upload spoof
- ✅ CDN local + proxy ke Garena
- ✅ Telegram login notification

## Yang Tidak Ada
- ❌ Skin / emote / avatar inject
- ❌ Mail inject / fake mail
- ❌ Login reward fake
- ❌ Cache_res patch (hitbox mod)
- ❌ ESP / aimbot

## Konfigurasi
Edit `.env` atau set env vars di Railway:
```
PROXY_URL=https://domain-kamu.railway.app/
TG_BOT_TOKEN=your_token
TG_CHAT_ID=your_chat_id
```

## Dashboard API
- `GET /api/config` — baca config saat ini
- `POST /api/config` — simpan config

Body POST:
```json
{
  "runSpeed": 5.5,
  "sensi": {
    "SensitivityMaxSetting": 9.5,
    "Sensitivity1PMaxSetting": 9.5,
    "X1ScopeMaxSetting": 9.5,
    "X2ScopeMaxSetting": 9.5,
    "X4ScopeMaxSetting": 9.5,
    "X8ScopeMaxSetting": 9.5,
    "FreeLookMaxSetting": 9.5
  }
}
```
`runSpeed: null` = tidak inject (default game).

## Deploy Railway
1. Upload folder ini
2. Set `PROXY_URL` di Environment Variables
3. Opsional: `TG_BOT_TOKEN` dan `TG_CHAT_ID`
