import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import {
  checkOcrRateLimit,
  checkSimpleRateLimit,
  CHAT_10MIN,
  getClientIp,
  hashIp,
  isTurnstileVerified,
  markTurnstileVerified,
  ocrLimits,
  peekOcrWindowCount,
  rateLimitHeaders,
  TICKET_HOUR,
} from "./api/_lib/rate-limit";
import { isTurnstileConfigured, verifyTurnstile } from "./api/_lib/turnstile";
import { PHOTO_PURGE_AUDIT_NOTE, sha256Hex, validateUploadBuffer } from "./api/_lib/file-guard";
import { hapusFotoTiket } from "./api/_lib/tiket-foto";
import { getCachedOcr, setCachedOcr } from "./api/_lib/ocr-cache";
import { logOcrAttempt } from "./api/_lib/abuse-log";
import { classifyAiFailure } from "./api/_lib/ai-errors";
import { WaError, isWaEnabled, normalizeWa, sendFonnteWa, ticketStatusMessage } from "./api/_lib/wa";
import { isOfficerJwtConfigured, officerUnauthorized, requireOfficer, signOfficerToken } from "./api/_lib/officer-auth";
import {
  AI_PROVIDERS,
  chatCompletionViaNaraRoute,
  getNaraRouteApiKey,
  getNaraRouteBaseURL,
  isNaraRouteConfigured,
  logAiKeyStatus,
  validateAiKeys,
  visionViaNaraRoute,
} from "./services/ai_providers";

// Load env dari .env.local / .env agar SUPABASE_URL & KEY terbaca saat `tsx server.ts`
// (tsx tidak otomatis memuat .env.local seperti Next.js / Vite)
for (const envFile of [".env.local", ".env"]) {
  try {
    const full = path.join(process.cwd(), envFile);
    if (fs.existsSync(full)) dotenv.config({ path: full, override: false });
  } catch {}
}
dotenv.config();

// Validasi dini kunci AI (peringatan di log bila kosong/placeholder,
// supaya ketahuan rusaknya saat start — bukan saat warga sudah memindai).
logAiKeyStatus();

// Normalisasi kode akses: trim, uppercase, rapikan separator, toleransi typo SUKAMAZU -> SUKAMAJU
function normalizeAccessCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/SUKAMAZU/g, "SUKAMAJU");
}

// Daftar petugas fallback resmi (satu sumber kebenaran untuk server Express)
const FALLBACK_OFFICERS: { id: string; nama_petugas: string; role: string; kode_akses: string }[] = [
  { id: "off-001", nama_petugas: "Bambang Sudiro, S.STP", role: "Kepala Seksi Pelayanan Kependudukan", kode_akses: "ADM-SUKAMAJU-2026" },
  { id: "off-002", nama_petugas: "Siti Rahmawati, S.AP", role: "Petugas Loket 1 - e-KTP & Identitas", kode_akses: "849201" },
  { id: "off-003", nama_petugas: "Ahmad Fauzi, S.Kom", role: "Supervisor VeriBot AI Kependudukan", kode_akses: "VERIBOT-ADMIN" },
  { id: "off-004", nama_petugas: "Hendra Setiawan, S.IP", role: "Petugas Loket Fast-Track VeriBot AIPEX", kode_akses: "LOKET-SUKAMAJU-01" },
  // Alias typo lama (SUKAMAZU) tetap diterima demi kompatibilitas
  { id: "off-004", nama_petugas: "Hendra Setiawan, S.IP", role: "Petugas Loket Fast-Track VeriBot AIPEX", kode_akses: "LOKET-SUKAMAZU-01" },
];

function findFallbackOfficer(normalized: string) {
  return (
    FALLBACK_OFFICERS.find((o) => normalizeAccessCode(o.kode_akses) === normalized) || null
  );
}

// --- Scanner KTP: normalisasi & pesan standar --------------------------------
// Pesan baku saat file bukan KTP Indonesia (wajib dipakai frontend & backend)
export const BUKAN_KTP_MESSAGE =
  "File bukan Kartu Kependudukan Indonesia. Silakan unggah foto e-KTP asli yang jelas dan tidak terpotong.";

// Normalisasi jenis dokumen hasil AI ke salah satu: KTP | KK | AKTA | LAINNYA
// Jika user mengirim KTP (varian "e-KTP", "KTP-EL", "KARTU TANDA PENDUDUK") → "KTP".
function normalizeJenisDokumen(raw: unknown): "KTP" | "KK" | "AKTA" | "LAINNYA" {
  const upper = String(raw ?? "").toUpperCase().trim();
  if (!upper) return "LAINNYA";
  if (upper.includes("KTP") || upper.includes("TANDA PENDUDUK")) return "KTP";
  if (
    upper === "KK" ||
    upper.startsWith("KK ") ||
    upper.startsWith("KK-") ||
    upper.includes("KARTU KELUARGA") ||
    upper.includes("FAMILY CARD")
  )
    return "KK";
  if (upper.includes("AKTA") || upper.includes("AKTE") || upper.includes("KELAHIRAN"))
    return "AKTA";
  if (upper === "KTP" || upper === "KK" || upper === "AKTA") return upper as any;
  return "LAINNYA";
}

// Normalisasi status verifikasi hasil AI ke: BERHASIL | BURAM | TIDAK_VALID
function normalizeStatusVerifikasi(raw: unknown): "BERHASIL" | "BURAM" | "TIDAK_VALID" {
  const upper = String(raw ?? "").toUpperCase().trim().replace(/[\s-]+/g, "_");
  if (upper === "BERHASIL" || upper === "VALID" || upper === "LULUS" || upper === "LAYAK" || upper === "SUCCESS" || upper === "BERHASIL_")
    return "BERHASIL";
  if (
    upper === "TIDAK_VALID" ||
    upper === "TIDAKVALID" ||
    upper === "INVALID" ||
    upper === "LAINNYA" ||
    upper === "REJECTED" ||
    upper === "DITOLAK" ||
    upper.includes("BUKAN")
  )
    return "TIDAK_VALID";
  return "BURAM";
}

// Parse JSON respons AI secara robust: AI kadang membungkus JSON dalam ```json fence
// atau teks tambahan. Jangan langsung gagal untuk KTP valid hanya karena format.
function parseAiJsonResponse(rawText: string): any {
  const text = String(rawText || "").trim();
  if (!text) throw new Error("Respons AI kosong.");
  try {
    return JSON.parse(text);
  } catch {}
  try {
    const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    return JSON.parse(fenced.trim());
  } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error("AI mengembalikan format tak valid, coba ulangi pindaian.");
}

// Initialize Supabase Client (sanitized to remove any trailing /rest/v1 or slashes causing PGRST125)
function getCleanSupabaseUrl(rawUrl?: string): string {
  if (!rawUrl) return "";
  return rawUrl.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
}

const rawSupabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_URL = getCleanSupabaseUrl(rawSupabaseUrl);
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
if (supabase) {
  console.log(`[Supabase] Client connected to: ${SUPABASE_URL}`);
}

// In-Memory Storage for uploaded documents (UU PDP Compliance: No persistent file saving)
// Disamakan dengan file-guard MAX_UPLOAD_BYTES (4.2MB batas Vercel) agar
// file kebesaran ditolak cepat di multer, bukan setelah baca buffer.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4_200_000 }, // Max 4.2MB (sinkron file-guard.ts)
});

interface Ticket {
  id: string;
  ticket_code: string;
  kode_tiket?: string;
  nik_encrypted: string;
  nik_raw?: string;
  nama_warga: string;
  nama?: string;
  phone?: string;
  no_hp?: string;
  alamat?: string;
  jenis_dokumen: string;
  status_verifikasi: any;
  skor_ai: number;
  status_ai: "LULUS" | "GAGAL";
  catatan_ai: string;
  catatan_petugas?: string;
  catatan?: string;
  officer_id?: string;
  foto_path?: string | null;
  created_at: string;
  updated_at: string;
}

