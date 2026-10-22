-- Dataset evaluasi foto asli batch ycwc-001 — AIPEX VeriBot.
-- Jalankan di Supabase Dashboard -> SQL Editor. Idempoten, non-destruktif.
--
-- KEBIJAKAN (UU PDP No. 27/2022):
-- - Foto asli HANYA di bucket privat eval-fotos (public=false, tanpa storage policy
--   = default-deny, hanya service_role via server). Pola sama tiket-fotos (20260927).
-- - Tabel TIDAK menyimpan NIK/nama/foto mentah — hanya hash + label + metadata
--   cahaya/device (pola ocr_logs 20260923). NIK hasil OCR di-mask sebelum log.
-- - Retensi khusus evaluasi 14 hari (EVAL_RETENTION_DAYS), beda dari tiket 7 hari.
--   Setelah run final + purge, yang tersisa hanya 1 baris agregat eval_runs.
-- - Penarikan consent 1 file: DELETE /api/eval/batch?batch_id=ycwc-001&file_id=Pxxx
--   (atau hapus batch penuh) <60 detik.

-- 1. Bucket privat evaluasi (terisolasi dari tiket-fotos produksi).
insert into storage.buckets (id, name, public)
values ('eval-fotos', 'eval-fotos', false)
on conflict (id) do nothing;

-- 2. Label kebenaran per file (tanpa data pribadi).
create table if not exists public.eval_labels (
  file_id text primary key,
  batch_id text not null default 'ycwc-001',
  storage_path text not null,
  file_hash text not null,
  jenis_true text not null check (jenis_true in ('KTP','KK','AKTA','LAINNYA')),
  status_true text not null check (status_true in ('BERHASIL','BURAM','TIDAK_VALID')),
  lighting text,
  device text,
  relawan_id text,
  consent_ref text,
  iv_hex text,
  created_at timestamptz not null default now()
);
create index if not exists eval_labels_batch_idx on public.eval_labels (batch_id, created_at desc);

-- 3. Hasil agregat per run (satu-satunya yang boleh publik ke /transparansi Tier-1).
create table if not exists public.eval_runs (
  id bigint generated always as identity primary key,
  batch_id text not null default 'ycwc-001',
  created_at timestamptz not null default now(),
  n integer not null default 0,
  precision numeric,
  recall numeric,
  f1 numeric,
  f1_lainnya numeric,
  f1_buram numeric,
  latency_p50 integer,
  latency_p95 integer,
  cache_hit_rate numeric,
  notes text
);
create index if not exists eval_runs_batch_idx on public.eval_runs (batch_id, created_at desc);

-- 4. Prediksi per-file per run (tanpa NIK/nama/foto — hanya vonis + skor + latency).
-- Diisi oleh script evaluate-eval-bucket.py. Tier-2 membaca dari sini (tanpa buka foto).
create table if not exists public.eval_predictions (
  batch_id text not null default 'ycwc-001',
  run_id bigint references public.eval_runs(id) on delete cascade,
  file_id text not null,
  jenis_true text not null,
  status_true text not null,
  jenis_pred text,
  status_pred text,
  skor integer,
  latency_ms integer,
  source text,
  created_at timestamptz not null default now(),
  primary key (batch_id, run_id, file_id)
);
create index if not exists eval_predictions_run_idx on public.eval_predictions (batch_id, run_id);

-- 4. Verifikasi:
-- select id, name, public from storage.buckets where id = 'eval-fotos'; -- harus false
-- select column_name from information_schema.columns where table_name = 'eval_labels';
-- select column_name from information_schema.columns where table_name = 'eval_runs';
