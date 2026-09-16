import { readJsonBody, setCors } from "./_lib/http";
import {
  BUKAN_KTP_MESSAGE,
  getSupabase,
  memTickets,
  normalizeJenisDokumen,
  normalizeStatusVerifikasi,
  toPublicTicket,
  type TicketRow,
} from "./_lib/store";

// GET /api/tickets — daftar semua tiket (Supabase utama, memori fallback)
// POST /api/tickets — buat tiket (dengan validasi bukti scan)
export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  const supabase = getSupabase();

  if (req.method === "GET") {
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from("tickets")
          .select("*")
          .order("created_at", { ascending: false });
        if (!error && data && data.length > 0) {
          return res.json({ success: true, data: data.map(toPublicTicket), total: data.length });
        }
      }
    } catch (err) {
      console.warn("Supabase fetch all tickets warning:", err);
    }
    return res.json({ success: true, data: memTickets, total: memTickets.length });
  }

  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const {
        nik,
        nama_warga,
        phone,
        alamat,
        jenis_dokumen,
        skor_ai = 88,
        status_ai = "LULUS",
        catatan_ai,
        scan_jenis_dokumen,
        jenis_dokumen_scan,
        scan_status_verifikasi,
        status_verifikasi_scan,
        verification,
      } = body;

      if (!nama_warga || !nik) {
        return res.status(400).json({ success: false, message: "NIK dan Nama warga wajib diisi." });
      }
      const nikDigits = String(nik).replace(/\D/g, "");
      if (nikDigits.length !== 16) {
        return res.status(400).json({
          success: false,
          message: "NIK harus 16 digit angka. Tiket tidak dapat diterbitkan.",
        });
      }

      const scanJenisRaw =
        scan_jenis_dokumen ?? jenis_dokumen_scan ?? (verification as any)?.jenis_dokumen ?? null;
      const scanStatusRaw =
        scan_status_verifikasi ??
        status_verifikasi_scan ??
        (verification as any)?.status_verifikasi ??
        (verification as any)?.status_kualitas ??
        null;
      if (scanJenisRaw == null || scanStatusRaw == null) {
        return res.status(400).json({
          success: false,
          message:
            "Wajib verifikasi dokumen via scanner terlebih dahulu. Unggah foto e-KTP asli hingga terdeteksi sebagai dokumen kependudukan.",
        });
      }
      const scanJenis = normalizeJenisDokumen(scanJenisRaw);
      const scanStatus = normalizeStatusVerifikasi(scanStatusRaw);
      const scanCatatan = String((verification as any)?.catatan ?? catatan_ai ?? "");
      const terdeteksiBukanKtp =
        scanJenis === "LAINNYA" ||
        scanStatus === "TIDAK_VALID" ||
        /bukan kartu kependudukan/i.test(scanCatatan);
      if (terdeteksiBukanKtp) {
        return res.status(400).json({ success: false, message: BUKAN_KTP_MESSAGE });
      }

      const date = new Date();
      const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
      const randomCode = Math.floor(1000 + Math.random() * 9000);
      const ticketCode = `TKT-${yearMonth}-${randomCode}`;
      const maskedNik =
        nikDigits.length >= 12
          ? `${nikDigits.slice(0, 6)}******${nikDigits.slice(-4)}`
          : `${nikDigits.slice(0, 3)}***${nikDigits.slice(-2)}`;

      const awalStatusVerifikasi = scanStatus === "BURAM" ? "REVISI" : "PENDING";
      const awalCatatan =
        catatan_ai ||
        (scanStatus === "BURAM"
          ? "Dokumen valid namun buram. QR terbit — bawa fisik dokumen asli untuk verifikasi ulang di loket."
          : "Dokumen lolos validasi otomatis Cognitive AI VeriBot.");

      const newTicket: TicketRow = {
        id: String(Date.now()),
        ticket_code: ticketCode,
        nik_encrypted: maskedNik,
        nik_raw: nikDigits,
        nama_warga,
        phone: phone || "",
        alamat: alamat || "",
        jenis_dokumen: jenis_dokumen || "Penerbitan KTP-EL Baru / Penggantian",
        status_verifikasi: awalStatusVerifikasi as any,
        skor_ai: Number(skor_ai) || 88,
        status_ai: status_ai || "LULUS",
        catatan_ai: awalCatatan,
        created_at: new Date().toISOString().replace("T", " ").slice(0, 16),
        updated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
      };
      memTickets.unshift(newTicket);

      if (supabase) {
        try {
          await supabase.from("tickets").insert([
            {
              kode_tiket: ticketCode,
              nik: nikDigits,
              nama: nama_warga,
              jenis_dokumen: jenis_dokumen || "KTP",
              skor_kejelasan: Number(skor_ai) || 88,
              status_verifikasi: scanStatus === "BURAM" ? "BURAM" : "BERHASIL",
              catatan: awalCatatan,
            },
          ]);
        } catch (dbErr) {
          console.warn("Supabase insert warning for new ticket:", dbErr);
        }
      }

      return res.status(201).json({
        success: true,
        data: newTicket,
        ticket: newTicket,
        message: "Tiket Fast-Track berhasil diterbitkan.",
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ success: false, message: "Method not allowed" });
}
