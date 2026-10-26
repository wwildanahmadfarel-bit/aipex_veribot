# eval/ — Dataset evaluasi batch ycwc-001 (PRIVAT)

- `private/` — 100 foto asli (gitignored, tidak boleh commit). Nama file mengikuti
  `labels.csv` (mis. `P001.jpg`). Foto dienkripsi AES-256-GCM lalu diunggah ke bucket
  privat `eval-fotos`.
- `labels.csv` — label kebenaran TANPA NIK/nama. Boleh commit (tidak ada data pribadi).
  Kolom: `filename,jenis_true,status_true,lighting,device,relawan_id,consent_ref`.
  `jenis_true`: KTP / KK / AKTA / AKTA_KEMATIAN / AKTA_PERKAWINAN / SURAT_PINDAH / KIA / LAINNYA.
  `status_true`: BERHASIL / BURAM / TIDAK_VALID.
- `results.json` — agregat metrik (F1, latency, cache-hit) untuk halaman `/transparansi`
  Tier-1. Boleh commit.
- `results-private.json` — log per-file (gitignored, dihapus saat purge).

## Alur

1. Consent fisik dari relawan dicatat (`consent_ref`) sebelum foto diambil.
2. Isi `labels.csv` dan taruh foto di `private/`.
3. Jalankan server lokal: `npm run dev` (port 3000).
4. Ingest + evaluasi + publish dalam satu perintah:

   ```bash
   python scripts/evaluate-eval-bucket.py --all --base-url http://localhost:3000
   ```

   Ingin bertahap?

   ```bash
   python scripts/evaluate-eval-bucket.py --ingest
   python scripts/evaluate-eval-bucket.py --publish --base-url http://localhost:3000
   ```

5. Verifikasi:

   ```bash
   curl "http://localhost:3000/api/eval?action=results&batch_id=ycwc-001"
   ```

   Lalu buka `/transparansi`. Tier-2 (detail per-file) butuh login petugas.
6. Purge hari ke-14: `DELETE /api/eval/batch?batch_id=ycwc-001` + cron
   `api/cron/purge-eval-fotos.ts`. Agregat `eval_runs` tetap tersimpan.

## Catatan penting

- Script memuat `.env.local` lalu `.env` otomatis. **Jangan** menaruh
  `EVAL_MASTER_KEY` atau service role key di command line (tersimpan di shell history).
- `--ingest` memakai service role langsung (tanpa JWT petugas) karena ini alat admin
  lokal. Upload lewat aplikasi tetap memakai `POST /api/eval/upload` + JWT petugas.
- Setelah rotasi `EVAL_MASTER_KEY`, jalankan `--ingest --force` agar ciphertext lama
  dienkripsi ulang dengan kunci baru.
- `eval_labels.jenis_true` mendukung 7 jenis + LAINNYA. Jalankan migrasi
  `supabase/migrations/20261026_eval_jenis_7.sql` bila constraint lama masih 4 jenis.
- Publish default menolak metrik setengah jadi bila ada file gagal. Gunakan
  `--allow-partial` hanya bila kegagalan sudah dipahami (tercatat di `notes`).
- Publish juga menolak batch yang belum mencapai 100 label (`--min-labels`). Untuk uji
  kecil, pakai `--min-labels 2` (jangan pakai `--allow-partial` hanya untuk melewati
  batas jumlah).

## Demo sintetis (batch demo-001)

Untuk presentasi tanpa memakai foto warga:

```bash
python scripts/generate-demo-eval.py
python scripts/evaluate-eval-bucket.py --all --batch demo-001 \
  --labels-csv eval/demo/labels.csv --private-dir eval/demo/private \
  --min-labels 6 --base-url http://localhost:3000
```

Buka `/transparansi?batch=demo-001`. Halaman otomatis menampilkan badge DEMO dan
judul demo. Semua gambar diberi watermark “DEMO — DATA SINTETIS”, NIK palsu
`0000000000000000`, dan nama fiktif. Folder `eval/demo/` gitignored dan **tidak boleh**
dicampur ke batch `ycwc-001`.
