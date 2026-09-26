// Logging abuse best-effort ke Supabase — AIPEX VeriBot.
// Tidak pernah melempar error; tabel boleh belum ada (diabaikan).

import { getSupabase } from "./store.js";

export interface OcrLogEntry {
  ipHash: string;
  fileHash: string;
  mime?: string;
  sizeBytes?: number;
  skor?: number | null;
  status?: string;
  source?: string;
  latencyMs?: number;
}

export async function logOcrAttempt(entry: OcrLogEntry): Promise<void> {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from("ocr_logs").insert([
      {
        ip_hash: entry.ipHash || null,
        file_hash: entry.fileHash || null,
        mime: entry.mime || null,
        size_bytes: entry.sizeBytes ?? null,
        skor: entry.skor ?? null,
        status: entry.status || null,
        source: entry.source || null,
        latency_ms: entry.latencyMs ?? null,
      },
    ]);
  } catch {
    // abaikan: logging tidak boleh menggagalkan request warga
  }
}
