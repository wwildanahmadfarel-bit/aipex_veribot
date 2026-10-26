import { setCors } from "./_lib/http.js";
import { isWaEnabled } from "./_lib/wa.js";
import {
  isOfficerJwtConfigured,
  OFFICER_ACCESS_TTL_MS,
  OFFICER_SESSION_TTL_MS,
} from "./_lib/officer-auth.js";
import { isOfficerAuthStoreConfigured } from "./_lib/officer-service.js";
import { getOfficerLoginRateLimitConfig } from "./_lib/officer-rate-limit.js";
import { validateAiKeys } from "../services/ai_providers.js";

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method not allowed" });
  // Cek kesiapan kunci AI TANPA network call & tanpa membakar kuota scan.
  // (Hanya format/placeholder — untuk tes koneksi asli, lakukan 1x scan.)
  // fingerprint = 7 karakter pertama + panjang; ISI KUNCI TIDAK PERNAH dikirim.
  const aiKeys = validateAiKeys();
  const ocrReady = aiKeys.some((k) => k.ready);
  // Status WA Fonnte: boolean + panjang token saja, ISI TOKEN TIDAK PERNAH dikirim.
  const waTokenLen = String(process.env.FONNTE_TOKEN || "").trim().length;
  const waEnabled = isWaEnabled();
  const loginLimit = getOfficerLoginRateLimitConfig();
  const wa = {
    enabled: waEnabled,
    tokenPresent: waTokenLen > 0,
    tokenLen: waTokenLen,
    senderLabel: String(process.env.WA_SENDER_LABEL || "Kelurahan Sukamaju"),
    ready: waEnabled && waTokenLen > 0,
    hint: !waEnabled
      ? "WA_ENABLED=false — PATCH status ditolak 503 WA_DISABLED. Ubah ke true setelah FONNTE_TOKEN diisi."
      : waTokenLen === 0
        ? "FONNTE_TOKEN kosong — isi token device dari dashboard Fonnte."
        : "WA siap — PATCH status akan kirim notifikasi otomatis (gagal = rollback).",
  };
  return res.json({
    status: "ok",
    server: "AIPEX VeriBot Engine (Vercel Serverless)",
    compliance: "UU PDP Compliant (In-Memory Processing)",
    timestamp: new Date().toISOString(),
    ocrReady,
    wa,
    adminAuth: {
      jwtConfigured: isOfficerJwtConfigured(),
      sessionStoreConfigured: isOfficerAuthStoreConfigured(),
      accessTtlHours: Math.round((OFFICER_ACCESS_TTL_MS / 3_600_000) * 100) / 100,
      sessionTtlHours: Math.round((OFFICER_SESSION_TTL_MS / 3_600_000) * 100) / 100,
      loginRateLimit: {
        max: loginLimit.max,
        windowMs: loginLimit.windowMs,
        windowSec: Math.round(loginLimit.windowMs / 1000),
        custom: loginLimit.custom,
        hint: loginLimit.custom
          ? "Rate limit login memakai nilai env OFFICER_LOGIN_MAX/OFFICER_LOGIN_WINDOW_MS. Hanya untuk demo; produksi sebaiknya 10 percobaan/10 menit."
          : "Default produksi: 10 percobaan login/10 menit/IP.",
      },
      hint: isOfficerJwtConfigured()
        ? "Auth admin aktif — login username/password, /api/admin/* wajib Bearer. sessionStoreConfigured hanya menandakan env DB terisi; pastikan migrasi auth sudah dijalankan (docs/AUTH-PETUGAS.md)."
        : "OFFICER_JWT_SECRET kosong/pendek — login 503, /api/admin/* tolak semua.",
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
            "Tidak ada provider AI yang siap — pindaian OCR akan gagal (502). Isi NARA_ROUTE_API_KEY / BYNARA_API_KEY dan/atau GEMINI_API_KEY yang valid lalu restart/redeploy.",
        }
      : {}),
  });
}
