-- KEDALUWARSA / CONTOH SAJA — JANGAN dijalankan menimpa database aktual.
-- Database aktual (init_schema_veribot) berbeda: officers.id UUID (bukan text),
-- officers.role CHECK IN ('PETUGAS','SUPER_ADMIN'), verification_logs memakai
-- FK UUID + CHECK status_baru IN ('DISETUJUI','DITOLAK','PERLU_PERBAIKAN'),
-- tickets tanpa kolom phone/alamat/catatan_petugas.
-- File ini dipertahankan sebagai referensi; acuan yang benar: skema aktual di atas.
-- Skema utama AIPEX VeriBot (tickets / officers / verification_logs).
-- Jalankan di Supabase Dashboard -> SQL Editor. Idempoten (if not exists).
-- Backend menulis best-effort: bila tabel belum ada, API fallback ke in-memory.

create table if not exists public.tickets (
  id bigint generated always as identity primary key,
  kode_tiket text not null unique,
  nik text not null,
  nama text not null,
  phone text,
  alamat text,
  jenis_dokumen text not null default 'KTP',
  skor_kejelasan integer not null default 0,
  status_verifikasi text not null default 'BERHASIL',
  catatan text,
  catatan_petugas text,
  created_at timestamptz not null default now()
);

create index if not exists tickets_created_at_idx on public.tickets (created_at desc);
create index if not exists tickets_kode_tiket_idx on public.tickets (kode_tiket);

create table if not exists public.officers (
  id text primary key,
  nama_petugas text not null,
  role text not null default 'Petugas Loket',
  kode_akses text not null unique
);

create table if not exists public.verification_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ticket_id text,
  officer_id text,
  status_sebelumnya text,
  status_baru text,
  catatan text
);

create index if not exists verification_logs_ticket_idx on public.verification_logs (ticket_id, created_at desc);
