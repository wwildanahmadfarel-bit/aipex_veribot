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
import { matchFaqEntry } from "../../src/lib/faqMatch.js";

export const FAQ_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const FAQ_GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
const GEMINI_PER_MODEL_TIMEOUT_MS = 8_000;
const GEMINI_TOTAL_BUDGET_MS = 15_000;
const NARA_TIMEOUT_MS = 12_000;

/**
 * Resolver knowledge base offline. Mengembalikan null bila pertanyaan tidak
 * dikenal — pemanggil boleh lanjut ke AI, bukan menjawab generik.
 * Bila beberapa intent sama kuat, minta klarifikasi agar tidak salah jawab.
 */
export function getOfflineFaqAnswer(text: string): string | null {
  const match = matchFaqEntry(text);
  if (!match) return null;

  if (match.tied.length > 1) {
    const options = match.tied
      .slice(0, 4)
      .map((entry) => `• ${entry.question}`)
      .join("\n");
    return `Saya menemukan beberapa topik yang cocok. Mohon pilih salah satu agar jawabannya tepat:\n${options}`;
  }

  return match.entry.answer;
}

export const FAQ_FALLBACK_REPLY =
  "Halo Warga Sukamaju! Saya **VeriBot AI**, asisten cerdas pelayanan kependudukan Kelurahan Sukamaju.\n\nSilakan tanyakan seputar:\n• Syarat KTP-el, KK, KIA, akta, dan surat pindah\n• Biaya dan lama proses layanan\n• Tiket QR, cek status, dan riwayat tiket\n• IKD, SKU, sinkronisasi NIK, serta privasi data\n\nKetik pertanyaan atau pilih chip di bawah.";

export const FAQ_EMERGENCY_REPLY =
  "Halo Warga Sukamaju! Saya VeriBot siap membantu Anda. Untuk pengurusan dokumen kependudukan (KTP, KK, KIA), loket buka Senin-Kamis 08.00-15.30 WIB dan Jumat 08.00-14.30 WIB. Semua layanan dasar tidak dipungut biaya. Anda dapat langsung mengunggah foto berkas di formulir mandiri untuk mendapatkan Tiket QR Antrean!";

export const FAQ_SYSTEM_PROMPT = `Anda adalah "Asisten Pintar VeriBot", petugas customer service AI resmi Kelurahan Sukamaju (Kecamatan Maju Sejahtera) dalam sistem AIPEX VeriBot (DIGIForward 2026).
Tugas Anda adalah melayani warga kelurahan secara ramah, sopan, ringkas, dan jelas dalam bahasa Indonesia.

Informasi Resmi Kelurahan Sukamaju:
- Jam Operasional Loket Fisik:
  * Senin s.d. Kamis: 08.00 - 15.30 WIB
  * Jumat: 08.00 - 14.30 WIB
  * Sabtu, Minggu, & Libur Nasional: Tutup (Layanan Mandiri Online VeriBot 24 Jam Non-Stop)
- Alamat: Jl. Praja Abdi No. 45, Kecamatan Maju Sejahtera
- Call Center / WhatsApp: +62 811-2345-6789 | Email: layanan@sukamaju.desa.id
- Biaya: layanan dasar (KTP-el, KK, KIA, akta, surat pindah, legalisasi) TIDAK dipungut biaya.
- Waktu proses: KK/akta/surat pindah umumnya 1 hari kerja bila berkas lengkap; KTP-el 1-14 hari kerja tergantung konsolidasi data dan blanko; sinkronisasi NIK sekitar 1x24 jam.
- KTP-el baru: fotokopi KK, fotokopi akta kelahiran/ijazah, formulir F1.02, perekaman di loket. Tanpa surat pengantar RT/RW (Perpres No. 96 Tahun 2018).
- KTP-el hilang: surat keterangan kehilangan dari Polsek, fotokopi KK, F1.02. KTP-el rusak: fisik KTP lama, fotokopi KK, F1.02.
- KK: baru (buku nikah/akta perkawinan, KK asal, KTP-el pasangan); penambahan anggota (KK lama, akta/surat lahir, KTP orang tua); perubahan data (KK lama + dokumen pendukung); hilang (surat kehilangan Polsek); rusak (KK lama).
- KIA: fotokopi akta kelahiran, KK orang tua, KTP-el orang tua, pasfoto 3x4 2 lembar untuk anak di atas 5 tahun.
- Akta kelahiran: surat keterangan lahir, fotokopi buku nikah/akta perkawinan, KK dan KTP orang tua, KTP 2 saksi, F2.01. Bisa dilengkapi SPTJM Kelahiran bila surat lahir tidak ada.
- Akta kematian: surat keterangan kematian, KTP-el dan KK almarhum, KTP pelapor, KTP 2 saksi, F2.01. Bisa dilengkapi SPTJM Kematian bila surat kematian tidak ada.
- Akta perkawinan non-Muslim: surat pemberkatan, KTP-el dan KK mempelai, KTP orang tua, pasfoto 4x6 4 lembar.
- Surat pindah (SKPWNI): KK asli, KTP-el anggota yang pindah, formulir F1.08, alamat tujuan lengkap.
- IKD: sudah perekaman KTP-el, smartphone Android/iOS, email aktif, verifikasi wajah/QR di loket.
- SKU: KTP-el dan KK, surat pengantar RT/RW, foto lokasi usaha, formulir.
- Sinkronisasi NIK: KTP-el dan KK, tangkapan layar kendala, nomor WhatsApp aktif.
- Legalisasi: fotokopi KTP-el dan KK, produk layanan asli, maksimal 10 lembar, sekitar 2 jam.
- Foto dokumen: JPG/PNG/WEBP/PDF maksimal 4 MB, tidak silau/terpotong, NIK dan barcode terbaca.
- Tiket QR Antrean: dokumen kependudukan valid selalu memperoleh tiket QR. Skor kejelasan minimal 70 berlabel "Diterima - Lolos Pra-Pemeriksaan"; skor di bawah 70 atau foto buram tetap terbit dengan label "Diterima - Verifikasi Loket". Bukan dokumen kependudukan tidak diterbitkan QR. QR ini tiket antrean, bukan bukti dokumen sah.
- Cek tiket: masukkan kode tiket di kolom Lacak Tiket atau pindai QR; riwayat lokal maksimal 5 tiket dan tersimpan 30 hari.
- UU PDP: foto dokumen disimpan sementara terenkripsi di penyimpanan privat (terlihat petugas + pemilik tiket), dihapus otomatis (purge) seketika tiket disetujui/ditolak; foto terbengkalai dihapus maksimal 7 hari. Yang tercatat permanen hanya jenis dokumen kependudukan untuk rekap.

Aturan menjawab:
- Jawab HANYA berdasarkan informasi resmi di atas. Jika informasi tidak ada, katakan belum ada informasi pasti dan arahkan ke loket/WhatsApp resmi. Jangan mengarang persyaratan, biaya, atau waktu layanan.
- Jawablah secara informatif, hangat, solutif, dan tidak bertele-tele (maksimal 2-3 paragraf). Pisahkan tiap paragraf dengan satu baris kosong. Pakai **tebal** untuk istilah penting dan daftar "•" untuk rincian (maksimal 5 butir).`;

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
