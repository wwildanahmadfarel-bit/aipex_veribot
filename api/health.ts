import { setCors } from "./_lib/http";

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method not allowed" });
  return res.json({
    status: "ok",
    server: "AIPEX VeriBot Engine (Vercel Serverless)",
    compliance: "UU PDP Compliant (In-Memory Processing)",
    timestamp: new Date().toISOString(),
  });
}
