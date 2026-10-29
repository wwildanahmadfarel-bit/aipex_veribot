// Modul baca/purge foto tiket — AIPEX VeriBot.
// Penulisan arsip foto sudah tidak dipakai: foto diproses in-memory saat OCR
// lalu buffer-nya dinolkan, sehingga tidak ada foto yang disimpan. Modul ini
// hanya membaca foto lama (bila ada) dan menghapusnya saat tiket diputus.
//
// Env: FOTO_MASTER_KEY (hex 64 char / 32 byte, server-only),
//      TICKET_FOTO_RETENTION_DAYS (default 7, untuk tiket non-final).

import { createDecipheriv, createHmac } from "node:crypto";
import { getSupabase, ticketLookupFilter } from "./store.js";

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
      .or(ticketLookupFilter(kodeTiket))
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
      .or(ticketLookupFilter(kodeTiket))
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
        .or(ticketLookupFilter(kodeTiket));
    } catch {}
    try {
      console.log(`[Foto] purge ${kodeTiket}`);
    } catch {}
    return true;
  } catch {
    return false;
  }
}
