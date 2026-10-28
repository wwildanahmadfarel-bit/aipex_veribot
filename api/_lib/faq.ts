// Modul FAQ chatbot bersama untuk dev (server.ts) dan produksi (api/chat-faq.ts).
// SATU sumber kebenaran agar copy & logika tidak drift antar lingkungan.
//
// Urutan jawab (dioptimalkan untuk kecepatan):
//   1. Knowledge base offline — intent dikenal (chip demo) dijawab instan.
//   2. Cache Redis — jawaban AI untuk pertanyaan identik disimpan 24 jam.
//   3. Gemini — timeout 8 dtk/model, anggaran total ~15 dtk.
//   4. nara-route / bynara — timeout 12 dtk.
//   5. KB generik — selalu ada jawaban walau semua AI down.

import { sha256Hex } from "./file-guard.js";
import { redisGet, redisSet } from "./rate-limit.js";
import { getGeminiClient, isNaraConfigured } from "./store.js";
import { chatCompletionViaNaraRoute } from "../../services/ai_providers.js";

export const FAQ_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const FAQ_GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
const GEMINI_PER_MODEL_TIMEOUT_MS = 8_000;
const GEMINI_TOTAL_BUDGET_MS = 15_000;
const NARA_TIMEOUT_MS = 12_000;

/**
 * Resolver knowledge base offline. Mengembalikan null bila pertanyaan tidak
 * dikenal — pemanggil boleh lanjut ke AI, bukan menjawab generik.
 * Ambang skor seragam 70 (lihat composeAlasan & kartu rekomendasi klien).
 */
export function getOfflineFaqAnswer(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes("pdp") || lower.includes("privasi") || lower.includes("aman") || lower.includes("ram") || lower.includes("keamanan") || lower.includes("hapus") || lower.includes("purge")) {
    return "🛡️ **Kepatuhan Privasi UU PDP (UU No. 27 Tahun 2022):**\nFoto e-KTP/KK warga disimpan SEMENTARA terenkripsi di penyimpanan privat — hanya terlihat petugas dan pemilik tiket — lalu dihapus otomatis (purge) seketika tiket disetujui/ditolak. Foto tiket terbengkalai dihapus maksimal 7 hari. Yang tercatat permanen hanya jenis dokumen kependudukan untuk rekap.";
  }
  if (lower.includes("jam") || lower.includes("buka") || lower.includes("operasional") || lower.includes("tutup") || lower.includes("jadwal")) {
    return "🕒 **Jam Operasional Loket Kelurahan Sukamaju:**\n• **Senin - Kamis:** 08.00 - 15.30 WIB\n• **Jumat:** 08.00 - 14.30 WIB\n• **Sabtu, Minggu & Libur Nasional:** Loket fisik tutup.\n\nLayanan online mandiri **AIPEX VeriBot** tetap aktif 24 jam nonstop untuk pra-pemeriksaan berkas dan Tiket QR Antrean!";
  }
  if (lower.includes("ktp") || lower.includes("e-ktp")) {
    if (lower.includes("hilang")) {
      return "🪪 **Syarat Pengurusan KTP Hilang:**\n1. Surat Keterangan Kehilangan dari Polsek setempat.\n2. Fotokopi Kartu Keluarga (KK).\n3. Tidak perlu surat pengantar RT/RW (Perpres No. 96/2018).\n\n💡 *Tips:* Unggah foto berkas KK Anda di menu pra-pemeriksaan untuk mendapatkan Tiket QR Antrean tanpa antre lama di loket!";
    }
    if (lower.includes("rusak")) {
      return "🪪 **Syarat Penggantian KTP Rusak:**\n1. Membawa fisik e-KTP lama yang rusak.\n2. Fotokopi Kartu Keluarga (KK).\n3. Tidak dipungut biaya (Gratis 100%).\n\nSilakan gunakan fitur OCR VeriBot untuk memverifikasi kejelasan dokumen sebelum ke kantor kelurahan.";
    }
    return "🪪 **Syarat Pembuatan KTP-EL Baru (Pemula Usia 17 Tahun):**\n1. Cukup bawa Fotokopi Kartu Keluarga (KK).\n2. Tidak memerlukan surat pengantar RT/RW sesuai Perpres No. 96 Tahun 2018.\n3. Perekaman foto & sidik jari dilakukan langsung di loket kelurahan.\n\nUnggah foto KK Anda sekarang untuk reservasi Tiket QR Antrean!";
  }
  if (lower.includes("fast-track") || lower.includes("tiket") || lower.includes("antre") || lower.includes("prioritas") || lower.includes("qr")) {
    return "⚡ **Tiket QR Antrean VeriBot:**\nSemua dokumen kependudukan yang valid (KTP, KK, KIA, akta, surat pindah) dapat memperoleh **Tiket QR Antrean**.\n\n• Skor kejelasan ≥70%: label **Diterima — Lolos Pra-Pemeriksaan**.\n• Skor <70% atau foto buram: label **Diterima — Verifikasi Loket** — QR tetap terbit, tetapi dokumen asli tetap diperiksa petugas.\n• Bukan dokumen kependudukan: QR tidak diterbitkan.\n\nQR ini tiket antrean, bukan bukti dokumen sah.";
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
  if (lower.includes("lokasi") || lower.includes("alamat") || lower.includes("kantor") || lower.includes("kontak") || lower.includes("telepon") || lower.includes("whatsapp") || lower.includes("wa")) {
    return "📍 **Kantor Kelurahan Sukamaju:**\n• **Alamat:** Jl. Praja Abdi No. 45, Kecamatan Maju Sejahtera\n• **WhatsApp / Call Center:** +62 811-2345-6789\n• **Email Resmi:** layanan@sukamaju.desa.id\n• **Website / VeriBot:** 24 Jam Mandiri Online";
  }
  return null;
}

