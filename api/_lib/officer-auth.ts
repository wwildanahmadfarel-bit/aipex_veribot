// Auth petugas stateless (JWT HS256, tanpa dep baru) — AIPEX VeriBot.
// Access token default 8 jam (dapat diubah via OFFICER_ACCESS_TTL_MS).
// Sesi refresh default 8 jam absolut (OFFICER_SESSION_TTL_MS), sehingga
// refresh tidak memperpanjang sesi tanpa batas.
// Secret HANYA dari env OFFICER_JWT_SECRET — tidak pernah ke frontend/log.

import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_ACCESS_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function envTtlMs(name: string, fallback: number): number {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) return fallback;
  // Batasi maksimum 30 hari agar salah konfigurasi tidak membuat token abadi.
  return Math.min(Math.floor(n), 30 * 24 * 60 * 60 * 1000);
}

export const OFFICER_ACCESS_TTL_MS = envTtlMs("OFFICER_ACCESS_TTL_MS", DEFAULT_ACCESS_TTL_MS);
export const OFFICER_SESSION_TTL_MS = envTtlMs("OFFICER_SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS);
// Kompatibilitas nama lama.
export const OFFICER_JWT_TTL_MS = OFFICER_ACCESS_TTL_MS;

export interface OfficerClaims {
  sub: string;
  nama: string;
  role: string;
  /** ID sesi refresh; boleh kosong untuk token lama. */
  sid?: string;
  /** token_version petugas saat token diterbitkan. */
  ver?: number;
  iat: number;
  exp: number;
}

function jwtSecret(): string {
  return String(process.env.OFFICER_JWT_SECRET || "").trim();
}

export function isOfficerJwtConfigured(): boolean {
  return jwtSecret().length >= 32;
}

function b64urlEncode(input: Buffer | string): string {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const s = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

export interface SignOfficerOptions {
  sessionId?: string;
  tokenVersion?: number;
  /** Batas absolut sesi (epoch ms); token tidak boleh melewati nilai ini. */
  expiresAt?: number;
}

/**
 * Terbitkan token sesi petugas. `exp` selalu dibatasi oleh expiresAt sesi,
 * sehingga refresh di menit terakhir tidak memperpanjang sesi 8 jam.
 */
export function signOfficerToken(
  officer: { id: string; nama: string; role: string },
  options: SignOfficerOptions = {}
): string {
  const secret = jwtSecret();
  if (secret.length < 32) throw new Error("OFFICER_JWT_SECRET belum dikonfigurasi (min 32 karakter).");
  const now = Date.now();
  const absoluteLimit =
    Number.isFinite(options.expiresAt) && Number(options.expiresAt) > 0
      ? Number(options.expiresAt)
      : now + OFFICER_ACCESS_TTL_MS;
  const exp = Math.min(now + OFFICER_ACCESS_TTL_MS, absoluteLimit);
  const payload: OfficerClaims = {
    sub: String(officer.id),
    nama: String(officer.nama),
    role: String(officer.role || "PETUGAS"),
    ...(options.sessionId ? { sid: String(options.sessionId) } : {}),
    ...(Number.isInteger(options.tokenVersion) ? { ver: Number(options.tokenVersion) } : {}),
    iat: now,
    exp,
  };
  const header = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = b64urlEncode(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

/** Verifikasi token. Return klaim bila valid & belum kedaluwarsa, else null. */
export function verifyOfficerToken(token: unknown): OfficerClaims | null {
  try {
    const secret = jwtSecret();
    if (!secret || typeof token !== "string") return null;
    const parts = token.trim().split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = b64urlEncode(createHmac("sha256", secret).update(`${header}.${body}`).digest());
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(b64urlDecode(body).toString("utf8")) as OfficerClaims;
    if (!payload?.sub || !payload?.exp || Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

function bearerFromReq(req: any): string | null {
  const h = req?.headers?.authorization || req?.headers?.Authorization;
  if (typeof h === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(h.trim());
    if (m) return m[1].trim();
  }
  const alt = req?.headers?.["x-officer-token"];
  if (typeof alt === "string" && alt.trim()) return alt.trim();
  return null;
}

export interface OfficerAuth {
  ok: boolean;
  officerId: string;
  nama: string;
  role: string;
  sessionId?: string;
  tokenVersion?: number;
}

/** Guard untuk semua /api/admin/*. Pakai di baris pertama setelah CORS. */
export function requireOfficer(req: any): OfficerAuth & { error?: string } {
  const token = bearerFromReq(req);
  if (!token)
    return {
      ok: false,
      officerId: "",
      nama: "",
      role: "",
      error: "Token sesi petugas wajib (Authorization: Bearer).",
    };
  const claims = verifyOfficerToken(token);
  if (!claims)
    return {
      ok: false,
      officerId: "",
      nama: "",
      role: "",
      error: "Sesi petugas tidak valid/kedaluwarsa. Login ulang.",
    };
  // Token lama (sebelum auth username/password) tidak punya `sid` dan tidak
  // boleh lagi diterima, meskipun tanda tangannya masih valid.
  if (typeof claims.sid !== "string" || !claims.sid)
    return {
      ok: false,
      officerId: "",
      nama: "",
      role: "",
      error: "Sesi petugas lama tidak berlaku. Login ulang dengan username dan password.",
    };
  return {
    ok: true,
    officerId: claims.sub,
    nama: claims.nama,
    role: claims.role,
    sessionId: claims.sid,
    tokenVersion: claims.ver,
  };
}

export function officerUnauthorized(res: any, message?: string) {
  return res.status(401).json({
    success: false,
    code: "OFFICER_UNAUTHORIZED",
    message: message || "Sesi petugas tidak valid/kedaluwarsa. Login ulang.",
  });
}
