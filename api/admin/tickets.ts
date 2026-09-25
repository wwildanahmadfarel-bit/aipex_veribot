import { readJsonBody, setCors } from "../_lib/http";
import { getSupabase, memTickets } from "../_lib/store";
import { WaError, isWaEnabled, normalizeWa, sendFonnteWa, ticketStatusMessage } from "../_lib/wa";
import { officerUnauthorized, requireOfficer } from "../_lib/officer-auth";
import { PHOTO_PURGE_AUDIT_NOTE } from "../_lib/file-guard";
import { hapusFotoTiket } from "../_lib/tiket-foto";

// GET /api/admin/tickets — daftar pengajuan untuk petugas (WAJIB Bearer)
// PATCH /api/admin/tickets — ubah status + catat verification_logs (WAJIB Bearer)
export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  const supabase = getSupabase();

  if (req.method === "GET") {
    const auth = requireOfficer(req);
    if (!auth.ok) return officerUnauthorized(res, auth.error);
    try {
      if (supabase) {
        try {
          const { data: dbTickets, error } = await supabase
            .from("tickets")
            .select("*")
            .order("created_at", { ascending: false });
          if (!error && dbTickets && dbTickets.length > 0) {
            // Deteksi jujur: bila kolom phone belum dimigrasi, nomor tak akan
            // pernah terprefill — beri tahu via log (bukan diam-diam).
            try {
              if (!(dbTickets[0] as any) || !("phone" in (dbTickets[0] as any))) {
                console.warn("[admin/tickets GET] kolom phone belum ada — nomor tak persist. Jalankan migrasi 20260928_tiket_phone.sql.");
              }
            } catch {}
            return res.json({ success: true, data: dbTickets });
          }
        } catch (dbErr) {
          console.warn("[admin/tickets GET] Supabase warning:", dbErr);
        }
      }
      return res.json({ success: true, data: memTickets });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  if (req.method === "PATCH" || req.method === "POST") {
    const auth = requireOfficer(req);
    if (!auth.ok) return officerUnauthorized(res, auth.error);
    try {
      const body = await readJsonBody(req);
      // Dukung 2 format: baru (ticketId/officerId/status) & legacy PHP-bridge
      // officerId SELALU dari klaim token (abaikan body) agar tak bisa dipalsukan.
      const ticketId = body.ticketId || body.id || body.kode_tiket;
      const officerId = auth.officerId || "petugas";
      const status = body.status || body.status_verifikasi;
      const catatan = body.catatan ?? body.catatan_petugas ?? null;
      const noHp = body.no_hp ?? body.phone ?? body.noHp ?? null;
      const nama = body.nama ?? body.nama_warga ?? "Pemohon";
      const jenisDokumen = body.jenis_dokumen ?? "Dokumen";
      const kodeTiket = body.kode_tiket ?? ticketId;
      if (!ticketId || !status) {
        return res.status(400).json({ success: false, message: "Data tidak lengkap" });
      }

      // Mode ketat: WA wajib. Tolak lebih awal sebelum ubah DB bila konfigurasi/nomor invalid.
      if (!isWaEnabled()) {
        return res.status(503).json({
          success: false,
          code: "WA_DISABLED",
          message: "Notifikasi WA belum diaktifkan (WA_ENABLED=false). Minta admin isi FONNTE_TOKEN dulu — status TIDAK diubah.",
        });
      }
      if (!normalizeWa(noHp)) {
        return res.status(400).json({
          success: false,
          code: "WA_INVALID_NUMBER",
          message: "Nomor WhatsApp warga tidak valid (harap 08xxxxxxxxxx). Status TIDAK diubah.",
        });
      }

      let currentTicket: any = null;
      let updatedTicket: any = null;
      let memPrev: any = null;
      let memIdx = -1;

      // Skema aktual (init_schema_veribot): tickets.id UUID, verification_logs
      // memakai FK UUID + CHECK status_baru IN (DISETUJUI,DITOLAK,PERLU_PERBAIKAN).
      // Log bersifat best-effort: tulis hanya bila id UUID valid + status valid.
      const isUuid = (v: unknown) =>
        typeof v === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      const isValidLogStatus = (v: unknown) => v === "DISETUJUI" || v === "DITOLAK" || v === "PERLU_PERBAIKAN";

      if (supabase) {
        try {
          const { data: cur } = await supabase
            .from("tickets")
            .select("id,status_verifikasi")
            .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`)
            .single();
          currentTicket = cur;

          let { data: upd, error: updateError } = await supabase
            .from("tickets")
            .update({ status_verifikasi: status, catatan: catatan || null, updated_at: new Date().toISOString() })
            .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`)
            .select()
            .single();

          // Simpan balik nomor koreksi petugas (best-effort; abaikan bila kolom belum ada).
          if (!updateError && normalizeWa(noHp)) {
            try {
              await supabase
                .from("tickets")
                .update({ phone: String(noHp).trim() })
                .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`);
            } catch {}
          }

          if (updateError && ((updateError as any).code === "PGRST204" || String((updateError as any).message || "").toLowerCase().includes("updated_at"))) {
            const retry = await supabase
              .from("tickets")
              .update({ status_verifikasi: status, catatan: catatan || null })
              .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`)
              .select()
              .single();
            upd = retry.data;
            updateError = retry.error;
          }
          if (!updateError) updatedTicket = upd;
          // Log best-effort (lewati bila FK UUID / CHECK tidak terpenuhi).
          // Penanda purge: foto tidak dipertahankan pasca-keputusan (audit UU PDP).
          // tickets.catatan tetap murni catatan petugas — marker hanya di log.
          if (isUuid(updatedTicket?.id) && isUuid(officerId) && isValidLogStatus(status)) {
            const auditNote = catatan ? `${catatan} ${PHOTO_PURGE_AUDIT_NOTE}` : PHOTO_PURGE_AUDIT_NOTE;
            try {
              await supabase.from("verification_logs").insert([
                {
                  ticket_id: updatedTicket.id,
                  officer_id: officerId,
                  status_sebelumnya: currentTicket?.status_verifikasi || "TERKIRIM",
                  status_baru: status,
                  catatan_petugas: auditNote,
                },
              ]);
            } catch {}
          }
        } catch (dbErr) {
          console.warn("[admin/tickets PATCH] Supabase error:", dbErr);
        }
      }

      const idx = memTickets.findIndex((t) => t.id === ticketId || t.ticket_code === ticketId);
      memIdx = idx;
      if (idx !== -1) {
        memPrev = { ...memTickets[idx] };
        memTickets[idx] = {
          ...memTickets[idx],
          status_verifikasi: status,
          catatan_petugas: catatan !== undefined && catatan !== null ? catatan : memTickets[idx].catatan_petugas,
          phone: normalizeWa(noHp) ? String(noHp).trim() : memTickets[idx].phone,
          updated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
        };
        if (!updatedTicket) updatedTicket = memTickets[idx];
      }
      if (!updatedTicket) updatedTicket = { id: ticketId, status_verifikasi: status, catatan: catatan || null };

      // Kirim WA setelah update. Gagal -> rollback (mode ketat).
      const waMessage = ticketStatusMessage({ nama, kode: kodeTiket, jenis: jenisDokumen, status, catatan });
      try {
        await sendFonnteWa({ to: String(noHp), message: waMessage });
        // Keputusan final: purge foto SEKETIKA (sebelum return sukses).
        // Gagal hapus tidak membatalkan keputusan (sweeper menutup).
        try {
          await hapusFotoTiket(kodeTiket);
        } catch {}
      } catch (waErr: any) {
        const reason = waErr instanceof WaError ? waErr.message : String(waErr?.message || waErr).slice(0, 200);
        // Rollback Supabase.
        if (supabase && currentTicket?.status_verifikasi) {
          try {
            await supabase
              .from("tickets")
              .update({ status_verifikasi: currentTicket.status_verifikasi })
              .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`);
          } catch {}
          if (isUuid(updatedTicket?.id) && isUuid(officerId)) {
            try {
              await supabase.from("verification_logs").insert([
                {
                  ticket_id: updatedTicket?.id,
                  officer_id: officerId,
                  // status_baru wajib lolos CHECK: pakai status pulihan yang valid,
                  // alasan rollback dicatat di catatan_petugas.
                  status_sebelumnya: isValidLogStatus(status) ? status : "DITOLAK",
                  status_baru: isValidLogStatus(currentTicket?.status_verifikasi)
                    ? currentTicket.status_verifikasi
                    : "PERLU_PERBAIKAN",
                  catatan_petugas: `[ROLLBACK WA GAGAL] ${reason}`,
                },
              ]);
            } catch {}
          }
        }
        // Rollback memori.
        if (memIdx !== -1 && memPrev) memTickets[memIdx] = memPrev;
        try {
          console.warn(`[admin/tickets PATCH] WA gagal, rollback ke ${currentTicket?.status_verifikasi || "?"}: ${reason.slice(0, 200)}`);
        } catch {}
        return res.status(502).json({
          success: false,
          code: "WA_FAILED",
          message: `Status DIBATALKAN karena WA gagal: ${reason} Perbaiki nomor/token Fonnte lalu ulangi.`,
          ticket: { id: ticketId, status_verifikasi: currentTicket?.status_verifikasi || "UNKNOWN" },
        });
      }

      return res.json({
        success: true,
        waSent: true,
        message: `Status tiket berhasil diubah menjadi ${status} dan notifikasi WA terkirim.`,
        ticket: updatedTicket,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ success: false, message: "Method not allowed" });
}
