-- Kompatibilitas skema aktual AIPEX VeriBot (init_schema_veribot).
-- Jalankan SEKALI di Supabase Dashboard -> SQL Editor SEBELUM seed petugas.
-- Idempoten dan non-destruktif: hanya memastikan ekstensi ada.
-- (Tabel officers/tickets/verification_logs milik Anda sudah benar; file ini
-- tidak mengubahnya. File contoh 20260924 di repo kedaluwarsa: menulis id text
-- + role bebas, sedangkan database aktual memakai id UUID + role CHECK
-- ('PETUGAS','SUPER_ADMIN'). Database aktual yang menang.)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
