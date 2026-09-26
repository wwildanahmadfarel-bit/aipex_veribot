import { readJsonBody, setCors } from "./_lib/http.js";
import { checkSimpleRateLimit, CHAT_10MIN } from "./_lib/rate-limit.js";
import { extractNaraApiKey, getGeminiClient, isNaraConfigured } from "./_lib/store.js";
import { chatCompletionViaNaraRoute } from "../services/ai_providers.js";

function getOfflineFaqAnswer(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("jam") || lower.includes("buka") || lower.includes("operasional") || lower.includes("tutup") || lower.includes("jadwal")) {
    return "🕒 **Jam Operasional Loket Kelurahan Sukamaju:**\n• **Senin - Kamis:** 08.00 - 15.30 WIB\n• **Jumat:** 08.00 - 14.30 WIB\n• **Sabtu, Minggu & Libur Nasional:** Loket fisik tutup.\n\nLayanan online mandiri **AIPEX VeriBot** tetap aktif 24 jam nonstop untuk pra-pemeriksaan berkas dan tiket antrean Fast-Track!";
  }
  if (lower.includes("ktp") || lower.includes("e-ktp")) {
    if (lower.includes("hilang")) {
      return "🪪 **Syarat Pengurusan KTP Hilang:**\n1. Surat Keterangan Kehilangan dari Polsek setempat.\n2. Fotokopi Kartu Keluarga (KK).\n3. Tidak perlu surat pengantar RT/RW (Perpres No. 96/2018).\n\n💡 *Tips:* Unggah foto berkas KK Anda di menu pra-pemeriksaan untuk mendapatkan Tiket Fast-Track tanpa antre lama di loket!";
    }
    if (lower.includes("rusak")) {
      return "🪪 **Syarat Penggantian KTP Rusak:**\n1. Membawa fisik e-KTP lama yang rusak.\n2. Fotokopi Kartu Keluarga (KK).\n3. Tidak dipungut biaya (Gratis 100%).\n\nSilakan gunakan fitur OCR VeriBot untuk memverifikasi kejelasan dokumen sebelum ke kantor kelurahan.";
    }
    return "🪪 **Syarat Pembuatan KTP-EL Baru (Pemula Usia 17 Tahun):**\n1. Cukup bawa Fotokopi Kartu Keluarga (KK).\n2. Tidak memerlukan surat pengantar RT/RW sesuai Perpres No. 96 Tahun 2018.\n3. Perekaman foto & sidik jari dilakukan langsung di loket kelurahan.\n\nUnggah foto KK Anda sekarang untuk reservasi antrean Fast-Track!";
  }
  if (lower.includes("fast-track") || lower.includes("tiket") || lower.includes("antre") || lower.includes("prioritas") || lower.includes("qr")) {
    return "⚡ **Jalur Fast-Track Tiket VeriBot:**\nWarga yang berkas kependudukannya lulus uji pra-pemeriksaan AI (skor kejelasan minimal 70-75%) otomatis memperoleh **Tiket QR Code Fast-Track**.\n\nSaat tiba di kantor kelurahan, Anda cukup memindai QR Code di loket prioritas untuk langsung dipanggil petugas tanpa perlu antre manual dan tanpa mengisi formulir kertas ulang.";
  }
  if (lower.includes("kia") || lower.includes("anak")) {
    return "👶 **Syarat Kartu Identitas Anak (KIA):**\n1. Fotokopi Akta Kelahiran anak.\n2. Fotokopi Kartu Keluarga (KK) orang tua.\n3. Fotokopi KTP-EL kedua orang tua.\n4. Pasfoto berwarna ukuran 3x4 sebanyak 2 lembar (khusus anak usia di atas 5 tahun). Untuk usia 0-5 tahun tidak memerlukan foto.";
  }
  if (lower.includes("kk") || lower.includes("kartu keluarga")) {
    return "👨‍👩‍👧‍👦 **Layanan Kartu Keluarga (KK):**\n• **Penambahan Anggota (Kelahiran):** KK lama, Surat Keterangan Lahir / Akta Lahir, KTP orang tua.\n• **Perubahan Data:** KK lama & dokumen pendukung (ijazah, akta nikah, surat pindah).\n• **Penerbitan Baru:** Buku Nikah/Akta Perkawinan, KK asal masing-masing suami & istri.";
  }
  if (lower.includes("akta") || lower.includes("lahir") || lower.includes("mati") || lower.includes("kematian") || lower.includes("nikah")) {
    return "📜 **Layanan Akta Pencatatan Sipil:**\n• **Akta Kelahiran:** Surat Keterangan Lahir dari Bidan/RS, Buku Nikah/Akta Perkawinan, KK, dan KTP orang tua.\n• **Akta Kematian:** Surat Kematian dari RS/Dokter/Kelurahan, KTP almarhum, KK, KTP pelapor & 2 saksi.\n• **Akta Perkawinan Non-Muslim:** Surat Pemberkatan dari Pemuka Agama, KTP suami istri, KK, pasfoto berdampingan.";
  }
  if (lower.includes("rt") || lower.includes("rw") || lower.includes("pengantar")) {
    return "📜 Sesuai amanat **Perpres No. 96 Tahun 2018**, pengurusan dokumen kependudukan dasar (seperti KTP-EL baru/rusak/hilang, Akta Kelahiran, dan pembaruan KK) **tidak lagi memerlukan surat pengantar RT/RW** sepanjang NIK sudah terdaftar aktif di Ditjen Dukcapil.";
  }
  if (lower.includes("pdp") || lower.includes("privasi") || lower.includes("aman") || lower.includes("ram") || lower.includes("keamanan") || lower.includes("hapus") || lower.includes("purge")) {
    return "🛡️ **Kepatuhan Privasi UU PDP (UU No. 27 Tahun 2022):**\nFoto e-KTP/KK warga disimpan SEMENTARA terenkripsi di penyimpanan privat — hanya terlihat petugas dan pemilik tiket — lalu dihapus otomatis (purge) seketika tiket disetujui/ditolak. Foto tiket terbengkalai dihapus maksimal 7 hari. Yang tercatat permanen hanya jenis dokumen (KTP/KK/AKTA) untuk rekap.";
  }
  if (lower.includes("lokasi") || lower.includes("alamat") || lower.includes("kantor") || lower.includes("kontak") || lower.includes("telepon") || lower.includes("whatsapp") || lower.includes("wa")) {
    return "📍 **Kantor Kelurahan Sukamaju:**\n• **Alamat:** Jl. Praja Abdi No. 45, Kecamatan Maju Sejahtera\n• **WhatsApp / Call Center:** +62 811-2345-6789\n• **Email Resmi:** layanan@sukamaju.desa.id\n• **Website / VeriBot:** 24 Jam Mandiri Online";
  }
  return "Halo Warga Sukamaju! Saya **VeriBot AI**, asisten cerdas pelayanan kependudukan Kelurahan Sukamaju.\n\nSilakan tanyakan seputar:\n• Syarat KTP-EL Baru / Hilang / Rusak\n• Prosedur Jalur Antrean Cepat (Fast-Track Tiket QR)\n• Pembuatan KIA, KK, dan Akta Pencatatan Sipil\n• Jadwal loket & standar pelayanan tanpa surat pengantar RT/RW.";
}

