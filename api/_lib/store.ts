// Shared domain logic (dipindah dari server.ts agar bisa dipakai
// semua Vercel Functions tanpa duplikasi). File underscore = bukan route.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import {
  getBynaraApiKey,
  getNaraRouteApiKey,
  isBynaraConfigured,
  isNaraRouteConfigured,
} from "../../services/ai_providers.js";

// Frasa "bukan Kartu Kependudukan" dipertahankan: dipakai deteksi regex
// di frontend/backend (mis. /bukan kartu kependudukan/i).
export const BUKAN_KTP_MESSAGE =
  "File bukan Kartu Kependudukan Indonesia. Verifikasi AI mendukung e-KTP, Kartu Keluarga (KK), Kartu Identitas Anak (KIA), Akta Kelahiran/Kematian/Perkawinan, dan Surat Pindah (SKPWNI) asli — silakan unggah ulang foto dokumen yang jelas dan tidak terpotong.";

export type JenisDokumen =
  | "KTP"
  | "KK"
  | "AKTA"
  | "AKTA_KEMATIAN"
  | "AKTA_PERKAWINAN"
  | "SURAT_PINDAH"
  | "KIA"
  | "LAINNYA";

/** Jenis dokumen kependudukan yang didukung verifikasi AI (tanpa LAINNYA). */
export const JENIS_DOKUMEN_VALID: readonly JenisDokumen[] = [
  "KTP",
  "KK",
  "AKTA",
  "AKTA_KEMATIAN",
  "AKTA_PERKAWINAN",
  "SURAT_PINDAH",
  "KIA",
];

/** Dokumen non-kartu: NIK 16 digit OPSIONAL (dokumen lama sering tanpa NIK). */
export const JENIS_NIK_OPSIONAL: readonly string[] = [
  "AKTA_KEMATIAN",
  "AKTA_PERKAWINAN",
  "SURAT_PINDAH",
];

// Normalisasi jenis dokumen hasil AI. PENTING: jenis akta spesifik dicek
// SEBELUM kata generik "AKTA" agar "Akta Kematian/Perkawinan" tidak tertelan
// menjadi "AKTA" (Akta Kelahiran).
export function normalizeJenisDokumen(raw: unknown): JenisDokumen {
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
  if (upper === "KIA" || /^KIA[\s_-]/.test(upper) || upper.includes("IDENTITAS ANAK") || upper.includes("KARTU ANAK"))
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
  if (upper.includes("AKTA") || upper.includes("AKTE") || upper.includes("KELAHIRAN") || upper.includes("BIRTH CERTIFICATE"))
    return "AKTA";
  return "LAINNYA";
}

export function normalizeStatusVerifikasi(raw: unknown): "BERHASIL" | "BURAM" | "TIDAK_VALID" {
  const upper = String(raw ?? "").toUpperCase().trim().replace(/[\s-]+/g, "_");
  if (upper === "BERHASIL" || upper === "VALID" || upper === "LULUS" || upper === "LAYAK" || upper === "SUCCESS" || upper === "BERHASIL_")
    return "BERHASIL";
  if (
    upper === "TIDAK_VALID" ||
    upper === "TIDAKVALID" ||
    upper === "INVALID" ||
    upper === "LAINNYA" ||
    upper === "REJECTED" ||
    upper === "DITOLAK" ||
    upper.includes("BUKAN")
  )
    return "TIDAK_VALID";
  return "BURAM";
}

export function parseAiJsonResponse(rawText: string): any {
  const text = String(rawText || "").trim();
  if (!text) throw new Error("Respons AI kosong.");
  try {
    return JSON.parse(text);
  } catch {}
  try {
    const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    return JSON.parse(fenced.trim());
  } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error("AI mengembalikan format tak valid, coba ulangi pindaian.");
}

function getCleanSupabaseUrl(rawUrl?: string): string {
  if (!rawUrl) return "";
  return rawUrl.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
}

let cachedSupabase: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cachedSupabase !== undefined) return cachedSupabase;
  const rawUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const url = getCleanSupabaseUrl(rawUrl);
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  cachedSupabase = url && key ? createClient(url, key) : null;
  return cachedSupabase;
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
}

export function extractNaraApiKey(req: any): string {
  const fromHeader =
    req?.headers?.["x-nara-route-api-key"] ||
    req?.headers?.["x-nara-api-key"] ||
    req?.headers?.["x-bynara-api-key"] ||
    req?.headers?.["x-bynara-route-api-key"];
  const fromBody =
    req?.body?.naraApiKey ||
    req?.body?.nara_route_api_key ||
    req?.body?.bynaraApiKey ||
    req?.body?.bynara_api_key ||
    req?.body?.apiKey ||
    req?.body?.key;
  const picked =
    (typeof fromHeader === "string" && fromHeader.trim()) ||
    (typeof fromBody === "string" && fromBody.trim()) ||
    "";
  return getNaraRouteApiKey(picked) || getBynaraApiKey(picked) || picked;
}

