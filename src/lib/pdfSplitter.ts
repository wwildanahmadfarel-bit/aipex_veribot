// Client-side PDF splitting & preview — AIPEX VeriBot
// Privacy-first: runs entirely in browser, no server upload of full PDF.
// Uses pdf-lib (MIT, zero-dep, browser-native).

import { PDFDocument } from "pdf-lib";

export interface PdfPageData {
  index: number;
  uint8Array: Uint8Array;
  base64: string;
  mimeType: "application/pdf";
  previewUrl: string;
}

export interface SplitResult {
  pages: PdfPageData[];
  totalPages: number;
  fileName: string;
  fileSize: number;
}

export interface SplitPdfOptions {
  /** Tolak PDF bila jumlah halaman melebihi batas ini. */
  maxPages?: number;
}

export async function splitPdfClientSide(file: File, options: SplitPdfOptions = {}): Promise<SplitResult> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const pageCount = pdf.getPageCount();

  if (options.maxPages && pageCount > options.maxPages) {
    throw new Error(
      `PDF memiliki ${pageCount} halaman, sedangkan maksimal ${options.maxPages} halaman per pemindaian. Pisahkan PDF lalu unggah ulang.`
    );
  }

  const pages: PdfPageData[] = [];

  for (let i = 0; i < pageCount; i++) {
    const newPdf = await PDFDocument.create();
    const [copiedPage] = await newPdf.copyPages(pdf, [i]);
    newPdf.addPage(copiedPage);
    const pageBytes = await newPdf.save();

    const base64 = bytesToBase64(pageBytes);
    const previewUrl = URL.createObjectURL(new Blob([pageBytes], { type: "application/pdf" }));

    pages.push({
      index: i,
      uint8Array: pageBytes,
      base64,
      mimeType: "application/pdf",
      previewUrl,
    });
  }

  return {
    pages,
    totalPages: pageCount,
    fileName: file.name,
    fileSize: file.size,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function revokePreviewUrls(pages: PdfPageData[]): void {
  pages.forEach((p) => {
    if (p.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(p.previewUrl);
    }
  });
}

export function validatePdfFile(file: File): { valid: boolean; error?: string } {
  if (!file) return { valid: false, error: "File tidak dipilih" };
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return { valid: false, error: "File harus berformat PDF" };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { valid: false, error: "Ukuran file maksimal 10 MB" };
  }
  return { valid: true };
}
