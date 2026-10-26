-- AIPEX VeriBot — hardening auth petugas (username + password + refresh session).
-- Jalankan di Supabase Dashboard -> SQL Editor, SETELAH backup database.
--
-- Skema aktual yang diasumsikan: public.officers.id bertipe UUID dan
-- public.officers.role dibatasi CHECK (PETUGAS, SUPER_ADMIN).
-- File ini idempoten; aman dijalankan ulang.
--
-- Setelah migrasi:
--   1. Buat akun petugas dengan scripts/create-officer.ts (password sementara).
--   2. Login memakai username + password; kode_akses lama TIDAK dipakai lagi.
--   3. Setelah semua petugas pindah, kolom kode_akses boleh dihapus manual.

create extension if not exists "pgcrypto";

alter table public.officers
  add column if not exists username text,
  add column if not exists password_hash text,
  add column if not exists must_change_password boolean not null default true,
  add column if not exists is_active boolean not null default true,
  add column if not exists token_version integer not null default 0,
  add column if not exists password_changed_at timestamptz,
  add column if not exists last_login_at timestamptz;

-- Username disimpan lowercase oleh aplikasi. Unique index pada lower(username)
-- mencegah duplikat beda kapitalisasi.
create unique index if not exists officers_username_lower_uidx
  on public.officers (lower(username));

-- Kolom lama kode_akses bersifat NOT NULL. Akun baru tidak lagi memakai kode
-- akses, jadi kolom itu harus boleh kosong sampai nanti dihapus.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'officers'
      and column_name = 'kode_akses'
  ) then
    execute 'alter table public.officers alter column kode_akses drop not null';
    execute 'comment on column public.officers.kode_akses is ''DEPRECATED — tidak dipakai login sejak auth username/password. Aman dihapus setelah semua akun dimigrasikan.''';
  end if;
end $$;

-- Sesi refresh. Token mentah HANYA ada di cookie HttpOnly; database hanya
-- menyimpan SHA-256(token). officer_id sengaja text agar kompatibel dengan
-- skema UUID maupun text lama.
create table if not exists public.officer_sessions (
  id uuid primary key default gen_random_uuid(),
  officer_id text not null,
  refresh_hash text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip_hash text,
  user_agent text
);

create unique index if not exists officer_sessions_refresh_hash_uidx
  on public.officer_sessions (refresh_hash);

create index if not exists officer_sessions_officer_idx
  on public.officer_sessions (officer_id, expires_at desc);

create index if not exists officer_sessions_active_idx
  on public.officer_sessions (expires_at)
  where revoked_at is null;

-- Audit login. Jangan pernah menyimpan password, token, atau kode akses.
create table if not exists public.officer_login_logs (
  id bigint generated always as identity primary key,
  officer_id text,
  username_hash text,
  success boolean not null default false,
  reason text,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists officer_login_logs_created_idx
  on public.officer_login_logs (created_at desc);

-- Tabel auth hanya boleh diakses backend dengan secret/service key.
-- RLS + revoke adalah dua lapis: RLS memblokir baris, revoke memblokir tabel.
-- Frontend TIDAK pernah memakai anon key untuk membaca officers/sessions/logs.
alter table public.officers enable row level security;
alter table public.officer_sessions enable row level security;
alter table public.officer_login_logs enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all privileges on table public.officers from anon';
    execute 'revoke all privileges on table public.officer_sessions from anon';
    execute 'revoke all privileges on table public.officer_login_logs from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all privileges on table public.officers from authenticated';
    execute 'revoke all privileges on table public.officer_sessions from authenticated';
    execute 'revoke all privileges on table public.officer_login_logs from authenticated';
  end if;
exception
  when insufficient_privilege then
    raise notice 'Lewati revoke privilege: jalankan sebagai owner/service role bila perlu.';
end $$;

comment on column public.officers.username is 'Username login petugas, lowercase, unik (case-insensitive).';
comment on column public.officers.password_hash is 'Hash scrypt berversi: scrypt$N$r$p$salt$hash.';
comment on column public.officers.must_change_password is 'true = wajib ganti password setelah login (password sementara).';
comment on table public.officer_sessions is 'Refresh session petugas; hanya hash token yang disimpan.';
