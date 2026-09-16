import { readJsonBody, setCors } from "../_lib/http";
import { getSupabase, memTickets } from "../_lib/store";

// GET /api/admin/tickets — daftar pengajuan untuk petugas
// PATCH /api/admin/tickets — ubah status + catat verification_logs
export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  const supabase = getSupabase();

  if (req.method === "GET") {
    try {
      if (supabase) {
        try {
          const { data: dbTickets, error } = await supabase
            .from("tickets")
            .select("*")
            .order("created_at", { ascending: false });
          if (!error && dbTickets && dbTickets.length > 0) {
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
    try {
      const body = await readJsonBody(req);
      // Dukung 2 format: baru (ticketId/officerId/status) & legacy PHP-bridge
      const ticketId = body.ticketId || body.id || body.kode_tiket;
      const officerId = body.officerId || body.officer_id || "petugas";
      const status = body.status || body.status_verifikasi;
      const catatan = body.catatan ?? body.catatan_petugas ?? null;
      if (!ticketId || !status) {
        return res.status(400).json({ success: false, message: "Data tidak lengkap" });
      }

      let currentTicket: any = null;
      let updatedTicket: any = null;

      if (supabase) {
        try {
          const { data: cur } = await supabase
            .from("tickets")
            .select("status_verifikasi")
            .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`)
            .single();
          currentTicket = cur;

          let { data: upd, error: updateError } = await supabase
            .from("tickets")
            .update({ status_verifikasi: status, catatan: catatan || null, updated_at: new Date().toISOString() })
            .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`)
            .select()
            .single();

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
          try {
            await supabase.from("verification_logs").insert([
              {
                ticket_id: (updatedTicket as any)?.id || ticketId,
                officer_id: officerId,
                status_sebelumnya: currentTicket?.status_verifikasi || "TERKIRIM",
                status_baru: status,
                catatan_petugas: catatan,
              },
            ]);
          } catch {}
        } catch (dbErr) {
          console.warn("[admin/tickets PATCH] Supabase error:", dbErr);
        }
      }

      const idx = memTickets.findIndex((t) => t.id === ticketId || t.ticket_code === ticketId);
      if (idx !== -1) {
        memTickets[idx] = {
          ...memTickets[idx],
          status_verifikasi: status,
          catatan_petugas: catatan !== undefined && catatan !== null ? catatan : memTickets[idx].catatan_petugas,
          updated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
        };
        if (!updatedTicket) updatedTicket = memTickets[idx];
      }
      if (!updatedTicket) updatedTicket = { id: ticketId, status_verifikasi: status, catatan: catatan || null };

      return res.json({
        success: true,
        message: `Status tiket berhasil diubah menjadi ${status}`,
        ticket: updatedTicket,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ success: false, message: "Method not allowed" });
}
