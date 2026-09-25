// Rate-limit terpusat untuk Vercel Serverless (stateless) — AIPEX VeriBot.
// Prioritas: Upstash Redis / Vercel KV via REST (env UPSTASH_REDIS_REST_URL + TOKEN).
// Fallback: in-memory Map (dev lokal / saat Redis down — best effort, tidak persisten).
// Tidak menyimpan IP mentah: key memakai sha256(ip + user-agent).

import { createHash } from "node:crypto";

export interface RateLimitPreset {
  windowMs: number;
  max: number;
  prefix: string;
}

export const OCR_10MIN: RateLimitPreset = { windowMs: 10 * 60 * 1000, max: 20, prefix: "ocr10" };
// Mode prototype: 20x/10 mnt/IP dan 20x/hari/IP agar uji coba wajar.
// Masih bisa dioverride via env OCR_MAX_PER_10MIN / OCR_MAX_PER_DAY_IP.
// Key harian memakai tanggal kalender sehingga reset tiap tengah malam.
export const OCR_DAY_IP: RateLimitPreset = { windowMs: 24 * 60 * 60 * 1000, max: 20, prefix: "ocrDay" };
export const OCR_DAY_GLOBAL: RateLimitPreset = { windowMs: 24 * 60 * 60 * 1000, max: 300, prefix: "ocrGlobal" };
export const CHAT_10MIN: RateLimitPreset = { windowMs: 10 * 60 * 1000, max: 10, prefix: "chat10" };
export const TICKET_HOUR: RateLimitPreset = { windowMs: 60 * 60 * 1000, max: 5, prefix: "tktHr" };

export const TURNSTILE_VERIFIED_TTL_MS = 10 * 60 * 1000;

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function ocrLimits() {
  return {
    per10Min: envNum("OCR_MAX_PER_10MIN", OCR_10MIN.max),
    perDayIp: envNum("OCR_MAX_PER_DAY_IP", OCR_DAY_IP.max),
    perDayGlobal: envNum("OCR_MAX_PER_DAY_GLOBAL", OCR_DAY_GLOBAL.max),
  };
}

// --- IP & hashing -----------------------------------------------------------

export function getClientIp(req: any): string {
  const xff = req?.headers?.["x-forwarded-for"] || req?.headers?.["X-Forwarded-For"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  const real = req?.headers?.["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  if (typeof req?.ip === "string" && req.ip) return req.ip;
  const sock = req?.socket?.remoteAddress || req?.connection?.remoteAddress;
  if (typeof sock === "string" && sock) return sock;
  return "unknown";
}

export function hashIp(ip: string, userAgent?: string): string {
  const ua = typeof userAgent === "string" ? userAgent : "";
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 32);
}

function redisConf(): { url: string; token: string } | null {
  const url = (process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return url && token ? { url, token } : null;
}

// --- Storage (Redis REST dengan fallback memori) ----------------------------

interface MemEntry {
  count: number;
  resetAt: number;
  value?: string;
}

const mem = new Map<string, MemEntry>();

function memIncr(key: string, windowMs: number): { count: number; resetMs: number } {
  const now = Date.now();
  const cur = mem.get(key);
  if (!cur || cur.resetAt <= now) {
    const resetAt = now + windowMs;
    mem.set(key, { count: 1, resetAt });
    return { count: 1, resetMs: windowMs };
  }
  cur.count += 1;
  return { count: cur.count, resetMs: Math.max(0, cur.resetAt - now) };
}

async function redisIncr(key: string, windowMs: number): Promise<{ count: number; resetMs: number } | null> {
  const conf = redisConf();
  if (!conf) return null;
  try {
    const headers = { Authorization: `Bearer ${conf.token}`, "Content-Type": "application/json" };
    const incrRes = await fetch(`${conf.url}/incr/${encodeURIComponent(key)}`, { method: "POST", headers });
    if (!incrRes.ok) return null;
    const incrJson: any = await incrRes.json().catch(() => null);
    const count = Number(incrJson?.result ?? NaN);
    if (!Number.isFinite(count)) return null;
    if (count === 1) {
      await fetch(`${conf.url}/pexpire/${encodeURIComponent(key)}/${Math.max(1000, windowMs)}`, {
        method: "POST",
        headers,
      }).catch(() => {});
      return { count, resetMs: windowMs };
    }
    const ttlRes = await fetch(`${conf.url}/pttl/${encodeURIComponent(key)}`, { method: "POST", headers }).catch(
      () => null
    );
    let resetMs = windowMs;
    if (ttlRes && ttlRes.ok) {
      const ttlJson: any = await ttlRes.json().catch(() => null);
      const ttl = Number(ttlJson?.result ?? NaN);
      if (Number.isFinite(ttl) && ttl > 0) resetMs = ttl;
    }
    return { count, resetMs };
  } catch {
    return null;
  }
}

async function incrWindow(key: string, windowMs: number): Promise<{ count: number; resetMs: number; store: "redis" | "memory" }> {
  const viaRedis = await redisIncr(key, windowMs);
  if (viaRedis) return { ...viaRedis, store: "redis" };
  return { ...memIncr(key, windowMs), store: "memory" };
}

export async function redisGet(key: string): Promise<string | null> {
  const conf = redisConf();
  if (conf) {
    try {
      const res = await fetch(`${conf.url}/get/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${conf.token}` },
      });
      if (res.ok) {
        const json: any = await res.json().catch(() => null);
        if (typeof json?.result === "string") return json.result;
      }
    } catch {}
  }
  const cur = mem.get(key);
  if (cur && cur.resetAt > Date.now() && typeof cur.value === "string") return cur.value;
  return null;
}

