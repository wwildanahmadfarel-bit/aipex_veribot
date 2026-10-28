// Helper OCR pra-pemeriksaan multi-halaman — AIPEX VeriBot.
// PDF dipecah 100% di browser; server hanya menerima satu halaman per request.

import type { OcrPreScreenResult, PreScreenPage, VerificationResult } from "../types";
import { isNikWajib, jenisLabel, normalizeJenis } from "./jenisDokumen";
import { BUKAN_KTP_MESSAGE } from "./messages";
import { revokePreviewUrls, splitPdfClientSide } from "./pdfSplitter";

/** Batas halaman per pemindaian. Satu halaman = satu panggilan OCR/kuota. */
export const MAX_OCR_PAGES = 5;
/** Batas total PDF sebelum dipecah (halaman individual tetap dicek 4,2 MB). */
export const MAX_PDF_FILE_BYTES = 10 * 1024 * 1024;
/** Batas file gambar tunggal / satu halaman hasil pecahan (batas server). */
export const MAX_PAGE_BYTES = 4_200_000;

export interface PreparedOcrPage {
  pageIndex: number;
  pageNumber: number;
  imageBase64: string;
  imageName: string;
  mimeType: string;
  sizeBytes: number;
}

const isPdfFile = (file: File): boolean =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Gagal membaca file di perangkat."));
    reader.readAsDataURL(file);
  });

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function friendlyPdfError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || "");
  if (/halaman|maksimal/i.test(raw)) return raw;
  return "PDF tidak dapat dibaca. Pastikan file tidak rusak/terkunci, lalu unggah ulang.";
}

/**
 * Siapkan halaman OCR dari satu file:
 * - PDF → pecah per halaman di browser, maksimal MAX_OCR_PAGES.
 * - JPG/PNG/WEBP → satu halaman.
 */
