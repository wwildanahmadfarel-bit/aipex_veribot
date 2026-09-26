// Penyimpanan foto sementara tiket — AIPEX VeriBot.
// Foto dienkripsi AES-256-GCM (kunci per-tiket dari master + IV acak per file)
// sebelum masuk bucket privat Supabase. Server mendekripsi hanya saat view
// berizin (petugas Bearer / warga pemilik kode). Dihapus SEKETIKA saat tiket
// diputus; sweeper menghapus foto tiket terbengkalai. NIK/identitas tidak ikut.
//
// Env: FOTO_MASTER_KEY (hex 64 char / 32 byte, server-only),
//      TICKET_FOTO_RETENTION_DAYS (default 7, untuk tiket non-final).

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { getSupabase } from "./store.js";

export const FOTO_BUCKET = "tiket-fotos";

export function fotoRetentionDays(): number {
  const n = Number(process.env.TICKET_FOTO_RETENTION_DAYS || 7);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 7;
}

function masterKey(): Buffer | null {
  const hex = String(process.env.FOTO_MASTER_KEY || "").trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return Buffer.from(hex, "hex");
}

/** Kunci per-tiket: HMAC(master, kode_tiket) — bocor 1 file tidak membuka lainnya. */
function ticketKey(kodeTiket: string): Buffer | null {
  const master = masterKey();
  if (!master) return null;
  return createHmac("sha256", master).update(String(kodeTiket)).digest();
}

function fotoPathFor(kodeTiket: string, mime: string): string {
  const ext = /png/i.test(mime || "") ? "png" : /webp/i.test(mime || "") ? "webp" : /pdf/i.test(mime || "") ? "pdf" : "jpg";
  const safe = String(kodeTiket || "unknown").replace(/[^A-Za-z0-9-]/g, "");
  return `${safe}/utama.${ext}.enc`;
}

export interface SimpanFotoResult {
  ok: boolean;
  path: string | null;
  ivHex: string | null;
  reason?: string;
}

/** Enkripsi + upload foto utama. Best-effort: gagal -> {ok:false}, tiket tetap terbit. */
export async function simpanFotoTiket(
  kodeTiket: string,
  plain: Buffer,
  mime: string
): Promise<SimpanFotoResult> {
  try {
    const key = ticketKey(kodeTiket);
    const supabase = getSupabase();
    if (!key) return { ok: false, path: null, ivHex: null, reason: "FOTO_MASTER_KEY belum dikonfigurasi." };
    if (!supabase) return { ok: false, path: null, ivHex: null, reason: "Database tidak terhubung." };
    if (!plain || plain.length === 0) return { ok: false, path: null, ivHex: null, reason: "Buffer kosong." };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([enc, tag]); // tag 16 byte di ekor
    const path = fotoPathFor(kodeTiket, mime);
    const { error } = await supabase.storage.from(FOTO_BUCKET).upload(path, payload, {
      contentType: "application/octet-stream",
      upsert: true,
    });
    if (error) {
      try {
        console.warn(`[Foto] upload gagal ${kodeTiket}: ${String(error.message || error).slice(0, 200)}`);
      } catch {}
      return { ok: false, path: null, ivHex: null, reason: String(error.message || error).slice(0, 200) };
    }
    return { ok: true, path, ivHex: iv.toString("hex") };
  } catch (err: any) {
    return { ok: false, path: null, ivHex: null, reason: String(err?.message || err).slice(0, 200) };
  }
}

export interface LihatFotoResult {
  ok: boolean;
  bytes: Buffer | null;
  mime: string;
  reason?: string;
}

/** Unduh + dekripsi foto untuk view berizin. Gagal -> {ok:false} (jangan bocorkan detail). */
export async function lihatFotoTiket(kodeTiket: string): Promise<LihatFotoResult> {
  try {
    const key = ticketKey(kodeTiket);
    const supabase = getSupabase();
    if (!key || !supabase) return { ok: false, bytes: null, mime: "image/jpeg", reason: "Layanan foto belum siap." };
    const { data: row, error } = await supabase
      .from("tickets")
      .select("foto_path,foto_iv,jenis_dokumen")
      .or(`kode_tiket.eq.${kodeTiket},id.eq.${kodeTiket}`)
      .maybeSingle();
    const path = (row as any)?.foto_path as string | null;
    const ivHex = (row as any)?.foto_iv as string | null;
    if (error || !row || !path || !ivHex) {
      return { ok: false, bytes: null, mime: "image/jpeg", reason: "Foto tidak tersedia (sudah di-purge atau tak tersimpan)." };
    }
    const { data: blob, error: dlErr } = await supabase.storage.from(FOTO_BUCKET).download(path);
    if (dlErr || !blob) return { ok: false, bytes: null, mime: "image/jpeg", reason: "Foto tidak tersedia." };
    const payload = Buffer.from(await blob.arrayBuffer());
    if (payload.length < 17) return { ok: false, bytes: null, mime: "image/jpeg", reason: "Foto rusak." };
    const enc = payload.subarray(0, payload.length - 16);
    const tag = payload.subarray(payload.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
    const mime = /\.png\.enc$/i.test(path) ? "image/png" : /\.webp\.enc$/i.test(path) ? "image/webp" : /\.pdf\.enc$/i.test(path) ? "application/pdf" : "image/jpeg";
    return { ok: true, bytes: plain, mime };
  } catch {
    return { ok: false, bytes: null, mime: "image/jpeg", reason: "Foto tidak tersedia." };
  }
}

/** Hapus objek + null-kan kolom. Best-effort: return false bila gagal (sweeper menutup). */
export async function hapusFotoTiket(kodeTiket: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    if (!supabase) return false;
    const { data: row } = await supabase
      .from("tickets")
      .select("foto_path")
      .or(`kode_tiket.eq.${kodeTiket},id.eq.${kodeTiket}`)
      .maybeSingle();
    const path = (row as any)?.foto_path as string | null;
    if (path) {
      try {
        await supabase.storage.from(FOTO_BUCKET).remove([path]);
      } catch {}
    }
    try {
      await supabase
        .from("tickets")
        .update({ foto_path: null, foto_iv: null })
        .or(`kode_tiket.eq.${kodeTiket},id.eq.${kodeTiket}`);
    } catch {}
    try {
      console.log(`[Foto] purge ${kodeTiket}`);
    } catch {}
    return true;
  } catch {
    return false;
  }
}
