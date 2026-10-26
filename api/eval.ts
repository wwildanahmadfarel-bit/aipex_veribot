// Endpoint evaluasi terpadu — AIPEX VeriBot.
// Satu Serverless Function untuk 5 aksi (agar tetap di bawah batas fungsi Vercel):
//   GET    /api/eval?action=results  (publik, agregat)
//   GET    /api/eval?action=detail   (officer JWT)
//   GET    /api/eval?action=labels   (officer JWT)
//   POST   /api/eval?action=upload   (officer JWT)
//   DELETE /api/eval?action=batch    (officer JWT)
// Alias lama (/api/eval/results, dst.) diarahkan lewat rewrite vercel.json.

import { readJsonBody, setCors } from "./_lib/http.js";
import { JENIS_DOKUMEN_VALID, getSupabase } from "./_lib/store.js";
import { officerUnauthorized, requireOfficer } from "./_lib/officer-auth.js";
import { sha256Hex, validateUploadBuffer } from "./_lib/file-guard.js";
import {
  EVAL_BATCH_DEFAULT,
  EVAL_BUCKET,
  evalRetentionDays,
  isEvalConfigured,
  simpanFotoEval,
} from "./_lib/eval-foto.js";

const JENIS_OK: string[] = [...JENIS_DOKUMEN_VALID, "LAINNYA"];
const STATUS_OK = ["BERHASIL", "BURAM", "TIDAK_VALID"];

function resolveAction(req: any): string {
  const fromQuery = String((req.query as any)?.action || "").trim().toLowerCase();
  if (fromQuery) return fromQuery;
  const path = String(req.url || "").split("?")[0];
  return String(path.split("/").filter(Boolean).pop() || "").toLowerCase();
}

async function handleResults(req: any, res: any) {
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method not allowed" });
  const batchId = String((req.query as any)?.batch_id || EVAL_BATCH_DEFAULT).trim() || EVAL_BATCH_DEFAULT;
  const isDemoBatch = /^demo-/i.test(batchId);
  const privacy = isDemoBatch
    ? "Agregat demo sintetis. Gambar bukan foto warga; bukan klaim akurasi batch ycwc-001."
    : "Agregat saja (UU PDP). Foto asli di bucket privat eval-fotos, tidak dipublikasi.";
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
            privacy,
            data,
          });
        }
      } catch {}
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json({
      success: true,
      tier: 1,
      batch_id: batchId,
      retention_days: evalRetentionDays(),
      privacy,
      data: null,
      hint: isDemoBatch
        ? `Belum ada run untuk batch ${batchId}.`
        : "Belum ada run evaluasi. Jalankan scripts/evaluate-eval-bucket.py setelah 100 foto terupload.",
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: String(err?.message || err).slice(0, 200) });
  }
}

