// Penjaga file murah (nol token AI) — AIPEX VeriBot.
// Validasi magic-bytes + ukuran + dimensi minimum sebelum AI dipanggil.

import { createHash } from "node:crypto";

export type DetectedFileType = "jpg" | "png" | "webp" | "pdf" | "unknown";

export const MAX_UPLOAD_BYTES = 4_200_000; // batas payload Vercel
export const MIN_IMAGE_BYTES = 20 * 1024;
export const MIN_PDF_BYTES = 4 * 1024;
export const MIN_DIMENSION = 400;

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function detectFileType(buf: Buffer): DetectedFileType {
  if (!buf || buf.length < 12) return "unknown";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  )
    return "webp";
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "pdf";
  return "unknown";
}

function pngDimensions(buf: Buffer): { w: number; h: number } | null {
  try {
    if (buf.length < 33) return null;
    // IHDR mulai byte 16: width (4) + height (4), big-endian
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w > 0 && h > 0 && w < 20000 && h < 20000) return { w, h };
    return null;
  } catch {
    return null;
  }
}

function jpegDimensions(buf: Buffer): { w: number; h: number } | null {
  try {
    let i = 2;
    while (i + 8 < buf.length && i < 200_000) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      // SOF0-SOF3, SOF5-SOF15 (kecuali DHT/JPG/DAC)
      const isSof =
        (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc);
      if (isSof) {
        const h = buf.readUInt16BE(i + 5);
        const w = buf.readUInt16BE(i + 7);
        if (w > 0 && h > 0 && w < 20000 && h < 20000) return { w, h };
        return null;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

export interface FileGuardResult {
  ok: boolean;
  detected: DetectedFileType;
  reason?: string;
  message?: string;
}

export function validateUploadBuffer(buf: Buffer | null, mimeHint?: string): FileGuardResult {
  if (!buf || buf.length === 0) {
    return { ok: false, detected: "unknown", reason: "empty", message: "File tidak ditemukan. Silakan unggah foto e-KTP (JPG/PNG/WEBP/PDF)." };
  }
  if (buf.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      detected: detectFileType(buf),
      reason: "too-large",
      message: "Ukuran file melebihi 4MB (batas Vercel). Kompres/ambil ulang foto di bawah 4MB lalu coba lagi.",
    };
  }
  const detected = detectFileType(buf);
  if (detected === "unknown") {
    void mimeHint;
    return {
      ok: false,
      detected,
      reason: "bad-magic",
      message: "Format file harus JPG, PNG, WEBP, atau PDF. File yang diunggah bukan gambar valid.",
    };
  }
  if (detected === "pdf") {
    if (buf.length < MIN_PDF_BYTES) {
      return { ok: false, detected, reason: "too-small", message: "File PDF terlalu kecil/rusak. Unggah ulang dokumen asli." };
    }
    return { ok: true, detected };
  }
  if (buf.length < MIN_IMAGE_BYTES) {
    return {
      ok: false,
      detected,
      reason: "too-small",
      message: "Gambar terlalu kecil (di bawah 20KB), kemungkinan bukan foto dokumen asli. Gunakan foto resolusi lebih tinggi.",
    };
  }
  const dims = detected === "png" ? pngDimensions(buf) : detected === "jpg" ? jpegDimensions(buf) : null;
  if (dims && dims.w < MIN_DIMENSION && dims.h < MIN_DIMENSION) {
    return {
      ok: false,
      detected,
      reason: "too-small-dimension",
      message: `Dimensi gambar terlalu kecil (${dims.w}x${dims.h}). Gunakan foto minimal sisi ${MIN_DIMENSION}px agar NIK terbaca.`,
    };
  }
  return { ok: true, detected };
}

export interface PurgeResult {
  purged: boolean;
  artifacts: number;
}

/**
 * Purge artefak foto saat keputusan petugas (DISETUJUI/DITOLAK/PERLU_PERBAIKAN).
 * Implementasi nyata: hapusFotoTiket() di api/_lib/tiket-foto.ts (dipanggil
 * di semua PATCH keputusan + cron sweeper). Fungsi ini dipertahankan sebagai
 * penanda kebijakan + fallback bila tiket-foto belum terkonfigurasi.
 * Kolom teks (jenis_dokumen/NIK/nama) SENGAJA tidak disentuh — rekap butuh itu.
 */
export function purgeDecisionArtifacts(_ticketId?: unknown): PurgeResult {
  void _ticketId;
  return { purged: true, artifacts: 0 };
}

/** Penanda audit untuk verification_logs: bukti foto tidak dipertahankan pasca-keputusan. */
export const PHOTO_PURGE_AUDIT_NOTE = "[Foto dokumen: tidak disimpan/di-purge otomatis]";
