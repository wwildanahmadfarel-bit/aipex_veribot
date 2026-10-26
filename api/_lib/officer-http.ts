// Handler HTTP auth petugas yang dipakai bersama oleh Vercel Functions
// (api/admin/*.ts) dan server Express lokal (server.ts), agar perilaku
// development dan production tidak berbeda.

import { readJsonBody, setCors } from "./http.js";
import { checkSimpleRateLimit } from "./rate-limit.js";
import {
  isOfficerJwtConfigured,
  OFFICER_ACCESS_TTL_MS,
  officerUnauthorized,
  requireOfficer,
} from "./officer-auth.js";
import {
  clearOfficerRefreshCookie,
  readOfficerRefreshCookie,
  refreshCookieMaxAgeSec,
  setOfficerRefreshCookie,
} from "./officer-cookie.js";
import {
  changeOfficerPassword,
  isOfficerAuthStoreConfigured,
  logLoginAttempt,
  loginOfficer,
  logoutOfficer,
  OfficerAuthError,
  refreshOfficer,
} from "./officer-service.js";

// ipOnly=true: ganti User-Agent tidak boleh mereset kuota brute-force.
const LOGIN_10MIN = { windowMs: 10 * 60 * 1000, max: 10, prefix: "login10", ipOnly: true };
const REFRESH_10MIN = { windowMs: 10 * 60 * 1000, max: 120, prefix: "officerRefresh10", ipOnly: true };
const CHANGE_PASSWORD_10MIN = { windowMs: 10 * 60 * 1000, max: 10, prefix: "officerPwd10", ipOnly: true };

function noStore(res: any): void {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
  } catch {}
}

