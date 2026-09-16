import { setCors } from "./_lib/http";
import { AI_PROVIDERS, getNaraRouteBaseURL, isNaraRouteConfigured } from "../services/ai_providers";

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method not allowed" });
  return res.json({
    success: true,
    providers: Object.values(AI_PROVIDERS).map((p) => ({
      name: p.name,
      baseURL: p.name === "nara-route" ? getNaraRouteBaseURL() : p.baseURL,
      type: p.type,
      defaultModel:
        p.name === "nara-route" ? process.env.NARA_ROUTE_MODEL || p.defaultModel : p.defaultModel,
      configured:
        p.name === "nara-route"
          ? isNaraRouteConfigured()
          : Boolean((process.env as any)[p.apiKeyEnv]),
      apiKeyEnv: p.apiKeyEnv,
    })),
  });
}
