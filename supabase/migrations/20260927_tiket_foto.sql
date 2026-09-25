-- Penyimpanan foto sementara tiket (init_schema_veribot + fitur foto-sementara).
-- Jalankan di Supabase Dashboard -> SQL Editor. Idempoten, non-destruktif.
--
-- KEBIJAKAN: foto dokumen disimpan SEMENTARA di bucket privat untuk dilihat
-- petugas + warga pemilik, lalu dihapus SEKETIKA saat tiket diputus
-- (DISETUJUI/DITOLAK/PERLU_PERBAIKAN). Sweeper cron menghapus foto tiket
-- terbengkalai (non-final > retensi). NIK/identitas TIDAK ikut dihapus.
-- Detail plaintext (kode, nama) tetap di tabel tickets seperti sebelumnya.

-- 1. Bucket privat (RLS default deny: tanpa policy, hanya service_role via server).
insert into storage.buckets (id, name, public)
values ('tiket-fotos', 'tiket-fotos', false)
on conflict (id) do nothing;

-- 2. Kolom path + IV (IV acak per file untuk enkripsi AES-GCM per-tiket).
alter table public.tickets add column if not exists foto_path text;
alter table public.tickets add column if not exists foto_iv text;

-- 3. Verifikasi:
-- select id, name, public from storage.buckets where id = 'tiket-fotos';
-- select column_name from information_schema.columns
--  where table_name = 'tickets' and column_name in ('foto_path', 'foto_iv');