export async function redisSet(key: string, value: string, ttlMs: number): Promise<void> {
  const conf = redisConf();
  if (conf) {
    try {
      const res = await fetch(
        `${conf.url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/px/${Math.max(1000, ttlMs)}`,
        { method: "POST", headers: { Authorization: `Bearer ${conf.token}` } }
      );
      if (res.ok) return;
    } catch {}
  }
  mem.set(key, { count: 1, resetAt: Date.now() + ttlMs, value });
}

// --- API utama --------------------------------------------------------------

export type RateBlockCode = "OK" | "GLOBAL_LIMIT" | "DAY_LIMIT" | "WINDOW_LIMIT";

export interface OcrRateResult {
  allowed: boolean;
  code: RateBlockCode;
  ipHash: string;
  count10: number;
  remaining10: number;
  retryAfterSec: number;
  store: "redis" | "memory";
}

/** Intip counter mentah tanpa increment (Redis GET+PTTL, fallback memori). */
async function peekRawCount(key: string): Promise<{ count: number; resetMs: number }> {
  const conf = redisConf();
  if (conf) {
    try {
      const headers = { Authorization: `Bearer ${conf.token}` };
      const res = await fetch(`${conf.url}/get/${encodeURIComponent(key)}`, {
        method: "POST",
        headers,
      });
      if (res.ok) {
        const json: any = await res.json().catch(() => null);
        const n = Number(json?.result ?? NaN);
        if (!Number.isFinite(n) || n <= 0) return { count: 0, resetMs: 0 };
        const ttlRes = await fetch(`${conf.url}/pttl/${encodeURIComponent(key)}`, {
          method: "POST",
          headers,
        }).catch(() => null);
        let resetMs = 0;
        if (ttlRes && ttlRes.ok) {
          const ttlJson: any = await ttlRes.json().catch(() => null);
          const ttl = Number(ttlJson?.result ?? NaN);
          if (Number.isFinite(ttl) && ttl > 0) resetMs = ttl;
        }
        return { count: Math.floor(n), resetMs };
      }
    } catch {}
  }
  const cur = mem.get(key);
  if (cur && cur.resetAt > Date.now()) {
    return { count: cur.count, resetMs: Math.max(0, cur.resetAt - Date.now()) };
  }
  return { count: 0, resetMs: 0 };
}

