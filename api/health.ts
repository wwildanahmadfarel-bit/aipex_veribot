import { setCors } from "./_lib/http";
import { isWaEnabled } from "./_lib/wa";
import { isOfficerJwtConfigured } from "./_lib/officer-auth";
import { validateAiKeys } from "../services/ai_providers";

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
      hint: isOfficerJwtConfigured()
        ? "Auth admin aktif — /api/admin/* wajib Bearer."
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
            "Tidak ada provider AI yang siap — pindaian OCR akan gagal (502). Isi NARA_ROUTE_API_KEY dan/atau GEMINI_API_KEY yang valid lalu restart/redeploy.",
        }
      : {}),
  });
}
