import { readJsonBody, setCors } from "../_lib/http";
import { findFallbackOfficer, getSupabase, normalizeAccessCode } from "../_lib/store";
import { checkSimpleRateLimit } from "../_lib/rate-limit";
import { isOfficerJwtConfigured, signOfficerToken } from "../_lib/officer-auth";

// Rate-limit login: maks 10x/10 mnt/IP (anti brute-force kode pendek).
const LOGIN_10MIN = { windowMs: 10 * 60 * 1000, max: 10, prefix: "login10" };

// POST /api/admin/login — login petugas (Supabase officers → fallback server-only)
export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed" });
  // Anti brute-force lebih dulu (429 tanpa membocorkan validitas kode).
  const rl = await checkSimpleRateLimit(req, LOGIN_10MIN);
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
  try {
    const body = await readJsonBody(req);
    const kodeAkses = body.kodeAkses || body.kode_akses || body.pin;
    if (!kodeAkses || typeof kodeAkses !== "string" || !kodeAkses.trim()) {
      return res.status(400).json({ success: false, message: "Kode akses wajib diisi" });
    }
    const trimmedCode = kodeAkses.trim();
    const normalizedCode = normalizeAccessCode(trimmedCode);
    if (!normalizedCode) {
      return res.status(400).json({ success: false, message: "Kode akses wajib diisi" });
    }
    if (/^(TKT|FT)-/i.test(normalizedCode)) {
      return res.status(401).json({
        success: false,
        code: "INVALID_CODE",
        message: "Kode akses tidak valid.",
      });
    }

    let officer: { id: string; nama_petugas: string; role: string; kode_akses?: string } | null = null;
    const supabase = getSupabase();
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
          const insensitive = await supabase
            .from("officers")
            .select("id, nama_petugas, role, kode_akses")
            .ilike("kode_akses", normalizedCode)
            .maybeSingle();
          if (!insensitive.error && insensitive.data) {
            officer = insensitive.data;
          }
        }
      } catch {
        // DB gagal -> lanjut ke fallback server-only di bawah.
      }
    }
    if (!officer) {
      const matched = findFallbackOfficer(normalizedCode);
      if (matched) officer = matched;
    }
    if (!officer) {
      // Pesan generik: jangan bocorkan contoh kode valid / detail DB.
      return res.status(401).json({
        success: false,
        code: "INVALID_CODE",
        message: "Kode akses tidak valid.",
      });
    }
    if (!isOfficerJwtConfigured()) {
      return res.status(503).json({
        success: false,
        code: "AUTH_NOT_CONFIGURED",
        message: "Login petugas belum dikonfigurasi (OFFICER_JWT_SECRET kosong). Hubungi admin server.",
      });
    }
    const officerProfile = { id: officer.id, nama: officer.nama_petugas, role: officer.role };
    const token = signOfficerToken(officerProfile);
    return res.json({
      success: true,
      message: "Login petugas berhasil",
      officer: officerProfile,
      token,
      expiresInMs: 8 * 60 * 60 * 1000,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || "Terjadi kesalahan sistem" });
  }
}
