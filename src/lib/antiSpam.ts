// Helper anti-spam frontend — AIPEX VeriBot.
// Kuota cermin server (advisory; server otoritatif), cooldown 30 detik,
// dwell-time. Turnstile NONAKTIF by policy (kode gerbang ada tapi tak pernah aktif).

export const PAGE_STARTED_AT = Date.now();

const QUOTA_KEY = "aipex_scan_quota_v1";
const QUOTA_WINDOW_MS = 10 * 60 * 1000;
// SEMENTARA uji coba 100 (server OCR_MAX_PER_10MIN=100); produksi 20.
export const QUOTA_MAX = 100;

const CD_KEY = "aipex_scan_cd_v1";
const CD_MS = 30_000;

export function getTurnstileSiteKey(): string {
  try {
    return String((import.meta as any)?.env?.VITE_TURNSTILE_SITE_KEY || "").trim();
  } catch {
    return "";
  }
}

export interface QuotaState {
  used: number;
  remaining: number;
  resetSec: number;
}

export function getQuotaState(): QuotaState {
  try {
    const raw = localStorage.getItem(QUOTA_KEY);
    const now = Date.now();
    if (raw) {
      const s = JSON.parse(raw) as { count?: number; windowStart?: number };
      if (s.windowStart && s.windowStart + QUOTA_WINDOW_MS > now) {
        const used = Math.min(QUOTA_MAX, Math.max(0, Number(s.count) || 0));
        return {
          used,
          remaining: Math.max(0, QUOTA_MAX - used),
          resetSec: Math.ceil((s.windowStart + QUOTA_WINDOW_MS - now) / 1000),
        };
      }
    }
  } catch {}
  return { used: 0, remaining: QUOTA_MAX, resetSec: 0 };
}

export function recordScanAttempt(): QuotaState {
  const now = Date.now();
  try {
    const raw = localStorage.getItem(QUOTA_KEY);
    if (raw) {
      const s = JSON.parse(raw) as { count?: number; windowStart?: number };
      if (s.windowStart && s.windowStart + QUOTA_WINDOW_MS > now) {
        const next = { count: (Number(s.count) || 0) + 1, windowStart: s.windowStart };
        localStorage.setItem(QUOTA_KEY, JSON.stringify(next));
        return getQuotaState();
      }
    }
    localStorage.setItem(QUOTA_KEY, JSON.stringify({ count: 1, windowStart: now }));
  } catch {}
  return getQuotaState();
}

export function getCooldownSec(): number {
  try {
    const raw = Number(localStorage.getItem(CD_KEY) || 0);
    const left = Math.ceil((raw - Date.now()) / 1000);
    return left > 0 ? left : 0;
  } catch {
    return 0;
  }
}

export function setCooldown(): void {
  try {
    localStorage.setItem(CD_KEY, String(Date.now() + CD_MS));
  } catch {}
}