async function handleDetail(req: any, res: any) {
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

async function handleLabels(req: any, res: any) {
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

async function handleUpload(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed" });
  const auth = requireOfficer(req);
  if (!auth.ok) return officerUnauthorized(res, auth.error);
  if (!isEvalConfigured()) {
    return res.status(503).json({
      success: false,
      code: "EVAL_NOT_CONFIGURED",
      message: "EVAL_MASTER_KEY belum dikonfigurasi (hex 64 char). Isi di env server, tiket warga tetap jalan.",
    });
  }
  try {
    const body = await readJsonBody(req);
    const batchId = String(body.batch_id || EVAL_BATCH_DEFAULT).trim() || EVAL_BATCH_DEFAULT;
    const fileId = String(body.file_id || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    const jenisTrue = String(body.jenis_true || "").toUpperCase().trim();
    const statusTrue = String(body.status_true || "").toUpperCase().trim();
    if (!fileId || fileId.length < 3 || fileId.length > 32) {
      return res.status(400).json({ success: false, message: "file_id wajib 3-32 char alfanumerik (mis. P001)." });
    }
    if (!JENIS_OK.includes(jenisTrue)) {
      return res.status(400).json({ success: false, message: `jenis_true wajib salah satu: ${JENIS_OK.join("/")}.` });
    }
    if (!STATUS_OK.includes(statusTrue)) {
      return res.status(400).json({ success: false, message: "status_true wajib salah satu: BERHASIL/BURAM/TIDAK_VALID." });
    }
    const b64 = String(body.imageBase64 || "");
    if (!b64) return res.status(400).json({ success: false, message: "imageBase64 wajib diisi." });
    const clean = b64.replace(/^data:[a-zA-Z0-9/+.-]+;base64,/, "");
    let fileBytes: Buffer;
    try {
      fileBytes = Buffer.from(clean, "base64");
    } catch {
      return res.status(400).json({ success: false, message: "imageBase64 tidak valid." });
    }
    let mime = "image/jpeg";
    const m = b64.match(/^data:([a-zA-Z0-9/+.-]+);base64,/);
    if (m) mime = m[1];
    const guard = validateUploadBuffer(fileBytes, mime);
    if (!guard.ok) {
      try { fileBytes.fill(0); } catch {}
      return res.status(400).json({ success: false, code: "INVALID_FILE", message: guard.message });
    }
    const fileHash = sha256Hex(fileBytes);
    const supabase = getSupabase();
    if (!supabase) {
      try { fileBytes.fill(0); } catch {}
      return res.status(503).json({ success: false, message: "Database tidak terhubung." });
    }
    try {
      const { data: existing } = await supabase
        .from("eval_labels")
        .select("file_id")
        .eq("batch_id", batchId)
        .eq("file_id", fileId)
        .maybeSingle();
      if (existing) {
        try { fileBytes.fill(0); } catch {}
        return res.status(409).json({ success: false, message: `file_id ${fileId} sudah ada di batch ${batchId}. Ganti file_id.` });
      }
    } catch {}
    const saved = await simpanFotoEval(batchId, fileId, fileBytes, mime);
    const sizeBytes = fileBytes.length;
    try { fileBytes.fill(0); } catch {}
    if (!saved.ok) {
      return res.status(500).json({ success: false, message: saved.reason || "Gagal menyimpan foto evaluasi." });
    }
    const row: any = {
      file_id: fileId,
      batch_id: batchId,
      storage_path: saved.path,
      file_hash: fileHash,
      jenis_true: jenisTrue,
      status_true: statusTrue,
      lighting: String(body.lighting || "").slice(0, 32) || null,
      device: String(body.device || "").slice(0, 32) || null,
      relawan_id: String(body.relawan_id || "").slice(0, 16) || null,
      consent_ref: String(body.consent_ref || "").slice(0, 32) || null,
      iv_hex: saved.ivHex,
    };
    const { error } = await supabase.from("eval_labels").insert([row]);
    if (error) {
      try {
        if (saved.path) await supabase.storage.from("eval-fotos").remove([saved.path]);
      } catch {}
      return res.status(500).json({ success: false, message: `Gagal mencatat label: ${String(error.message).slice(0, 200)}` });
    }
    return res.json({
      success: true,
      data: {
        file_id: fileId,
        batch_id: batchId,
        storage_path: saved.path,
        file_hash: fileHash.slice(0, 16) + "...",
        size_bytes: sizeBytes,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: String(err?.message || err).slice(0, 200) });
  }
}

async function handleBatch(req: any, res: any) {
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

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  const action = resolveAction(req);
  switch (action) {
    case "results":
      return handleResults(req, res);
    case "detail":
      return handleDetail(req, res);
    case "labels":
      return handleLabels(req, res);
    case "upload":
      return handleUpload(req, res);
    case "batch":
      return handleBatch(req, res);
    default:
      return res.status(404).json({ success: false, message: "Aksi evaluasi tidak dikenal." });
  }
}
