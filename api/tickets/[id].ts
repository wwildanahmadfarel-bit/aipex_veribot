import { readJsonBody, setCors } from "../_lib/http.js";
import { getSupabase, memTickets, ticketLookupFilter, toPublicTicket } from "../_lib/store.js";
import { officerUnauthorized, requireOfficer } from "../_lib/officer-auth.js";
import { PHOTO_PURGE_AUDIT_NOTE } from "../_lib/file-guard.js";

interface PublicTimelineItem {
  status: string;
  catatan?: string;
  created_at: string;
}

/** Buang penanda audit internal dari catatan yang tampil ke warga. */
function cleanPublicNote(raw: unknown): string {
  return String(raw ?? "")
    .split(PHOTO_PURGE_AUDIT_NOTE)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Timeline publik: hanya status, waktu, dan catatan; tanpa officer_id. */
function buildPublicTimeline(ticket: any, logs: any[] = []): PublicTimelineItem[] {
  const timeline: PublicTimelineItem[] = [
    {
      status: "DITERIMA",
      created_at: String(ticket?.created_at || ""),
    },
  ];
  const seen = new Set<string>();

  for (const log of logs) {
    const note = cleanPublicNote(log?.catatan_petugas ?? log?.catatan);
    // Log rollback adalah audit internal, bukan status final untuk warga.
    // Batalkan juga entri keputusan yang gagal di-rollback agar warga tidak
    // melihat "Disetujui" padahal statusnya sudah dikembalikan.
    if (/^\[ROLLBACK/i.test(note)) {
      const attempted = String(log?.status_sebelumnya || "").toUpperCase().trim();
      const last = timeline[timeline.length - 1];
      if (attempted && timeline.length > 1 && last?.status === attempted) {
        timeline.pop();
        seen.delete(`${last.status}|${String(last.created_at || "")}|${last.catatan || ""}`);
      }
      continue;
    }
    const status = String(log?.status_baru || "").toUpperCase().trim();
    if (!status) continue;
    const key = `${status}|${String(log?.created_at || "")}|${note}`;
    if (seen.has(key)) continue;
    seen.add(key);
    timeline.push({
      status,
      catatan: note || undefined,
      created_at: String(log?.created_at || ""),
    });
  }

  // Tiket lama / log gagal ditulis: tetap tampilkan keputusan final bila ada.
  const current = String(ticket?.status_verifikasi || "").toUpperCase().trim();
  const finalStatuses = ["DISETUJUI", "APPROVED", "DITOLAK", "REJECTED", "PERLU_PERBAIKAN"];
  const lastStatus = timeline[timeline.length - 1]?.status;
  if (finalStatuses.includes(current) && lastStatus !== current) {
    timeline.push({
      status: current,
      catatan: cleanPublicNote(ticket?.catatan || ticket?.catatan_petugas) || undefined,
      created_at: String(ticket?.updated_at || ticket?.created_at || ""),
    });
  }

  return timeline;
}

async function loadPublicTimeline(supabase: any, ticket: any): Promise<PublicTimelineItem[]> {
  let logs: any[] = [];
  if (supabase && ticket?.id) {
    try {
      const { data } = await supabase
        .from("verification_logs")
        .select("*")
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: true });
      logs = Array.isArray(data) ? data : [];
    } catch {
      // Log best-effort: jangan gagalkan lacak tiket bila tabel/kolom bermasalah.
    }
  }
  return buildPublicTimeline(ticket, logs);
}

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
            .eq("kode_tiket", id)
            .maybeSingle();
          if (!error && data) {
            const found = toPublicTicket(data);
            const riwayat = await loadPublicTimeline(supabase, data);
            const payload = { ...found, riwayat };
            return res.json({ success: true, data: payload, ticket: payload });
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
          const payload = { ...found, riwayat: buildPublicTimeline(mem) };
          return res.json({ success: true, data: payload, ticket: payload });
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
            .or(ticketLookupFilter(id));
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