export function formatCountdown(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h} jam ${m} mnt`;
  return m > 0 ? `${m} mnt ${r} dtk` : `${r} dtk`;
}

// --- Cloudflare Turnstile invisible -----------------------------------------

declare global {
  interface Window {
    turnstile?: any;
  }
}

let scriptPromise: Promise<boolean> | null = null;

function ensureTurnstileScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.turnstile) return Promise.resolve(true);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.defer = true;
      s.onload = () => resolve(Boolean(window.turnstile));
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/** Minta token invisible. Return null bila site-key kosong / gagal (caller lanjut tanpa token). */
export async function getTurnstileToken(siteKey: string): Promise<string | null> {
  if (!siteKey) return null;
  const ok = await ensureTurnstileScript();
  if (!ok || !window.turnstile) return null;
  try {
    let container = document.getElementById("aipex-turnstile");
    if (!container) {
      container = document.createElement("div");
      container.id = "aipex-turnstile";
      container.setAttribute("aria-hidden", "true");
      // Off-screen (bukan display:none) agar challenge overlay tetap bisa tampil.
      container.style.cssText = "position:fixed;left:-9999px;top:0;width:300px;height:65px;";
      document.body.appendChild(container);
    }
    container.innerHTML = "";
    return await new Promise((resolve) => {
      let done = false;
      let widgetId: any = null;
      const finish = (v: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          if (widgetId !== null) window.turnstile.remove(widgetId);
        } catch {}
        resolve(v);
      };
      const timer = setTimeout(() => finish(null), 20000);
      try {
        widgetId = window.turnstile.render(container, {
          sitekey: siteKey,
          size: "invisible",
          callback: (token: string) => finish(token),
          "error-callback": () => finish(null),
          "timeout-callback": () => finish(null),
        });
        window.turnstile.execute(widgetId);
      } catch {
        finish(null);
      }
    });
  } catch {
    return null;
  }
}

/** Kode respons yang TIDAK memakan kuota server (jangan dicatat di kuota lokal). */
export function isQuotaFreeCode(code: unknown): boolean {
  // Gangguan sistem / limit server JANGAN membakar kuota lokal warga:
  // foto ulang tak guna saat kunci API invalid / AI sibuk / rate-limit server.
  return (
    code === "CAPTCHA_REQUIRED" ||
    code === "BOT_DETECTED" ||
    code === "RATE_LIMITED" ||
    code === "DAY_LIMIT" ||
    code === "WINDOW_LIMIT" ||
    code === "GLOBAL_LIMIT" ||
    code === "AI_CONFIG_ERROR" ||
    code === "AI_TRANSIENT_ERROR" ||
    code === "OCR_SYSTEM_ERROR"
  );
}

/** True bila pesan menandakan blokir kuota (AI belum sempat memeriksa berkas). */
export function isQuotaBlockedMessage(msg: unknown): boolean {
  return /kuota harian|terlalu sering memindai|layanan sedang padat|kuota.*habis|sisa kuota 0/i.test(String(msg || ""));
}

export async function readErrorJson(res: Response): Promise<{ message: string; code?: string; limitCode?: string; subcode?: string; provider?: string; retryable?: boolean; retryAfter?: number; captchaRequired?: boolean }> {
  let message = `Gagal memindai dokumen (HTTP ${res.status})`;
  let code: string | undefined;
  let limitCode: string | undefined;
  let subcode: string | undefined;
  let provider: string | undefined;
  let retryable: boolean | undefined;
  let retryAfter = 0;
  let captchaRequired = false;
  try {
    const j: any = await res.clone().json();
    if (j) {
      message = String(j.message || j.error || message);
      code = typeof j.code === "string" ? j.code : undefined;
      limitCode = typeof j.limitCode === "string" ? j.limitCode : undefined;
      subcode = typeof j.subcode === "string" ? j.subcode : undefined;
      provider = typeof j.provider === "string" ? j.provider : undefined;
      if (typeof j.retryable === "boolean") retryable = j.retryable;
      // Kompatibilitas: backend lama hanya kirim code=RATE_LIMITED tanpa limitCode.
      if (!limitCode && code === "RATE_LIMITED") {
        if (/kuota harian/i.test(message)) limitCode = "DAY_LIMIT";
        else if (/terlalu sering memindai/i.test(message)) limitCode = "WINDOW_LIMIT";
        else if (/sedang padat/i.test(message)) limitCode = "GLOBAL_LIMIT";
      }
      if (Number.isFinite(Number(j.retryAfter))) retryAfter = Number(j.retryAfter);
      captchaRequired = j.captchaRequired === true || code === "CAPTCHA_REQUIRED";
    }
  } catch {}
  return { message, code, limitCode, subcode, provider, retryable, retryAfter, captchaRequired };
}

/** True bila error adalah transient AI yang layak auto-retry 1x (502 AI_TRANSIENT_ERROR). */
export function isTransientAiError(
  input: { code?: string; retryable?: boolean; message?: string } | string,
  httpStatus?: number
): boolean {
  const code = typeof input === "string" ? undefined : input.code;
  const retryable = typeof input === "string" ? undefined : input.retryable;
  const message = typeof input === "string" ? input : (input.message || "");
  if (retryable === true && code === "AI_TRANSIENT_ERROR") return true;
  if (code === "AI_TRANSIENT_ERROR") return true;
  if (httpStatus === 502 && /sedang sibuk|gagal memproses|jawaban tak valid|gangguan sistem|koneksi.*ai|kuota ai/i.test(message)) return true;
  return false;
}

/** Hitung jeda auto-retry (detik) dari subcode/server, clamp 3..30 agar tidak spam. */
export function transientRetrySec(subcode?: string, serverRetryAfter?: number): number {
  if (Number.isFinite(Number(serverRetryAfter)) && Number(serverRetryAfter) > 0) {
    return Math.min(30, Math.max(3, Math.ceil(Number(serverRetryAfter))));
  }
  if (subcode === "RATE_LIMITED") return 15;
  if (subcode === "OVERLOADED") return 8;
  if (subcode === "TIMEOUT" || subcode === "NETWORK") return 5;
  return 8;
}
