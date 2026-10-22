// Enkripsi foto evaluasi batch ycwc-001 — AIPEX VeriBot.
// Pola sama tiket-foto.ts (AES-256-GCM + IV acak + HMAC per-file), tapi:
// - kunci TERPISAH: EVAL_MASTER_KEY (bukan FOTO_MASTER_KEY)
// - bucket TERPISAH: eval-fotos (bukan tiket-fotos)
// - path: eval/{batch_id}/{file_id}.jpg.enc
// Foto TIDAK PERNAH ke git/public/log — hanya .enc di bucket privat.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { getSupabase } from "./store.js";

export const EVAL_BUCKET = "eval-fotos";
export const EVAL_BATCH_DEFAULT = process.env.EVAL_BATCH_ID || "ycwc-001";

export function evalRetentionDays(): number {
  const n = Number(process.env.EVAL_RETENTION_DAYS || 14);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 14;
}

function evalMasterKey(): Buffer | null {
  const hex = String(process.env.EVAL_MASTER_KEY || "").trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, "hex");
}

/** Kunci per-file evaluasi: HMAC(master, batch:file) — bocor 1 file tidak membuka lainnya. */
function evalFileKey(batchId: string, fileId: string): Buffer | null {
  const master = evalMasterKey();
  if (!master) return null;
  return createHmac("sha256", master).update(`eval:${batchId}:${fileId}`).digest();
}

export function evalPathFor(batchId: string, fileId: string, mime: string): string {
  const ext = /png/i.test(mime || "") ? "png" : /webp/i.test(mime || "") ? "webp" : /pdf/i.test(mime || "") ? "pdf" : "jpg";
  const safeBatch = String(batchId || EVAL_BATCH_DEFAULT).replace(/[^A-Za-z0-9-]/g, "").slice(0, 32) || "ycwc-001";
  const safeFile = String(fileId || "unknown").replace(/[^A-Za-z0-9-]/g, "").slice(0, 32) || "unknown";
  return `eval/${safeBatch}/${safeFile}.${ext}.enc`;
}

export function isEvalConfigured(): boolean {
  return evalMasterKey() !== null;
}

export interface SimpanEvalResult {
  ok: boolean;
  path: string | null;
  ivHex: string | null;
  reason?: string;
}

/** Enkripsi + upload 1 foto evaluasi. Best-effort: gagal -> {ok:false}. */
export async function simpanFotoEval(
  batchId: string,
  fileId: string,
  plain: Buffer,
  mime: string
): Promise<SimpanEvalResult> {
  try {
    const key = evalFileKey(batchId, fileId);
    const supabase = getSupabase();
    if (!key) return { ok: false, path: null, ivHex: null, reason: "EVAL_MASTER_KEY belum dikonfigurasi (hex 64 char)." };
    if (!supabase) return { ok: false, path: null, ivHex: null, reason: "Database tidak terhubung." };
    if (!plain || plain.length === 0) return { ok: false, path: null, ivHex: null, reason: "Buffer kosong." };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([enc, tag]);
    const path = evalPathFor(batchId, fileId, mime);
    const { error } = await supabase.storage.from(EVAL_BUCKET).upload(path, payload, {
      contentType: "application/octet-stream",
      upsert: false,
    });
    if (error) {
      const msg = String((error as any)?.message || error).slice(0, 200);
      // File sudah ada → beri tahu agar file_id diganti (cegah timpa data relawan lain).
      if (/exists|duplicate|already/i.test(msg)) {
        return { ok: false, path: null, ivHex: null, reason: `file_id sudah ada di batch ini. Ganti file_id lalu ulangi.` };
      }
      return { ok: false, path: null, ivHex: null, reason: msg };
    }
    return { ok: true, path, ivHex: iv.toString("hex") };
  } catch (err: any) {
    return { ok: false, path: null, ivHex: null, reason: String(err?.message || err).slice(0, 200) };
  }
}

export interface LihatEvalResult {
  ok: boolean;
  bytes: Buffer | null;
  mime: string;
  reason?: string;
}

/** Unduh + dekripsi 1 foto evaluasi (officer only via API). Gagal -> {ok:false}. */
export async function lihatFotoEval(
  batchId: string,
  storagePath: string,
  ivHex: string
): Promise<LihatEvalResult> {
  try {
    const m = /eval\/([^/]+)\/([^/.]+)\./.exec(String(storagePath || ""));
    const fileId = m?.[2] || "";
    const batch = m?.[1] || batchId;
    const key = evalFileKey(batch, fileId);
    const supabase = getSupabase();
    if (!key || !supabase) return { ok: false, bytes: null, mime: "image/jpeg", reason: "Layanan eval belum siap." };
    if (!ivHex || !/^[0-9a-fA-F]{24}$/.test(ivHex)) return { ok: false, bytes: null, mime: "image/jpeg", reason: "IV tidak valid." };
    const { data: blob, error: dlErr } = await supabase.storage.from(EVAL_BUCKET).download(storagePath);
    if (dlErr || !blob) return { ok: false, bytes: null, mime: "image/jpeg", reason: "File evaluasi tidak tersedia." };
    const payload = Buffer.from(await blob.arrayBuffer());
    if (payload.length < 17) return { ok: false, bytes: null, mime: "image/jpeg", reason: "File rusak." };
    const enc = payload.subarray(0, payload.length - 16);
    const tag = payload.subarray(payload.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
    const mime = /\.png\.enc$/i.test(storagePath) ? "image/png" : /\.webp\.enc$/i.test(storagePath) ? "image/webp" : /\.pdf\.enc$/i.test(storagePath) ? "application/pdf" : "image/jpeg";
    return { ok: true, bytes: plain, mime };
  } catch {
    return { ok: false, bytes: null, mime: "image/jpeg", reason: "File tidak tersedia." };
  }
}
