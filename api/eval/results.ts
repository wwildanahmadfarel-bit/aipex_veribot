// GET /api/eval/results — Tier-1 PUBLIK (tanpa auth): agregat terbaru batch ycwc-001.
// Sumber: tabel eval_runs (1 baris) + fallback eval/results.json statis.
// TIDAK PERNAH kembalikan: foto, path, hash, NIK, relawan_id, per-file detail.
// Cache publik 1 jam (angka tidak sensitif). Tier-2 ada di /api/eval/detail (JWT).

import { setCors } from "../_lib/http.js";
import { getSupabase } from "../_lib/store.js";
import { EVAL_BATCH_DEFAULT, evalRetentionDays } from "../_lib/eval-foto.js";

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method not allowed" });
  const batchId = String((req.query as any)?.batch_id || EVAL_BATCH_DEFAULT).trim() || EVAL_BATCH_DEFAULT;
  try {
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from("eval_runs")
          .select("batch_id,created_at,n,precision,recall,f1,f1_lainnya,f1_buram,latency_p50,latency_p95,cache_hit_rate,notes")
          .eq("batch_id", batchId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!error && data) {
          res.setHeader("Cache-Control", "public, max-age=3600");
          return res.json({
            success: true,
            tier: 1,
            batch_id: batchId,
            retention_days: evalRetentionDays(),
            privacy: "Agregat saja (UU PDP). Foto asli di bucket privat eval-fotos, tidak dipublikasi.",
            data,
          });
        }
      } catch {}
    }
    // Fallback: belum ada run — kembalikan status kosong (bukan error) agar halaman tetap render.
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json({
      success: true,
      tier: 1,
      batch_id: batchId,
      retention_days: evalRetentionDays(),
      privacy: "Agregat saja (UU PDP). Foto asli di bucket privat eval-fotos, tidak dipublikasi.",
      data: null,
      hint: "Belum ada run evaluasi. Jalankan scripts/evaluate-eval-bucket.py setelah 100 foto terupload.",
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: String(err?.message || err).slice(0, 200) });
  }
}
