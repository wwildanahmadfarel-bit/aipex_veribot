import { readJsonBody, setCors } from "./_lib/http.js";
import { checkSimpleRateLimit, CHAT_10MIN } from "./_lib/rate-limit.js";
import { extractNaraApiKey } from "./_lib/store.js";
import { answerFaq, FAQ_EMERGENCY_REPLY } from "./_lib/faq.js";

// Chat FAQ produksi (Vercel). Seluruh logika jawab — KB offline, cache, Gemini,
// nara-route — ada di api/_lib/faq.ts (satu sumber dengan server.ts dev).
export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed" });
  try {
    const body = await readJsonBody(req);
    try {
      (req as any).body = body;
    } catch {}
    const { message } = body;
    if (!message) return res.status(400).json({ success: false, message: "Pesan tidak boleh kosong." });

    // Anti-spam: batasi chat agar token tidak diboroskan bot (10x/10 mnt/IP).
    const chatRl = await checkSimpleRateLimit(req, CHAT_10MIN);
    if (!chatRl.allowed) {
      return res.status(429).json({
        success: false,
        code: "RATE_LIMITED",
        message: `Terlalu banyak pertanyaan dalam waktu singkat. Coba lagi dalam ${Math.ceil(chatRl.retryAfterSec / 60)} menit.`,
        retryAfter: chatRl.retryAfterSec,
      });
    }

    const { reply, source } = await answerFaq(String(message), {
      apiKey: extractNaraApiKey({ headers: req.headers, body }),
      naraModel: ((body?.naraModel || body?.bynaraModel) as string) || undefined,
    });
    return res.json({ success: true, reply, source });
  } catch (err: any) {
    console.warn(`[FAQ] fallback darurat: ${err?.message || err}`);
    return res.json({
      success: true,
      reply: FAQ_EMERGENCY_REPLY,
      source: "emergency-fallback",
    });
  }
}