const SYSTEM_PROMPT = `Anda adalah "Asisten Pintar VeriBot", petugas customer service AI resmi Kelurahan Sukamaju (Kecamatan Maju Sejahtera) dalam sistem AIPEX VeriBot (DIGIForward 2026).
Tugas Anda adalah melayani warga kelurahan secara ramah, sopan, ringkas, dan jelas dalam bahasa Indonesia.

Informasi Resmi Kelurahan Sukamaju:
- Jam Operasional Loket Fisik:
  * Senin s.d. Kamis: 08.00 - 15.30 WIB
  * Jumat: 08.00 - 14.30 WIB
  * Sabtu, Minggu, & Libur Nasional: Tutup (Layanan Mandiri Online VeriBot 24 Jam Non-Stop)
- Alamat: Jl. Praja Abdi No. 45, Kecamatan Maju Sejahtera
- Call Center / WhatsApp: +62 811-2345-6789 | Email: layanan@sukamaju.desa.id
- Syarat KTP-EL:
  * Baru: Usia 17 tahun, Fotokopi Kartu Keluarga (KK). Tanpa surat pengantar RT/RW (Perpres No. 96 Tahun 2018).
  * Rusak: Fisik KTP lama, Fotokopi KK.
  * Hilang: Surat Keterangan Kehilangan dari Polsek setempat + Fotokopi KK.
- Syarat Kartu Identitas Anak (KIA): Fotokopi Akta Lahir, KK orang tua, KTP orang tua, pasfoto 3x4 (untuk anak usia di atas 5 tahun).
- Akta Kematian: Surat Kematian dari RS/Dokter/Kelurahan, KTP almarhum, KK, KTP 2 saksi.
- Akta Perkawinan: Surat nikah keagamaan, KTP suami istri, KK, pasfoto berdampingan.
- Surat Pindah (SKPWNI): KK asli, KTP pemohon, form permohonan pindah.
- Jalur Khusus Fast-Track: Warga yang berkasnya lulus pra-pemeriksaan AI (skor minimal 75%) akan memperoleh Tiket QR Prioritas. Saat ke kantor kelurahan, cukup tunjukkan QR Tiket di loket tanpa perlu antre panjang manual atau mengisi form kertas lagi.
- UU PDP Compliance: Foto dokumen disimpan sementara terenkripsi di penyimpanan privat (terlihat petugas + pemilik tiket), dihapus otomatis (purge) seketika tiket disetujui/ditolak; foto terbengkalai dihapus maksimal 7 hari. Yang tercatat permanen hanya jenis dokumen (KTP/KK/AKTA) untuk rekap.

Jawablah secara informatif, hangat, solutif, dan tidak bertele-tele (maksimal 2-3 paragraf). Pisahkan tiap paragraf dengan satu baris kosong. Pakai **tebal** untuk istilah penting dan daftar "•" untuk rincian (maksimal 5 butir).`;

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed" });
  try {
    const body = await readJsonBody(req);
    try {
      (req as any).body = body;
    } catch {}
    const { message } = body;
    if (!message) return res.status(400).json({ success: false, message: "Pesan tidak boleh kosong." });

    // Anti-spam: batasi chat agar token tidak diboroskan bot (10x/10 mnt/IP).
    const chatRl = await checkSimpleRateLimit(req, CHAT_10MIN);
    if (!chatRl.allowed) {
      return res.status(429).json({
        success: false,
        code: "RATE_LIMITED",
        message: `Terlalu banyak pertanyaan dalam waktu singkat. Coba lagi dalam ${Math.ceil(chatRl.retryAfterSec / 60)} menit.`,
        retryAfter: chatRl.retryAfterSec,
      });
    }

    const client = getGeminiClient();
    const naraApiKey = extractNaraApiKey({ headers: req.headers, body });

    if (isNaraConfigured(naraApiKey)) {
      try {
        const reply = await chatCompletionViaNaraRoute({
          apiKey: naraApiKey,
          model: (body?.naraModel as string) || process.env.NARA_ROUTE_MODEL || undefined,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: message },
          ],
          temperature: 0.2,
        });
        if (reply) return res.json({ success: true, reply, source: "nara-route" });
      } catch (naraErr: any) {
        console.warn(`[FAQ] nara-route gagal: ${naraErr?.message || naraErr}`);
      }
    }

    if (client) {
      const candidateModels = ["gemini-3.6-flash", "gemini-2.5-flash"];
      for (const modelName of candidateModels) {
        try {
          const response = await client.models.generateContent({
            model: modelName,
            contents: [{ text: SYSTEM_PROMPT }, { text: `Pertanyaan Warga: ${message}` }],
          });
          if (response && (response as any).text && String((response as any).text).trim()) {
            return res.json({ success: true, reply: String((response as any).text).trim(), source: modelName });
          }
        } catch (modelErr: any) {
          console.warn(`[Gemini FAQ] Model ${modelName} issue, trying next...`);
        }
      }
    }

    return res.json({ success: true, reply: getOfflineFaqAnswer(message), source: "knowledge-base" });
  } catch (err: any) {
    return res.json({
      success: true,
      reply: "Halo Warga Sukamaju! Saya VeriBot siap membantu Anda. Untuk pengurusan dokumen kependudukan (KTP, KK, KIA), loket buka Senin-Kamis 08.00-15.30 WIB dan Jumat 08.00-14.30 WIB. Anda dapat langsung mengunggah foto berkas di formulir mandiri untuk mendapatkan Tiket Fast-Track!",
      source: "emergency-fallback",
    });
  }
}
