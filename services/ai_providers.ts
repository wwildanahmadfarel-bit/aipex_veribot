/**
 * Global AI Provider Registry — AIPEX VeriBot
 *
 * Daftarkan semua provider AI yang dipakai aplikasi di sini agar
 * terpusat (global) dan mudah diganti tanpa ubah logic di server.ts.
 *
 * Provider bawaan:
 *  - "gemini"     -> Google GenAI (SDK @google/genai, env: GEMINI_API_KEY)
 *  - "nara-route" -> Nara Router, OpenAI-compatible
 *                    baseURL: https://router.bynara.id/v1
 *                    env: NARA_ROUTE_API_KEY (diinput sendiri oleh user)
 *
 * Cara pakai:
 *  1. Isi NARA_ROUTE_API_KEY di .env.local (atau kirim header
 *     `x-nara-route-api-key` per-request untuk input manual dari UI).
 *  2. Panggil `chatCompletion({ provider: "nara-route", ... })`
 *     atau `getProvider("nara-route")` dari server.ts / route lain.
 */

export const NARA_ROUTE_BASE_URL = "https://router.bynara.id/v1";

export interface AIProviderConfig {
  /** Nama unik provider, dipakai sebagai key global. */
  name: string;
  /** Base URL OpenAI-compatible (tanpa trailing slash). Contoh: https://router.bynara.id/v1 */
  baseURL: string;
  /** Nama env var tempat API key dibaca. */
  apiKeyEnv: string;
  /** Tipe protokol. Saat ini: "openai-compatible" | "google-genai" */
  type: "openai-compatible" | "google-genai";
  /** Model default untuk provider ini. Bisa dioverride per-request. */
  defaultModel: string;
  /** Daftar model fallback (dicoba berurutan jika model utama 404/429/5xx). */
  fallbackModels?: string[];
}

export const AI_PROVIDERS: Record<string, AIProviderConfig> = {
  "nara-route": {
    name: "nara-route",
    baseURL: NARA_ROUTE_BASE_URL,
    apiKeyEnv: "NARA_ROUTE_API_KEY",
    type: "openai-compatible",
    // Model default — ganti sesuai katalog di router.bynara.id
    // User bisa override lewat env NARA_ROUTE_MODEL atau param `model`.
    defaultModel: process.env.NARA_ROUTE_MODEL || "auto",
    fallbackModels: [],
  },
  gemini: {
    name: "gemini",
    baseURL: "",
    apiKeyEnv: "GEMINI_API_KEY",
    type: "google-genai",
    defaultModel: "gemini-2.5-flash",
    fallbackModels: ["gemini-3.6-flash", "gemini-2.5-flash"],
  },
};

/** Ambil baseURL nara-route (sudah dinormalisasi tanpa trailing slash). */
export function getNaraRouteBaseURL(): string {
  const fromEnv = (process.env.NARA_ROUTE_BASE_URL || "").trim();
  const raw = fromEnv || NARA_ROUTE_BASE_URL;
  return raw.replace(/\/+$/, "");
}

/**
 * Ambil API key nara-route.
 * Prioritas: explicitKey (dari header/body UI) > env NARA_ROUTE_API_KEY.
 * Sengaja TIDAK menyimpan key ke disk — hanya in-memory / env.
 */
export function getNaraRouteApiKey(explicitKey?: unknown): string {
  if (typeof explicitKey === "string" && explicitKey.trim()) return explicitKey.trim();
  return (process.env.NARA_ROUTE_API_KEY || "").trim();
}

export function isNaraRouteConfigured(explicitKey?: unknown): boolean {
  return getNaraRouteApiKey(explicitKey).length > 0;
}

/** Ambil API key Gemini (env: GEMINI_API_KEY). */
export function getGeminiApiKey(): string {
  return (process.env.GEMINI_API_KEY || "").trim();
}

export function isGeminiConfigured(): boolean {
  return getGeminiApiKey().length > 0;
}

// ---------------------------------------------------------------------------
// Validasi kunci AI saat startup + health-check (tanpa network call,
// tanpa membakar kuota, tanpa membocorkan isi kunci ke log/respons).
// ---------------------------------------------------------------------------

/** Fragmen nilai dummy/placeholder yang pernah ter-commit — pasti ditolak provider. */
const PLACEHOLDER_FRAGMENTS = ["xVCFY", "CONTOH", "EXAMPLE", "YOUR_KEY", "ISI_DISINI", "xxx", "***"];

export interface AiKeyStatus {
  provider: "nara-route" | "gemini";
  envVar: string;
  /** Ada nilai (apa pun isinya). */
  present: boolean;
  /** Format awalan sesuai ekspektasi provider. */
  formatOk: boolean;
  /** Cocok dengan nilai dummy yang diketahui mati. */
  isPlaceholder: boolean;
  /** Siap dipakai (ada + format ok + bukan placeholder). */
  ready: boolean;
  /** Sidik aman untuk log: 7 karakter pertama + panjang (BUKAN isi kunci). */
  fingerprint: string;
  /** Saran perbaikan (Indonesia). Kosong bila ready. */
  hint: string;
}

function fingerprintOf(key: string): string {
  if (!key) return "-";
  return `${key.slice(0, 7)}…(len:${key.length})`;
}

