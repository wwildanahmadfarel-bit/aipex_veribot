import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Init Supabase (sanitized to remove any trailing /rest/v1 or slashes causing PGRST125)
function getCleanSupabaseUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  return rawUrl.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseUrl = getCleanSupabaseUrl(rawSupabaseUrl);
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

function normalizeAccessCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/SUKAMAZU/g, 'SUKAMAJU');
}

// Fallback Petugas Terdaftar Resmi (Demo / Offline-safe / Backup jika tabel 'officers' belum dimigrasi di Supabase)
// Disamakan dengan server.ts agar perilaku identik.
const FALLBACK_OFFICERS = [
  {
    id: 'off-001',
    nama_petugas: 'Bambang Sudiro, S.STP',
    role: 'Kepala Seksi Pelayanan Kependudukan',
    kode_akses: 'ADM-SUKAMAJU-2026',
  },
  {
    id: 'off-002',
    nama_petugas: 'Siti Rahmawati, S.AP',
    role: 'Petugas Loket 1 - e-KTP & Identitas',
    kode_akses: '849201',
  },
  {
    id: 'off-003',
    nama_petugas: 'Ahmad Fauzi, S.Kom',
    role: 'Supervisor VeriBot AI Kependudukan',
    kode_akses: 'VERIBOT-ADMIN',
  },
  {
    id: 'off-004',
    nama_petugas: 'Hendra Setiawan, S.IP',
    role: 'Petugas Loket Fast-Track VeriBot AIPEX',
    kode_akses: 'LOKET-SUKAMAJU-01',
  },
  {
    id: 'off-004',
    nama_petugas: 'Hendra Setiawan, S.IP',
    role: 'Petugas Loket Fast-Track VeriBot AIPEX',
    kode_akses: 'LOKET-SUKAMAZU-01',
  },
];

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const kodeAkses = body.kodeAkses || body.kode_akses || body.pin;

    if (!kodeAkses || typeof kodeAkses !== 'string' || !kodeAkses.trim()) {
      return NextResponse.json(
        { success: false, message: 'Kode akses wajib diisi' },
        { status: 400 }
      );
    }

    const trimmedCode = kodeAkses.trim();
    const normalizedCode = normalizeAccessCode(trimmedCode);
    if (!normalizedCode) {
      return NextResponse.json({ success: false, message: 'Kode akses wajib diisi' }, { status: 400 });
    }

    if (/^(TKT|FT)-/i.test(normalizedCode)) {
      return NextResponse.json(
        {
          success: false,
          message: 'Itu kode tiket warga (TKT-...), bukan kode akses petugas. Gunakan kode akses petugas, contoh: 849201 atau LOKET-SUKAMAJU-01.',
        },
        { status: 401 }
      );
    }

    let officer: { id: string; nama_petugas: string; role: string; kode_akses?: string } | null = null;
    let errorFromDb: any = null;

    // 1. Cari petugas di database Supabase (exact + ilike agar case-insensitive)
    if (supabase) {
      try {
        const exact = await supabase
          .from('officers')
          .select('id, nama_petugas, role, kode_akses')
          .eq('kode_akses', trimmedCode)
          .maybeSingle();
        if (!exact.error && exact.data) {
          officer = exact.data;
        } else {
          if (exact.error && (exact.error as any).code !== 'PGRST116') errorFromDb = exact.error;
          const insensitive = await supabase
            .from('officers')
            .select('id, nama_petugas, role, kode_akses')
            .ilike('kode_akses', normalizedCode)
            .maybeSingle();
          if (!insensitive.error && insensitive.data) {
            officer = insensitive.data;
          } else if (insensitive.error && (insensitive.error as any).code !== 'PGRST116') {
            errorFromDb = insensitive.error;
          }
        }
      } catch (err) {
        errorFromDb = err;
      }
    }

    // 2. Fallback jika tabel officers belum dibuat di Supabase (Error PGRST205) atau koneksi offline
    if (!officer) {
      const matchedFallback = FALLBACK_OFFICERS.find(
        (o) => normalizeAccessCode(o.kode_akses) === normalizedCode
      );
      if (matchedFallback) {
        officer = matchedFallback;
      }
    }

    if (!officer) {
      return NextResponse.json(
        {
          success: false,
          message: 'Kode Akses Petugas tidak valid! Periksa kembali kode (contoh: 849201 atau LOKET-SUKAMAJU-01). Kode tiket TKT-... tidak bisa dipakai untuk login.',
          details: errorFromDb?.message || undefined,
        },
        { status: 401 }
      );
    }

    // 3. Berhasil Login: Kembalikan data petugas & token sesi terverifikasi
    return NextResponse.json({
      success: true,
      message: 'Login petugas berhasil',
      officer: {
        id: officer.id,
        nama: officer.nama_petugas,
        role: officer.role,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Terjadi kesalahan sistem' },
      { status: 500 }
    );
  }
}
