-- Kolom nomor WhatsApp tiket (init_schema_veribot tidak memilikinya).
-- Jalankan di Supabase Dashboard -> SQL Editor. Idempoten, non-destruktif.
-- Tanpa kolom ini nomor warga tidak persist: modal admin jatuh ke '—' dan
-- PATCH ditolak WA_INVALID_NUMBER. Migrasi ini + input koreksi di modal
-- menutup rantai tersebut.

alter table public.tickets add column if not exists phone text;

-- Verifikasi:
-- select column_name from information_schema.columns
--  where table_name = 'tickets' and column_name = 'phone';
