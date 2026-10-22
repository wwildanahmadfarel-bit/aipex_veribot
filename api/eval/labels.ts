// GET /api/eval/labels — daftar label evaluasi TANPA path mentah massal (officer JWT wajib).
// Query: ?batch_id=ycwc-001 — kembalikan ringkasan kurasi (file_id, jenis_true, status_true, lighting, device, relawan_id).
// storage_path + file_hash penuh TIDAK dikembalikan di list (hanya di run server-side) agar tidak bisa di-join massal.
// GET /api/eval/labels?batch_id=ycwc-001&count=1 — hitung jumlah saja untuk dashboard kurasi.

import { setCors } from "../_lib/http.js";
import { getSupabase } from "../_lib/store.js";
import { officerUnauthorized, requireOfficer } from "../_lib/officer-auth.js";
import { EVAL_BATCH_DEFAULT } from "../_lib/eval-foto.js";

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method not allowed" });
  const auth = requireOfficer(req);
  if (!auth.ok) return officerUnauthorized(res, auth.error);
  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ success: false, message: "Database tidak terhubung." });
  try {
    const batchId = String((req.query as any)?.batch_id || EVAL_BATCH_DEFAULT).trim() || EVAL_BATCH_DEFAULT;
    const { data, error } = await supabase
      .from("eval_labels")
      .select("file_id,jenis_true,status_true,lighting,device,relawan_id,consent_ref,created_at")
      .eq("batch_id", batchId)
      .order("file_id", { ascending: true })
      .limit(500);
    if (error) return res.status(500).json({ success: false, message: String(error.message).slice(0, 200) });
    const rows = data || [];
    const byJenis: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const r of rows as any[]) {
      byJenis[String((r as any).jenis_true)] = (byJenis[String((r as any).jenis_true)] || 0) + 1;
      byStatus[String((r as any).status_true)] = (byStatus[String((r as any).status_true)] || 0) + 1;
    }
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.json({ success: true, batch_id: batchId, total: rows.length, byJenis, byStatus, data: rows });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: String(err?.message || err).slice(0, 200) });
  }
}
