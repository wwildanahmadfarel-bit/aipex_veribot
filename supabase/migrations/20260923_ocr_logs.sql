-- Log percobaan OCR untuk deteksi abuse (anti-spam tanpa login).
-- Hanya menyimpan HASH (bukan foto, bukan IP mentah, bukan NIK) agar patuh UU PDP.
-- Jalankan di Supabase Dashboard -> SQL Editor. Tabel boleh belum ada:
-- kode backend menulis best-effort dan mengabaikan kegagalan insert.

create table if not exists public.ocr_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ip_hash text,
  file_hash text,
  mime text,
  size_bytes integer,
  skor integer,
  status text,
  source text,
  latency_ms integer
);

create index if not exists ocr_logs_created_at_idx on public.ocr_logs (created_at desc);
create index if not exists ocr_logs_ip_hash_idx on public.ocr_logs (ip_hash, created_at desc);
create index if not exists ocr_logs_file_hash_idx on public.ocr_logs (file_hash, created_at desc);

-- Contoh query abuse:
-- Top IP per jam:
-- select ip_hash, count(*) from public.ocr_logs
-- where created_at > now() - interval '1 hour' group by 1 order by 2 desc limit 20;
-- Rasio blokir vs AI:
-- select source, count(*) from public.ocr_logs
-- where created_at > now() - interval '24 hours' group by 1 order by 2 desc;
