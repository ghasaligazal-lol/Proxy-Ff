# EMU-PROXY

Proxy minimalis — **satu fungsi**: spoof `emulator_score=100` dan `is_emulator=true`.

## Cara pakai

1. Deploy ke Railway / VPS
2. Set `verAddr` di `localConfig.json` ke URL proxy ini
3. Proxy akan forward semua traffic ke Garena, dan patch field emulator di setiap response

## Yang di-patch

| Field | Sebelum | Sesudah |
|-------|---------|---------|
| `emulator_score` | 0 | 100 |
| `is_emulator` | false | true |
| `is_emulator_pool` | false | true |
| JWT `emulator_score` | 0 | 100 |
| JWT `is_emulator` | false | true |

## Yang TIDAK diubah

- `server_url` — game tetap connect ke server Garena normal
- Match server, routing, semua endpoint — forward apa adanya
- Tidak ada patch bypass, ban, CDN, dll

## ENV

- `PORT` — default 3000
