// Klasifikasi kegagalan AI Vision agar user mendapat pesan singkat yang jujur
// (BUKAN dump JSON mentah dari provider yang bisa membocorkan detail internal).
// Aturan: error auth/konfigurasi -> user disuruh hubungi petugas (foto ulang tak guna);
// error transien -> user disuruh coba lagi sesaat.

export type AiFailureCode = "AI_CONFIG_ERROR" | "AI_TRANSIENT_ERROR";

export type AiTransientSubcode =
  | "RATE_LIMITED"
  | "OVERLOADED"
  | "TIMEOUT"
  | "NETWORK"
  | "UNKNOWN";

export interface AiFailure {
  code: AiFailureCode;
  /** Pesan singkat, padat, jelas untuk warga. Tanpa detail teknis. */
  message: string;
  provider: AiProviderTag;
  subcode: AiTransientSubcode;
  /** Boleh dicoba ulang otomatis oleh frontend (hanya transient). */
  retryable: boolean;
  /** Saran jeda retry untuk frontend (detik). */
  retryAfterSec: number;
}

export type AiProviderTag = "nara-route" | "gemini" | "unknown";

/**
 * Tebak provider sumber error dari prefiks pesan yang dipakai caller:
 * - "nara-route: ..." (visionViaNaraRoute di ocr-handler/server)
 * - "Gemini <model>: ..." (SDK Google GenAI di ocr-handler/server)
 * Dipakai agar log langsung menunjuk provider bermasalah (401 Nara vs Gemini gagal).
 */
export function detectAiProvider(lastAiError: unknown): AiProviderTag {
  const t = String(lastAiError || "").toLowerCase();
  if (t.startsWith("nara-route:") || t.includes("nara-route vision") || t.includes("router.bynara.id")) {
    return "nara-route";
  }
  if (t.startsWith("gemini ") || t.includes("gemini")) {
    return "gemini";
  }
  return "unknown";
}

const CONFIG_PATTERNS = [
  "api_key_invalid",
  "api key not valid",
  "invalid api key",
  "api_key_not_valid",
  "unauthorized",
  "permission_denied",
  "permission denied",
  "forbidden",
  "account_deleted",
  "billing",
  "billing_not_enabled",
  "access_not_configured",
];

const BUSY_PATTERNS = [
  "429",
  "resource_exhausted",
  "rate_limit",
  "overloaded",
  "overload",
  "try again later",
  "quota",
  "timeout",
  "timed out",
  "aborted",
  "unavailable",
  "internal error",
  "bad gateway",
  "service unavailable",
  "gateway timeout",
  "fetch failed",
  "network",
];

const RATE_LIMIT_PATTERNS = [
  "429",
  "resource_exhausted",
  "rate_limit",
  "rate limited",
  "try again later",
  "quota",
];

const TIMEOUT_PATTERNS = [
  "timeout",
  "timed out",
  "gateway timeout",
  "aborted",
  "deadline",
];

const NETWORK_PATTERNS = [
  "fetch failed",
  "network",
  "econn",
  "socket",
  "dns",
  "getaddrinfo",
];

const OVERLOAD_PATTERNS = [
  "overloaded",
  "overload",
  "unavailable",
  "internal error",
  "bad gateway",
  "service unavailable",
  "503",
  "502",
  "500",
];

function detectSubcode(t: string): AiTransientSubcode {
  if (RATE_LIMIT_PATTERNS.some((p) => t.includes(p))) return "RATE_LIMITED";
  if (TIMEOUT_PATTERNS.some((p) => t.includes(p))) return "TIMEOUT";
  if (NETWORK_PATTERNS.some((p) => t.includes(p))) return "NETWORK";
  if (OVERLOAD_PATTERNS.some((p) => t.includes(p))) return "OVERLOADED";
  if (BUSY_PATTERNS.some((p) => t.includes(p))) return "OVERLOADED";
  return "UNKNOWN";
}

function retryAfterFor(subcode: AiTransientSubcode): number {
  if (subcode === "RATE_LIMITED") return 15;
  if (subcode === "OVERLOADED") return 8;
  if (subcode === "TIMEOUT") return 5;
  if (subcode === "NETWORK") return 5;
  return 8;
}

function providerLabel(provider: AiProviderTag): string {
  if (provider === "gemini") return "via Gemini";
  if (provider === "nara-route") return "via Nara";
  return "";
}

function transientMessage(subcode: AiTransientSubcode, provider: AiProviderTag): string {
  const via = providerLabel(provider);
  const viaSuffix = via ? ` (${via})` : "";
  if (subcode === "RATE_LIMITED") {
    return `Kuota AI habis/sibuk${viaSuffix}. Tunggu sesaat lalu pindai ulang otomatis. (Bukan salah foto Anda.)`;
  }
  if (subcode === "TIMEOUT" || subcode === "NETWORK") {
    return `Koneksi ke Layanan AI terputus${viaSuffix}. Periksa koneksi lalu pindai ulang. (Bukan salah foto Anda.)`;
  }
  if (subcode === "OVERLOADED") {
    return `Layanan AI sedang sibuk${viaSuffix}. Tunggu sesaat lalu pindai ulang. (Bukan salah foto Anda.)`;
  }
  return `Layanan AI gagal memproses foto${viaSuffix} (gangguan sistem). Periksa koneksi lalu coba lagi sesaat, atau lanjut isi manual.`;
}

export function classifyAiFailure(lastAiError: unknown): AiFailure {
  // Detail mentah HANYA ke log server — jangan pernah dikirim ke frontend.
  // Tag provider dicantumkan agar langsung tahu: 401 Nara vs Gemini gagal.
  const raw = String(lastAiError || "");
  const provider = detectAiProvider(raw);
  if (raw) {
    try {
      console.warn(`[OCR AI] gagal [${provider}] (detail server-only): ${raw.slice(0, 400)}`);
    } catch {}
  }
  const t = raw.toLowerCase();
  if (CONFIG_PATTERNS.some((p) => t.includes(p))) {
    return {
      code: "AI_CONFIG_ERROR",
      // Bukan salah foto warga: kunci API server kedaluwarsa/tidak valid.
      // Foto ulang tidak akan membantu — arahkan ke isi manual / loket.
      message:
        "Layanan AI sedang gangguan (kunci akses server tidak valid). Bukan salah foto Anda — Anda tetap bisa lanjut isi formulir manual atau hubungi petugas loket untuk verifikasi manual.",
      provider,
      subcode: "UNKNOWN",
      retryable: false,
      retryAfterSec: 0,
    };
  }
  const subcode = detectSubcode(t);
  if (subcode !== "UNKNOWN" || BUSY_PATTERNS.some((p) => t.includes(p))) {
    return {
      code: "AI_TRANSIENT_ERROR",
      message: transientMessage(subcode, provider),
      provider,
      subcode,
      retryable: true,
      retryAfterSec: retryAfterFor(subcode),
    };
  }
  return {
    code: "AI_TRANSIENT_ERROR",
    message: transientMessage("UNKNOWN", provider),
    provider,
    subcode: "UNKNOWN",
    retryable: true,
    retryAfterSec: retryAfterFor("UNKNOWN"),
  };
}
