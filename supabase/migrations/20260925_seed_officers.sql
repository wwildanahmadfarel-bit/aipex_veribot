-- Seed petugas baru AIPEX VeriBot (Jalankan di Supabase Dashboard -> SQL Editor).
-- Idempoten: gen_random_uuid() selalu baru, jadi konflik tidak mungkin -> do nothing.
--
-- PERHATIAN SKEMA AKTUAL (init_schema_veribot milik Anda):
-- - officers.id bertipe UUID (pakai gen_random_uuid(), BUKAN 'off-005').
-- - officers.role CHECK (role IN ('PETUGAS','SUPER_ADMIN')), default 'PETUGAS'.
--   Role bebas seperti 'Petugas Loket 2 - KK' DITOLAK database -> pakai PETUGAS.
-- - File contoh 20260924 di repo menulis id text + role bebas: ITU KEDALUWARSA,
--   jangan dipakai sebagai acuan. Skema aktual Anda yang menang.
-- - Butuh ekstensi pgcrypto untuk gen_random_uuid(): jalankan dulu
--   supabase/migrations/20260926_pgcompat.sql (atau CREATE EXTENSION IF NOT EXISTS "pgcrypto";)
--
-- CARA PAKAI (jangan bagikan kode via chat/screenshot):
-- 1. Ganti tiga nilai GANTI-... di bawah dengan nilai Anda (HAPUS kata GANTI-...,
--    jangan sisakan tanda kurung siku/sudut apapun):
--    - GANTI-NAMA : nama lengkap, mis. Agus Santoso
--    - GANTI-KODE : KUAT, min 12 karakter campuran huruf-angka-strip,
--                   mis. LOKET-7X2Q-99AB (jangan kata kamus / 6 digit).
--    Login menormalkan kode ke huruf besar otomatis (spasi jadi strip).
-- 2. Untuk petugas ke-2 dst, duplikasi baris values dengan koma.
-- 3. Paste ke SQL Editor -> Run. Ekspektasi: 1 row inserted.
-- 4. Verifikasi (jangan select kode_akses ke chat/log):
--      select id, nama_petugas, role from public.officers order by nama_petugas;
-- 5. Uji login 1x dengan kode baru (perlu OFFICER_JWT_SECRET terisi;
--    cek GET /api/health -> adminAuth.jwtConfigured: true).
-- 6. Contoh kode valid TIDAK PERNAH ditampilkan di UI/pesan error (kebijakan repo).

insert into public.officers (id, nama_petugas, role, kode_akses) values
  (gen_random_uuid(), 'GANTI-NAMA', 'PETUGAS', 'GANTI-KODE-MIN-12-KARAKTER')
on conflict (id) do nothing;
