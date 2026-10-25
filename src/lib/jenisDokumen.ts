// Normalisasi & metadata jenis dokumen kependudukan — SATU sumber untuk klien.
// Disinkronkan dengan normalizeJenisDokumen di api/_lib/store.ts (server).
//
// PENTING (urutan normalisasi): jenis akta spesifik (kematian/perkawinan)
// dicek SEBELUM kata generik "AKTA" agar "Akta Kematian" tidak tertelan
// menjadi "AKTA" (Akta Kelahiran). Sama untuk PINDAH/SKPWNI dan KIA.

/** Semua jenis dokumen yang didukung verifikasi AI (tanpa LAINNYA). */
export const JENIS_DOKUMEN_VALID = [
  "KTP",
  "KK",
  "AKTA",
  "AKTA_KEMATIAN",
  "AKTA_PERKAWINAN",
  "SURAT_PINDAH",
  "KIA",
] as const;

export type JenisDokumen = (typeof JENIS_DOKUMEN_VALID)[number] | "LAINNYA";

/**
 * Dokumen non-kartu: NIK 16 digit OPSIONAL — dokumen lama/arsip sering tidak
 * mencantumkan NIK (akta kematian, akta perkawinan, surat pindah). Field kunci
 * lain (nama, jenis) tetap divalidasi.
 */
export const JENIS_NIK_OPSIONAL: readonly string[] = [
  "AKTA_KEMATIAN",
  "AKTA_PERKAWINAN",
  "SURAT_PINDAH",
];

/** Label & warna badge per jenis dokumen — kartu hasil, modal, wizard, admin. */
export const JENIS_META: Record<string, { label: string; badge: string }> = {
  KTP: { label: "e-KTP Indonesia", badge: "text-blue-800 bg-blue-100 border-blue-200" },
  KK: { label: "Kartu Keluarga", badge: "text-violet-800 bg-violet-100 border-violet-200" },
  AKTA: { label: "Akta Kelahiran", badge: "text-teal-800 bg-teal-100 border-teal-200" },
  AKTA_KEMATIAN: { label: "Akta Kematian", badge: "text-slate-700 bg-slate-100 border-slate-300" },
  AKTA_PERKAWINAN: { label: "Akta Perkawinan", badge: "text-rose-800 bg-rose-100 border-rose-200" },
  SURAT_PINDAH: { label: "Surat Pindah (SKPWNI)", badge: "text-cyan-800 bg-cyan-100 border-cyan-200" },
  KIA: { label: "Kartu Identitas Anak (KIA)", badge: "text-amber-800 bg-amber-100 border-amber-200" },
  LAINNYA: { label: "Bukan Dokumen Kependudukan", badge: "text-red-700 bg-red-100 border-red-200" },
};

export function normalizeJenis(raw: unknown): string {
  const upper = String(raw ?? "").toUpperCase().trim();
  if (!upper) return "LAINNYA";
  if (upper.includes("KEMATIAN") || upper.includes("DEATH")) return "AKTA_KEMATIAN";
  if (
    upper.includes("PERKAWINAN") ||
    upper.includes("KAWIN") ||
    upper.includes("NIKAH") ||
    upper.includes("MARRIAGE")
  )
    return "AKTA_PERKAWINAN";
  if (upper.includes("PINDAH") || upper.includes("SKPWNI")) return "SURAT_PINDAH";
  if (
    upper === "KIA" ||
    /^KIA[\s_-]/.test(upper) ||
    upper.includes("IDENTITAS ANAK") ||
    upper.includes("KARTU ANAK")
  )
    return "KIA";
  if (upper.includes("KTP") || upper.includes("TANDA PENDUDUK")) return "KTP";
  if (
    upper === "KK" ||
    upper.startsWith("KK ") ||
    upper.startsWith("KK-") ||
    upper.includes("KARTU KELUARGA") ||
    upper.includes("FAMILY CARD")
  )
    return "KK";
  if (
    upper.includes("AKTA") ||
    upper.includes("AKTE") ||
    upper.includes("KELAHIRAN") ||
    upper.includes("BIRTH CERTIFICATE")
  )
    return "AKTA";
  return "LAINNYA";
}

export function jenisLabel(jenis: unknown): string {
  return JENIS_META[String(jenis || "LAINNYA")]?.label || String(jenis || "LAINNYA");
}

/** true bila NIK 16 digit WAJIB untuk jenis ini (dokumen berkartu). */
export function isNikWajib(rawJenis: unknown): boolean {
  return !JENIS_NIK_OPSIONAL.includes(normalizeJenis(rawJenis));
}
