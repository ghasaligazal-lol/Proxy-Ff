# FF MAX Proxy — FIX v3.2 (Safe Splice + Speed/Sensi Mode + Dashboard)

## v3 — Login fix
- Blacklist: SPLICE OUT field 12 (support ban_type string)
- Hapus zero-out yang bikin Unconsumed data
- Proto ditambah ban_type, kts, ak, aiv, ffanti_url

## v3.1 — Mode speed_sensi
- bodyMode baru: `speed_sensi`
- Hanya inject RunSpeed + Sensitivity + FreeMoveAngular
- cache_res download dari official CDN

## v3.2 — Dashboard
- Tombol **Speed + Sensi** ditambah di Body Mode
- Speed & Sensi panel aktif juga di mode speed_sensi
- Grid mode jadi 2x2 biar muat 4 pilihan
- Config bisa disimpan lewat tombol Simpan Config

### Cara pakai mode Speed + Sensi
1. Buka dashboard
2. Klik **Speed + Sensi**
3. Atur Run Speed + Sensitivity
4. Klik **Simpan Config**
5. Restart game / login ulang

Mode:
| bodyMode     | Gamevar              | Cache/CDN          |
|--------------|----------------------|--------------------|
| hs_only      | normal (no mod)      | proxy              |
| speed_sensi  | speed + sensi only   | official CDN       |
| full         | full mod             | proxy + assets     |
| esp          | full mod             | no cache_res       |
