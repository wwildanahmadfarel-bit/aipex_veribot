-- Dukungan 7 jenis dokumen pada dataset evaluasi batch ycwc-001.
-- Jalankan di Supabase Dashboard -> SQL Editor SETELAH 20261015_eval_fotos.sql.
-- Idempoten, non-destruktif.
--
-- Latar belakang: migrasi 20261015 mengunci eval_labels.jenis_true ke 4 nilai
-- (KTP/KK/AKTA/LAINNYA). API dan pipeline OCR sudah mendukung 7 jenis + LAINNYA,
-- sehingga upload KIA/AKTA_KEMATIAN/AKTA_PERKAWINAN/SURAT_PINDAH akan ditolak
-- check constraint lama. Migrasi ini melonggarkan constraint tersebut.

do $$
declare
  c record;
begin
  if to_regclass('public.eval_labels') is null then
    raise notice 'Tabel public.eval_labels belum ada. Jalankan 20261015_eval_fotos.sql dulu.';
    return;
  end if;

  -- Nama constraint bisa berbeda tergantung cara tabel dibuat; hapus semua
  -- check constraint yang menyebut kolom jenis_true.
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.eval_labels'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%jenis_true%'
  loop
    execute format('alter table public.eval_labels drop constraint %I', c.conname);
  end loop;

  alter table public.eval_labels
    add constraint eval_labels_jenis_true_check
    check (
      jenis_true in (
        'KTP',
        'KK',
        'AKTA',
        'AKTA_KEMATIAN',
        'AKTA_PERKAWINAN',
        'SURAT_PINDAH',
        'KIA',
        'LAINNYA'
      )
    );
end $$;

-- Verifikasi (jalankan manual bila perlu):
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.eval_labels'::regclass and contype = 'c';
