-- Kolom alamat tiket (skema lama / init_schema_veribot mungkin belum punya).
-- Idempoten, non-destruktif. Tanpa kolom ini alamat hanya tersimpan di memori
-- server dan hilang saat restart; endpoint POST /api/tickets otomatis fallback
-- menyimpan tanpa alamat bila kolom belum ada (tiket TIDAK pernah gagal terbit).
alter table public.tickets add column if not exists alamat text;

-- Verifikasi:
-- select column_name from information_schema.columns
--  where table_name = 'tickets' and column_name = 'alamat';
