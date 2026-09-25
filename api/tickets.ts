import { readJsonBody, setCors } from "./_lib/http";
import { checkSimpleRateLimit, TICKET_HOUR } from "./_lib/rate-limit";
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
      // Anti-spam: cegah banjir tiket (5x/jam/IP).
      const tktRl = await checkSimpleRateLimit(req, TICKET_HOUR);
      if (!tktRl.allowed) {
        return res.status(429).json({
          success: false,
          code: "RATE_LIMITED",
          message: `Terlalu sering menerbitkan tiket. Coba lagi dalam ${Math.ceil(tktRl.retryAfterSec / 60)} menit.`,
          retryAfter: tktRl.retryAfterSec,
        });
      }
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
      // Sembuhkan memori: baris NIK sama yang belum punya nomor ikut terisi.
      if (phone) {
        try {
          for (const t of memTickets) {
            const sameNik = (t as any).nik_raw === nikDigits;
            if (sameNik && !(t as any).phone) (t as any).phone = String(phone);
          }
        } catch {}
      }

      // Bukti simpan nomor: true bila ikut terkirim ke DB (false = kolom belum ada / DB mati).
      let phoneSaved = false;
      if (supabase) {
        try {
          const row: any = {
            kode_tiket: ticketCode,
            nik: nikDigits,
            nama: nama_warga,
            jenis_dokumen: jenis_dokumen || "KTP",
            skor_kejelasan: Number(skor_ai) || 88,
            status_verifikasi: scanStatus === "BURAM" ? "BURAM" : "BERHASIL",
            catatan: awalCatatan,
          };
          if (phone) row.phone = String(phone);
          let ins = await supabase.from("tickets").insert([row]);
          // Fallback bila kolom phone belum dimigrasi di database.
          if (ins.error && /phone/i.test(String(ins.error.message || ""))) {
            try {
              console.warn(`[tickets POST] kolom phone belum ada, nomor ${ticketCode} tidak persist. Jalankan migrasi 20260928_tiket_phone.sql.`);
            } catch {}
            delete row.phone;
            ins = await supabase.from("tickets").insert([row]);
          }
          if (ins.error) {
            console.warn("Supabase insert warning for new ticket:", ins.error);
          } else if (phone) {
            phoneSaved = true;
            // Sembuhkan baris lama NIK sama yang belum punya nomor (mis. tiket
            // hasil pindai sebelum nomor dikirim) — best-effort.
            try {
              await supabase
                .from("tickets")
                .update({ phone: String(phone) })
                .eq("nik", nikDigits)
                .is("phone", null)
                .neq("kode_tiket", ticketCode);
            } catch {}
          }
        } catch (dbErr) {
          console.warn("Supabase insert warning for new ticket:", dbErr);
        }
      }

      return res.status(201).json({
        success: true,
        data: newTicket,
        ticket: newTicket,
        phoneSaved,
        message: phoneSaved
          ? "Tiket Fast-Track berhasil diterbitkan. Nomor WA tersimpan."
          : "Tiket Fast-Track berhasil diterbitkan.",
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ success: false, message: "Method not allowed" });
}
