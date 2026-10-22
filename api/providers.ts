import { setCors } from "./_lib/http.js";
import {
  AI_PROVIDERS,
  getBynaraBaseURL,
  getNaraRouteBaseURL,
  validateAiKeys,
} from "../services/ai_providers.js";

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method not allowed" });
  // `configured` = kunci siap pakai (bukan sekadar terisi: placeholder/format salah = false).
  const keyStatus = Object.fromEntries(validateAiKeys().map((k) => [k.provider, k]));
  return res.json({
    success: true,
    providers: Object.values(AI_PROVIDERS).map((p) => {
      let baseURL = p.baseURL;
      if (p.name === "nara-route") baseURL = getNaraRouteBaseURL();
      else if (p.name === "bynara" || p.name === "bynara-router") baseURL = getBynaraBaseURL();
      let defaultModel = p.defaultModel;
      if (p.name === "nara-route") defaultModel = process.env.NARA_ROUTE_MODEL || p.defaultModel;
      else if (p.name === "bynara") defaultModel = process.env.BYNARA_MODEL || process.env.NARA_ROUTE_MODEL || p.defaultModel;
      else if (p.name === "bynara-router")
        defaultModel = process.env.BYNARA_ROUTE_MODEL || process.env.BYNARA_MODEL || process.env.NARA_ROUTE_MODEL || p.defaultModel;
      return {
        name: p.name,
        baseURL,
        type: p.type,
        defaultModel,
        configured: keyStatus[p.name]?.ready ?? false,
        formatOk: keyStatus[p.name]?.formatOk ?? false,
        isPlaceholder: keyStatus[p.name]?.isPlaceholder ?? false,
        hint: keyStatus[p.name]?.hint ?? "",
        apiKeyEnv: p.apiKeyEnv,
      };
    }),
  });
}
