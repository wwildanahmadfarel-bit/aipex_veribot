import { setCors } from "./_lib/http.js";
import { handleOcr } from "./_lib/ocr-handler.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed" });
  return handleOcr(req, res);
}