function checkKey(provider: AiKeyStatus["provider"], envVar: string, key: string, expectedPrefix: string): AiKeyStatus {
  const present = key.length > 0;
  const upper = key.toUpperCase();
  const isPlaceholder = present && PLACEHOLDER_FRAGMENTS.some((f) => upper.includes(f));
  const formatOk = present && key.startsWith(expectedPrefix);
  const ready = present && formatOk && !isPlaceholder;
  let hint = "";
  if (!present) {
    hint =
      provider === "nara-route"
        ? `${envVar} kosong. Isi dengan API key valid dari dashboard router Nara, atau isi GEMINI_API_KEY sebagai cadangan.`
        : `${envVar} kosong. Buat gratis di Google AI Studio (awalan AIza...).`;
  } else if (isPlaceholder) {
    hint = `${envVar} masih berisi nilai dummy/placeholder yang pasti ditolak provider (401). Ganti dengan key asli lalu restart/redeploy.`;
  } else if (!formatOk) {
    hint =
      provider === "nara-route"
        ? `${envVar} tidak berawalan "${expectedPrefix}". Periksa salah salin (spasi/kutip berlebih) atau key dari akun yang salah.`
        : `${envVar} tidak berawalan "${expectedPrefix}". Key Gemini resmi selalu diawali AIza — periksa salah salin.`;
  }
  return { provider, envVar, present, formatOk, isPlaceholder, ready, fingerprint: fingerprintOf(key), hint };
}

/** Status kedua kunci AI (Nara + Gemini). Aman untuk log & health-check. */
export function validateAiKeys(): AiKeyStatus[] {
  return [
    checkKey("nara-route", "NARA_ROUTE_API_KEY", getNaraRouteApiKey(), "sk-nry-"),
    checkKey("gemini", "GEMINI_API_KEY", getGeminiApiKey(), "AIza"),
  ];
}

/** Cetak laporan status kunci ke log server (peringatan dini sebelum ada yang scan). */
export function logAiKeyStatus(): void {
  try {
    const statuses = validateAiKeys();
    for (const s of statuses) {
      if (s.ready) {
        console.log(`[AI Keys] ${s.provider}: OK (${s.envVar} ${s.fingerprint})`);
      } else {
        console.warn(`[AI Keys] ${s.provider}: BELUM SIAP — ${s.hint} (${s.envVar} ${s.fingerprint})`);
      }
    }
    if (!statuses.some((s) => s.ready)) {
      console.warn("[AI Keys] Tidak ada provider AI yang siap — semua pindaian OCR akan gagal (502). Segera isi minimal satu kunci valid.");
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// OpenAI-compatible Chat Completions client (dipakai untuk nara-route)
// Endpoint: POST {baseURL}/chat/completions
// Header : Authorization: Bearer <apiKey>
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface NaraChatOptions {
  apiKey?: string;
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormatJson?: boolean;
  timeoutMs?: number;
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
}

export async function chatCompletionViaNaraRoute(opts: NaraChatOptions): Promise<string> {
  const apiKey = getNaraRouteApiKey(opts.apiKey);
  if (!apiKey) {
    throw new Error("NARA_ROUTE_API_KEY belum diisi. Isi di .env.local atau kirim header x-nara-route-api-key.");
  }
  const baseURL = getNaraRouteBaseURL();
  const modelsToTry = [opts.model || AI_PROVIDERS["nara-route"].defaultModel].filter(Boolean);

  let lastError: any = null;
  for (const model of modelsToTry) {
    const { signal, cancel } = withTimeout(opts.timeoutMs ?? 60_000);
    try {
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          temperature: opts.temperature ?? 0.2,
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          ...(opts.responseFormatJson ? { response_format: { type: "json_object" } } : {}),
        }),
        signal,
      });
      cancel();

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = new Error(`nara-route [${model}] ${res.status}: ${text.slice(0, 500)}`);
        // Retry hanya untuk error transient / model tidak ada; 401/403 langsung lempar.
        if (res.status === 401 || res.status === 403) throw lastError;
        continue;
      }

      const json: any = await res.json();
      const content: string | undefined =
        json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text;
      if (content && String(content).trim()) return String(content).trim();
      lastError = new Error(`nara-route [${model}]: respons kosong dari router.`);
    } catch (err: any) {
      cancel();
      lastError = err;
      if (err?.message?.includes("401") || err?.message?.includes("403")) throw err;
    }
  }
  throw lastError || new Error("nara-route: semua model gagal dihubungi.");
}

// ---------------------------------------------------------------------------
// Vision / OCR via nara-route (OpenAI-compatible image_url)
// Dipakai sebagai opsi tambahan selain Gemini Vision di server.ts.
// ---------------------------------------------------------------------------

export interface NaraVisionOptions {
  apiKey?: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  imageBase64: string;
  mimeType?: string;
  timeoutMs?: number;
}

export async function visionViaNaraRoute(opts: NaraVisionOptions): Promise<string> {
  const apiKey = getNaraRouteApiKey(opts.apiKey);
  if (!apiKey) {
    throw new Error("NARA_ROUTE_API_KEY belum diisi.");
  }
  const baseURL = getNaraRouteBaseURL();
  const model = opts.model || AI_PROVIDERS["nara-route"].defaultModel;
  const mimeType = opts.mimeType || "image/jpeg";
  const dataUrl = opts.imageBase64.startsWith("data:")
    ? opts.imageBase64
    : `data:${mimeType};base64,${opts.imageBase64}`;

  const { signal, cancel } = withTimeout(opts.timeoutMs ?? 90_000);
  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: opts.systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: opts.userPrompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      signal,
    });
    cancel();

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`nara-route vision ${res.status}: ${text.slice(0, 500)}`);
    }
    const json: any = await res.json();
    const content: string | undefined = json?.choices?.[0]?.message?.content;
    if (!content || !String(content).trim()) {
      throw new Error("nara-route vision: respons kosong dari router.");
    }
    return String(content).trim();
  } catch (err) {
    cancel();
    throw err;
  }
}