export const FAQ_FALLBACK_REPLY =
  "Halo Warga Sukamaju! Saya **VeriBot AI**, asisten cerdas pelayanan kependudukan Kelurahan Sukamaju.\n\nSilakan tanyakan seputar:\n• Syarat KTP-EL Baru / Hilang / Rusak\n• Prosedur Tiket QR Antrean\n• Pembuatan KIA, KK, dan Akta Pencatatan Sipil\n• Jadwal loket & standar pelayanan tanpa surat pengantar RT/RW.";

export const FAQ_EMERGENCY_REPLY =
  "Halo Warga Sukamaju! Saya VeriBot siap membantu Anda. Untuk pengurusan dokumen kependudukan (KTP, KK, KIA), loket buka Senin-Kamis 08.00-15.30 WIB dan Jumat 08.00-14.30 WIB. Anda dapat langsung mengunggah foto berkas di formulir mandiri untuk mendapatkan Tiket QR Antrean!";

export const FAQ_SYSTEM_PROMPT = `Anda adalah "Asisten Pintar VeriBot", petugas customer service AI resmi Kelurahan Sukamaju (Kecamatan Maju Sejahtera) dalam sistem AIPEX VeriBot (DIGIForward 2026).
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
- Tiket QR Antrean: Dokumen kependudukan valid selalu memperoleh tiket QR. Skor kejelasan minimal 70% berlabel "Diterima — Lolos Pra-Pemeriksaan"; skor di bawah 70% atau foto buram tetap terbit dengan label "Diterima — Verifikasi Loket". Bukan dokumen kependudukan tidak diterbitkan QR. QR ini tiket antrean, bukan bukti dokumen sah.
- UU PDP Compliance: Foto dokumen disimpan sementara terenkripsi di penyimpanan privat (terlihat petugas + pemilik tiket), dihapus otomatis (purge) seketika tiket disetujui/ditolak; foto terbengkalai dihapus maksimal 7 hari. Yang tercatat permanen hanya jenis dokumen kependudukan untuk rekap.

Jawablah secara informatif, hangat, solutif, dan tidak bertele-tele (maksimal 2-3 paragraf). Pisahkan tiap paragraf dengan satu baris kosong. Pakai **tebal** untuk istilah penting dan daftar "•" untuk rincian (maksimal 5 butir).`;

