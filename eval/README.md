# eval/ — Dataset evaluasi batch ycwc-001 (PRIVAT)

- `private/` — 100 foto asli (gitignored, tidak boleh commit). Diisi via `POST /api/eval/upload`
  yang otomatis mengenkripsi + mengunggah ke bucket privat `eval-fotos`.
- `labels.csv` — label kebenaran TANPA NIK/nama. Boleh commit (tidak ada data pribadi).
- `results.json` — agregat metrik (F1, latency) untuk halaman `/transparansi` Tier-1. Boleh commit.
- `results-private.json` — log per-file (gitignored, dihapus saat purge).

Alur: consent fisik → upload (officer JWT) → run `scripts/evaluate-eval-bucket.py`
→ publikasi agregat → purge hari ke-14 (`api/cron/purge-eval-fotos.ts`).
