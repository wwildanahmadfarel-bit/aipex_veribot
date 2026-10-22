// DELETE /api/eval/batch — hapus 1 file atau 1 batch evaluasi (officer JWT wajib, untuk tarik consent / purge).
// Query: ?batch_id=ycwc-001 [&file_id=P001]
// - Bila file_id diisi: hapus 1 objek + 1 baris label (<60 detik, untuk tarik consent individu).
// - Bila tanpa file_id: hapus SELURUH batch (purge terjadwal hari ke-14 + drill). Minta konfirmasi via body { confirm: "HAPUS-YCWC-001" }.
// Agregat eval_runs TIDAK dihapus (angka boleh tersisa sesuai keputusan).

import { readJsonBody, setCors } from "../_lib/http.js";
import { getSupabase } from "../_lib/store.js";
import { officerUnauthorized, requireOfficer } from "../_lib/officer-auth.js";
import { EVAL_BATCH_DEFAULT, EVAL_BUCKET } from "../_lib/eval-foto.js";

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "DELETE") return res.status(405).json({ success: false, message: "Method not allowed" });
  const auth = requireOfficer(req);
  if (!auth.ok) return officerUnauthorized(res, auth.error);
  const supabase = getSupabase();
  if (!supabase) return res.status(503).json({ success: false, message: "Database tidak terhubung." });
  try {
    const batchId = String((req.query as any)?.batch_id || EVAL_BATCH_DEFAULT).trim() || EVAL_BATCH_DEFAULT;
    const fileId = String((req.query as any)?.file_id || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (fileId) {
      const { data: row } = await supabase
        .from("eval_labels")
        .select("storage_path")
        .eq("batch_id", batchId)
        .eq("file_id", fileId)
        .maybeSingle();
      const path = String((row as any)?.storage_path || "");
      if (path) {
        try {
          await supabase.storage.from(EVAL_BUCKET).remove([path]);
        } catch {}
      }
      await supabase.from("eval_labels").delete().eq("batch_id", batchId).eq("file_id", fileId);
      try {
        console.log(`[Eval] tarik consent ${batchId}/${fileId} oleh ${auth.nama}`);
      } catch {}
      return res.json({ success: true, deleted: 1, batch_id: batchId, file_id: fileId });
    }
    // Hapus batch penuh — butuh konfirmasi eksplisit.
    const body = await readJsonBody(req).catch(() => ({}));
    const confirm = String((body as any)?.confirm || "");
    if (confirm !== `HAPUS-${batchId.toUpperCase()}`) {
      return res.status(400).json({
        success: false,
        code: "CONFIRM_REQUIRED",
        message: `Hapus batch penuh butuh konfirmasi. Kirim body { "confirm": "HAPUS-${batchId.toUpperCase()}" }.`,
      });
    }
    const { data: rows } = await supabase.from("eval_labels").select("storage_path").eq("batch_id", batchId).limit(1000);
    const paths = ((rows as any[]) || []).map((r) => String((r as any)?.storage_path || "")).filter(Boolean);
    let removed = 0;
    // Hapus objek 50 per batch agar tidak timeout.
    for (let i = 0; i < paths.length; i += 50) {
      try {
        const chunk = paths.slice(i, i + 50);
        if (chunk.length) {
          await supabase.storage.from(EVAL_BUCKET).remove(chunk);
          removed += chunk.length;
        }
      } catch {}
    }
    await supabase.from("eval_labels").delete().eq("batch_id", batchId);
    try {
      console.log(`[Eval] purge batch ${batchId}: ${removed} objek oleh ${auth.nama}`);
    } catch {}
    return res.json({ success: true, deleted: removed, batch_id: batchId, purge: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: String(err?.message || err).slice(0, 200) });
  }
}