export async function checkOcrRateLimit(req: any): Promise<OcrRateResult> {
  const limits = ocrLimits();
  const ip = getClientIp(req);
  const ua = req?.headers?.["user-agent"];
  const ipHash = hashIp(ip, ua);
  const day = new Date().toISOString().slice(0, 10);

  const k10 = `rl:${OCR_10MIN.prefix}:${ipHash}`;
  const kDay = `rl:${OCR_DAY_IP.prefix}:${ipHash}:${day}`;
  const kGlobal = `rl:${OCR_DAY_GLOBAL.prefix}:${day}`;

  // Intip dulu: percobaan yang DITOLAK tidak boleh ikut membakar kuota.
  // (Sebelumnya increment-then-check membuat spam "Coba Lagi" saat terblokir
  // memperdalam counter.)
  const [p10, pDay, pGlobal] = await Promise.all([
    peekRawCount(k10),
    peekRawCount(kDay),
    peekRawCount(kGlobal),
  ]);
  const store: "redis" | "memory" = redisConf() ? "redis" : "memory";

  if (pGlobal.count >= limits.perDayGlobal) {
    return {
      allowed: false,
      code: "GLOBAL_LIMIT",
      ipHash,
      count10: p10.count,
      remaining10: 0,
      retryAfterSec: Math.max(60, Math.ceil((pGlobal.resetMs || 60000) / 1000)),
      store,
    };
  }
  if (pDay.count >= limits.perDayIp) {
    return {
      allowed: false,
      code: "DAY_LIMIT",
      ipHash,
      count10: p10.count,
      remaining10: 0,
      retryAfterSec: Math.max(60, Math.ceil((pDay.resetMs || 60000) / 1000)),
      store,
    };
  }
  if (p10.count >= limits.per10Min) {
    return {
      allowed: false,
      code: "WINDOW_LIMIT",
      ipHash,
      count10: p10.count,
      remaining10: 0,
      retryAfterSec: Math.max(1, Math.ceil((p10.resetMs || 1000) / 1000)),
      store,
    };
  }

  const [w10, wDay, wGlobal] = await Promise.all([
    incrWindow(k10, OCR_10MIN.windowMs),
    incrWindow(kDay, OCR_DAY_IP.windowMs),
    incrWindow(kGlobal, OCR_DAY_GLOBAL.windowMs),
  ]);
  void wDay;
  void wGlobal;
  return {
    allowed: true,
    code: "OK",
    ipHash,
    count10: w10.count,
    remaining10: Math.max(0, limits.per10Min - w10.count),
    retryAfterSec: 0,
    store: w10.store,
  };
}

export interface SimpleRateResult {
  allowed: boolean;
  retryAfterSec: number;
  count: number;
  remaining: number;
}

export async function checkSimpleRateLimit(req: any, preset: RateLimitPreset, maxOverride?: number): Promise<SimpleRateResult> {
  const max = maxOverride ?? preset.max;
  const ip = getClientIp(req);
  const ua = req?.headers?.["user-agent"];
  const ipHash = hashIp(ip, ua);
  const day = new Date().toISOString().slice(0, 10);
  const r = await incrWindow(`rl:${preset.prefix}:${ipHash}:${day}`, preset.windowMs);
  if (r.count > max) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(r.resetMs / 1000)), count: r.count, remaining: 0 };
  }
  return { allowed: true, retryAfterSec: 0, count: r.count, remaining: Math.max(0, max - r.count) };
}

export function turnstileVerifiedKey(ipHash: string): string {
  return `rl:turnstile-ok:${ipHash}`;
}

export async function isTurnstileVerified(ipHash: string): Promise<boolean> {
  return (await redisGet(turnstileVerifiedKey(ipHash))) === "1";
}

export async function markTurnstileVerified(ipHash: string): Promise<void> {
  await redisSet(turnstileVerifiedKey(ipHash), "1", TURNSTILE_VERIFIED_TTL_MS);
}

export function rateLimitHeaders(remaining: number, retryAfterSec: number): Record<string, string> {
  const h: Record<string, string> = { "X-RateLimit-Remaining": String(Math.max(0, remaining)) };
  if (retryAfterSec > 0) h["Retry-After"] = String(retryAfterSec);
  return h;
}

// --- Peek (baca tanpa increment): untuk captcha adaptif presisi ----------------
// Scan awal gratis; scan terakhir dalam jendela wajib token. Peek memastikan 403
// "captcha-required" TIDAK memakan kuota sehingga retry dengan token
// masih dihitung sebagai percobaan terakhir, bukan berikutnya.

export async function peekWindowCount(prefix: string, ipHash: string, windowMs: number): Promise<number> {
  void windowMs;
  const key = `rl:${prefix}:${ipHash}`;
  const conf = redisConf();
  if (conf) {
    try {
      const res = await fetch(`${conf.url}/get/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${conf.token}` },
      });
      if (res.ok) {
        const json: any = await res.json().catch(() => null);
        const n = Number(json?.result ?? NaN);
        if (Number.isFinite(n) && n > 0) return Math.floor(n);
        return 0;
      }
    } catch {}
  }
  const cur = mem.get(key);
  if (cur && cur.resetAt > Date.now()) return cur.count;
  return 0;
}

export async function peekOcrWindowCount(ipHash: string): Promise<number> {
  return peekWindowCount(OCR_10MIN.prefix, ipHash, OCR_10MIN.windowMs);
}