// In-Memory Database for Tickets (UU PDP: foto hanya arsip sementara terenkripsi,
// di-purge seketika saat tiket diputus; NIK/identitas mengikuti kebijakan retensi)
let tickets: Ticket[] = [
  {
    id: "1",
    ticket_code: "TKT-202609-8410",
    nik_encrypted: "565757******6576",
    nik_raw: "5657576576576576",
    nama_warga: "rana coba",
    phone: "08122516355",
    alamat: "RT 02 / RW 04 Kel. Sukamaju",
    jenis_dokumen: "Penerbitan KTP-EL Baru / Penggantian",
    status_verifikasi: "PENDING",
    skor_ai: 88,
    status_ai: "LULUS",
    catatan_ai: "Kualitas dokumen tajam, NIK 16 digit terdeteksi valid, foto wajah jelas.",
    created_at: "2026-09-08 07:23",
    updated_at: "2026-09-08 07:23",
  },
  {
    id: "2",
    ticket_code: "TKT-202609-9315",
    nik_encrypted: "099999******9999",
    nik_raw: "0999999999999999",
    nama_warga: "www",
    phone: "099999999999",
    alamat: "RT 01 / RW 01 Sukamaju",
    jenis_dokumen: "Penerbitan KTP-EL Baru / Penggantian",
    status_verifikasi: "PENDING",
    skor_ai: 88,
    status_ai: "LULUS",
    catatan_ai: "Format data terbaca, sudut orientasi 0 derajat, watermark Dukcapil teridentifikasi.",
    created_at: "2026-09-08 02:09",
    updated_at: "2026-09-08 02:09",
  },
  {
    id: "3",
    ticket_code: "TKT-202508-004",
    nik_encrypted: "320101******0002",
    nik_raw: "3201014812990002",
    nama_warga: "Rina Agustina Wardani",
    phone: "087811223344",
    alamat: "Jl. Melati No. 8 RT 05 / RW 02",
    jenis_dokumen: "Akta Kematian",
    status_verifikasi: "PENDING",
    skor_ai: 91,
    status_ai: "LULUS",
    catatan_ai: "Surat Keterangan Medis Rumah Sakit & KTP saksi terlampir lengkap.",
    created_at: "2025-08-23 11:28",
    updated_at: "2025-08-23 11:28",
  },
  {
    id: "4",
    ticket_code: "TKT-202508-001",
    nik_encrypted: "320101******0001",
    nik_raw: "3201011504950001",
    nama_warga: "Ahmad Santoso",
    phone: "081234567890",
    alamat: "Jl. Cempaka Raya No. 12 RT 03/05",
    jenis_dokumen: "Penerbitan KTP-EL Baru / Penggantian",
    status_verifikasi: "APPROVED",
    skor_ai: 95,
    status_ai: "LULUS",
    catatan_ai: "Dokumen asli fisik e-KTP dan kartu keluarga terverifikasi sempurna.",
    catatan_petugas: "Disetujui. Silakan ambil fisik KTP di Meja Loket 2.",
    created_at: "2025-08-20 09:15",
    updated_at: "2025-08-20 09:40",
  },
  {
    id: "5",
    ticket_code: "TKT-202508-002",
    nik_encrypted: "320101******0004",
    nik_raw: "3201015607980004",
    nama_warga: "Siti Nurhaliza",
    phone: "081398765432",
    alamat: "Komplek Sukamaju Indah Blok D-4",
    jenis_dokumen: "Kartu Identitas Anak (KIA)",
    status_verifikasi: "APPROVED",
    skor_ai: 92,
    status_ai: "LULUS",
    catatan_ai: "Akta Kelahiran dan pasfoto anak ukuran 3x4 latar belakang merah valid.",
    catatan_petugas: "KIA telah dicetak dan siap diambil.",
    created_at: "2025-08-21 14:02",
    updated_at: "2025-08-21 14:30",
  },
  {
    id: "6",
    ticket_code: "TKT-202508-003",
    nik_encrypted: "320101******0003",
    nik_raw: "3201017849200003",
    nama_warga: "Budi Hermawan",
    phone: "085712349988",
    alamat: "Komplek Permata Blok B2 No. 8",
    jenis_dokumen: "Surat Keterangan Pindah (SKPWNI)",
    status_verifikasi: "REVISI",
    skor_ai: 58,
    status_ai: "GAGAL",
    catatan_ai: "Foto KTP buram, pantulan silau menutupi 4 digit terakhir NIK. Perlu unggah ulang.",
    catatan_petugas: "Mohon unggah kembali foto KTP di tempat terang tanpa pantulan lampu kilat.",
    created_at: "2025-08-22 10:45",
    updated_at: "2025-08-22 11:10",
  },
];

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// --- Global provider: nara-route -------------------------------------------
// API key diinput sendiri oleh user via salah satu cara berikut (prioritas):
//  1. Header:  x-nara-route-api-key: <key>
//  2. Body:    { naraApiKey: "<key>" } atau { apiKey: "<key>" } (khusus chat/ocr)
//  3. Env:     NARA_ROUTE_API_KEY di .env.local / .env
function extractNaraApiKey(req: any): string {
  const fromHeader =
    req?.headers?.["x-nara-route-api-key"] || req?.headers?.["x-nara-api-key"];
  const fromBody = req?.body?.naraApiKey || req?.body?.nara_route_api_key;
  const picked =
    (typeof fromHeader === "string" && fromHeader.trim()) ||
    (typeof fromBody === "string" && fromBody.trim()) ||
    "";
  return getNaraRouteApiKey(picked);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));

  // CORS for local API access (termasuk header kunci Nara manual via frontend)
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-nara-route-api-key, x-nara-api-key");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Health check (+ kesiapan kunci AI, tanpa network call & tanpa bakar kuota)
  app.get("/api/health", (_req, res) => {
    const aiKeys = validateAiKeys();
    const ocrReady = aiKeys.some((k) => k.ready);
    const waTokenLen = String(process.env.FONNTE_TOKEN || "").trim().length;
    const waEnabled = isWaEnabled();
    res.json({
      status: "ok",
      server: "AIPEX VeriBot Engine",
      compliance: "UU PDP Compliant (In-Memory Processing)",
      timestamp: new Date().toISOString(),
      ocrReady,
      wa: {
        enabled: waEnabled,
        tokenPresent: waTokenLen > 0,
        tokenLen: waTokenLen,
        ready: waEnabled && waTokenLen > 0,
      },
      adminAuth: { jwtConfigured: isOfficerJwtConfigured() },
      ai: aiKeys.map((k) => ({
        provider: k.provider,
        envVar: k.envVar,
        present: k.present,
        formatOk: k.formatOk,
        isPlaceholder: k.isPlaceholder,
        ready: k.ready,
        fingerprint: k.fingerprint,
        hint: k.hint,
      })),
      ...(!ocrReady
        ? {
            warning:
              "Tidak ada provider AI yang siap — pindaian OCR akan gagal (502). Isi NARA_ROUTE_API_KEY dan/atau GEMINI_API_KEY yang valid lalu restart server.",
          }
        : {}),
    });
  });

  // Global AI providers registry (tanpa membocorkan API key)
  // `configured` = kunci siap pakai (placeholder/format salah = false).
  app.get("/api/providers", (_req, res) => {
    const keyStatus = Object.fromEntries(validateAiKeys().map((k) => [k.provider, k]));
    res.json({
      success: true,
      providers: Object.values(AI_PROVIDERS).map((p) => ({
        name: p.name,
        baseURL: p.name === "nara-route" ? getNaraRouteBaseURL() : p.baseURL,
        type: p.type,
        defaultModel: p.name === "nara-route"
          ? process.env.NARA_ROUTE_MODEL || p.defaultModel
          : p.defaultModel,
        configured: keyStatus[p.name]?.ready ?? false,
        formatOk: keyStatus[p.name]?.formatOk ?? false,
        isPlaceholder: keyStatus[p.name]?.isPlaceholder ?? false,
        hint: keyStatus[p.name]?.hint ?? "",
        apiKeyEnv: p.apiKeyEnv,
      })),
    });
  });

  // 1. Scan Document OCR with Gemini AI Vision (UU PDP In-Memory Processing)
  const handleOcrRequest = async (req: any, res: any) => {
    try {
      let fileBytes: Buffer | null = null;
      let mimeType = "image/jpeg";
      // Salinan foto untuk arsip sementara terenkripsi (diisi setelah AI selesai).
      let fotoCopy: Buffer | null = null;

      if (req.file && req.file.buffer) {
        fileBytes = req.file.buffer;
        mimeType = req.file.mimetype || "image/jpeg";
      } else if (req.body && typeof req.body.imageBase64 === "string" && req.body.imageBase64) {
        const cleanBase64 = req.body.imageBase64.replace(/^data:[a-zA-Z0-9/+\-.]+;base64,/, "");
        fileBytes = Buffer.from(cleanBase64, "base64");
        const match = req.body.imageBase64.match(/^data:([a-zA-Z0-9/+\-.]+);base64,/);
        if (match) {
          mimeType = match[1];
        }
      }
      if (fileBytes && fileBytes.length === 0) fileBytes = null;

      // --- Anti-spam (paritas Vercel): honeypot + dwell + captcha + rate + guard + dedup
      const ocrStart = Date.now();
      const clientIp = getClientIp(req);
      const ipHash = hashIp(clientIp, req?.headers?.["user-agent"]);
      const limits = ocrLimits();
      const bodyF: any = req.body || {};

      const honeypot = bodyF.website_confirm ?? bodyF.honeypot;
      const startedAt = Number(bodyF.startedAt);
      if (typeof honeypot === "string" && honeypot.trim()) {
        await logOcrAttempt({ ipHash, fileHash: "", mime: mimeType, sizeBytes: fileBytes?.length ?? 0, status: "BOT_HONEYPOT", source: "blocked:honeypot", latencyMs: Date.now() - ocrStart });
        return res.status(400).json({ success: false, code: "BOT_DETECTED", message: "Terdeteksi aktivitas otomatis. Muat ulang halaman lalu unggah foto e-KTP asli." });
      }
      if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < 3000) {
        await logOcrAttempt({ ipHash, fileHash: "", mime: mimeType, sizeBytes: fileBytes?.length ?? 0, status: "BOT_FAST", source: "blocked:dwell", latencyMs: Date.now() - ocrStart });
        return res.status(400).json({ success: false, code: "BOT_DETECTED", message: "Terlalu cepat mengirim berkas. Tunggu sejenak lalu unggah ulang foto e-KTP asli." });
      }

      const turnstileToken = bodyF.turnstileToken ?? null;
      if (!(await isTurnstileVerified(ipHash)) && isTurnstileConfigured()) {
        const used = await peekOcrWindowCount(ipHash);
        if (used >= limits.per10Min - 1) {
          const v = await verifyTurnstile(turnstileToken, clientIp);
          if (!v.ok) {
            await logOcrAttempt({ ipHash, fileHash: "", mime: mimeType, sizeBytes: fileBytes?.length ?? 0, status: "CAPTCHA_REQUIRED", source: "blocked:captcha", latencyMs: Date.now() - ocrStart });
            return res.status(403).json({ success: false, code: "CAPTCHA_REQUIRED", captchaRequired: true, message: "Verifikasi manusia diperlukan untuk pemindaian terakhir. Selesaikan captcha lalu coba lagi (kuota Anda tidak berkurang)." });
          }
          await markTurnstileVerified(ipHash);
        } else if (typeof turnstileToken === "string" && turnstileToken.trim()) {
          const v = await verifyTurnstile(turnstileToken, clientIp);
          if (v.ok) await markTurnstileVerified(ipHash);
        }
      }

      const rl = await checkOcrRateLimit(req);
      for (const [k, v] of Object.entries(rateLimitHeaders(rl.remaining10, rl.retryAfterSec))) {
        try { res.setHeader(k, v); } catch {}
      }
      if (!rl.allowed) {
        const msg =
          rl.code === "GLOBAL_LIMIT"
            ? "Layanan sedang padat (kuota harian tercapai). Coba lagi besok atau hubungi petugas loket."
            : rl.code === "DAY_LIMIT"
              ? `Kuota harian Anda habis (${limits.perDayIp}x/hari). AI belum memeriksa berkas ini — bukan salah foto Anda. Coba lagi besok atau hubungi petugas loket / lanjut isi manual.`
              : `Terlalu sering memindai. Sisa kuota 0/${limits.per10Min} per 10 menit. AI belum memeriksa berkas ini — bukan salah foto Anda.`;
        await logOcrAttempt({ ipHash, fileHash: "", mime: mimeType, sizeBytes: fileBytes?.length ?? 0, status: rl.code, source: "blocked:rate", latencyMs: Date.now() - ocrStart });
        return res.status(429).json({ success: false, code: "RATE_LIMITED", limitCode: rl.code, isSystemError: true, message: msg, retryAfter: rl.retryAfterSec, remaining: 0, limit: limits.per10Min });
      }

      const guard = validateUploadBuffer(fileBytes, mimeType);
      if (!guard.ok) {
        await logOcrAttempt({ ipHash, fileHash: "", mime: mimeType, sizeBytes: fileBytes?.length ?? 0, status: "INVALID_FILE", source: `blocked:${guard.reason}`, latencyMs: Date.now() - ocrStart });
        return res.status(guard.reason === "too-large" ? 413 : 400).json({
          success: false,
          code: "INVALID_FILE",
          message: guard.message,
          data: { nik: null, nama: null, jenis_dokumen: "LAINNYA", skor_kejelasan: 0, status_verifikasi: "TIDAK_VALID", status_kualitas: "TIDAK_LAYAK", catatan: guard.message },
        });
      }

      const fileHash = sha256Hex(fileBytes as Buffer);
      let parsed: any = await getCachedOcr(fileHash);
      const skipAi = Boolean(parsed) && typeof parsed === "object";
      let aiSource = skipAi ? "cache" : "";

      if (!fileBytes) {
        return res.status(400).json({
          success: false,
          message: "File tidak ditemukan. Silakan unggah foto e-KTP (JPG/PNG/WEBP/PDF).",
          data: {
            nik: null,
            nama: null,
            jenis_dokumen: "LAINNYA",
            skor_kejelasan: 0,
            status_verifikasi: "TIDAK_VALID",
            status_kualitas: "TIDAK_LAYAK",
            catatan: BUKAN_KTP_MESSAGE,
          },
        });
      }

      const naraApiKey = extractNaraApiKey(req);
      const naraConfigured = isNaraRouteConfigured(naraApiKey);
      const client = getGeminiClient();

      const systemInstructionText = `Anda adalah sistem AI Vision OCR profesional yang dikhususkan untuk menganalisis dan memverifikasi dokumen kependudukan resmi Indonesia (e-KTP, Kartu Keluarga / KK, dan Akta Kelahiran).

Tugas utama Anda:
1. Identifikasi Jenis Dokumen (wajib tepat):
   - "KTP": e-KTP Republik Indonesia. Ciri wajib: ada tulisan "NIK" 16 digit, header provinsi/kabupaten, foto wajah, tulisan "KARTU TANDA PENDUDUK" / "e-KTP". Varian tulisan "e-KTP", "KTP-EL", "KTP EL" semuanya tetap "KTP".
   - "KK": Kartu Keluarga.
   - "AKTA": Akta Kelahiran.
   - "LAINNYA": WAJIB dipakai jika gambar BUKAN salah satu dari ketiga dokumen di atas (misal: SIM, paspor, foto selfie, screenshot HP, dokumen asing, kertas kosong, foto blur total tanpa ciri Dukcapil).

2. Ekstraksi Data Utama:
   - NIK: Cari 16-digit Nomor Induk Kependudukan. Bersihkan dari spasi atau simbol. Jika tidak ditemukan, kabur, atau tidak bernilai 16 digit, set ke null.
   - Nama: Ambil nama lengkap pemilik dokumen sesuai teks resmi. Jika bukan dokumen Dukcapil, set ke null.

3. Evaluasi Kualitas Fisik & Kejelasan Foto:
   - Periksa kejelasan teks (apakah terjadi motion blur atau out-of-focus).
   - Periksa gangguan cahaya (pantulan flash, silau/glare, atau bayangan gelap).
   - Periksa kerapian pemotongan (apakah ada sudut dokumen yang terpotong).

4. Kalkulasi Skor Kejelasan (0 - 100):
   - 80 - 100: Teks sangat tajam, seluruh digit NIK terbaca sempurna tanpa keraguan.
   - 50 - 79: Teks agak kabur/silau, namun NIK masih dapat diidentifikasi.
   - 0 - 49: Foto sangat buram, NIK tertutup silau, terpotong, atau tidak terbaca.
   - 0 - 25: Bukan dokumen kependudukan (wajib skor rendah).

5. Penentuan Status Verifikasi (wajib konsisten dengan jenis):
   - "BERHASIL": Dokumen valid (KTP/KK/AKTA) dan skor kejelasan >= 70.
   - "BURAM": Dokumen kependudukan asli (KTP/KK/AKTA), namun skor kejelasan < 70 (memerlukan foto ulang).
   - "TIDAK_VALID": WAJIB dipakai jika jenis_dokumen "LAINNYA" (gambar bukan dokumen kependudukan resmi Indonesia).

6. Catatan Perbaikan (Saran Singkat):
   - Jika status BURAM, berikan 1 kalimat saran konkret (contoh: "Foto KTP terlalu silau di area NIK, harap matikan lampu flash dan ambil ulang foto di tempat terang").
   - Jika status TIDAK_VALID, WAJIB awali catatan dengan kalimat persis: "File bukan Kartu Kependudukan Indonesia." lalu lanjutkan saran unggah e-KTP asli.

PENTING: Jawab HANYA dengan JSON valid memakai key: nik, nama, jenis_dokumen, skor_kejelasan, status_verifikasi, catatan.`;

      const userPrompt = "Analisis foto dokumen kependudukan ini. Periksa kejelasan teks, ekstrak NIK 16 digit jika ada, dan tentukan apakah foto layak untuk verifikasi.";

      const ocrModels = ["gemini-2.5-flash", "gemini-3.6-flash"];
      let responseText = "";
      let lastAiError = "";
      const isPdf = /pdf/i.test(mimeType || "");

      // Prioritas 1: Gemini (utama — mendukung gambar + PDF).
      // Cache hit: lewati semua panggilan AI (hemat token).
      if (!skipAi && !responseText && client) {
        for (const modelName of ocrModels) {
        try {
          const response = await client.models.generateContent({
            model: modelName,
            contents: [
              {
                inlineData: {
                  data: fileBytes.toString("base64"),
                  mimeType: mimeType,
                },
              },
              { text: userPrompt },
            ],
            config: {
              systemInstruction: systemInstructionText,
              responseMimeType: "application/json",
              temperature: 0.0,
              responseSchema: {
                type: "OBJECT",
                properties: {
                  nik: {
                    type: "STRING",
                    nullable: true,
                    description: "16 digit NIK jika terdeteksi, null jika tidak",
                  },
                  nama: {
                    type: "STRING",
                    nullable: true,
                    description: "Nama lengkap pada dokumen",
                  },
                  jenis_dokumen: {
                    type: "STRING",
                    description: "KTP, KK, AKTA, atau LAINNYA",
                  },
                  skor_kejelasan: {
                    type: "INTEGER",
                    description: "Skor kejelasan 0 - 100",
                  },
                  status_verifikasi: {
                    type: "STRING",
                    description: "BERHASIL, BURAM, atau TIDAK_VALID",
                  },
                  catatan: {
                    type: "STRING",
                    description: "Alasan jika dokumen kurang tajam atau terpotong",
                  },
                },
                required: ["jenis_dokumen", "skor_kejelasan", "status_verifikasi"],
              },
            },
          });

          if (response && response.text) {
            responseText = response.text;
            aiSource = "gemini";
            break;
          }
        } catch (modelErr: any) {
          lastAiError = `Gemini ${modelName}: ${modelErr?.message || modelErr}`;
          console.warn(`[OCR AI] Model ${modelName} gagal: ${lastAiError}`);
        }
        }
      }

      // Prioritas 2 (cadangan): nara-route (https://router.bynara.id/v1)
      // Catatan: endpoint image_url nara-route hanya mendukung gambar — PDF dilewati.
      if (!skipAi && !responseText && naraConfigured && !isPdf) {
        try {
          responseText = await visionViaNaraRoute({
            apiKey: naraApiKey,
            model: (req.body?.naraModel as string) || process.env.NARA_ROUTE_MODEL || undefined,
            systemPrompt: systemInstructionText,
            userPrompt,
            imageBase64: fileBytes.toString("base64"),
            mimeType,
          });
          if (responseText) aiSource = "nara-route";
          console.log("[OCR AI] via nara-route (https://router.bynara.id/v1, cadangan)");
        } catch (naraErr: any) {
          lastAiError = `nara-route: ${naraErr?.message || naraErr}`;
          console.warn(`[OCR AI] nara-route (cadangan) gagal: ${lastAiError}`);
        }
      } else if (isPdf && naraConfigured) {
        console.log("[OCR AI] PDF terdeteksi — lewati nara-route (image-only), hanya Gemini.");
      }

      if (!skipAi && !responseText && !client && !naraConfigured) {
        return res.status(503).json({
          success: false,
          isSystemError: true,
          message: "Layanan AI OCR belum dikonfigurasi (GEMINI_API_KEY / NARA_ROUTE_API_KEY kosong). Bukan salah foto Anda — lanjut isi formulir manual atau hubungi petugas untuk verifikasi manual.",
          data: {
            nik: null,
            nama: null,
            jenis_dokumen: "LAINNYA",
            skor_kejelasan: 0,
            status_verifikasi: "TIDAK_VALID",
            status_kualitas: "TIDAK_LAYAK",
            isSystemError: true,
            catatan: "Layanan AI belum dikonfigurasi (gangguan sistem). Bukan salah foto Anda — lanjut isi manual atau hubungi petugas untuk verifikasi manual.",
          },
        });
      }

      if (!skipAi && !responseText) {
        // JANGAN samarkan kegagalan AI sebagai "bukan KTP", dan JANGAN
        // bocorkan detail mentah provider ke user.
        const aiFail = classifyAiFailure(lastAiError);
        return res.status(502).json({
          success: false,
          isSystemError: true,
          code: aiFail.code,
          subcode: aiFail.subcode,
          provider: aiFail.provider,
          retryable: aiFail.retryable,
          retryAfter: aiFail.retryAfterSec,
          message: aiFail.message,
          data: {
            nik: null,
            nama: null,
            jenis_dokumen: "LAINNYA",
            skor_kejelasan: 0,
            status_verifikasi: "TIDAK_VALID",
            status_kualitas: "TIDAK_LAYAK",
            isSystemError: true,
            catatan: aiFail.message,
          },
        });
      }

      if (!skipAi) {
      try {
        parsed = parseAiJsonResponse(responseText);
      } catch (parseErr: any) {
        console.warn(`[OCR AI] Gagal parse JSON AI: ${parseErr?.message}. Raw: ${String(responseText).slice(0, 300)}`);
        // Buffer foto dinol-kan sebelum keluar (UU PDP: minimalkan sisa data di RAM).
        try {
          if (fileBytes) fileBytes.fill(0);
        } catch {}
        return res.status(502).json({
          success: false,
          isSystemError: true,
          message: "AI mengembalikan jawaban tak valid. Silakan ulangi pindaian dengan foto lebih jelas.",
          data: {
            nik: null,
            nama: null,
            jenis_dokumen: "LAINNYA",
            skor_kejelasan: 0,
            status_verifikasi: "TIDAK_VALID",
            status_kualitas: "TIDAK_LAYAK",
            isSystemError: true,
            catatan: "AI mengembalikan jawaban tak valid. Silakan ulangi pindaian.",
          },
        });
      }
      // Foto sudah selesai dipakai AI: salin untuk arsip sementara terenkripsi,
      // lalu nol-kan buffer asli (panjang tak berubah, aman untuk log size).
      fotoCopy = null;
      try {
        if (fileBytes) fotoCopy = Buffer.from(fileBytes);
      } catch {}
      try {
        if (fileBytes) fileBytes.fill(0);
      } catch {}
      if (!aiSource) aiSource = client ? "gemini" : naraConfigured ? "nara-route" : "ai";
      }

      // Normalisasi jenis dokumen & status (otoritatif backend)
      parsed.jenis_dokumen = normalizeJenisDokumen(parsed.jenis_dokumen);
      parsed.status_verifikasi = normalizeStatusVerifikasi(parsed.status_verifikasi);
      if (typeof parsed.skor_kejelasan !== "number") {
        const asNum = Number(parsed.skor_kejelasan);
        parsed.skor_kejelasan = Number.isFinite(asNum) ? Math.round(asNum) : 0;
      }
      parsed.skor_kejelasan = Math.max(0, Math.min(100, Math.round(parsed.skor_kejelasan)));

      // Validasi tambahan: Cek kelengkapan digit NIK (parsial disimpan agar user tahu)
      if (parsed.nik) {
        const nikClean = String(parsed.nik).replace(/\D/g, "");
        if (nikClean.length !== 16) {
          // Simpan bacaan parsial untuk umpan balik (mis. "12/16 digit terbaca"), bukan sekadar null
          if (nikClean.length >= 8) {
            parsed.nik_partial = nikClean;
          }
          parsed.nik = null;
          if (parsed.status_verifikasi === "BERHASIL") {
            parsed.status_verifikasi = "BURAM";
            parsed.catatan = `NIK terbaca sebagian (${nikClean.length || 0}/16 digit). Foto ulang e-KTP dengan fokus tajam tanpa silau.`;
          }
        } else {
          parsed.nik = nikClean;
        }
      }

      // Konsistensi silang jenis <-> status
      if (parsed.jenis_dokumen === "LAINNYA") {
        parsed.status_verifikasi = "TIDAK_VALID";
      }
      // Skor < 70 tidak boleh BERHASIL
      if (parsed.status_verifikasi === "BERHASIL" && parsed.skor_kejelasan < 70) {
        parsed.status_verifikasi = "BURAM";
        if (!parsed.catatan) {
          parsed.catatan = "Dokumen terdeteksi namun skor kejelasan di bawah 70. Foto ulang di tempat terang tanpa flash.";
        }
      }

      // Penegakan baku untuk dokumen TIDAK_VALID (bukan KTP Indonesia)
      if (parsed.status_verifikasi === "TIDAK_VALID") {
        parsed.jenis_dokumen = "LAINNYA";
        parsed.nik = null;
        if (!parsed.nama || typeof parsed.nama !== "string") parsed.nama = null as any;
        // Cap skor rendah agar jelas invalid
        if (typeof parsed.skor_kejelasan !== "number" || parsed.skor_kejelasan > 25) {
          parsed.skor_kejelasan = typeof parsed.skor_kejelasan === "number" ? Math.min(parsed.skor_kejelasan, 20) : 0;
        }
        if (!parsed.catatan || !/bukan kartu kependudukan/i.test(String(parsed.catatan))) {
          parsed.catatan = BUKAN_KTP_MESSAGE;
        }
      }

      const isTidakValid = parsed.status_verifikasi === "TIDAK_VALID" || parsed.jenis_dokumen === "LAINNYA";
      const isBerhasil = parsed.status_verifikasi === "BERHASIL" && !isTidakValid;
      const isBuramValid =
        parsed.status_verifikasi === "BURAM" &&
        !isTidakValid &&
        ["KTP", "KK", "AKTA"].includes(parsed.jenis_dokumen);
      // Koreksi final: BERHASIL palsu tidak boleh lolos
      if (isTidakValid) {
        parsed.status_verifikasi = "TIDAK_VALID";
        parsed.jenis_dokumen = "LAINNYA";
      }
      parsed.status_kualitas = isBerhasil ? "LAYAK" : "TIDAK_LAYAK";

      if (!skipAi && !parsed._cacheHit) await setCachedOcr(fileHash, parsed);

      // File BUKAN dokumen kependudukan → JANGAN buat tiket, kembalikan pesan baku
      if (isTidakValid) {
        await logOcrAttempt({ ipHash, fileHash, mime: mimeType, sizeBytes: fileBytes.length, skor: parsed.skor_kejelasan ?? null, status: "TIDAK_VALID", source: aiSource || "ai", latencyMs: Date.now() - ocrStart });
        return res.json({
          success: false,
          message: BUKAN_KTP_MESSAGE,
          data: parsed,
          ...parsed,
        });
      }

      // Dokumen valid (BERHASIL maupun BURAM) → SELALU buat tiket + QR.
      // BERHASIL = Fast-Track LULUS. BURAM = dokumen asli tapi buram → tiket REVISI
      // dengan catatan foto ulang / bawa fisik ke loket (tetap dapat QR).
      const isValidDoc = isBerhasil || isBuramValid;
      if (!isValidDoc) {
        return res.json({
          success: false,
          message: parsed.catatan || "Dokumen buram, silakan foto ulang.",
          data: parsed,
          ...parsed,
        });
      }
      
      // Simpan Otomatis ke Tabel Supabase 'tickets' (BERHASIL + BURAM valid)
      const kodeTiket = `TKT-${Date.now().toString().slice(-6)}`;
      const finalStatus = isBerhasil ? "BERHASIL" : "BURAM";
      const finalCatatan =
        parsed.catatan ||
        (isBerhasil
          ? "Dokumen kependudukan valid dan terbaca jelas. QR Fast-Track terbit."
          : "Dokumen kependudukan asli terdeteksi namun buram. QR tetap terbit — bawa fisik dokumen asli untuk verifikasi ulang di loket.");
      parsed.catatan = finalCatatan;

      const dbPayload: any = {
        kode_tiket: kodeTiket,
        nik: parsed.nik || "0000000000000000",
        nama: parsed.nama || "Tidak Terdeteksi",
        jenis_dokumen: parsed.jenis_dokumen || "LAINNYA",
        skor_kejelasan: typeof parsed.skor_kejelasan === "number" ? parsed.skor_kejelasan : 0,
        status_verifikasi: finalStatus,
        catatan: finalCatatan,
      };
      // Nomor WA dari wizard (langkah 1); alur tanpa formulir tidak punya.
      const scanPhone =
        typeof bodyF.phone === "string" && bodyF.phone.trim()
          ? bodyF.phone.trim()
          : typeof bodyF.no_hp === "string" && bodyF.no_hp.trim()
            ? bodyF.no_hp.trim()
            : "";
      if (scanPhone) dbPayload.phone = scanPhone;
      
      let ticketData: any = dbPayload;
      let phoneSaved = false;
      
      if (supabase) {
        try {
          // Insert ke Supabase
          let ins = await supabase.from("tickets").insert([dbPayload]).select();
          // Fallback bila kolom phone belum dimigrasi di database.
          if (ins.error && scanPhone && /phone/i.test(String((ins.error as any)?.message || ""))) {
            try {
              console.warn(`[ocr] kolom phone belum ada, nomor ${kodeTiket} tidak persist. Jalankan migrasi 20260928_tiket_phone.sql.`);
            } catch {}
            delete dbPayload.phone;
            ins = await supabase.from("tickets").insert([dbPayload]).select();
          }
          const { data, error } = ins;
          if (error) {
            console.error("Supabase insert error:", error);
          } else if (data && data.length > 0) {
            ticketData = data[0];
            if (scanPhone && (ticketData as any).phone) phoneSaved = true;
          }
          // Sembuhkan baris lama NIK sama yang belum punya nomor — best-effort.
          if (scanPhone && parsed.nik) {
            try {
              await supabase
                .from("tickets")
                .update({ phone: scanPhone })
                .eq("nik", String(parsed.nik).replace(/\D/g, ""))
                .is("phone", null)
                .neq("kode_tiket", kodeTiket);
            } catch {}
            try {
              for (const t of tickets) {
                if ((t as any).nik_raw === parsed.nik && !(t as any).phone) (t as any).phone = scanPhone;
              }
            } catch {}
          }
        } catch (supabaseError) {
          console.error("Failed to save to Supabase:", supabaseError);
        }
      }

      // Keep in-memory store updated for UI consistency
      const maskedNik = parsed.nik && parsed.nik.length >= 12
        ? `${parsed.nik.slice(0, 6)}******${parsed.nik.slice(-4)}`
        : (parsed.nik ? `${parsed.nik.slice(0, 3)}***${parsed.nik.slice(-2)}` : "320101******0000");

      const inMemTicket: Ticket = {
        id: String(ticketData.id || Date.now()),
        ticket_code: kodeTiket,
        nik_encrypted: maskedNik,
        nik_raw: parsed.nik || undefined,
        nama_warga: parsed.nama || "Warga",
        phone: scanPhone || "",
        jenis_dokumen: parsed.jenis_dokumen || "LAINNYA",
        status_verifikasi: isBerhasil ? "APPROVED" : "REVISI",
        skor_ai: typeof parsed.skor_kejelasan === "number" ? parsed.skor_kejelasan : 90,
        status_ai: isBerhasil ? "LULUS" : "GAGAL",
        catatan_ai: finalCatatan,
        created_at: new Date().toISOString().replace("T", " ").slice(0, 16),
        updated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
      };
      tickets.unshift(inMemTicket);

      // Sembuhkan memori: baris NIK sama yang belum punya nomor ikut terisi.
      if (scanPhone && parsed.nik) {
        try {
          for (const t of tickets) {
            if ((t as any).nik_raw === parsed.nik && !(t as any).phone) (t as any).phone = scanPhone;
          }
        } catch {}
      }

      // Arsip sementara foto terenkripsi (best-effort): tiket tetap valid bila gagal.
      if (fotoCopy && supabase) {
        try {
          const { simpanFotoTiket } = await import("./api/_lib/tiket-foto");
          const saved = await simpanFotoTiket(kodeTiket, fotoCopy, mimeType);
          if (saved.ok && saved.path) {
            inMemTicket.foto_path = saved.path;
            try {
              await supabase
                .from("tickets")
                .update({ foto_path: saved.path, foto_iv: saved.ivHex })
                .or(`kode_tiket.eq.${kodeTiket},id.eq.${ticketData.id || ""}`);
            } catch {}
          }
        } catch {}
        try {
          fotoCopy.fill(0);
        } catch {}
        fotoCopy = null;
      }

      const completeTicketResponse = {
        ...ticketData,
        ...inMemTicket,
        kode_tiket: kodeTiket,
        ticket_code: kodeTiket,
        nama: parsed.nama || "Warga",
        nama_warga: parsed.nama || "Warga",
        skor_kejelasan: typeof parsed.skor_kejelasan === "number" ? parsed.skor_kejelasan : 90,
        catatan: finalCatatan,
      };

      await logOcrAttempt({ ipHash, fileHash, mime: mimeType, sizeBytes: fileBytes.length, skor: parsed.skor_kejelasan ?? null, status: finalStatus, source: aiSource || "ai", latencyMs: Date.now() - ocrStart });
      try {
        res.setHeader("X-Ocr-Source", aiSource || "ai");
        res.setHeader("X-RateLimit-Remaining", String(rl.remaining10));
      } catch {}
      res.json({
        success: true,
        message: finalCatatan,
        needsRephoto: !isBerhasil,
        source: aiSource || "ai",
        phoneSaved,
        data: {
          ...parsed,
          ticket: completeTicketResponse,
        },
        ticket: completeTicketResponse,
        ...parsed,
      });
    } catch (error: any) {
      // Error tak terduga = GANGGUAN SISTEM, bukan vonis "bukan KTP".
      // Detail mentah hanya ke log server.
      try {
        console.error(`[OCR] tak terduga (server-only): ${String(error?.message || error).slice(0, 400)}`);
      } catch {}
      res.status(500).json({
        success: false,
        isSystemError: true,
        code: "OCR_SYSTEM_ERROR",
        message: "Terjadi gangguan sistem saat memindai. Coba lagi sesaat atau hubungi petugas untuk verifikasi manual.",
        data: {
          nik: null,
          nama: null,
          jenis_dokumen: "LAINNYA",
          skor_kejelasan: 0,
          status_verifikasi: "TIDAK_VALID",
          status_kualitas: "TIDAK_LAYAK",
          isSystemError: true,
          catatan: "Terjadi gangguan sistem saat memindai. Coba lagi, atau hubungi petugas untuk verifikasi manual.",
        },
      });
    }
  };

  app.post("/api/scan-document", upload.single("file"), handleOcrRequest);
  app.post("/api/ocr", upload.single("file"), handleOcrRequest);

  // Foto sementara tiket (proksi terdekripsi, no-store; rate-limit 20x/10 mnt/IP).
  app.get("/api/tickets/foto", async (req, res) => {
    try {
      const rl = await checkSimpleRateLimit(req, { windowMs: 10 * 60 * 1000, max: 20, prefix: "foto10" });
      if (!rl.allowed) {
        return res.status(429).json({ success: false, message: "Terlalu sering membuka foto. Coba lagi nanti." });
      }
      const kode = String((req.query as any)?.kode || (req.query as any)?.kode_tiket || "").trim().toUpperCase();
      if (!kode) return res.status(400).json({ success: false, message: "Parameter kode tiket wajib." });
      const { lihatFotoTiket } = await import("./api/_lib/tiket-foto");
      const foto = await lihatFotoTiket(kode);
      if (!foto.ok || !foto.bytes) {
        return res.status(404).json({ success: false, message: foto.reason || "Foto tidak tersedia." });
      }
      res.setHeader("Content-Type", foto.mime);
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Content-Disposition", "inline");
      return res.status(200).send(foto.bytes);
    } catch {
      return res.status(500).json({ success: false, message: "Gagal membuka foto." });
    }
  });

  // Sweeper dev: hapus foto tiket terbengkalai (butuh x-cron-secret).
  app.all("/api/cron/purge-tiket-foto", async (req, res) => {
    const secret = String(process.env.CRON_SECRET || "").trim();
    const got = String(req.headers?.["x-cron-secret"] || "").trim();
    if (!secret || !got || got !== secret) {
      return res.status(401).json({ success: false, message: "Cron tidak diotorisasi." });
    }
    try {
      const { fotoRetentionDays } = await import("./api/_lib/tiket-foto");
      const days = fotoRetentionDays();
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      if (!supabase) return res.json({ success: true, deleted: 0 });
      const { data: rows } = await supabase
        .from("tickets")
        .select("kode_tiket,foto_path")
        .not("foto_path", "is", null)
        .lt("created_at", cutoff);
      let deleted = 0;
      for (const r of rows || []) {
        const kode = String((r as any)?.kode_tiket || "");
        const path = String((r as any)?.foto_path || "");
        if (!kode || !path) continue;
        try {
          await supabase.storage.from("tiket-fotos").remove([path]);
          await supabase.from("tickets").update({ foto_path: null, foto_iv: null }).eq("kode_tiket", kode);
          deleted += 1;
        } catch {}
      }
      return res.json({ success: true, deleted, retentionDays: days });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: String(err?.message || err).slice(0, 200) });
    }
  });

  // 2. Track/Get specific ticket by ticket code
  app.get("/api/tickets/:kode_tiket", async (req, res) => {
    try {
      const kodeTiket = req.params.kode_tiket.trim().toUpperCase();
      let found: any = null;
      
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from("tickets")
            .select("*")
            .ilike("kode_tiket", kodeTiket)
            .maybeSingle();

          if (!error && data) {
            const rawNik = data.nik || "";
            const masked = rawNik.length >= 12
              ? `${rawNik.slice(0, 6)}******${rawNik.slice(-4)}`
              : (rawNik ? `${rawNik.slice(0, 3)}***${rawNik.slice(-2)}` : "320101******0000");

            found = {
              id: String(data.id || data.kode_tiket),
              ticket_code: data.kode_tiket,
              kode_tiket: data.kode_tiket,
              nik_encrypted: masked,
              nik_raw: rawNik,
              nama_warga: data.nama || "Warga",
              nama: data.nama || "Warga",
              phone: data.phone || "",
              alamat: data.alamat || "",
              jenis_dokumen: data.jenis_dokumen || "KTP",
              status_verifikasi: data.status_verifikasi === "BERHASIL" ? "APPROVED" : (data.status_verifikasi === "BURAM" ? "REVISI" : (data.status_verifikasi || "PENDING")),
              skor_ai: data.skor_kejelasan || 90,
              skor_kejelasan: data.skor_kejelasan || 90,
              status_ai: data.status_verifikasi === "BERHASIL" || (data.skor_kejelasan >= 70) ? "LULUS" : "GAGAL",
              catatan_ai: data.catatan || "",
              catatan: data.catatan || "",
              catatan_petugas: data.catatan_petugas || "",
              created_at: data.created_at ? new Date(data.created_at).toISOString().replace("T", " ").slice(0, 16) : new Date().toISOString().replace("T", " ").slice(0, 16),
              updated_at: data.created_at ? new Date(data.created_at).toISOString().replace("T", " ").slice(0, 16) : new Date().toISOString().replace("T", " ").slice(0, 16),
            };
          }
        } catch (dbErr) {
          console.warn("Supabase ticket query warning:", dbErr);
        }
      }

      if (!found) {
        const memTicket = tickets.find(
          (t) => t.ticket_code.toUpperCase() === kodeTiket || (t as any).kode_tiket?.toUpperCase() === kodeTiket
        );
        if (memTicket) {
          found = {
            ...memTicket,
            kode_tiket: memTicket.ticket_code,
            nama: memTicket.nama_warga,
            skor_kejelasan: memTicket.skor_ai,
            catatan: memTicket.catatan_ai,
          };
        }
      }

      if (!found) {
        return res.status(404).json({
          success: false,
          message: "Nomor resi/tiket tidak ditemukan. Pastikan kode yang Anda masukkan benar."
        });
      }

      return res.json({
        success: true,
        data: found,
        ticket: found
      });
    } catch (error: any) {
      console.error("Tracking API Error:", error);
      res.status(500).json({ 
        success: false,
        message: error?.message || "Terjadi kesalahan internal server" 
      });
    }
  });

  // 3. Get All Tickets
  app.get("/api/tickets", async (_req, res) => {
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from("tickets")
          .select("*")
          .order("created_at", { ascending: false });

        if (!error && data && data.length > 0) {
          const supabaseMapped = data.map((row: any) => {
            const rawNik = row.nik || "";
            const masked = rawNik.length >= 12
              ? `${rawNik.slice(0, 6)}******${rawNik.slice(-4)}`
              : (rawNik ? `${rawNik.slice(0, 3)}***${rawNik.slice(-2)}` : "320101******0000");

            return {
              id: String(row.id || row.kode_tiket),
              ticket_code: row.kode_tiket,
              kode_tiket: row.kode_tiket,
              nik_encrypted: masked,
              nik_raw: rawNik,
              nama_warga: row.nama || "Warga",
              nama: row.nama || "Warga",
              jenis_dokumen: row.jenis_dokumen || "KTP",
              status_verifikasi: row.status_verifikasi === "BERHASIL" ? "APPROVED" : (row.status_verifikasi === "BURAM" ? "REVISI" : (row.status_verifikasi || "PENDING")),
              skor_ai: row.skor_kejelasan || 90,
              skor_kejelasan: row.skor_kejelasan || 90,
              status_ai: row.status_verifikasi === "BERHASIL" || (row.skor_kejelasan >= 70) ? "LULUS" : "GAGAL",
              catatan_ai: row.catatan || "",
              catatan: row.catatan || "",
              created_at: row.created_at ? new Date(row.created_at).toISOString().replace("T", " ").slice(0, 16) : new Date().toISOString().replace("T", " ").slice(0, 16),
              updated_at: row.created_at ? new Date(row.created_at).toISOString().replace("T", " ").slice(0, 16) : new Date().toISOString().replace("T", " ").slice(0, 16),
            };
          });

          return res.json({
            success: true,
            data: supabaseMapped,
            total: supabaseMapped.length,
          });
        }
      }
    } catch (err) {
      console.warn("Supabase fetch all tickets warning:", err);
    }

    res.json({
      success: true,
      data: tickets,
      total: tickets.length,
    });
  });

  // 4. Create Ticket (Form Wizard)
  app.post("/api/tickets", async (req, res) => {
    try {
      // Anti-spam dev-parity: cegah banjir tiket (5x/jam/IP).
      const tktRl = await checkSimpleRateLimit(req, TICKET_HOUR);
      if (!tktRl.allowed) {
        return res.status(429).json({ success: false, code: "RATE_LIMITED", message: `Terlalu sering menerbitkan tiket. Coba lagi dalam ${Math.ceil(tktRl.retryAfterSec / 60)} menit.`, retryAfter: tktRl.retryAfterSec });
      }
      const {
        nik,
        nama_warga,
        phone,
        alamat,
        jenis_dokumen,
        skor_ai = 88,
        status_ai = "LULUS",
        catatan_ai,
        // Bukti hasil scan — wajib untuk mencegah tiket dari file bukan kependudukan
        scan_jenis_dokumen,
        jenis_dokumen_scan,
        scan_status_verifikasi,
        status_verifikasi_scan,
        verification,
      } = req.body;

      if (!nama_warga || !nik) {
        return res.status(400).json({ success: false, message: "NIK dan Nama warga wajib diisi." });
      }

      // NIK wajib 16 digit angka
      const nikDigits = String(nik).replace(/\D/g, "");
      if (nikDigits.length !== 16) {
        return res.status(400).json({
          success: false,
          message: "NIK harus 16 digit angka. Tiket tidak dapat diterbitkan.",
        });
      }

      // Validasi bukti scan: tolak jika terdeteksi BUKAN dokumen kependudukan.
      // Frontend wajib mengirim scan_jenis_dokumen + scan_status_verifikasi dari hasil OCR.
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
      const scanCatatan = String(
        (verification as any)?.catatan ?? catatan_ai ?? ""
      );
      const terdeteksiBukanKtp =
        scanJenis === "LAINNYA" ||
        scanStatus === "TIDAK_VALID" ||
        /bukan kartu kependudukan/i.test(scanCatatan);
      if (terdeteksiBukanKtp) {
        return res.status(400).json({
          success: false,
          message: BUKAN_KTP_MESSAGE,
        });
      }

      // Generate Ticket Code: TKT-YYYYMM-XXXX
      const date = new Date();
      const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
      const randomCode = Math.floor(1000 + Math.random() * 9000);
      const ticketCode = `TKT-${yearMonth}-${randomCode}`;

      // Masked NIK for UU PDP privacy compliance
      const maskedNik = nikDigits.length >= 12
        ? `${nikDigits.slice(0, 6)}******${nikDigits.slice(-4)}`
        : `${nikDigits.slice(0, 3)}***${nikDigits.slice(-2)}`;

      // Status awal mengikuti hasil scan: BERHASIL → PENDING (siap verifikasi petugas),
      // BURAM valid → REVISI (wajib bawa fisik + foto ulang di loket).
      const awalStatusVerifikasi = scanStatus === "BURAM" ? "REVISI" : "PENDING";
      const awalCatatan =
        catatan_ai ||
        (scanStatus === "BURAM"
          ? "Dokumen valid namun buram. QR terbit — bawa fisik dokumen asli untuk verifikasi ulang di loket."
          : "Dokumen lolos validasi otomatis Cognitive AI VeriBot.");

      const newTicket: Ticket = {
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

      tickets.unshift(newTicket);
      // Sembuhkan baris NIK sama yang belum punya nomor (mis. tiket hasil pindai).
      if (phone) {
        try {
          for (const t of tickets) {
            if ((t as any).nik_raw === nikDigits && !(t as any).phone) (t as any).phone = String(phone);
          }
        } catch {}
      }

      // Simpan ke Supabase jika tersedia
      if (supabase) {
        try {
          const dbPayload: any = {
            kode_tiket: ticketCode,
            nik: nikDigits,
            nama: nama_warga,
            jenis_dokumen: jenis_dokumen || "KTP",
            skor_kejelasan: Number(skor_ai) || 88,
            status_verifikasi: scanStatus === "BURAM" ? "BURAM" : "BERHASIL",
            catatan: awalCatatan,
          };
          if (phone) dbPayload.phone = String(phone);
          let phoneSaved = false;
          try {
            await supabase.from("tickets").insert([dbPayload]);
            if (phone) phoneSaved = true;
          } catch (firstErr: any) {
            // Fallback bila kolom phone belum dimigrasi di database.
            if (phone && /phone/i.test(String(firstErr?.message || ""))) {
              try {
                console.warn(`[tickets POST] kolom phone belum ada, nomor ${ticketCode} tidak persist. Jalankan migrasi 20260928_tiket_phone.sql.`);
              } catch {}
              delete dbPayload.phone;
              await supabase.from("tickets").insert([dbPayload]);
            } else {
              throw firstErr;
            }
          }
          if (phoneSaved) {
            // Sembuhkan baris lama NIK sama yang belum punya nomor — best-effort.
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

      res.status(201).json({
        success: true,
        data: newTicket,
        ticket: newTicket,
        phoneSaved: Boolean(phone),
        message: "Tiket Fast-Track berhasil diterbitkan.",
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 5. Update Ticket Status (Petugas Loket 1-Click Action)
  app.patch("/api/tickets/:id", async (req, res) => {
    const { id } = req.params;
    const { status_verifikasi, catatan_petugas } = req.body;

    const ticketIndex = tickets.findIndex((t) => t.id === id || t.ticket_code === id);
    if (ticketIndex !== -1) {
      tickets[ticketIndex] = {
        ...tickets[ticketIndex],
        status_verifikasi: status_verifikasi || tickets[ticketIndex].status_verifikasi,
        catatan_petugas: catatan_petugas !== undefined ? catatan_petugas : tickets[ticketIndex].catatan_petugas,
        updated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
      };
    }

    let supabaseUpdated = false;
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("tickets")
          .update({
            status_verifikasi: status_verifikasi,
            catatan: catatan_petugas || undefined,
          })
          .or(`id.eq.${id},kode_tiket.eq.${id}`)
          .select();
        if (!error && data && data.length > 0) supabaseUpdated = true;
      } catch (dbErr) {
        console.warn("Supabase update ticket status warning:", dbErr);
      }
    }

    if (ticketIndex === -1 && !supabaseUpdated) {
      return res.status(404).json({ success: false, message: "Tiket tidak ditemukan." });
    }

    const updated = ticketIndex !== -1 ? tickets[ticketIndex] : { id, status_verifikasi, catatan_petugas };

    res.json({
      success: true,
      data: updated,
      message: `Status tiket berhasil diubah menjadi ${status_verifikasi}.`,
    });
  });

  // 6. Gemini FAQ Chatbot with Multi-Model Fallback & Knowledge Base
  app.post("/api/chat-faq", async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ success: false, message: "Pesan tidak boleh kosong." });
      }
      // Anti-spam dev-parity: batasi chat (10x/10 mnt/IP).
      const chatRl = await checkSimpleRateLimit(req, CHAT_10MIN);
      if (!chatRl.allowed) {
        return res.status(429).json({ success: false, code: "RATE_LIMITED", message: `Terlalu banyak pertanyaan dalam waktu singkat. Coba lagi dalam ${Math.ceil(chatRl.retryAfterSec / 60)} menit.`, retryAfter: chatRl.retryAfterSec });
      }

      // Offline knowledge base resolver for 24/7 uninterrupted responses
      const getOfflineFaqAnswer = (text: string): string => {
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

        if (lower.includes("pdp") || lower.includes("privasi") || lower.includes("aman") || lower.includes("ram") || lower.includes("keamanan")) {
          return "🛡️ **Kepatuhan Privasi UU PDP (UU No. 27 Tahun 2022):**\nSeluruh berkas foto e-KTP dan KK yang diunggah warga diproses murni di memori sementara (In-Memory RAM) dan otomatis dihapus saat analisis selesai. Sistem tidak menyimpan foto dokumen ke hard disk/database.";
        }

        if (lower.includes("lokasi") || lower.includes("alamat") || lower.includes("kantor") || lower.includes("kontak") || lower.includes("telepon") || lower.includes("whatsapp") || lower.includes("wa")) {
          return "📍 **Kantor Kelurahan Sukamaju:**\n• **Alamat:** Jl. Praja Abdi No. 45, Kecamatan Maju Sejahtera\n• **WhatsApp / Call Center:** +62 811-2345-6789\n• **Email Resmi:** layanan@sukamaju.desa.id\n• **Website / VeriBot:** 24 Jam Mandiri Online";
        }

        return "Halo Warga Sukamaju! Saya **VeriBot AI**, asisten cerdas pelayanan kependudukan Kelurahan Sukamaju.\n\nSilakan tanyakan seputar:\n• Syarat KTP-EL Baru / Hilang / Rusak\n• Prosedur Jalur Antrean Cepat (Fast-Track Tiket QR)\n• Pembuatan KIA, KK, dan Akta Pencatatan Sipil\n• Jadwal loket & standar pelayanan tanpa surat pengantar RT/RW.";
      };

      const client = getGeminiClient();
      const naraApiKey = extractNaraApiKey(req);

      const systemPrompt = `Anda adalah "Asisten Pintar VeriBot", petugas customer service AI resmi Kelurahan Sukamaju (Kecamatan Maju Sejahtera) dalam sistem AIPEX VeriBot (DIGIForward 2026).
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
- UU PDP Compliance: Seluruh foto dokumen kependudukan diproses hanya dalam memori server (RAM) dan langsung dihapus otomatis (auto-purge). Tidak ada foto yang disimpan di hard disk.

Jawablah secara informatif, hangat, solutif, dan tidak bertele-tele (maksimal 2-3 paragraf). Pisahkan tiap paragraf dengan satu baris kosong. Pakai **tebal** untuk istilah penting dan daftar "•" untuk rincian (maksimal 5 butir).`;

      // Prioritas 1: global provider "nara-route" (https://router.bynara.id/v1)
      if (isNaraRouteConfigured(naraApiKey)) {
        try {
          const reply = await chatCompletionViaNaraRoute({
            apiKey: naraApiKey,
            model: (req.body?.naraModel as string) || process.env.NARA_ROUTE_MODEL || undefined,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: message },
            ],
            temperature: 0.2,
          });
          if (reply) {
            return res.json({ success: true, reply, source: "nara-route" });
          }
        } catch (naraErr: any) {
          console.warn(`[FAQ] nara-route gagal, lanjut ke Gemini/offline: ${naraErr?.message || naraErr}`);
        }
      }

      if (client) {
        // Multi-model resilience: Prioritize gemini-3.6-flash as requested, with fallback model
        const candidateModels = ["gemini-3.6-flash", "gemini-2.5-flash"];

        for (const modelName of candidateModels) {
          try {
            const response = await client.models.generateContent({
              model: modelName,
              contents: [
                { text: systemPrompt },
                { text: `Pertanyaan Warga: ${message}` },
              ],
            });

            if (response && response.text && response.text.trim()) {
              return res.json({ success: true, reply: response.text.trim(), source: modelName });
            }
          } catch (modelErr: any) {
            // If 503 (high demand) or 429 (rate limit), log gentle warning and try fallback model
            console.warn(`[Gemini FAQ] Model ${modelName} temporary issue (${modelErr?.status || modelErr?.code || 503}), trying next model...`);
          }
        }
      }

      // If no API key or all Gemini models hit 503 high-demand spike, deliver comprehensive offline answer
      const offlineReply = getOfflineFaqAnswer(message);
      return res.json({ success: true, reply: offlineReply, source: "knowledge-base" });
    } catch (err: any) {
      console.warn("Chat fallback activation:", err?.message || err);
      return res.json({
        success: true,
        reply: "Halo Warga Sukamaju! Saya VeriBot siap membantu Anda. Untuk pengurusan dokumen kependudukan (KTP, KK, KIA), loket buka Senin-Kamis 08.00-15.30 WIB dan Jumat 08.00-14.30 WIB. Anda dapat langsung mengunggah foto berkas di formulir mandiri untuk mendapatkan Tiket Fast-Track!",
        source: "emergency-fallback",
      });
    }
  });

  // Admin & Officer Authentication & Verifikasi Kode Khusus
  const handleAdminLogin = async (req: express.Request, res: express.Response) => {
    try {
      // Anti brute-force: maks 10x/10 mnt/IP.
      const rl = await checkSimpleRateLimit(req, { windowMs: 10 * 60 * 1000, max: 10, prefix: "login10" });
      if (!rl.allowed) {
        try {
          res.setHeader("Retry-After", String(rl.retryAfterSec));
        } catch {}
        return res.status(429).json({
          success: false,
          code: "LOGIN_RATE_LIMITED",
          message: "Terlalu banyak percobaan login. Coba lagi beberapa menit.",
          retryAfter: rl.retryAfterSec,
        });
      }
      const kodeAkses = req.body.kodeAkses || req.body.kode_akses || req.body.pin;

      if (!kodeAkses || typeof kodeAkses !== "string" || !kodeAkses.trim()) {
        return res.status(400).json({
          success: false,
          message: "Kode akses wajib diisi",
        });
      }

      const trimmedCode = kodeAkses.trim();
      const normalizedCode = normalizeAccessCode(trimmedCode);
      if (!normalizedCode) {
        return res.status(400).json({ success: false, message: "Kode akses wajib diisi" });
      }

      // Deteksi kesalahan umum: user memasukkan kode tiket warga (TKT-/FT-) ke form login petugas
      if (/^(TKT|FT)-/i.test(normalizedCode)) {
        return res.status(401).json({
          success: false,
          code: "INVALID_CODE",
          message: "Kode akses tidak valid.",
        });
      }

      let officer: { id: string; nama_petugas: string; role: string; kode_akses?: string } | null = null;
      let errorFromDb: any = null;

      // 1. Cari petugas di database Supabase (tabel officers)
      // Coba exact dulu, lalu case-insensitive (ilike) dengan versi normalisasi agar
      // "loket-sukamaju-01" / " Loket Sukamaju 01 " tetap lolos.
      if (supabase) {
        try {
          const exact = await supabase
            .from("officers")
            .select("id, nama_petugas, role, kode_akses")
            .eq("kode_akses", trimmedCode)
            .maybeSingle();

          if (!exact.error && exact.data) {
            officer = exact.data;
          } else {
            if (exact.error && (exact.error as any).code !== "PGRST116") errorFromDb = exact.error;
            const insensitive = await supabase
              .from("officers")
              .select("id, nama_petugas, role, kode_akses")
              .ilike("kode_akses", normalizedCode)
              .maybeSingle();
            if (!insensitive.error && insensitive.data) {
              officer = insensitive.data;
            } else if (insensitive.error && (insensitive.error as any).code !== "PGRST116") {
              errorFromDb = insensitive.error;
            }
          }
        } catch (err) {
          errorFromDb = err;
        }
      }

      // 2. Fallback petugas terdaftar resmi jika tabel officers belum dimigrasikan di database atau offline
      if (!officer) {
        const matched = findFallbackOfficer(normalizedCode);
        if (matched) {
          officer = matched;
        }
      }

      if (!officer) {
        console.warn(`[login] kode tidak valid (normalized): "${normalizedCode}" dbErr=${errorFromDb?.message || errorFromDb?.code || "-"}`);
        return res.status(401).json({
          success: false,
          code: "INVALID_CODE",
          message: "Kode akses tidak valid.",
        });
      }

      // 3. Berhasil Login: terbitkan JWT 8 jam (stateless, verifikasi di semua instance)
      if (!isOfficerJwtConfigured()) {
        return res.status(503).json({
          success: false,
          code: "AUTH_NOT_CONFIGURED",
          message: "Login petugas belum dikonfigurasi (OFFICER_JWT_SECRET kosong). Hubungi admin server.",
        });
      }
      const officerProfile = { id: officer.id, nama: officer.nama_petugas, role: officer.role };
      return res.json({
        success: true,
        message: "Login petugas berhasil",
        officer: officerProfile,
        token: signOfficerToken(officerProfile),
        expiresInMs: 8 * 60 * 60 * 1000,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: err.message || "Terjadi kesalahan sistem",
      });
    }
  };

  app.post("/api/admin/login", handleAdminLogin);
  app.post("/api/officer/login", handleAdminLogin);

  // 1. GET: Ambil daftar pengajuan berkas warga untuk petugas (WAJIB Bearer)
  app.get("/api/admin/tickets", async (req, res) => {
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
            try {
              if (!("phone" in (dbTickets[0] as any))) {
                console.warn("[admin/tickets GET] kolom phone belum ada — nomor tak persist. Jalankan migrasi 20260928_tiket_phone.sql.");
              }
            } catch {}
            return res.json({ success: true, data: dbTickets });
          }
        } catch (dbErr) {
          console.warn("[admin/tickets GET] Supabase warning:", dbErr);
        }
      }

      return res.json({ success: true, data: tickets });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. PATCH: Petugas mengubah status verifikasi berkas warga (WAJIB Bearer)
  // Transaksional WA seperti api/admin/tickets.ts: WA gagal -> rollback.
  app.patch("/api/admin/tickets", async (req, res) => {
    const auth = requireOfficer(req);
    if (!auth.ok) return officerUnauthorized(res, auth.error);
    try {
      const { ticketId, status, catatan, no_hp, nama, jenis_dokumen, kode_tiket } = req.body;
      const officerId = auth.officerId;

      if (!ticketId || !status) {
        return res.status(400).json({
          success: false,
          message: "Data tidak lengkap",
        });
      }

      if (!isWaEnabled()) {
        return res.status(503).json({
          success: false,
          code: "WA_DISABLED",
          message: "Notifikasi WA belum diaktifkan (WA_ENABLED=false). Status TIDAK diubah.",
        });
      }
      const waTo = no_hp || tickets.find((t: any) => t.id === ticketId || t.ticket_code === ticketId)?.no_hp;
      if (!normalizeWa(waTo)) {
        return res.status(400).json({
          success: false,
          code: "WA_INVALID_NUMBER",
          message: "Nomor WhatsApp warga tidak valid (harap 08xxxxxxxxxx). Status TIDAK diubah.",
        });
      }

      let currentTicket: any = null;
      let updatedTicket: any = null;

      // Skema aktual: tickets.id UUID; verification_logs = FK UUID +
      // CHECK status_baru IN (DISETUJUI,DITOLAK,PERLU_PERBAIKAN). Log best-effort.
      const isUuid = (v: unknown) =>
        typeof v === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      const isValidLogStatus = (v: unknown) => v === "DISETUJUI" || v === "DITOLAK" || v === "PERLU_PERBAIKAN";

      // Update di Supabase jika terhubung
      if (supabase) {
        try {
          const { data: cur } = await supabase
            .from("tickets")
            .select("id,status_verifikasi")
            .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`)
            .single();
          currentTicket = cur;

          // Coba update dengan updated_at
          let { data: upd, error: updateError } = await supabase
            .from("tickets")
            .update({
              status_verifikasi: status,
              catatan: catatan || null,
              updated_at: new Date().toISOString(),
            })
            .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`)
            .select()
            .single();

          // Simpan balik nomor koreksi petugas (best-effort; abaikan bila kolom belum ada).
          if (!updateError && typeof no_hp === "string" && no_hp.trim()) {
            try {
              await supabase
                .from("tickets")
                .update({ phone: no_hp.trim() })
                .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`);
            } catch {}
          }

          // Fallback bila kolom updated_at belum ada di skema Supabase
          if (
            updateError &&
            (updateError.code === "PGRST204" ||
              updateError.message?.toLowerCase().includes("updated_at"))
          ) {
            const retry = await supabase
              .from("tickets")
              .update({
                status_verifikasi: status,
                catatan: catatan || null,
              })
              .or(`id.eq.${ticketId},kode_tiket.eq.${ticketId}`)
              .select()
              .single();
            upd = retry.data;
            updateError = retry.error;
          }

          if (updateError) {
            console.warn("[admin/tickets PATCH] Supabase update error:", updateError);
          } else {
            updatedTicket = upd;
          }

          // Catat log tindakan petugas (best-effort: lewati bila FK/CHECK tak terpenuhi)
          // Penanda purge: foto tidak dipertahankan pasca-keputusan (audit UU PDP).
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
            } catch (logErr) {
              console.warn("[verification_logs] insert skipped:", logErr);
            }
          }
        } catch (dbErr) {
          console.warn("[admin/tickets PATCH] Supabase error:", dbErr);
        }
      }

      // Update in-memory tickets juga
      const idx = tickets.findIndex(
        (t) => t.id === ticketId || t.ticket_code === ticketId
      );
      const prevMem = idx !== -1 ? { ...tickets[idx] } : null;
      if (idx !== -1) {
        tickets[idx] = {
          ...tickets[idx],
          status_verifikasi: status,
          catatan_petugas: catatan !== undefined ? catatan : tickets[idx].catatan_petugas,
          phone: typeof waTo === "string" && waTo.trim() ? waTo.trim() : tickets[idx].phone,
          updated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
        };
        if (!updatedTicket) {
          updatedTicket = tickets[idx];
        }
      }

      if (!updatedTicket) {
        updatedTicket = {
          id: ticketId,
          status_verifikasi: status,
          catatan: catatan || null,
        };
      }

      // Kirim WA; gagal -> rollback (mode ketat, sama dgn Vercel).
      try {
        await sendFonnteWa({
          to: String(waTo),
          message: ticketStatusMessage({
            nama: nama || updatedTicket?.nama || updatedTicket?.nama_warga || "Pemohon",
            kode: kode_tiket || ticketId,
            jenis: jenis_dokumen || updatedTicket?.jenis_dokumen || "Dokumen",
            status,
            catatan,
          }),
        });
        // Keputusan final: purge foto SEKETIKA (sebelum return sukses).
        try {
          await hapusFotoTiket(kode_tiket || ticketId);
        } catch {}
      } catch (waErr: any) {
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
                  ticket_id: updatedTicket.id,
                  officer_id: officerId,
                  status_sebelumnya: isValidLogStatus(status) ? status : "DITOLAK",
                  status_baru: isValidLogStatus(currentTicket?.status_verifikasi)
                    ? currentTicket.status_verifikasi
                    : "PERLU_PERBAIKAN",
                  catatan_petugas: `[ROLLBACK WA GAGAL] ${String(waErr?.message || waErr).slice(0, 200)}`,
                },
              ]);
            } catch {}
          }
        }
        if (idx !== -1 && prevMem) tickets[idx] = prevMem;
        const reason = waErr instanceof WaError ? waErr.message : String(waErr?.message || waErr).slice(0, 200);
        return res.status(502).json({
          success: false,
          code: "WA_FAILED",
          message: `Status DIBATALKAN karena WA gagal: ${reason} Perbaiki nomor/token Fonnte lalu ulangi.`,
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
  });

  // 3. /api_tickets.php Bridge Endpoint (legacy; ikut dikunci Bearer)
  app.all("/api_tickets.php", async (req, res) => {
    const auth = requireOfficer(req);
    if (!auth.ok) return officerUnauthorized(res, auth.error);
    if (req.method === "GET") {
      return res.json({ success: true, data: tickets });
    }
    if (req.method === "PATCH" || req.method === "POST") {
      const { ticketId, status, no_hp, nama, jenis_dokumen, kode_tiket, catatan } = req.body || {};
      const officerId = auth.officerId;
      if (!ticketId || !status) {
        return res.status(400).json({ success: false, message: "Data tidak lengkap" });
      }

      // Mode ketat (sama dgn api/admin/tickets.ts): WA wajib, gagal -> batalkan.
      if (!isWaEnabled()) {
        return res.status(503).json({
          success: false,
          code: "WA_DISABLED",
          message: "Notifikasi WA belum diaktifkan (WA_ENABLED=false). Status TIDAK diubah.",
        });
      }
      if (!normalizeWa(no_hp)) {
        return res.status(400).json({
          success: false,
          code: "WA_INVALID_NUMBER",
          message: "Nomor WhatsApp warga tidak valid (harap 08xxxxxxxxxx). Status TIDAK diubah.",
        });
      }

      const idx = tickets.findIndex((t: any) => t.id === ticketId || t.kode_tiket === ticketId || t.kode_tiket === kode_tiket);
      const prev = idx !== -1 ? { ...tickets[idx] } : null;
      if (idx !== -1) {
        tickets[idx] = {
          ...tickets[idx],
          status_verifikasi: status,
          catatan: catatan || tickets[idx].catatan,
          officer_id: officerId,
          no_hp: no_hp || tickets[idx].no_hp,
          phone: typeof no_hp === "string" && no_hp.trim() ? no_hp.trim() : (tickets[idx] as any).phone,
          updated_at: new Date().toISOString(),
        };
      }

      try {
        await sendFonnteWa({
          to: String(no_hp),
          message: ticketStatusMessage({
            nama: nama || tickets[idx]?.nama || tickets[idx]?.nama_warga || "Pemohon",
            kode: kode_tiket || ticketId,
            jenis: jenis_dokumen || tickets[idx]?.jenis_dokumen || "Dokumen",
            status,
            catatan,
          }),
        });
      } catch (waErr: any) {
        if (idx !== -1 && prev) tickets[idx] = prev;
        const reason = waErr instanceof WaError ? waErr.message : String(waErr?.message || waErr).slice(0, 200);
        return res.status(502).json({
          success: false,
          code: "WA_FAILED",
          message: `Status DIBATALKAN karena WA gagal: ${reason} Perbaiki nomor/token Fonnte lalu ulangi.`,
        });
      }

      // Keputusan final: purge foto SEKETIKA (sebelum return sukses).
      try {
        await hapusFotoTiket(kode_tiket || ticketId);
      } catch {}

      return res.json({
        success: true,
        waSent: true,
        message: "Status berhasil diperbarui dan notifikasi WhatsApp terkirim!",
        ticket: idx !== -1 ? tickets[idx] : { id: ticketId, status_verifikasi: status, catatan }
      });
    }
    return res.status(405).json({ success: false, message: "Method not allowed" });
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[AIPEX VeriBot] Server running on http://localhost:${PORT}`);
  });
}

startServer();
