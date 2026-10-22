import type { BlurArea } from "../types";

/** Label istilah baku dokumen untuk area yang terdeteksi kurang jelas. */
export const BLUR_AREA_LABELS: Record<string, string> = {
  nik: "NIK",
  nama: "Nama",
  foto_wajah: "Foto Wajah",
  foto_wajah_kartu: "Foto Wajah",
  tanggal_lahir: "Tanggal Lahir",
  tempat_lahir: "Tempat Lahir",
  jenis_kelamin: "Jenis Kelamin",
  alamat: "Alamat",
  rt_rw: "RT/RW",
  kelurahan: "Kelurahan/Desa",
  kecamatan: "Kecamatan",
  agama: "Agama",
  pekerjaan: "Pekerjaan",
  kewarganegaraan: "Kewarganegaraan",
  status_perkawinan: "Status Perkawinan",
  golongan_darah: "Golongan Darah",
  berlaku_hingga: "Berlaku Hingga",
  tanda_tangan: "Tanda Tangan",
  kepala_keluarga: "Kepala Keluarga",
  anggota_keluarga: "Anggota Keluarga",
  lainnya: "Bagian Lain",
};

export function blurAreaLabel(raw: string): string {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return BLUR_AREA_LABELS[key] || "Bagian Lain";
}

/** Gaya kotak overlay per tingkat keparahan. Class ditulis statis agar dipindai Tailwind. */
export const BLUR_SEVERITY_STYLE: Record<
  BlurArea["severity"],
  { box: string; chip: string; dot: string; label: string }
> = {
  high: {
    box: "border-red-500 bg-red-500/25",
    chip: "bg-red-500 text-white",
    dot: "bg-red-500",
    label: "Sangat kurang jelas",
  },
  medium: {
    box: "border-amber-400 bg-amber-400/25",
    chip: "bg-amber-400 text-amber-950",
    dot: "bg-amber-400",
    label: "Kurang jelas",
  },
  low: {
    box: "border-yellow-300 bg-yellow-300/20",
    chip: "bg-yellow-300 text-yellow-950",
    dot: "bg-yellow-300",
    label: "Sedikit kurang tajam",
  },
};

/** Guard sisi klien: buang area yang bentuknya tidak valid (cache lama / respons rusak). */
export function normalizeBlurAreas(raw: unknown): BlurArea[] {
  if (!Array.isArray(raw)) return [];
  return (raw as BlurArea[])
    .filter(
      (a) =>
        !!a &&
        typeof a === "object" &&
        Array.isArray(a.bbox) &&
        a.bbox.length === 4 &&
        a.bbox.every((n) => typeof n === "number" && Number.isFinite(n))
    )
    .slice(0, 4);
}
