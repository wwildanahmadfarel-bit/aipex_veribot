import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Init Supabase (sanitized to remove any trailing /rest/v1 or slashes causing PGRST125)
function getCleanSupabaseUrl(rawUrl?: string): string {
  if (!rawUrl) return '';
  return rawUrl.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

const supabaseUrl = getCleanSupabaseUrl(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
);
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

const supabase = createClient(supabaseUrl, supabaseKey);

// 1. GET: Ambil daftar pengajuan berkas warga
export async function GET(_req: Request) {
  try {
    const { data: tickets, error } = await supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, data: tickets });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// 2. PATCH: Petugas mengubah status verifikasi berkas
export async function PATCH(req: Request) {
  try {
    const { ticketId, officerId, status, catatan } = await req.json();

    if (!ticketId || !officerId || !status) {
      return NextResponse.json(
        { success: false, message: 'Data tidak lengkap' },
        { status: 400 }
      );
    }

    // Ambil status tiket saat ini
    const { data: currentTicket } = await supabase
      .from('tickets')
      .select('status_verifikasi')
      .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`)
      .single();

    // Update status tiket (dengan fallback jika kolom updated_at belum dimigrasikan)
    let { data: updatedTicket, error: updateError } = await supabase
      .from('tickets')
      .update({
        status_verifikasi: status,
        catatan: catatan || null,
        updated_at: new Date().toISOString(),
      })
      .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`)
      .select()
      .single();

    // Jika skema belum memiliki kolom updated_at (PGRST204), coba update tanpa updated_at
    if (
      updateError &&
      (updateError.code === 'PGRST204' ||
        updateError.message?.toLowerCase().includes('updated_at'))
    ) {
      const retry = await supabase
        .from('tickets')
        .update({
          status_verifikasi: status,
          catatan: catatan || null,
        })
        .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`)
        .select()
        .single();

      updatedTicket = retry.data;
      updateError = retry.error;
    }

    if (updateError) throw updateError;

    // Catat log tindakan petugas (safe handling jika tabel verification_logs belum tersedia)
    try {
      await supabase.from('verification_logs').insert([
        {
          ticket_id: updatedTicket?.id || ticketId,
          officer_id: officerId,
          status_sebelumnya: currentTicket?.status_verifikasi || 'TERKIRIM',
          status_baru: status,
          catatan_petugas: catatan,
        },
      ]);
    } catch (logErr) {
      console.warn('[verification_logs] insert skipped:', logErr);
    }

    return NextResponse.json({
      success: true,
      message: `Status tiket berhasil diubah menjadi ${status}`,
      ticket: updatedTicket,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