export function isNaraConfigured(explicitKey?: unknown): boolean {
  return isNaraRouteConfigured(explicitKey) || isBynaraConfigured(explicitKey);
}

export function maskNik(rawNik: string): string {
  if (rawNik.length >= 12) return `${rawNik.slice(0, 6)}******${rawNik.slice(-4)}`;
  if (rawNik) return `${rawNik.slice(0, 3)}***${rawNik.slice(-2)}`;
  return "320101******0000";
}

// --- Fallback in-memory (best-effort; di serverless tidak persisten antar-invokasi).
// Sumber utama tetap Supabase. Diisi seed agar dashboard tidak kosong saat DB offline.
export interface TicketRow {
  id: string;
  ticket_code: string;
  kode_tiket?: string;
  nik_encrypted: string;
  nik_raw?: string;
  nama_warga: string;
  nama?: string;
  phone?: string;
  no_hp?: string;
  alamat?: string;
  jenis_dokumen: string;
  status_verifikasi: any;
  skor_ai: number;
  status_ai: "LULUS" | "GAGAL";
  catatan_ai: string;
  catatan_petugas?: string;
  /** Path foto sementara terenkripsi di Storage privat (null bila tak tersimpan/sudah purge). */
  foto_path?: string | null;
  catatan?: string;
  officer_id?: string;
  created_at: string;
  updated_at: string;
}

const g = globalThis as any;
if (!g.__aipexTickets) {
  g.__aipexTickets = [
    {
      id: "1",
      ticket_code: "TKT-202609-8410",
      nik_encrypted: "565757******6576",
      nik_raw: "5657576576576576",
      nama_warga: "rana coba",
      phone: "08122516355",
      alamat: "RT 02 / RW 04 Kel. Sukamaju",
      jenis_dokumen: "Penerbitan KTP-EL Baru / Penggantian",
      status_verifikasi: "PENDING",
      skor_ai: 88,
      status_ai: "LULUS",
      catatan_ai: "Kualitas dokumen tajam, NIK 16 digit terdeteksi valid, foto wajah jelas.",
      created_at: "2026-09-08 07:23",
      updated_at: "2026-09-08 07:23",
    },
  ] as TicketRow[];
}
export const memTickets: TicketRow[] = g.__aipexTickets;

export function toPublicTicket(row: any): any {
  const rawNik = row.nik || row.nik_raw || "";
  return {
    id: String(row.id || row.kode_tiket),
    ticket_code: row.kode_tiket || row.ticket_code,
    kode_tiket: row.kode_tiket || row.ticket_code,
    nik_encrypted: maskNik(rawNik),
    // nik_raw removed for privacy (UU PDP)
    nama_warga: row.nama || row.nama_warga || "Warga",
    nama: row.nama || row.nama_warga || "Warga",
    // phone and alamat removed from public list for privacy
    jenis_dokumen: row.jenis_dokumen || "KTP",
    status_verifikasi:
      // BERHASIL = lolos uji kejelasan AI, MASIH menunggu verifikasi petugas
      // (admin menampilkannya sebagai SIAP VERIFIKASI). Jangan tampilkan
      // "Disetujui/Siap Cetak" ke publik sebelum petugas benar-benar memutuskan.
      row.status_verifikasi === "BERHASIL"
        ? "MENUNGGU"
        : row.status_verifikasi === "BURAM"
          ? "REVISI"
          : row.status_verifikasi === "PENDING"
            ? "MENUNGGU"
            : row.status_verifikasi || "PENDING",
    skor_ai: row.skor_kejelasan ?? row.skor_ai ?? 90,
    skor_kejelasan: row.skor_kejelasan ?? row.skor_ai ?? 90,
    status_ai:
      row.status_verifikasi === "BERHASIL" || (row.skor_kejelasan ?? row.skor_ai ?? 0) >= 70
        ? "LULUS"
        : "GAGAL",
    catatan_ai: row.catatan || row.catatan_ai || "",
    catatan: row.catatan || row.catatan_ai || "",
    catatan_petugas: row.catatan_petugas || "",
    created_at: row.created_at
      ? new Date(row.created_at).toISOString().replace("T", " ").slice(0, 16)
      : new Date().toISOString().replace("T", " ").slice(0, 16),
    updated_at: row.updated_at || row.created_at
      ? new Date(row.updated_at || row.created_at).toISOString().replace("T", " ").slice(0, 16)
      : new Date().toISOString().replace("T", " ").slice(0, 16),
  };
}
