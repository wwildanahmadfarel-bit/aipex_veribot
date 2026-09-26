import { setCors } from "./_lib/http.js";
import { AI_PROVIDERS, getNaraRouteBaseURL, validateAiKeys } from "../services/ai_providers.js";

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method not allowed" });
  // `configured` = kunci siap pakai (bukan sekadar terisi: placeholder/format salah = false).
  const keyStatus = Object.fromEntries(validateAiKeys().map((k) => [k.provider, k]));
  return res.json({
    success: true,
    providers: Object.values(AI_PROVIDERS).map((p) => ({
      name: p.name,
      baseURL: p.name === "nara-route" ? getNaraRouteBaseURL() : p.baseURL,
      type: p.type,
      defaultModel:
        p.name === "nara-route" ? process.env.NARA_ROUTE_MODEL || p.defaultModel : p.defaultModel,
      configured: keyStatus[p.name]?.ready ?? false,
      formatOk: keyStatus[p.name]?.formatOk ?? false,
      isPlaceholder: keyStatus[p.name]?.isPlaceholder ?? false,
      hint: keyStatus[p.name]?.hint ?? "",
      apiKeyEnv: p.apiKeyEnv,
    })),
  });
}
