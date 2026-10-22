# Metrik Transparansi AIPEX VeriBot — Batch ycwc-001

> Halaman publik `/transparansi` (Tier-1) merender dari file ini + 1 baris `eval_runs`.
> Tidak ada data pribadi di sini (UU PDP No. 27/2022). Foto asli hanya di bucket privat `eval-fotos`.

## 1. Ringkasan (diisi setelah run)
- n = 100 foto asli (40 KTP tajam + 20 KK/Akta + 20 BURAM + 20 bukan-KTP)
- Batch: `ycwc-001` | Tanggal run: ____ | Tanggal purge: ____ (+14 hari)
- F1 global: ____ | F1 LAINNYA: ____ | F1 BURAM: ____
- Latency p50: ____ ms | p95: ____ ms | Cache-hit: ____%

## 2. Confusion Matrix (angka, tanpa identifier)
```
            pred KTP  KK  AKTA  LAINNYA
true KTP      __    __   __     __
true KK       __    __   __     __
true AKTA     __    __   __     __
true LAINNYA  __    __   __     __
```

## 3. Metodologi
1. Upload via `POST /api/eval/upload` (officer JWT) → enkripsi AES-256-GCM (`EVAL_MASTER_KEY`) → bucket privat `eval-fotos`.
2. Evaluasi via pipeline OCR yang sama dengan warga (`POST /api/ocr`), NIK di-mask sebelum log (`maskNik()`).
3. Hanya agregat yang dipublikasi. Detail per-file hanya di `/transparansi/detail` (JWT).

## 4. Keterbatasan
- 1 kelurahan, 2–3 tipe HP, variasi cahaya terbatas (terang/redup/backlight).
- F1 BURAM <0.75 berarti perlu panduan foto ulang lebih baik — bukan kegagalan vonis.

## 5. Contoh Redacted (3 file, NIK/wajah/alamat kotak hitam, EXIF dibersihkan)
- `public/evidence/metrics/redacted-01.jpg`
- `public/evidence/metrics/redacted-02.jpg`
- `public/evidence/metrics/redacted-03.jpg`