function allowedOrigins(): string[] {
  return `${process.env.APP_ORIGIN || ""},${process.env.ADMIN_ORIGIN || ""}`
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function isSameOrigin(req: any, origin: string): boolean {
  try {
    const host = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "")
      .split(",")[0]
      .trim();
    if (!host) return false;
    const proto = String(req?.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
    return (
      origin === `${proto}://${host}` ||
      origin === `http://${host}` ||
      origin === `https://${host}`
    );
  } catch {
    return false;
  }
}

function originAllowed(req: any): boolean {
  const origin = String(req?.headers?.origin || "").trim().replace(/\/+$/, "");
  if (!origin) return true; // curl / non-browser; SameSite tetap melindungi cookie.
  // Origin yang dikonfigurasi ATAU same-origin (termasuk preview deployment
  // yang host-nya berbeda dari APP_ORIGIN produksi).
  return allowedOrigins().includes(origin) || isSameOrigin(req, origin);
}

function rejectCsrf(res: any): boolean {
  noStore(res);
  res.status(403).json({
    success: false,
    code: "ORIGIN_REJECTED",
    message: "Permintaan ditolak karena origin tidak dikenal.",
  });
  return true;
}

function sendAuthError(res: any, err: unknown): void {
  noStore(res);
  if (err instanceof OfficerAuthError) {
    res.status(err.status).json({ success: false, code: err.code, message: err.message });
    return;
  }
  console.error("[officer-auth] unexpected error:", (err as any)?.message || err);
  res.status(500).json({
    success: false,
    code: "AUTH_INTERNAL",
    message: "Terjadi kesalahan pada layanan login.",
  });
}

function authUnavailable(res: any): boolean {
  noStore(res);
  if (!isOfficerJwtConfigured()) {
    res.status(503).json({
      success: false,
      code: "AUTH_NOT_CONFIGURED",
      message: "Login petugas belum dikonfigurasi (OFFICER_JWT_SECRET kosong/pendek).",
    });
    return true;
  }
  if (!isOfficerAuthStoreConfigured()) {
    res.status(503).json({
      success: false,
      code: "AUTH_STORE_UNAVAILABLE",
      message: "Database petugas belum dikonfigurasi di server.",
    });
    return true;
  }
  return false;
}

// POST /api/admin/login
export async function handleOfficerLogin(req: any, res: any): Promise<void> {
  if (setCors(req, res, { credentials: true })) return;
  noStore(res);
  if (req.method !== "POST") {
    res.status(405).json({ success: false, message: "Method not allowed" });
    return;
  }
  // Login juga menulis cookie refresh, jadi tolak origin asing (login CSRF).
  if (!originAllowed(req)) return void rejectCsrf(res);
  if (authUnavailable(res)) return;

  const rl = await checkSimpleRateLimit(req, LOGIN_10MIN);
  if (!rl.allowed) {
    try {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
    } catch {}
    void logLoginAttempt({
      req,
      success: false,
      reason: "RATE_LIMITED",
    });
    res.status(429).json({
      success: false,
      code: "LOGIN_RATE_LIMITED",
      message: "Terlalu banyak percobaan login. Coba lagi beberapa menit.",
      retryAfter: rl.retryAfterSec,
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await loginOfficer({
      username: body.username ?? body.nama_petugas ?? body.nip,
      password: body.password ?? body.sandi ?? body.kata_sandi,
      req,
    });
    setOfficerRefreshCookie(res, result.refreshToken, refreshCookieMaxAgeSec(result.sessionExpiresAt));
    res.status(200).json({
      success: true,
      message: "Login petugas berhasil",
      officer: result.officer,
      token: result.token,
      tokenType: "Bearer",
      accessTtlMs: OFFICER_ACCESS_TTL_MS,
      expiresInMs: result.expiresInMs,
      sessionExpiresInMs: result.sessionExpiresInMs,
      sessionExpiresAt: new Date(result.sessionExpiresAt).toISOString(),
      mustChangePassword: result.mustChangePassword,
    });
  } catch (err) {
    sendAuthError(res, err);
  }
}

// POST /api/admin/refresh — rotasi refresh token, terbitkan access JWT baru.
export async function handleOfficerRefresh(req: any, res: any): Promise<void> {
  if (setCors(req, res, { credentials: true })) return;
  noStore(res);
  if (req.method !== "POST") {
    res.status(405).json({ success: false, message: "Method not allowed" });
    return;
  }
  if (!originAllowed(req)) return void rejectCsrf(res);
  if (authUnavailable(res)) return;

  const rl = await checkSimpleRateLimit(req, REFRESH_10MIN);
  if (!rl.allowed) {
    try {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
    } catch {}
    res.status(429).json({
      success: false,
      code: "REFRESH_RATE_LIMITED",
      message: "Terlalu banyak permintaan sesi. Coba lagi beberapa saat.",
      retryAfter: rl.retryAfterSec,
    });
    return;
  }

  const refreshToken = readOfficerRefreshCookie(req);
  if (!refreshToken) {
    res.status(401).json({
      success: false,
      code: "SESSION_INVALID",
      message: "Sesi petugas tidak ditemukan. Login ulang.",
    });
    return;
  }

  try {
    const result = await refreshOfficer({ refreshToken, req });
    setOfficerRefreshCookie(res, result.refreshToken, refreshCookieMaxAgeSec(result.sessionExpiresAt));
    res.status(200).json({
      success: true,
      officer: result.officer,
      token: result.token,
      tokenType: "Bearer",
      accessTtlMs: OFFICER_ACCESS_TTL_MS,
      expiresInMs: result.expiresInMs,
      sessionExpiresInMs: result.sessionExpiresInMs,
      sessionExpiresAt: new Date(result.sessionExpiresAt).toISOString(),
      mustChangePassword: result.mustChangePassword,
    });
  } catch (err) {
    // Jangan hapus cookie di sini. Dua tab bisa me-refresh hampir bersamaan:
    // tab yang kalah mendapat 401 tepat setelah tab lain memasang cookie baru.
    // Menghapus cookie akan membuang cookie baru itu dan membuat retry gagal.
    // Cookie lama/kedaluwarsa tetap tidak dapat dipakai; login berikutnya akan
    // menggantinya. Logout dan ganti password tetap menghapus cookie.
    sendAuthError(res, err);
  }
}

// POST /api/admin/logout — cabut sesi refresh dan hapus cookie.
export async function handleOfficerLogout(req: any, res: any): Promise<void> {
  if (setCors(req, res, { credentials: true })) return;
  noStore(res);
  if (req.method !== "POST") {
    res.status(405).json({ success: false, message: "Method not allowed" });
    return;
  }
  if (!originAllowed(req)) return void rejectCsrf(res);

  try {
    await logoutOfficer(readOfficerRefreshCookie(req));
  } catch {
    // Logout tetap sukses dari sisi klien.
  }
  clearOfficerRefreshCookie(res);
  res.status(200).json({ success: true, message: "Logout berhasil." });
}

// POST /api/admin/change-password — wajib Bearer access token.
export async function handleOfficerChangePassword(req: any, res: any): Promise<void> {
  if (setCors(req, res, { credentials: true })) return;
  noStore(res);
  if (req.method !== "POST") {
    res.status(405).json({ success: false, message: "Method not allowed" });
    return;
  }
  if (!originAllowed(req)) return void rejectCsrf(res);

  const auth = requireOfficer(req);
  if (!auth.ok) return officerUnauthorized(res, auth.error);

  const rl = await checkSimpleRateLimit(req, CHANGE_PASSWORD_10MIN);
  if (!rl.allowed) {
    try {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
    } catch {}
    res.status(429).json({
      success: false,
      code: "PASSWORD_RATE_LIMITED",
      message: "Terlalu banyak percobaan ganti password. Coba lagi beberapa menit.",
      retryAfter: rl.retryAfterSec,
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    await changeOfficerPassword({
      officerId: auth.officerId,
      oldPassword: body.oldPassword ?? body.password_lama,
      newPassword: body.newPassword ?? body.password_baru,
      req,
    });
    clearOfficerRefreshCookie(res);
    res.status(200).json({
      success: true,
      message: "Password berhasil diubah. Silakan login ulang dengan password baru.",
    });
  } catch (err) {
    sendAuthError(res, err);
  }
}
