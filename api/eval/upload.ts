// POST /api/eval/upload — upload 1 foto evaluasi asli (officer JWT wajib).
// Body JSON: { imageBase64, file_id, batch_id?, jenis_true, status_true, lighting?, device?, relawan_id?, consent_ref? }
// Flow: auth → validasi label → file-guard → sha256 → enkripsi EVAL_MASTER_KEY → bucket privat eval-fotos → insert eval_labels.
// Foto TIDAK PERNAH ke git/public/log. NIK TIDAK disimpan.

import { readJsonBody, setCors } from "../_lib/http.js";
import { getSupabase } from "../_lib/store.js";
import { officerUnauthorized, requireOfficer } from "../_lib/officer-auth.js";
import { sha256Hex, validateUploadBuffer } from "../_lib/file-guard.js";
import { EVAL_BATCH_DEFAULT, evalPathFor, isEvalConfigured, simpanFotoEval } from "../_lib/eval-foto.js";

const JENIS_OK = ["KTP", "KK", "AKTA", "LAINNYA"];
const STATUS_OK = ["BERHASIL", "BURAM", "TIDAK_VALID"];

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
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
      return res.status(400).json({ success: false, message: "jenis_true wajib salah satu: KTP/KK/AKTA/LAINNYA." });
    }
    if (!STATUS_OK.includes(statusTrue)) {
      return res.status(400).json({ success: false, message: "status_true wajib salah satu: BERHASIL/BURAM/TIDAK_VALID." });
    }
    const b64 = String(body.imageBase64 || "");
    if (!b64) return res.status(400).json({ success: false, message: "imageBase64 wajib diisi." });
    const clean = b64.replace(/^data:[a-zA-Z0-9/+\-.]+;base64,/, "");
    let fileBytes: Buffer;
    try {
      fileBytes = Buffer.from(clean, "base64");
    } catch {
      return res.status(400).json({ success: false, message: "imageBase64 tidak valid." });
    }
    let mime = "image/jpeg";
    const m = b64.match(/^data:([a-zA-Z0-9/+\-.]+);base64,/);
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
    // Tolak file_id duplikat dalam batch yang sama (cegah timpa data relawan lain).
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
      // Rollback objek agar tidak yatim.
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
        // Skor NIK/nama TIDAK dikembalikan di sini — hanya saat run evaluasi agregat.
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: String(err?.message || err).slice(0, 200) });
  }
}
