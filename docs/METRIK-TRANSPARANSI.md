# Metrik Transparansi AIPEX VeriBot — Batch ycwc-001

> Halaman publik `/transparansi` (Tier-1) merender dari 1 baris `eval_runs`.
> Tidak ada data pribadi di sini (UU PDP No. 27/2022). Foto asli hanya di bucket privat `eval-fotos`.

## 1. Ringkasan (diisi setelah run)
- n = 100 foto asli; komposisi mengikuti `eval/labels.csv` (7 jenis dokumen + LAINNYA)
- Batch: `ycwc-001` | Tanggal run: ____ | Tanggal purge: ____ (+14 hari)
- F1 global (macro atas kelas yang ada di ground truth): ____
- F1 LAINNYA: ____ | F1 BURAM: ____
- Latency p50: ____ ms | p95: ____ ms | Cache-hit: ____%

## 2. Rincian per jenis
Angka diisi dari `per_jenis` di `eval/results.json` setelah run. Hanya agregat; tidak ada
file_id/NIK/nama di dokumen ini.

| Jenis | Support | Precision | Recall | F1 |
|---|---:|---:|---:|---:|
| KTP | __ | __ | __ | __ |
| KK | __ | __ | __ | __ |
| AKTA | __ | __ | __ | __ |
| AKTA_KEMATIAN | __ | __ | __ | __ |
| AKTA_PERKAWINAN | __ | __ | __ | __ |
| SURAT_PINDAH | __ | __ | __ | __ |
| KIA | __ | __ | __ | __ |
| LAINNYA | __ | __ | __ | __ |

## 3. Metodologi
1. Label + foto asli disiapkan lokal di `eval/labels.csv` + `eval/private/`.
2. `python scripts/evaluate-eval-bucket.py --ingest` membaca CSV, mengenkripsi foto dengan
   AES-256-GCM (`EVAL_MASTER_KEY`, kunci turunan per-file), mengunggah ke bucket privat
   `eval-fotos`, lalu mencatat `eval_labels`. Tidak ada NIK/nama di tabel.
3. Evaluasi memanggil pipeline OCR yang sama dengan warga (`POST /api/ocr` ke server lokal),
   NIK di-mask sebelum log (`maskNik()`).
4. `--publish` menulis agregat ke `eval_runs` dan vonis per-file (tanpa foto/NIK) ke
   `eval_predictions`. Hanya `eval_runs` yang dibaca halaman publik Tier-1.
5. Detail per-file hanya di `/transparansi` Tier-2 (JWT petugas).

## 4. Keterbatasan
- 1 kelurahan, 2–3 tipe HP, variasi cahaya terbatas (terang/redup/backlight).
- F1 BURAM <0.75 berarti perlu panduan foto ulang lebih baik — bukan kegagalan vonis.
- Macro F1 dihitung atas kelas yang benar-benar ada di ground truth; kelas tanpa support
  tidak menurunkan skor secara artifisial.

## 5. Contoh Redacted (3 file, NIK/wajah/alamat kotak hitam, EXIF dibersihkan)
- `public/evidence/metrics/redacted-01.jpg`
- `public/evidence/metrics/redacted-02.jpg`
- `public/evidence/metrics/redacted-03.jpg`
