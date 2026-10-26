// Cookie refresh petugas — HttpOnly, tidak pernah dibaca JavaScript.
// Access token tetap dikirim lewat header Authorization; cookie ini HANYA
// untuk memulihkan sesi/rotasi refresh token.

import { OFFICER_SESSION_TTL_MS } from "./officer-auth.js";

export const OFFICER_REFRESH_COOKIE = "aipex_refresh";
export const OFFICER_COOKIE_PATH = "/api/admin";

export function isSecureCookie(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    String(process.env.FORCE_SECURE_COOKIES || "").toLowerCase() === "true"
  );
}

function cookieHeader(value: string, maxAgeSec: number): string {
  const parts = [
    `${OFFICER_REFRESH_COOKIE}=${encodeURIComponent(value)}`,
    `Path=${OFFICER_COOKIE_PATH}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isSecureCookie()) parts.push("Secure");
  return parts.join("; ");
}

export function setOfficerRefreshCookie(res: any, token: string, maxAgeSec: number): void {
  res.setHeader("Set-Cookie", cookieHeader(token, maxAgeSec));
}

export function clearOfficerRefreshCookie(res: any): void {
  res.setHeader(
    "Set-Cookie",
    [
      `${OFFICER_REFRESH_COOKIE}=`,
      `Path=${OFFICER_COOKIE_PATH}`,
      "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      "HttpOnly",
      "SameSite=Lax",
      ...(isSecureCookie() ? ["Secure"] : []),
    ].join("; ")
  );
}

export function readCookie(req: any, name: string): string {
  const raw = String(req?.headers?.cookie || "");
  if (!raw) return "";
  for (const pair of raw.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    if (key !== name) continue;
    const value = pair.slice(idx + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}

export function readOfficerRefreshCookie(req: any): string {
  return readCookie(req, OFFICER_REFRESH_COOKIE);
}

export function refreshCookieMaxAgeSec(expiresAtMs: number): number {
  const remaining = Number(expiresAtMs) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.min(Math.ceil(remaining / 1000), Math.ceil(OFFICER_SESSION_TTL_MS / 1000));
}
