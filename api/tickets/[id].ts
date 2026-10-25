import { readJsonBody, setCors } from "../_lib/http.js";
import { getSupabase, memTickets, toPublicTicket } from "../_lib/store.js";
import { officerUnauthorized, requireOfficer } from "../_lib/officer-auth.js";

// GET /api/tickets/:kode → lacak tiket per kode (publik)
// PATCH /api/tickets/:id → update status (fallback OfficerDashboard lama, WAJIB Bearer petugas)
export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  const supabase = getSupabase();
  const id = String(req.query?.id || req.query?.kode_tiket || "").trim().toUpperCase()
    || String((req.url || "").split("/").pop()?.split("?")[0] || "").trim().toUpperCase();

  if (req.method === "GET") {
    try {
      if (supabase && id) {
        try {
          const { data, error } = await supabase
            .from("tickets")
            .select("*")
            .ilike("kode_tiket", id)
            .maybeSingle();
          if (!error && data) {
            const found = toPublicTicket(data);
            return res.json({ success: true, data: found, ticket: found });
          }
        } catch (dbErr) {
          console.warn("Supabase ticket query warning:", dbErr);
        }
      }
      if (id) {
        const mem = memTickets.find(
          (t) => t.ticket_code.toUpperCase() === id || (t as any).kode_tiket?.toUpperCase() === id
        );
        if (mem) {
          // Masking + peta status publik yang sama dengan jalur Supabase (UU PDP):
          // nik_raw/phone/alamat TIDAK boleh ikut keluar.
          const found = toPublicTicket(mem);
          return res.json({ success: true, data: found, ticket: found });
        }
      }
      return res.status(404).json({
        success: false,
        message: "Nomor resi/tiket tidak ditemukan. Pastikan kode yang Anda masukkan benar.",
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error?.message || "Terjadi kesalahan internal server" });
    }
  }

  if (req.method === "PATCH") {
    // Jalur publik DIKUNCI: perubahan status hanya via sesi petugas (Bearer).
    // Dashboard admin memakai /api/admin/tickets (audit + notifikasi WA).
    const auth = requireOfficer(req);
    if (!auth.ok) return officerUnauthorized(res, auth.error);
    try {
      const body = await readJsonBody(req);
      const { status_verifikasi, catatan_petugas } = body;
      const idx = memTickets.findIndex((t) => t.id === id || t.ticket_code === id);
      if (idx !== -1) {
        memTickets[idx] = {
          ...memTickets[idx],
          status_verifikasi: status_verifikasi || memTickets[idx].status_verifikasi,
          catatan_petugas: catatan_petugas !== undefined ? catatan_petugas : memTickets[idx].catatan_petugas,
          updated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
        };
      }
      if (supabase) {
        try {
          await supabase
            .from("tickets")
            .update({ status_verifikasi: status_verifikasi, catatan: catatan_petugas || undefined })
            .or(`id.eq.${id},kode_tiket.eq.${id}`);
        } catch (dbErr) {
          console.warn("Supabase update ticket status warning:", dbErr);
        }
      }
      if (idx === -1 && !supabase) {
        return res.status(404).json({ success: false, message: "Tiket tidak ditemukan." });
      }
      const updated = idx !== -1 ? memTickets[idx] : { id, status_verifikasi, catatan_petugas };
      return res.json({
        success: true,
        data: updated,
        message: `Status tiket berhasil diubah menjadi ${status_verifikasi}.`,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ success: false, message: "Method not allowed" });
}
