// Verifikasi Cloudflare Turnstile (mode adaptif) — AIPEX VeriBot.
// Jika TURNSTILE_SECRET_KEY belum diisi -> skipped (allow) agar tidak memblokir warga.

export function isTurnstileConfigured(): boolean {
  return Boolean((process.env.TURNSTILE_SECRET_KEY || "").trim());
}

export interface TurnstileResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

export async function verifyTurnstile(token: string | null | undefined, remoteIp?: string): Promise<TurnstileResult> {
  const secret = (process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) return { ok: true, skipped: true };
  if (!token || typeof token !== "string" || !token.trim()) {
    return { ok: false, reason: "missing-token" };
  }
  try {
    const body = new URLSearchParams({ secret, response: token.trim() });
    if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return { ok: false, reason: `verify-http-${res.status}` };
    const json: any = await res.json().catch(() => null);
    if (json?.success === true) return { ok: true };
    const codes = Array.isArray(json?.["error-codes"]) ? json["error-codes"].join(",") : "invalid";
    return { ok: false, reason: codes };
  } catch (err: any) {
    return { ok: false, reason: `verify-error:${err?.message || err}` };
  }
}
