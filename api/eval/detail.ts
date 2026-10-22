// GET /api/eval/detail — Tier-2 TERKUNCI (officer JWT wajib).
// Kembalikan tabel per-file run terbaru TANPA foto/path/hash/NIK: file_id, true vs pred, skor, latency, source.
// Foto mentah TIDAK PERNAH via endpoint ini — audit 1 file via dekripsi terkontrol terpisah bila juri meminta.

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
    const { data: run } = await supabase
      .from("eval_runs")
      .select("id,created_at,n,f1")
      .eq("batch_id", batchId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!run) return res.json({ success: true, batch_id: batchId, run: null, data: [] });
    const { data: preds, error } = await supabase
      .from("eval_predictions")
      .select("file_id,jenis_true,status_true,jenis_pred,status_pred,skor,latency_ms,source")
      .eq("batch_id", batchId)
      .eq("run_id", (run as any).id)
      .order("file_id", { ascending: true })
      .limit(500);
    if (error) return res.status(500).json({ success: false, message: String(error.message).slice(0, 200) });
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.json({ success: true, batch_id: batchId, run, total: (preds || []).length, data: preds || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: String(err?.message || err).slice(0, 200) });
  }
}