export async function prepareOcrPages(file: File): Promise<PreparedOcrPage[]> {
  if (!file) throw new Error("File tidak ditemukan.");

  if (isPdfFile(file)) {
    if (file.size > MAX_PDF_FILE_BYTES) {
      throw new Error(
        `Ukuran PDF melebihi ${Math.round(MAX_PDF_FILE_BYTES / 1024 / 1024)} MB. Kompres PDF lalu unggah ulang.`
      );
    }

    let split: Awaited<ReturnType<typeof splitPdfClientSide>>;
    try {
      split = await splitPdfClientSide(file, { maxPages: MAX_OCR_PAGES });
    } catch (err) {
      throw new Error(friendlyPdfError(err));
    }

    try {
      const baseName = file.name.replace(/\.pdf$/i, "") || "dokumen";
      return split.pages.map((page, i) => {
        const pageBytes = page.uint8Array.length;
        if (pageBytes > MAX_PAGE_BYTES) {
          throw new Error(
            `Halaman ${i + 1} berukuran ${(pageBytes / 1024 / 1024).toFixed(1)} MB, melebihi batas 4,2 MB per halaman. Kompres PDF atau unggah halaman itu sebagai foto.`
          );
        }
        return {
          pageIndex: i,
          pageNumber: i + 1,
          imageBase64: `data:application/pdf;base64,${bytesToBase64(page.uint8Array)}`,
          imageName: `${baseName}-halaman-${i + 1}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: pageBytes,
        };
      });
    } finally {
      // Preview blob tidak dipakai di kartu pra-pemeriksaan.
      revokePreviewUrls(split.pages);
    }
  }

  if (file.size > MAX_PAGE_BYTES) {
    throw new Error(
      "Ukuran file melebihi 4 MB (batas server). Kompres/kecilkan foto lalu unggah ulang."
    );
  }

  const dataUrl = await fileToDataUrl(file);
  if (!dataUrl) throw new Error("Gagal membaca file di perangkat. Coba file lain atau ulangi.");

  return [
    {
      pageIndex: 0,
      pageNumber: 1,
      imageBase64: dataUrl,
      imageName: file.name,
      mimeType: file.type || "image/jpeg",
      sizeBytes: file.size,
    },
  ];
}

export function normalizeOcrStatus(raw: unknown): string {
  const upper = String(raw ?? "").toUpperCase().trim().replace(/[\s-]+/g, "_");
  if (["BERHASIL", "VALID", "LULUS", "LAYAK", "SUCCESS"].includes(upper)) return "BERHASIL";
  if (
    ["TIDAK_VALID", "TIDAKVALID", "INVALID", "LAINNYA", "REJECTED", "DITOLAK"].includes(upper) ||
    upper.includes("BUKAN")
  )
    return "TIDAK_VALID";
  return "BURAM";
}

/** Susun alasan yang jelas dari hasil terstruktur. */
export function composeOcrReason(args: {
  jenis: string;
  skor: number;
  nikFull: string | null;
  nikPartial: string | null;
  nama: string | null;
  saranAi: string;
  tidakValid: boolean;
  isLayak: boolean;
}): string {
  const label = jenisLabel(args.jenis);
  if (args.tidakValid) {
    return (
      `${BUKAN_KTP_MESSAGE} ` +
      "Pastikan yang difoto adalah dokumen kependudukan yang didukung " +
      "(bukan SIM, paspor, atau swafoto), seluruh bingkai dokumen masuk, tidak silau, dan tidak terpotong."
    );
  }
  const digitCount = args.nikFull
    ? 16
    : args.nikPartial
      ? args.nikPartial.replace(/\D/g, "").length
      : 0;
  const nikOpsional = !isNikWajib(args.jenis);
  const nikInfo =
    digitCount === 16
      ? "NIK 16 digit terbaca lengkap."
      : nikOpsional
        ? digitCount > 0
          ? `NIK terbaca sebagian (${digitCount}/16 digit) — untuk jenis dokumen ini NIK opsional; boleh dilengkapi manual bila tercantum.`
          : "NIK tidak terbaca — tidak masalah, untuk jenis dokumen ini NIK opsional dan bisa dilengkapi di formulir bila tercantum."
        : digitCount > 0
          ? `NIK terbaca sebagian (${digitCount}/16 digit) — dilengkapi manual dari fisik dokumen atau foto ulang lebih fokus.`
          : "NIK tidak terbaca — ketik manual dari fisik dokumen atau foto ulang lebih fokus tanpa silau.";
  const namaInfo = args.nama
    ? `Nama terbaca: ${args.nama}.`
    : "Nama tidak terbaca — dilengkapi di formulir.";
  if (args.isLayak) {
    return (
      `Terdeteksi ${label} asli yang valid (skor kejelasan ${args.skor}/100, ambang lolos 70). ` +
      `${nikInfo} ${namaInfo} ` +
      (args.saranAi || "Dokumen layak — lanjut ke formulir untuk terbit Tiket QR Antrean.")
    );
  }
  const kekuranganSkor =
    args.skor < 70
      ? `skor kejelasan ${args.skor}/100 masih di bawah ambang 70`
      : `skor kejelasan ${args.skor}/100 sudah mencapai ambang 70, tetapi status keterbacaan masih perlu perbaikan`;
  const alasan = kekuranganSkor.charAt(0).toUpperCase() + kekuranganSkor.slice(1);
  return (
    `Terdeteksi ${label} asli. ${alasan}. ` +
    `${nikInfo} ${namaInfo} ` +
    (args.saranAi || "Foto ulang di tempat terang tanpa lampu flash.") +
    " Anda tetap bisa lanjut — tiket terbit dengan catatan REVISI; bawa fisik dokumen asli ke loket."
  );
}

/** True bila respons menandakan gangguan sistem, bukan vonis "bukan dokumen". */
export function isOcrSystemResponse(data: any, parsedRes: any): boolean {
  return (
    Boolean(data?.isSystemError) ||
    Boolean(parsedRes?.isSystemError) ||
    /belum dikonfigurasi|gagal memproses|jawaban tak valid|gangguan|kunci akses|sedang sibuk|verifikasi manual|coba lagi nanti|hubungi petugas loket/i.test(
      String(data?.message || parsedRes?.catatan || "")
    )
  );
}

export interface ParsedOcrPage {
  result: OcrPreScreenResult;
  systemError: boolean;
  message: string;
}

/**
 * Normalisasi respons /api/ocr untuk satu halaman.
 * Respons TIDAK_VALID tetap `systemError: false` (itu vonis sah), sedangkan
 * gangguan AI/koneksi menjadi `systemError: true`.
 */
export function parseOcrPageResponse(
  data: any,
  imageBase64: string,
  imageName: string
): ParsedOcrPage {
  const parsedRes = data?.data || data || {};
  const systemError = isOcrSystemResponse(data, parsedRes);

  if (systemError) {
    const message = String(
      data?.message || parsedRes?.catatan || "Layanan AI gagal memproses dokumen. Coba lagi."
    );
    return {
      systemError: true,
      message,
      result: {
        imageBase64,
        imageName,
        status_kelayakan: "TIDAK_LAYAK",
        skor_kejelasan: 0,
        status_kejelasan: "DITOLAK",
        nik_terdeteksi: false,
        nik_value: "Tidak Terdeteksi",
        nama_terdeteksi: "Tidak Terbaca",
        pencahayaan_status: "KURANG_TERANG",
        catatan: message,
        jenis_dokumen: "LAINNYA",
        status_verifikasi: "TIDAK_VALID",
        isSystemError: true,
      },
    };
  }

  const jenis = normalizeJenis(parsedRes.jenis_dokumen);
  let status = normalizeOcrStatus(parsedRes.status_verifikasi);
  if (jenis === "LAINNYA") status = "TIDAK_VALID";

  const tidakValid = status === "TIDAK_VALID" || jenis === "LAINNYA";
  const isLayak =
    !tidakValid && (status === "BERHASIL" || parsedRes.status_kualitas === "LAYAK");
  const score = tidakValid
    ? typeof parsedRes.skor_kejelasan === "number"
      ? Math.min(parsedRes.skor_kejelasan, 20)
      : 0
    : typeof parsedRes.skor_kejelasan === "number"
      ? parsedRes.skor_kejelasan
      : isLayak
        ? 92
        : 45;

  const nikFull: string | null =
    !tidakValid &&
    typeof parsedRes.nik === "string" &&
    /^\d{16}$/.test(parsedRes.nik.replace(/\D/g, ""))
      ? parsedRes.nik.replace(/\D/g, "")
      : null;
  const nikPartial: string | null =
    !tidakValid && !nikFull && typeof parsedRes.nik_partial === "string"
      ? parsedRes.nik_partial.replace(/\D/g, "")
      : null;
  const namaOk: string | null =
    !tidakValid &&
    typeof parsedRes.nama === "string" &&
    parsedRes.nama.trim() &&
    !/tidak terbaca/i.test(parsedRes.nama)
      ? parsedRes.nama.trim()
      : null;

  return {
    systemError: false,
    message: String(data?.message || ""),
    result: {
      imageBase64,
      imageName,
      status_kelayakan: isLayak ? "LAYAK" : "TIDAK_LAYAK",
      skor_kejelasan: score,
      status_kejelasan: tidakValid ? "DITOLAK" : isLayak ? "LULUS" : "KURANG_TAJAM",
      nik_terdeteksi: nikFull !== null,
      nik_value: tidakValid
        ? "Tidak Terdeteksi"
        : nikFull || (nikPartial ? `${nikPartial} (sebagian)` : "Tidak Terdeteksi"),
      nama_terdeteksi: namaOk || "Tidak Terbaca",
      pencahayaan_status: isLayak ? "SESUAI_STANDAR" : "KURANG_TERANG",
      catatan: composeOcrReason({
        jenis,
        skor: score,
        nikFull,
        nikPartial,
        nama: namaOk,
        saranAi: tidakValid ? "" : String(parsedRes.catatan || ""),
        tidakValid,
        isLayak,
      }),
      jenis_dokumen: jenis,
      status_verifikasi: status,
      isSystemError: false,
      blur_areas: tidakValid ? [] : normalizeBlurAreasSafe(parsedRes.blur_areas),
    },
  };
}

function normalizeBlurAreasSafe(raw: unknown): OcrPreScreenResult["blur_areas"] {
  if (!Array.isArray(raw)) return [];
  // Bentuk sudah divalidasi server; klien hanya membuang item yang jelas rusak.
  return raw
    .filter((item): item is any => Boolean(item) && typeof item === "object")
    .slice(0, 4)
    .map((item: any) => ({
      area: String(item.area ?? "lainnya"),
      severity: item.severity === "high" || item.severity === "low" ? item.severity : "medium",
      bbox: Array.isArray(item.bbox) && item.bbox.length === 4
        ? (item.bbox.map((n: unknown) => Number(n)) as [number, number, number, number])
        : [0, 0, 100, 100],
      description: String(item.description ?? ""),
    }));
}

/** Konversi hasil pra-pemeriksaan ke bentuk yang dipakai wizard. */
export function toVerificationResult(result: OcrPreScreenResult): VerificationResult {
  const nikDigits = String(result.nik_value || "").replace(/\D/g, "");
  return {
    nik: result.nik_terdeteksi && /^\d{16}$/.test(nikDigits) ? nikDigits : "",
    nama:
      result.nama_terdeteksi && !String(result.nama_terdeteksi).includes("Tidak")
        ? String(result.nama_terdeteksi)
        : "",
    jenis_dokumen: result.jenis_dokumen || "LAINNYA",
    status_kualitas: result.status_verifikasi === "BERHASIL" ? "LULUS" : "GAGAL",
    skor: result.skor_kejelasan,
    catatan: result.catatan || "",
    source: "pre-screen",
    blur_areas: result.blur_areas,
  };
}

export function makePreScreenPage(
  prepared: PreparedOcrPage,
  result: OcrPreScreenResult
): PreScreenPage {
  return {
    pageIndex: prepared.pageIndex,
    pageNumber: prepared.pageNumber,
    imageBase64: prepared.imageBase64,
    imageName: prepared.imageName,
    mimeType: prepared.mimeType,
    result,
    verification: toVerificationResult(result),
  };
}

export function isUsablePage(page: PreScreenPage | undefined): boolean {
  if (!page) return false;
  const r = page.result;
  return (
    !r.isSystemError &&
    r.jenis_dokumen !== "LAINNYA" &&
    r.status_verifikasi !== "TIDAK_VALID"
  );
}

/** KTP valid skor tertinggi → halaman valid pertama. */
export function pickDefaultMainIndex(pages: PreScreenPage[]): number {
  const usable = pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => isUsablePage(page));
  if (!usable.length) return 0;

  const ktp = usable
    .filter(({ page }) => page.result.jenis_dokumen === "KTP")
    .sort((a, b) => b.page.result.skor_kejelasan - a.page.result.skor_kejelasan)[0];
  return ktp ? ktp.index : usable[0].index;
}

export interface IdentitySummary {
  niks: string[];
  names: string[];
  hasConflict: boolean;
}

/** Deteksi NIK/nama berbeda antar halaman (mis. KTP pemohon vs KK kepala keluarga). */
export function summarizeIdentities(pages: PreScreenPage[]): IdentitySummary {
  const niks = new Set<string>();
  const names = new Set<string>();
  for (const page of pages) {
    if (!isUsablePage(page)) continue;
    const nik = String(page.result.nik_value || "").replace(/\D/g, "");
    if (nik.length === 16) niks.add(nik);
    const nama = String(page.result.nama_terdeteksi || "").trim();
    if (nama && !/tidak terbaca/i.test(nama)) names.add(nama.toUpperCase());
  }
  return {
    niks: [...niks],
    names: [...names],
    hasConflict: niks.size > 1 || names.size > 1,
  };
}

// ---------------------------------------------------------------------------
// Pemetaan halaman → slot syarat layanan (dipakai wizard)
// ---------------------------------------------------------------------------

export interface RequirementLike {
  title: string;
  description?: string;
  mandatory?: boolean;
}

export type PageAssignment =
  | { kind: "main" }
  | { kind: "support"; slot: number }
  | { kind: "unused" };

/** key = indeks array halaman (0-based), bukan pageIndex dokumen. */
export type PageAssignments = Record<number, PageAssignment>;

export interface MappingResult {
  assignments: PageAssignments;
  mainIndex: number;
}

function requirementMatchesType(titleRaw: string, jenisRaw: string): boolean {
  const title = String(titleRaw || "").toLowerCase();
  switch (normalizeJenis(jenisRaw)) {
    case "KTP":
      return /ktp|kartu tanda penduduk/.test(title);
    case "KK":
      return /kartu keluarga|\bkk\b/.test(title);
    case "AKTA":
      return /kelahiran|akta kelahiran/.test(title) && !/kematian|perkawinan/.test(title);
    case "AKTA_KEMATIAN":
      return /kematian/.test(title);
    case "AKTA_PERKAWINAN":
      return /perkawinan|kawin|nikah|pemberkatan/.test(title);
    case "SURAT_PINDAH":
      return /pindah|skpwni/.test(title);
    case "KIA":
      return /\bkia\b|identitas anak/.test(title);
    default:
      return false;
  }
}

/** Peringatan konteks saat dokumen utama bukan KTP pemohon. */
export function mainPageIdentityNote(jenisRaw: unknown): string | null {
  switch (normalizeJenis(jenisRaw)) {
    case "KK":
      return "NIK pada KK umumnya milik kepala keluarga, bukan selalu pemohon. Pastikan NIK/nama yang terisi sesuai dengan orang yang mengajukan.";
    case "AKTA":
      return "Data pada akta kelahiran adalah milik anak. Jika pemohon adalah orang tua, lengkapi NIK/nama pemohon secara manual.";
    case "AKTA_KEMATIAN":
      return "NIK/nama pada akta kematian adalah milik almarhum/almarhumah. Data ini tidak diisikan otomatis sebagai pemohon — isi NIK/nama pemohon secara manual.";
    case "AKTA_PERKAWINAN":
      return "Akta perkawinan memuat data dua pasangan. Pastikan NIK/nama yang terisi adalah milik pemohon, bukan pasangan.";
    case "KIA":
      return "Data pada KIA adalah milik anak. Jika pemohon adalah orang tua, lengkapi NIK/nama pemohon secara manual.";
    default:
      return null;
  }
}

/**
 * Default mapping:
 * 1. Halaman pilihan pengguna (mis. dari tombol "Jadikan dokumen utama").
 * 2. Halaman yang cocok dengan syarat utama.
 * 3. KTP valid skor tertinggi.
 * 4. Halaman valid pertama.
 * Halaman lain dipetakan ke slot lampiran yang tipenya cocok.
 */
export function buildDefaultAssignments(
  pages: PreScreenPage[],
  requirements: RequirementLike[],
  preferredMainIndex?: number
): MappingResult {
  const assignments: PageAssignments = {};
  const used = new Set<number>();
  const usable = pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) => isUsablePage(page));

  for (let i = 0; i < pages.length; i++) assignments[i] = { kind: "unused" };
  if (!usable.length) {
    return { assignments, mainIndex: 0 };
  }

  const mainReq = requirements[0];
  const preferred =
    typeof preferredMainIndex === "number"
      ? usable.find(({ index }) => index === preferredMainIndex)
      : undefined;
  const mainMatches = mainReq
    ? usable
        .filter(({ page }) => requirementMatchesType(mainReq.title, String(page.result.jenis_dokumen)))
        .sort((a, b) => b.page.result.skor_kejelasan - a.page.result.skor_kejelasan)
    : [];
  const ktpMatches = usable
    .filter(({ page }) => page.result.jenis_dokumen === "KTP")
    .sort((a, b) => b.page.result.skor_kejelasan - a.page.result.skor_kejelasan);

  // Pilihan eksplisit pengguna selalu dihormati; pemetaan ulang otomatis tidak
  // mengirim preferredMainIndex sehingga kembali mengikuti syarat layanan.
  const main = preferred || mainMatches[0] || ktpMatches[0] || usable[0];

  if (!main) return { assignments, mainIndex: 0 };

  assignments[main.index] = { kind: "main" };
  used.add(main.index);

  // Slot lampiran = requirements[1..N]; slot index mengikuti posisi supportFiles.
  for (let slot = 1; slot < requirements.length; slot++) {
    const req = requirements[slot];
    if (!req) continue;
    const candidate = usable
      .filter(
        ({ page, index }) =>
          !used.has(index) &&
          requirementMatchesType(req.title, String(page.result.jenis_dokumen))
      )
      .sort((a, b) => b.page.result.skor_kejelasan - a.page.result.skor_kejelasan)[0];
    if (candidate) {
      assignments[candidate.index] = { kind: "support", slot };
      used.add(candidate.index);
    }
  }

  return { assignments, mainIndex: main.index };
}

export interface MappedUploads {
  mainPage: PreScreenPage | null;
  supportFiles: { base64: string; name: string }[];
}

/** Ubah assignment menjadi dokumen utama + array supportFiles berindeks slot. */
export function assignmentsToUploads(
  pages: PreScreenPage[],
  requirements: RequirementLike[],
  assignments: PageAssignments
): MappedUploads {
  let mainPage: PreScreenPage | null = null;
  const supportFiles: { base64: string; name: string }[] = [];

  for (const [key, assignment] of Object.entries(assignments)) {
    const index = Number(key);
    const page = pages[index];
    if (!page) continue;
    if (assignment.kind === "main") {
      mainPage = page;
    } else if (assignment.kind === "support") {
      // Wizard menyimpan supportFiles[0] untuk requirements[1] (slot lampiran
      // pertama), jadi konversi slot 1-based → indeks array 0-based.
      const supportIndex = assignment.slot - 1;
      if (supportIndex < 0) continue;
      supportFiles[supportIndex] = {
        base64: page.imageBase64,
        name: page.imageName,
      };
    }
  }

  if (!mainPage) {
    const fallback = pages.find((page) => isUsablePage(page)) || pages[0] || null;
    mainPage = fallback;
  }

  // Pastikan panjang array minimal sejumlah slot lampiran.
  const requiredSupportCount = Math.max(0, requirements.length - 1);
  for (let i = 0; i < requiredSupportCount; i++) {
    if (!supportFiles[i]) supportFiles[i] = { base64: "", name: "" };
  }

  return { mainPage, supportFiles };
}
