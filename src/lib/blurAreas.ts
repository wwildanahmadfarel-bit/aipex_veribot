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

/** True bila ada area yang berasal dari perkiraan lokal, bukan vonis AI. */
export function hasEstimatedBlurAreas(areas?: BlurArea[] | null): boolean {
  return Array.isArray(areas) && areas.some((a) => a.estimated === true);
}

type SharpnessCell = {
  col: number;
  row: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  sharpness: number;
  contrast: number;
};

const ESTIMATE_COLS = 8;
const ESTIMATE_ROWS = 10;
const ESTIMATE_MAX_AREAS = 3;

function isRasterDataUrl(value?: string | null): boolean {
  return !!value && /^data:image\/(?:jpe?g|png|webp|bmp|gif);/i.test(value);
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gagal membaca gambar"));
    img.src = src;
  });
}

function groupAdjacentCells(cells: SharpnessCell[]): SharpnessCell[][] {
  const remaining = new Set(cells);
  const groups: SharpnessCell[][] = [];
  while (remaining.size > 0) {
    const seed = remaining.values().next().value as SharpnessCell;
    remaining.delete(seed);
    const group = [seed];
    const queue = [seed];
    while (queue.length > 0) {
      const current = queue.pop() as SharpnessCell;
      for (const other of Array.from(remaining)) {
        if (Math.abs(other.col - current.col) <= 1 && Math.abs(other.row - current.row) <= 1) {
          remaining.delete(other);
          group.push(other);
          queue.push(other);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

function cellGroupToBbox(group: SharpnessCell[], width: number, height: number) {
  const x0 = Math.min(...group.map((c) => c.x0));
  const y0 = Math.min(...group.map((c) => c.y0));
  const x1 = Math.max(...group.map((c) => c.x1));
  const y1 = Math.max(...group.map((c) => c.y1));
  const round = (n: number) => Math.round(n * 10) / 10;
  const x = Math.max(0, Math.min(96, round((x0 / width) * 100)));
  const y = Math.max(0, Math.min(96, round((y0 / height) * 100)));
  return {
    x,
    y,
    w: Math.max(4, Math.min(100 - x, round(((x1 - x0) / width) * 100))),
    h: Math.max(4, Math.min(100 - y, round(((y1 - y0) / height) * 100))),
    area: (x1 - x0) * (y1 - y0),
  };
}

/**
 * Perkiraan area kurang tajam dari analisis ketajaman lokal (canvas).
 * Dipakai HANYA sebagai fallback saat AI tidak mengembalikan `blur_areas`
 * padahal skor < 80. Hasilnya diberi `estimated: true` agar UI jujur
 * menyebutnya sebagai perkiraan, bukan vonis AI.
 */
export async function estimateBlurAreasFromImage(
  imageBase64: string,
  score: number
): Promise<BlurArea[]> {
  if (!isRasterDataUrl(imageBase64) || typeof document === "undefined") return [];
  try {
    const img = await loadImageElement(imageBase64);
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) return [];

    const scale = Math.min(1, 480 / Math.max(naturalW, naturalH));
    const width = Math.max(1, Math.round(naturalW * scale));
    const height = Math.max(1, Math.round(naturalH * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;

    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const p = i * 4;
      gray[i] = 0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2];
    }

    const cellW = Math.max(8, Math.floor(width / ESTIMATE_COLS));
    const cellH = Math.max(8, Math.floor(height / ESTIMATE_ROWS));
    const cells: SharpnessCell[] = [];

    for (let row = 0; row < ESTIMATE_ROWS; row++) {
      for (let col = 0; col < ESTIMATE_COLS; col++) {
        const x0 = col * cellW;
        const y0 = row * cellH;
        const x1 = col === ESTIMATE_COLS - 1 ? width : Math.min(width, x0 + cellW);
        const y1 = row === ESTIMATE_ROWS - 1 ? height : Math.min(height, y0 + cellH);
        if (x1 - x0 < 6 || y1 - y0 < 6) continue;

        let sum = 0;
        let sumSq = 0;
        let gradient = 0;
        let count = 0;
        for (let y = y0 + 1; y < y1 - 1; y++) {
          for (let x = x0 + 1; x < x1 - 1; x++) {
            const idx = y * width + x;
            const value = gray[idx];
            const gx = gray[idx + 1] - gray[idx - 1];
            const gy = gray[idx + width] - gray[idx - width];
            gradient += Math.abs(gx) + Math.abs(gy);
            sum += value;
            sumSq += value * value;
            count++;
          }
        }
        if (count < 8) continue;
        const mean = sum / count;
        const variance = Math.max(0, sumSq / count - mean * mean);
        cells.push({
          col,
          row,
          x0,
          y0,
          x1,
          y1,
          sharpness: gradient / count,
          contrast: Math.sqrt(variance),
        });
      }
    }
    if (cells.length === 0) return [];

    // Sel yang hampir kosong (margin putih) jangan dianggap buram.
    const meaningful = cells.filter((c) => c.contrast >= 4 || c.sharpness >= 3);
    const pool = meaningful.length >= 6 ? meaningful : cells;
    const sorted = [...pool].sort((a, b) => a.sharpness - b.sharpness);
    const median = sorted[Math.floor(sorted.length / 2)]?.sharpness || 0;
    const threshold = Math.max(1.5, median * 0.55);

    let picked = sorted.filter((c) => c.sharpness <= threshold).slice(0, 8);
    if (picked.length === 0) {
      // Bidang seragam: tandai bagian tengah sebagai area perkiraan.
      picked = pool
        .filter(
          (c) =>
            c.col >= 1 &&
            c.col <= ESTIMATE_COLS - 2 &&
            c.row >= 1 &&
            c.row <= ESTIMATE_ROWS - 2
        )
        .slice(0, 4);
    }
    if (picked.length === 0) return [];

    const severity: BlurArea["severity"] = score < 70 ? "high" : score < 76 ? "medium" : "low";
    const bboxes = groupAdjacentCells(picked)
      .map((group) => cellGroupToBbox(group, width, height))
      .sort((a, b) => b.area - a.area)
      .slice(0, ESTIMATE_MAX_AREAS);

    return bboxes.map((box) => ({
      area: "lainnya",
      severity,
      bbox: [box.x, box.y, box.w, box.h],
      description: "Perkiraan area kurang tajam (analisis lokal)",
      estimated: true,
    }));
  } catch {
    return [];
  }
}
