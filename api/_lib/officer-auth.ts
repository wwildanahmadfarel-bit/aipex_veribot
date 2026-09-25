// Auth petugas stateless (JWT HS256, tanpa dep baru) — AIPEX VeriBot.
// Login terbitkan token 8 jam; semua /api/admin/* wajib Bearer.
// Secret HANYA dari env OFFICER_JWT_SECRET — tidak pernah ke frontend/log.

import { createHmac, timingSafeEqual } from "node:crypto";

export const OFFICER_JWT_TTL_MS = 8 * 60 * 60 * 1000;

export interface OfficerClaims {
  sub: string;
  nama: string;
  role: string;
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

/** Terbitkan token sesi petugas. Throw bila secret belum dikonfigurasi. */
export function signOfficerToken(officer: { id: string; nama: string; role: string }): string {
  const secret = jwtSecret();
  if (secret.length < 32) throw new Error("OFFICER_JWT_SECRET belum dikonfigurasi (min 32 karakter).");
  const now = Date.now();
  const payload: OfficerClaims = {
    sub: String(officer.id),
    nama: String(officer.nama),
    role: String(officer.role || "Petugas Loket"),
    iat: now,
    exp: now + OFFICER_JWT_TTL_MS,
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
}

/** Guard untuk semua /api/admin/*. Pakai di baris pertama setelah CORS. */
export function requireOfficer(req: any): OfficerAuth & { error?: string } {
  const token = bearerFromReq(req);
  if (!token) return { ok: false, officerId: "", nama: "", role: "", error: "Token sesi petugas wajib (Authorization: Bearer)." };
  const claims = verifyOfficerToken(token);
  if (!claims)
    return { ok: false, officerId: "", nama: "", role: "", error: "Sesi petugas tidak valid/kedaluwarsa. Login ulang." };
  return { ok: true, officerId: claims.sub, nama: claims.nama, role: claims.role };
}

export function officerUnauthorized(res: any, message?: string) {
  return res.status(401).json({
    success: false,
    code: "OFFICER_UNAUTHORIZED",
    message: message || "Sesi petugas tidak valid/kedaluwarsa. Login ulang.",
  });
}
