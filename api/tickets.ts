import { readJsonBody, setCors } from "./_lib/http.js";
import { checkSimpleRateLimit, TICKET_HOUR } from "./_lib/rate-limit.js";
import {
  BUKAN_KTP_MESSAGE,
  JENIS_NIK_OPSIONAL,
  getSupabase,
  memTickets,
  normalizeJenisDokumen,
  normalizeStatusVerifikasi,
  toPublicTicket,
  type TicketRow,
} from "./_lib/store.js";

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
    // Fallback memori juga dimasking (UU PDP) — jangan kembalikan nik_raw/phone/alamat.
    const memPublic = memTickets.map(toPublicTicket);
    return res.json({ success: true, data: memPublic, total: memPublic.length });
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

      if (!nama_warga) {
        return res.status(400).json({ success: false, message: "Nama warga wajib diisi." });
      }

      // Validasi bukti scan terlebih dahulu (menentukan aturan NIK per jenis dokumen).
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
            "Wajib verifikasi dokumen via scanner terlebih dahulu. Unggah foto dokumen kependudukan asli hingga terdeteksi sebagai dokumen yang didukung.",
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

      // NIK wajib 16 digit untuk dokumen berkartu (KTP/KK/AKTA/KIA); opsional
      // untuk akta kematian/perkawinan & surat pindah (dokumen lama sering tanpa NIK).
      const nikDigits = String(nik ?? "").replace(/\D/g, "");
      const nikOpsional = JENIS_NIK_OPSIONAL.includes(scanJenis);
      if (!nikOpsional && nikDigits.length !== 16) {
        return res.status(400).json({
          success: false,
          message: "NIK harus 16 digit angka. Tiket tidak dapat diterbitkan.",
        });
      }
      if (nikOpsional && nikDigits.length > 0 && nikDigits.length !== 16) {
        return res.status(400).json({
          success: false,
          message: "NIK opsional untuk jenis dokumen ini — jika diisi harus 16 digit angka.",
        });
      }

      const date = new Date();
      const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
      const randomCode = Math.floor(1000 + Math.random() * 9000);
      const ticketCode = `TKT-${yearMonth}-${randomCode}`;
      const maskedNik = !nikDigits
        ? "Tanpa NIK (opsional)"
        : nikDigits.length >= 12
          ? `${nikDigits.slice(0, 6)}******${nikDigits.slice(-4)}`
          : `${nikDigits.slice(0, 3)}***${nikDigits.slice(-2)}`;

      const awalStatusVerifikasi = "PENDING"; // Semua tiket baru mulai dari PENDING
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
      if (phone && nikDigits) {
        try {
          for (const t of memTickets) {
            const sameNik = (t as any).nik_raw === nikDigits;
            if (sameNik && !(t as any).phone) (t as any).phone = String(phone);
          }
        } catch {}
      }

      // Bukti simpan nomor: true HANYA bila nomor benar-benar ikut tersimpan di DB
      // (false = kolom belum dimigrasi / DB mati). Tidak boleh berbohong ke UI.
      let phoneSaved = false;
      if (supabase) {
        try {
          const row: any = {
            kode_tiket: ticketCode,
            nik: nikDigits,
            nama: nama_warga,
            jenis_dokumen: jenis_dokumen || "KTP",
            skor_kejelasan: Number(skor_ai) || 88,
            status_verifikasi: "PENDING", // Semua tiket baru mulai dari PENDING di DB
            catatan: awalCatatan,
          };
          if (phone) row.phone = String(phone);
          if (alamat) row.alamat = String(alamat);
          let ins = await supabase.from("tickets").insert([row]);
          // Fallback kolom belum dimigrasi (phone/alamat): buang kolom itu lalu
          // ulangi — tiket TIDAK boleh gagal terbit hanya karena kolom belum ada.
          for (let attempt = 0; attempt < 2 && ins.error; attempt++) {
            const errMsg = String(ins.error.message || "");
            const kolomHilang = /phone/i.test(errMsg) ? "phone" : /alamat/i.test(errMsg) ? "alamat" : null;
            if (!kolomHilang || !row[kolomHilang]) break;
            try {
              console.warn(`[tickets POST] kolom ${kolomHilang} belum ada — tiket ${ticketCode} disimpan tanpa kolom itu. Jalankan migrasi supabase/migrations.`);
            } catch {}
            delete row[kolomHilang];
            ins = await supabase.from("tickets").insert([row]);
          }
          if (ins.error) {
            console.warn("Supabase insert warning for new ticket:", ins.error);
          } else if (phone && row.phone && nikDigits) {
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
          ? "Tiket QR antrean berhasil diterbitkan. Nomor WA tersimpan."
          : phone
            ? "Tiket QR antrean berhasil diterbitkan. Nomor WA belum tersimpan di server — petugas akan verifikasi manual."
            : "Tiket QR antrean berhasil diterbitkan.",
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ success: false, message: "Method not allowed" });
}
