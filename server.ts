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
import { isUsableAiParsed } from "./api/_lib/ai-response-guard";
import { logOcrAttempt } from "./api/_lib/abuse-log";
import { classifyAiFailure } from "./api/_lib/ai-errors";
import { WaError, isWaEnabled, normalizeWa, sendFonnteWa, ticketStatusMessage } from "./api/_lib/wa";
import {
  isOfficerJwtConfigured,
  OFFICER_ACCESS_TTL_MS,
  OFFICER_SESSION_TTL_MS,
  officerUnauthorized,
  requireOfficer,
} from "./api/_lib/officer-auth";
import {
  handleOfficerChangePassword,
  handleOfficerLogin,
  handleOfficerLogout,
  handleOfficerRefresh,
} from "./api/_lib/officer-http";
import { getOfficerLoginRateLimitConfig } from "./api/_lib/officer-rate-limit";
import {
  BUKAN_KTP_MESSAGE,
  JENIS_DOKUMEN_VALID,
  JENIS_NIK_OPSIONAL,
  normalizeJenisDokumen,
} from "./api/_lib/store";
import { answerFaq, FAQ_EMERGENCY_REPLY } from "./api/_lib/faq";
import {
  AI_PROVIDERS,
  getBynaraApiKey,
  getBynaraBaseURL,
  getNaraRouteApiKey,
  getNaraRouteBaseURL,
  getOpenRouterApiKey,
  getOpenRouterBaseURL,
  isBynaraConfigured,
  isNaraRouteConfigured,
  isOpenRouterConfigured,
  logAiKeyStatus,
  validateAiKeys,
  visionViaNaraRoute,
  visionViaOpenRouter,
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

// --- Scanner KTP: normalisasi & pesan standar --------------------------------
// Pesan baku saat file bukan dokumen kependudukan — satu sumber di api/_lib/store
// (di-re-export agar impor lama dari server tetap bekerja).
export { BUKAN_KTP_MESSAGE };

// Normalisasi jenis dokumen: satu sumber di api/_lib/store
// (normalizeJenisDokumen — 7 jenis didukung + LAINNYA).

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

/** Batas maksimum area buram yang ditampilkan (samakan dengan api/_lib/ocr-handler.ts). */
const MAX_BLUR_AREAS = 4;

type BlurArea = {
  area: string;
  severity: "high" | "medium" | "low";
  bbox: [number, number, number, number];
  description: string;
};

/** Validasi & normalisasi `blur_areas` dari AI agar overlay tak pernah merusak pindaian. */
function sanitizeBlurAreas(raw: unknown): BlurArea[] {
  if (!Array.isArray(raw)) return [];
  const rank: Record<BlurArea["severity"], number> = { high: 0, medium: 1, low: 2 };
  const out: BlurArea[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const it = item as any;
    const bboxRaw = Array.isArray(it.bbox) ? it.bbox : null;
    if (!bboxRaw || bboxRaw.length !== 4) continue;

    const nums = bboxRaw.map((v: unknown) => Number(v));
    if (nums.some((n: number) => !Number.isFinite(n))) continue;

    const clamp = (n: number) => Math.max(0, Math.min(100, n));
    let [x, y, w, h] = nums.map(clamp);
    if (x >= 100 || y >= 100) continue;
    w = Math.min(w, 100 - x);
    h = Math.min(h, 100 - y);
    if (w < 2 || h < 2) continue;

    const area = String(it.area ?? "lainnya").trim().toLowerCase().slice(0, 40) || "lainnya";
    const sevRaw = String(it.severity ?? "").trim().toLowerCase();
    const severity: BlurArea["severity"] =
      sevRaw === "high" || sevRaw === "medium" || sevRaw === "low" ? (sevRaw as BlurArea["severity"]) : "medium";

    out.push({
      area,
      severity,
      bbox: [
        Math.round(x * 10) / 10,
        Math.round(y * 10) / 10,
        Math.round(w * 10) / 10,
        Math.round(h * 10) / 10,
      ],
      description: String(it.description ?? "").trim().slice(0, 120),
    });
  }

  out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return out.slice(0, MAX_BLUR_AREAS);
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

// --- Global provider: nara-route / bynara -------------------------------------------
// API key diinput sendiri oleh user via salah satu cara berikut (prioritas):
//  1. Header:  x-nara-route-api-key / x-bynara-api-key / x-bynara-route-api-key
//  2. Body:    { naraApiKey, bynaraApiKey, apiKey, key } (khusus chat/ocr)
//  3. Env:     NARA_ROUTE_API_KEY / BYNARA_API_KEY / BYNARA_ROUTE_API_KEY di .env.local / .env
function extractNaraApiKey(req: any): string {
  const fromHeader =
    req?.headers?.["x-nara-route-api-key"] ||
    req?.headers?.["x-nara-api-key"] ||
    req?.headers?.["x-bynara-api-key"] ||
    req?.headers?.["x-bynara-route-api-key"];
  const fromBody =
    req?.body?.naraApiKey ||
    req?.body?.nara_route_api_key ||
    req?.body?.bynaraApiKey ||
    req?.body?.bynara_api_key ||
    req?.body?.bynaraRouteApiKey ||
    req?.body?.apiKey ||
    req?.body?.key;
  const picked =
    (typeof fromHeader === "string" && fromHeader.trim()) ||
    (typeof fromBody === "string" && fromBody.trim()) ||
    "";
  return getNaraRouteApiKey(picked) || getBynaraApiKey(picked) || picked;
}

function extractBynaraApiKey(req: any): string {
  const fromHeader =
    req?.headers?.["x-bynara-api-key"] ||
    req?.headers?.["x-bynara-route-api-key"] ||
    req?.headers?.["x-nara-route-api-key"] ||
    req?.headers?.["x-nara-api-key"];
  const fromBody =
    req?.body?.bynaraApiKey ||
    req?.body?.bynara_api_key ||
    req?.body?.bynaraRouteApiKey ||
    req?.body?.naraApiKey ||
    req?.body?.nara_route_api_key ||
    req?.body?.apiKey ||
    req?.body?.key;
  const picked =
    (typeof fromHeader === "string" && fromHeader.trim()) ||
    (typeof fromBody === "string" && fromBody.trim()) ||
    "";
  return getBynaraApiKey(picked) || picked;
}

// --- Global provider: OpenRouter (9router) -------------------------------------------
// API key diinput sendiri oleh user via:
//  1. Header:  x-openrouter-api-key / x-9router-api-key
//  2. Body:    { openrouterApiKey, nineRouterApiKey, apiKey, key }
//  3. Env:     OPENROUTER_API_KEY / 9ROUTER_API_KEY di .env.local / .env
function extractOpenRouterApiKey(req: any): string {
  const fromHeader =
    req?.headers?.["x-openrouter-api-key"] ||
    req?.headers?.["x-9router-api-key"] ||
    req?.headers?.["x-open-router-api-key"];
  const fromBody =
    req?.body?.openrouterApiKey ||
    req?.body?.openrouter_api_key ||
    req?.body?.nineRouterApiKey ||
    req?.body?.nine_router_api_key ||
    req?.body?.apiKey ||
    req?.body?.key;
  const picked =
    (typeof fromHeader === "string" && fromHeader.trim()) ||
    (typeof fromBody === "string" && fromBody.trim()) ||
    "";
  return getOpenRouterApiKey(picked) || picked;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));

  // CORS for local API access (termasuk header kunci Nara/OpenRouter manual via frontend)
  app.use((req, res, next) => {
    // Auth petugas memakai cookie credentials; biarkan handler auth yang
    // menetapkan Allow-Origin secara eksplisit (wildcard + credentials invalid).
    const authPaths = [
      "/api/admin/login",
      "/api/admin/refresh",
      "/api/admin/logout",
      "/api/admin/change-password",
      "/api/officer/login",
    ];
    if (authPaths.includes(req.path)) {
      return next();
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-nara-route-api-key, x-nara-api-key, x-bynara-api-key, x-bynara-route-api-key, x-openrouter-api-key, x-9router-api-key, x-open-router-api-key"
    );
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
    const loginLimit = getOfficerLoginRateLimitConfig();
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
      adminAuth: {
        jwtConfigured: isOfficerJwtConfigured(),
        sessionStoreConfigured: Boolean(supabase),
        accessTtlHours: Math.round((OFFICER_ACCESS_TTL_MS / 3_600_000) * 100) / 100,
        sessionTtlHours: Math.round((OFFICER_SESSION_TTL_MS / 3_600_000) * 100) / 100,
        loginRateLimit: {
          max: loginLimit.max,
          windowMs: loginLimit.windowMs,
          windowSec: Math.round(loginLimit.windowMs / 1000),
          custom: loginLimit.custom,
        },
      },
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
              "Tidak ada provider AI yang siap — pindaian OCR akan gagal (502). Isi NARA_ROUTE_API_KEY / BYNARA_API_KEY dan/atau GEMINI_API_KEY yang valid lalu restart server.",
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
      providers: Object.values(AI_PROVIDERS).map((p) => {
        let baseURL = p.baseURL;
        if (p.name === "nara-route") baseURL = getNaraRouteBaseURL();
        else if (p.name === "bynara" || p.name === "bynara-router") baseURL = getBynaraBaseURL();
        else if (p.name === "openrouter") baseURL = getOpenRouterBaseURL();
        let defaultModel = p.defaultModel;
        if (p.name === "nara-route") defaultModel = process.env.NARA_ROUTE_MODEL || p.defaultModel;
        else if (p.name === "bynara")
          defaultModel = process.env.BYNARA_MODEL || process.env.NARA_ROUTE_MODEL || p.defaultModel;
        else if (p.name === "bynara-router")
          defaultModel =
            process.env.BYNARA_ROUTE_MODEL || process.env.BYNARA_MODEL || process.env.NARA_ROUTE_MODEL || p.defaultModel;
        else if (p.name === "openrouter")
          defaultModel = process.env.OPENROUTER_MODEL || process.env.NINE_ROUTER_MODEL || p.defaultModel;
        return {
          name: p.name,
          baseURL,
          type: p.type,
          defaultModel,
          configured: keyStatus[p.name]?.ready ?? false,
          formatOk: keyStatus[p.name]?.formatOk ?? false,
          isPlaceholder: keyStatus[p.name]?.isPlaceholder ?? false,
          hint: keyStatus[p.name]?.hint ?? "",
          apiKeyEnv: p.apiKeyEnv,
        };
      }),
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

      // Kunci provider router.bynara.id: "nara-route" dulu, fallback ke alias "bynara".
      const naraApiKey = extractNaraApiKey(req) || extractBynaraApiKey(req);
      const naraConfigured = isNaraRouteConfigured(naraApiKey) || isBynaraConfigured(naraApiKey);
      const client = getGeminiClient();

      const systemInstructionText = `Anda adalah sistem AI Vision OCR profesional yang dikhususkan untuk menganalisis dan memverifikasi dokumen kependudukan resmi Indonesia (e-KTP, Kartu Keluarga/KK, KIA, akta kelahiran/kematian/perkawinan, dan Surat Pindah/SKPWNI).

Tugas utama Anda:
1. Identifikasi Jenis Dokumen (wajib tepat):
   - "KTP": e-KTP Republik Indonesia. Ciri wajib: ada tulisan "NIK" 16 digit, header provinsi/kabupaten, foto wajah, tulisan "KARTU TANDA PENDUDUK" / "e-KTP". Varian tulisan "e-KTP", "KTP-EL", "KTP EL" semuanya tetap "KTP".
   - "KK": Kartu Keluarga.
   - "AKTA": Akta Kelahiran (kutipan akta kelahiran).
   - "AKTA_KEMATIAN": Akta Kematian / kutipan akta kematian Dukcapil, atau surat keterangan kematian resmi (RS/dokter/kelurahan).
   - "AKTA_PERKAWINAN": Akta Perkawinan / kutipan akta perkawinan (termasuk perkawinan non-Muslim yang dilegalisasi).
   - "SURAT_PINDAH": Surat Keterangan Pindah WNI (SKPWNI) atau formulir permohonan pindah penduduk.
   - "KIA": Kartu Identitas Anak.
   - "LAINNYA": WAJIB dipakai HANYA jika gambar bukan salah satu dari ketujuh dokumen di atas (misal: SIM, paspor, foto selfie, screenshot HP, dokumen asing, kertas kosong, foto blur total tanpa ciri Dukcapil).

2. Ekstraksi Data Utama:
   - NIK: Cari 16-digit Nomor Induk Kependudukan (pada akta kematian: NIK almarhum; pada akta perkawinan: NIK yang paling jelas). Bersihkan dari spasi atau simbol. Jika tidak ditemukan, kabur, atau tidak bernilai 16 digit, set ke null — dokumen non-kartu tetap valid walau NIK null.
   - Nama: Ambil nama lengkap utama sesuai teks resmi (pemilik dokumen / almarhum / pasangan / anak). Jika bukan dokumen Dukcapil, set ke null.

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
   - "BERHASIL": Dokumen kependudukan yang didukung (KTP/KK/AKTA/AKTA_KEMATIAN/AKTA_PERKAWINAN/SURAT_PINDAH/KIA) dan skor kejelasan >= 70.
   - "BURAM": Dokumen kependudukan yang didukung, namun skor kejelasan < 70 (memerlukan foto ulang).
   - "TIDAK_VALID": WAJIB dipakai jika jenis_dokumen "LAINNYA" (gambar bukan dokumen kependudukan resmi Indonesia).

6. Deteksi Area Kurang Jelas (wajib bila skor_kejelasan < 80 dan dokumen kependudukan yang didukung, bukan LAINNYA):
   - Identifikasi bagian dokumen yang buram, silau, gelap, terpotong, atau tidak terbaca.
   - Gunakan istilah baku dokumen untuk "area": "nik", "nama", "foto_wajah", "tanggal_lahir", "tempat_lahir", "jenis_kelamin", "alamat", "rt_rw", "kelurahan", "kecamatan", "agama", "pekerjaan", "kewarganegaraan", "status_perkawinan", "golongan_darah", "berlaku_hingga", "tanda_tangan", "kepala_keluarga", "anggota_keluarga", "nomor_akta", "tanggal_peristiwa", "pasangan", atau "lainnya".
   - "severity": "high" (teks kunci tidak terbaca), "medium" (terbaca sebagian), "low" (terbaca namun kurang tajam).
   - "bbox": [x, y, width, height] dalam PERSEN 0-100 relatif terhadap gambar, (x, y) = pojok kiri atas area. Perkiraan posisi yang wajar sudah cukup.
   - "description": penyebab singkat, contoh "motion blur", "silau flash", "kurang cahaya", "bayangan", "terpotong", "out of focus".
   - Contoh: [{"area":"nik","severity":"high","bbox":[8,42,46,9],"description":"silau flash"}].
   - Jika seluruh foto tajam (skor >= 80) atau dokumen LAINNYA, kembalikan array kosong [].

7. Catatan Perbaikan (Saran Singkat):
   - Jika status BURAM, berikan 1 kalimat saran konkret (contoh: "Foto KTP terlalu silau di area NIK, harap matikan lampu flash dan ambil ulang foto di tempat terang").
   - Jika status TIDAK_VALID, WAJIB awali catatan dengan kalimat persis: "File bukan Kartu Kependudukan Indonesia." lalu lanjutkan saran mengunggah foto dokumen kependudukan yang didukung (e-KTP, KK, KIA, akta kelahiran/kematian/perkawinan, atau Surat Pindah/SKPWNI).

PENTING: Jawab HANYA dengan JSON valid memakai key: nik, nama, jenis_dokumen, skor_kejelasan, status_verifikasi, catatan, blur_areas.`;

      const userPrompt = "Analisis foto dokumen kependudukan ini. Periksa kejelasan teks, ekstrak NIK 16 digit jika ada, dan tentukan apakah foto layak untuk verifikasi.";

      // Urutan fallback: model terbaru dulu; yang deprecated/penuh dilewati otomatis.
      const ocrModels = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
      let responseText = "";
      let lastAiError = "";
      const isPdf = /pdf/i.test(mimeType || "");

      // Prioritas 1: Gemini (utama — mendukung gambar + PDF).
      // Cache hit: lewati semua panggilan AI (hemat token).
      if (!skipAi && !responseText && client) {
        const aiDeadline = Date.now() + 50_000;
        for (const modelName of ocrModels) {
        if (Date.now() >= aiDeadline) {
          lastAiError = "Batas waktu OCR AI habis sebelum semua model dicoba";
          break;
        }
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
              maxOutputTokens: 8192,
              // Batasi tiap model agar kegagalan jaringan tidak menggantung lama.
              httpOptions: { timeout: 18000 },
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
                    description: "KTP, KK, AKTA, AKTA_KEMATIAN, AKTA_PERKAWINAN, SURAT_PINDAH, KIA, atau LAINNYA",
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
                  blur_areas: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        area: { type: "STRING" },
                        severity: { type: "STRING" },
                        description: { type: "STRING" },
                        bbox: {
                          type: "ARRAY",
                          items: { type: "NUMBER" },
                        },
                      },
                      required: ["area", "severity", "bbox"],
                    },
                  },
                },
                required: ["jenis_dokumen", "skor_kejelasan", "status_verifikasi", "blur_areas"],
              },
            },
          });

          const candidateText = response?.text;
          if (candidateText) {
            try {
              const candidate = parseAiJsonResponse(candidateText);
              if (isUsableAiParsed(candidate)) {
                responseText = candidateText;
                aiSource = "gemini";
                break;
              }
              lastAiError = `Gemini ${modelName}: jawaban tidak lengkap / terindikasi halusinasi`;
            } catch {
              lastAiError = `Gemini ${modelName}: JSON tidak valid`;
            }
          }
        } catch (modelErr: any) {
          lastAiError = `Gemini ${modelName}: ${modelErr?.message || modelErr}`;
          console.warn(`[OCR AI] Model ${modelName} gagal: ${lastAiError}`);
        }
        }
      }

      // Prioritas 2 (cadangan): nara-route / bynara (https://router.bynara.id/v1)
      // Catatan: endpoint image_url nara-route hanya mendukung gambar — PDF dilewati.
      if (!skipAi && !responseText && naraConfigured && !isPdf) {
        try {
          const naraText = await visionViaNaraRoute({
            apiKey: naraApiKey,
            model:
              ((req.body?.naraModel || req.body?.bynaraModel) as string) ||
              process.env.NARA_ROUTE_MODEL ||
              process.env.BYNARA_MODEL ||
              undefined,
            systemPrompt: systemInstructionText,
            userPrompt,
            imageBase64: fileBytes.toString("base64"),
            mimeType,
          });
          if (naraText) {
            try {
              const candidate = parseAiJsonResponse(naraText);
              if (isUsableAiParsed(candidate)) {
                responseText = naraText;
                aiSource = "nara-route";
                console.log("[OCR AI] via nara-route (https://router.bynara.id/v1, cadangan)");
              } else {
                lastAiError = "nara-route: jawaban tidak lengkap / terindikasi halusinasi";
              }
            } catch {
              lastAiError = "nara-route: JSON tidak valid";
            }
          }
        } catch (naraErr: any) {
          lastAiError = `nara-route: ${naraErr?.message || naraErr}`;
          console.warn(`[OCR AI] nara-route (cadangan) gagal: ${lastAiError}`);
        }
      } else if (isPdf && naraConfigured) {
        console.log("[OCR AI] PDF terdeteksi — lewati nara-route (image-only), hanya Gemini.");
      }

      // Prioritas 3 (cadangan kedua): OpenRouter / 9router (https://openrouter.ai/api/v1)
      // Mendukung vision untuk gambar (bukan PDF).
      const openRouterApiKey = extractOpenRouterApiKey(req);
      const openRouterConfigured = isOpenRouterConfigured(openRouterApiKey);
      if (!skipAi && !responseText && openRouterConfigured && !isPdf) {
        try {
          const openRouterText = await visionViaOpenRouter({
            apiKey: openRouterApiKey,
            model:
              (req.body?.openrouterModel as string) ||
              (req.body?.nineRouterModel as string) ||
              process.env.OPENROUTER_MODEL ||
              process.env.NINE_ROUTER_MODEL ||
              undefined,
            systemPrompt: systemInstructionText,
            userPrompt,
            imageBase64: fileBytes.toString("base64"),
            mimeType,
          });
          if (openRouterText) {
            try {
              const candidate = parseAiJsonResponse(openRouterText);
              if (isUsableAiParsed(candidate)) {
                responseText = openRouterText;
                aiSource = "openrouter";
                console.log("[OCR AI] via openrouter (https://openrouter.ai/api/v1, cadangan ke-2)");
              } else {
                lastAiError = "openrouter: jawaban tidak lengkap / terindikasi halusinasi";
              }
            } catch {
              lastAiError = "openrouter: JSON tidak valid";
            }
          }
        } catch (orErr: any) {
          lastAiError = `openrouter: ${orErr?.message || orErr}`;
          console.warn(`[OCR AI] openrouter (cadangan ke-2) gagal: ${lastAiError}`);
        }
      } else if (isPdf && openRouterConfigured) {
        console.log("[OCR AI] PDF terdeteksi — lewati openrouter (image-only), hanya Gemini.");
      }

      if (!skipAi && !responseText && !client && !naraConfigured && !openRouterConfigured) {
        return res.status(503).json({
          success: false,
          isSystemError: true,
          message: "Layanan AI OCR belum dikonfigurasi (GEMINI_API_KEY / NARA_ROUTE_API_KEY / BYNARA_API_KEY / OPENROUTER_API_KEY kosong). Bukan salah foto Anda — lanjut isi formulir manual atau hubungi petugas untuk verifikasi manual.",
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

      // Overlay area buram: selalu array valid agar frontend tak perlu guard berlapis.
      parsed.blur_areas = sanitizeBlurAreas(parsed.blur_areas);

      // Validasi tambahan: Cek kelengkapan digit NIK (parsial disimpan agar user tahu)
      if (parsed.nik) {
        // Hanya terima NIK yang benar-benar 16 digit setelah membuang label/pemisah.
        // Jangan sekadar membuang SEMUA non-digit: teks sampah dari model bisa
        // menyisakan 16 digit palsu (mis. "3201...Drafting note...").
        const nikRaw = String(parsed.nik).trim().replace(/^NIK\b[:\s]*/i, "");
        const nikClean = nikRaw.replace(/[\s.\-:/]/g, "");
        const nikDigits = nikClean.replace(/\D/g, "");
        if (!/^\d{16}$/.test(nikClean)) {
          // Simpan bacaan parsial untuk umpan balik (mis. "12/16 digit terbaca"), bukan sekadar null
          if (nikDigits.length >= 8) {
            parsed.nik_partial = nikDigits;
          }
          parsed.nik = null;
          // Untuk dokumen non-kartu (akta kematian/perkawinan & surat pindah),
          // NIK memang sering tidak tercantum → cukup kosongkan, jangan
          // menurunkan vonis BERHASIL menjadi BURAM.
          if (
            parsed.status_verifikasi === "BERHASIL" &&
            !(JENIS_NIK_OPSIONAL as readonly string[]).includes(String(parsed.jenis_dokumen))
          ) {
            parsed.status_verifikasi = "BURAM";
            parsed.catatan =
              nikDigits.length === 16
                ? "Format NIK tidak valid (ada karakter tambahan). Foto ulang e-KTP dengan fokus tajam tanpa silau."
                : `NIK terbaca sebagian (${nikDigits.length || 0}/16 digit). Foto ulang e-KTP dengan fokus tajam tanpa silau.`;
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
        // Bukan dokumen kependudukan → overlay area tidak relevan.
        parsed.blur_areas = [];
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
        (JENIS_DOKUMEN_VALID as readonly string[]).includes(String(parsed.jenis_dokumen));
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

      // Dokumen valid (BERHASIL maupun BURAM) → KEMBALIKAN HASIL VERIFIKASI SAJA.
      // Tiket dibuat di /api/tickets oleh wizard agar 1 submission = 1 tiket.
      const isValidDoc = isBerhasil || isBuramValid;
      if (!isValidDoc) {
        return res.json({
          success: false,
          message: parsed.catatan || "Dokumen buram, silakan foto ulang.",
          data: parsed,
          ...parsed,
        });
      }
      
      const finalStatus = isBerhasil ? "BERHASIL" : "BURAM";
      const finalCataten =
        parsed.catatan ||
        (isBerhasil
          ? "Dokumen kependudukan valid dan terbaca jelas. Hasil uji tersimpan — lanjutkan untuk menerbitkan tiket QR."
          : "Dokumen kependudukan asli terdeteksi namun buram. Anda tetap dapat melanjutkan — tiket terbit dengan catatan revisi; bawa fisik dokumen asli untuk verifikasi ulang di loket.");
      parsed.catatan = finalCataten;
      parsed.status_verifikasi = finalStatus;
      parsed.status_kualitas = isBerhasil ? "LAYAK" : "TIDAK_LAYAK";

      // Log OCR attempt
      await logOcrAttempt({ ipHash, fileHash, mime: mimeType, sizeBytes: fileBytes.length, skor: parsed.skor_kejelasan ?? null, status: finalStatus, source: aiSource || "ai", latencyMs: Date.now() - ocrStart });
      try {
        res.setHeader("X-Ocr-Source", aiSource || "ai");
        res.setHeader("X-RateLimit-Remaining", String(rl.remaining10));
      } catch {}
      return res.json({
        success: true,
        message: finalCataten,
        needsRephoto: !isBerhasil,
        data: parsed,
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

  // Evaluasi ycwc-001 (bucket privat eval-fotos): wire Vercel handler ke Express dev.
  // Satu handler terpadu (?action=...), baik untuk /api/eval/results maupun /api/eval?action=results.
  const evalDevHandler = async (req: any, res: any) => {
    try {
      const { default: h } = await import("./api/eval");
      return (h as any)(req, res);
    } catch (e: any) {
      return res.status(500).json({ success: false, message: String(e?.message || e).slice(0, 200) });
    }
  };
  app.all("/api/eval", evalDevHandler);
  app.all("/api/eval/:action", evalDevHandler);

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

  // Timeline publik: hanya status, waktu, dan catatan; tanpa officer_id.
  // Mirror api/tickets/[id].ts agar perilaku dev = produksi.
  const cleanPublicNote = (raw: unknown): string =>
    String(raw ?? "")
      .split(PHOTO_PURGE_AUDIT_NOTE)
      .join("")
      .replace(/\s+/g, " ")
      .trim();

  const buildPublicTimeline = (ticket: any, logs: any[] = []) => {
    const timeline: Array<{ status: string; catatan?: string; created_at: string }> = [
      {
        status: "DITERIMA",
        created_at: String(ticket?.created_at || ""),
      },
    ];
    const seen = new Set<string>();
    for (const log of logs) {
      const note = cleanPublicNote(log?.catatan ?? log?.catatan_petugas);
      // Log rollback adalah audit internal, bukan status final untuk warga.
      if (/^\[ROLLBACK/i.test(note)) continue;
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
  };

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
              // nik_raw removed for privacy (UU PDP)
              nama_warga: data.nama || "Warga",
              nama: data.nama || "Warga",
              // phone and alamat removed from public response for privacy
              jenis_dokumen: data.jenis_dokumen || "KTP",
              // BERHASIL = lolos uji kejelasan AI, MASIH menunggu verifikasi petugas.
              // Jangan tampilkan "disetujui/siap cetak" ke publik sebelum petugas memutuskan.
              status_verifikasi: data.status_verifikasi === "BERHASIL" ? "MENUNGGU" : (data.status_verifikasi === "BURAM" ? "REVISI" : (data.status_verifikasi === "PENDING" ? "MENUNGGU" : (data.status_verifikasi || "PENDING"))),
              skor_ai: data.skor_kejelasan || 90,
              skor_kejelasan: data.skor_kejelasan || 90,
              status_ai: data.status_verifikasi === "BERHASIL" || (data.skor_kejelasan >= 70) ? "LULUS" : "GAGAL",
              catatan_ai: data.catatan || "",
              catatan: data.catatan || "",
              catatan_petugas: data.catatan_petugas || "",
              created_at: data.created_at ? new Date(data.created_at).toISOString().replace("T", " ").slice(0, 16) : new Date().toISOString().replace("T", " ").slice(0, 16),
              updated_at: data.created_at ? new Date(data.created_at).toISOString().replace("T", " ").slice(0, 16) : new Date().toISOString().replace("T", " ").slice(0, 16),
            };

            // Log best-effort: jangan gagalkan lacak tiket bila tabel bermasalah.
            try {
              const { data: logs } = await supabase
                .from("verification_logs")
                .select("*")
                .eq("ticket_id", data.id)
                .order("created_at", { ascending: true });
              found.riwayat = buildPublicTimeline(found, Array.isArray(logs) ? logs : []);
            } catch {
              found.riwayat = buildPublicTimeline(found);
            }
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
          // Map to public format (apply same privacy/status mapping)
          const rawNik = memTicket.nik_raw || "";
          const masked = rawNik.length >= 12
            ? `${rawNik.slice(0, 6)}******${rawNik.slice(-4)}`
            : (rawNik ? `${rawNik.slice(0, 3)}***${rawNik.slice(-2)}` : "320101******0000");
          const statusVerif = memTicket.status_verifikasi === "BERHASIL" ? "MENUNGGU" :
            memTicket.status_verifikasi === "BURAM" ? "REVISI" :
            memTicket.status_verifikasi === "PENDING" ? "MENUNGGU" :
            memTicket.status_verifikasi || "PENDING";

          found = {
            id: String(memTicket.id || memTicket.ticket_code),
            ticket_code: memTicket.ticket_code,
            kode_tiket: memTicket.ticket_code,
            nik_encrypted: masked,
            // nik_raw removed for privacy
            nama_warga: memTicket.nama_warga,
            nama: memTicket.nama_warga,
            // phone and alamat removed for privacy
            jenis_dokumen: memTicket.jenis_dokumen,
            status_verifikasi: statusVerif,
            skor_ai: memTicket.skor_ai,
            skor_kejelasan: memTicket.skor_ai,
            status_ai: memTicket.status_ai,
            catatan_ai: memTicket.catatan_ai,
            catatan: memTicket.catatan_ai,
            catatan_petugas: memTicket.catatan_petugas || "",
            created_at: memTicket.created_at,
            updated_at: memTicket.updated_at,
          };
          found.riwayat = buildPublicTimeline(found);
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

  // 3. Daftar semua tiket DITUTUP untuk publik (paritas api/tickets.ts).
  // Pelacakan publik hanya per kode: GET /api/tickets/:kode_tiket.
  app.get("/api/tickets", async (_req, res) => {
    return res.status(400).json({
      success: false,
      code: "TICKET_CODE_REQUIRED",
      message:
        "Daftar tiket publik tidak tersedia. Gunakan GET /api/tickets/:kode_tiket untuk melacak satu tiket.",
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

      if (!nama_warga) {
        return res.status(400).json({ success: false, message: "Nama warga wajib diisi." });
      }

      // Validasi bukti scan terlebih dahulu (menentukan aturan NIK per jenis dokumen).
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
            "Wajib verifikasi dokumen via scanner terlebih dahulu. Unggah foto dokumen kependudukan asli hingga terdeteksi sebagai dokumen yang didukung.",
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

      // Generate Ticket Code: TKT-YYYYMM-XXXX
      const date = new Date();
      const yearMonth = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
      const randomCode = Math.floor(1000 + Math.random() * 9000);
      const ticketCode = `TKT-${yearMonth}-${randomCode}`;

      // Masked NIK for UU PDP privacy compliance
      const maskedNik = !nikDigits
        ? "Tanpa NIK (opsional)"
        : nikDigits.length >= 12
          ? `${nikDigits.slice(0, 6)}******${nikDigits.slice(-4)}`
          : `${nikDigits.slice(0, 3)}***${nikDigits.slice(-2)}`;

      // Status awal mengikuti hasil scan: BERHASIL → PENDING (siap verifikasi petugas),
      // BURAM valid → REVISI (wajib bawa fisik + foto ulang di loket).
      const awalStatusVerifikasi = "PENDING"; // Semua tiket baru mulai dari PENDING
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
      if (phone && nikDigits) {
        try {
          for (const t of tickets) {
            if ((t as any).nik_raw === nikDigits && !(t as any).phone) (t as any).phone = String(phone);
          }
        } catch {}
      }

      // Simpan ke Supabase jika tersedia. phoneSaved dihitung dari HASIL insert
      // yang sebenarnya (supabase-js TIDAK throw saat error — cek .error), agar
      // UI tidak pernah menampilkan "Nomor WA tersimpan" secara palsu.
      let phoneSaved = false;
      if (supabase) {
        try {
          const dbPayload: any = {
            kode_tiket: ticketCode,
            nik: nikDigits,
            nama: nama_warga,
            jenis_dokumen: jenis_dokumen || "KTP",
            skor_kejelasan: Number(skor_ai) || 88,
            status_verifikasi: "PENDING", // Semua tiket baru mulai dari PENDING di DB
            catatan: awalCatatan,
          };
          if (phone) dbPayload.phone = String(phone);
          if (alamat) dbPayload.alamat = String(alamat);
          let ins = await supabase.from("tickets").insert([dbPayload]);
          // Fallback kolom belum dimigrasi (phone/alamat): buang kolom itu lalu
          // ulangi — tiket TIDAK boleh gagal terbit hanya karena kolom belum ada.
          for (let attempt = 0; attempt < 2 && ins.error; attempt++) {
            const errMsg = String(ins.error.message || "");
            const kolomHilang = /phone/i.test(errMsg) ? "phone" : /alamat/i.test(errMsg) ? "alamat" : null;
            if (!kolomHilang || !dbPayload[kolomHilang]) break;
            try {
              console.warn(`[tickets POST] kolom ${kolomHilang} belum ada — tiket ${ticketCode} disimpan tanpa kolom itu. Jalankan migrasi supabase/migrations.`);
            } catch {}
            delete dbPayload[kolomHilang];
            ins = await supabase.from("tickets").insert([dbPayload]);
          }
          if (ins.error) {
            console.warn("Supabase insert warning for new ticket:", ins.error);
          } else if (phone && dbPayload.phone && nikDigits) {
            phoneSaved = true;
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
        phoneSaved,
        message: phoneSaved
          ? "Tiket QR antrean berhasil diterbitkan. Nomor WA tersimpan."
          : phone
            ? "Tiket QR antrean berhasil diterbitkan. Nomor WA belum tersimpan di server — petugas akan verifikasi manual."
            : "Tiket QR antrean berhasil diterbitkan.",
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 5. Update Ticket Status (fallback lama; WAJIB Bearer petugas — jalur admin
  // utama: /api/admin/tickets yang mencatat audit + mengirim notifikasi WA).
  app.patch("/api/tickets/:id", async (req, res) => {
    const auth = requireOfficer(req);
    if (!auth.ok) return officerUnauthorized(res, auth.error);
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

  // 6. FAQ Chatbot - logika bersama api/_lib/faq.ts (dev & produksi)
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

      // Logika jawab satu sumber dengan produksi (api/_lib/faq.ts):
      // KB offline instan → cache Redis 24 jam → Gemini → nara-route → KB generik.
      const { reply, source } = await answerFaq(String(message), {
        apiKey: extractNaraApiKey(req) || extractBynaraApiKey(req),
        naraModel: ((req.body?.naraModel || req.body?.bynaraModel) as string) || undefined,
      });
      return res.json({ success: true, reply, source });
    } catch (err: any) {
      console.warn("Chat fallback activation:", err?.message || err);
      return res.json({
        success: true,
        reply: FAQ_EMERGENCY_REPLY,
        source: "emergency-fallback",
      });
    }
  });

  // Admin & Officer Authentication — satu implementasi dengan Vercel Functions.
  // Login memakai username + password; tidak ada fallback kode akses hardcoded.
  // app.all agar preflight OPTIONS ditangani oleh setCors di handler auth.
  app.all("/api/admin/login", handleOfficerLogin);
  app.all("/api/officer/login", handleOfficerLogin);
  app.all("/api/admin/refresh", handleOfficerRefresh);
  app.all("/api/admin/logout", handleOfficerLogout);
  app.all("/api/admin/change-password", handleOfficerChangePassword);

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
                  catatan: auditNote,
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
                  catatan: `[ROLLBACK WA GAGAL] ${String(waErr?.message || waErr).slice(0, 200)}`,
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
