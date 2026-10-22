// Cron purge foto evaluasi: /api/cron/purge-eval-fotos (butuh x-cron-secret).
// Hapus objek .enc batch yang retensinya lewat (default 14 hari sejak label tertua),
// lalu null-kan storage_path + iv_hex (label agregat tetap untuk audit hitungan).
// Agregat eval_runs TIDAK dihapus. Pola sama purge-tiket-foto.ts.

import { setCors } from "../_lib/http.js";
import { getSupabase } from "../_lib/store.js";
import { EVAL_BUCKET, evalRetentionDays } from "../_lib/eval-foto.js";

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  const secret = String(process.env.CRON_SECRET || "").trim();
  const got = String(req.headers?.["x-cron-secret"] || "").trim();
  if (!secret || !got || got !== secret) {
    return res.status(401).json({ success: false, message: "Cron tidak diotorisasi." });
  }
  try {
    const supabase = getSupabase();
    if (!supabase) return res.json({ success: true, deleted: 0, retentionDays: evalRetentionDays() });
    const days = evalRetentionDays();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows } = await supabase
      .from("eval_labels")
      .select("batch_id,file_id,storage_path")
      .lt("created_at", cutoff)
      .limit(1000);
    let deleted = 0;
    const byBatch: Record<string, string[]> = {};
    for (const r of (rows as any[]) || []) {
      const p = String((r as any)?.storage_path || "");
      if (!p) continue;
      const b = String((r as any)?.batch_id || "ycwc-001");
      (byBatch[b] ||= []).push(p);
    }
    for (const paths of Object.values(byBatch)) {
      for (let i = 0; i < paths.length; i += 50) {
        try {
          await supabase.storage.from(EVAL_BUCKET).remove(paths.slice(i, i + 50));
          deleted += Math.min(50, paths.length - i);
        } catch {}
      }
    }
    if (deleted > 0) {
      const doomed = ((rows as any[]) || []).map((r) => String((r as any)?.storage_path || "")).filter(Boolean);
      for (let i = 0; i < doomed.length; i += 50) {
        try {
          const chunk = doomed.slice(i, i + 50);
          for (const p of chunk) {
            await supabase.from("eval_labels").update({ storage_path: null, iv_hex: null }).eq("storage_path", p);
          }
        } catch {}
      }
    }
    return res.json({ success: true, deleted, retentionDays: days });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: String(err?.message || err).slice(0, 200) });
  }
}