function normalizeQuestion(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function chatCacheKey(normalized: string): string {
  return `rl:chat-cache:${sha256Hex(Buffer.from(normalized, "utf8"))}`;
}

/** Batasi waktu tunggu satu percobaan model tanpa mengubah SDK. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface FaqAnswer {
  reply: string;
  source: string;
}

export interface FaqOptions {
  /** Kunci nara-route/bynara dari header/body (opsional). */
  apiKey?: string;
  /** Override model nara-route dari request (opsional). */
  naraModel?: string;
}

/**
 * Jawab satu pertanyaan chat. Tidak pernah melempar error untuk jalur normal:
 * selalu ada jawaban (KB generik) walau semua provider AI mati.
 */
export async function answerFaq(message: string, opts: FaqOptions = {}): Promise<FaqAnswer> {
  const text = String(message || "").trim();
  if (!text) return { reply: FAQ_FALLBACK_REPLY, source: "knowledge-base" };

  // 1) KB offline — instan, tanpa jaringan/AI.
  const offline = getOfflineFaqAnswer(text);
  if (offline) return { reply: offline, source: "knowledge-base" };

  // 2) Cache jawaban AI (24 jam) — pertanyaan sama setelahnya instan.
  const key = chatCacheKey(normalizeQuestion(text));
  const cached = await redisGet(key).catch(() => null);
  if (cached && cached.trim()) return { reply: cached.trim(), source: "cache" };

  // 3) Gemini: timeout per model + anggaran total agar tidak menggantung.
  const client = getGeminiClient();
  if (client) {
    const startedAt = Date.now();
    for (const modelName of FAQ_GEMINI_MODELS) {
      const remaining = GEMINI_TOTAL_BUDGET_MS - (Date.now() - startedAt);
      if (remaining < 1500) break;
      try {
        const response = await withTimeout(
          client.models.generateContent({
            model: modelName,
            contents: [{ text: FAQ_SYSTEM_PROMPT }, { text: `Pertanyaan Warga: ${text}` }],
          }),
          Math.min(GEMINI_PER_MODEL_TIMEOUT_MS, remaining)
        );
        const answer = String((response as any)?.text || "").trim();
        if (answer) {
          await redisSet(key, answer, FAQ_CACHE_TTL_MS).catch(() => {});
          return { reply: answer, source: modelName };
        }
      } catch (modelErr: any) {
        console.warn(`[FAQ] Gemini ${modelName} gagal: ${modelErr?.message || modelErr}`);
      }
    }
  }

  // 4) nara-route / bynara (OpenAI-compatible chat).
  if (isNaraConfigured(opts.apiKey)) {
    try {
      const reply = await chatCompletionViaNaraRoute({
        apiKey: opts.apiKey,
        model: opts.naraModel || process.env.NARA_ROUTE_MODEL || process.env.BYNARA_MODEL || undefined,
        messages: [
          { role: "system", content: FAQ_SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        temperature: 0.2,
        timeoutMs: NARA_TIMEOUT_MS,
      });
      if (reply) {
        await redisSet(key, reply, FAQ_CACHE_TTL_MS).catch(() => {});
        return { reply, source: "nara-route" };
      }
    } catch (naraErr: any) {
      console.warn(`[FAQ] nara-route gagal: ${naraErr?.message || naraErr}`);
    }
  }

  // 5) KB generik — jalur aman terakhir.
  return { reply: FAQ_FALLBACK_REPLY, source: "knowledge-base" };
}
