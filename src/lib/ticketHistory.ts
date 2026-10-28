// Riwayat tiket terakhir di perangkat warga — AIPEX VeriBot.
// Hanya menyimpan kode, layanan, dan tanggal. NIK/HP/alamat/nama/foto TIDAK
// pernah disimpan di sini. TTL 30 hari + maksimal 5 tiket agar localStorage
// tidak menjadi arsip data pribadi.

const STORAGE_KEY = "aipex_ticket_history_v1";
const MAX_ITEMS = 5;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface TicketHistoryItem {
  code: string;
  service: string;
  created_at: string;
  savedAt: number;
}

export interface TicketHistoryInput {
  ticket_code?: string;
  kode_tiket?: string;
  jenis_dokumen?: string;
  created_at?: string;
}

function normalizeCode(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const match = /TKT-[A-Za-z0-9-]+/i.exec(text);
  return (match ? match[0] : text).toUpperCase();
}

function isBrowser(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage);
  } catch {
    // Safari private mode / cookie diblokir bisa melempar saat akses localStorage.
    return false;
  }
}

function readStored(): TicketHistoryItem[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const seen = new Set<string>();
    const cleaned: TicketHistoryItem[] = [];
    for (const value of parsed) {
      if (!value || typeof value !== "object") continue;
      const code = normalizeCode((value as any).code);
      const savedAt = Number((value as any).savedAt);
      if (!code || !Number.isFinite(savedAt) || savedAt + TTL_MS < now) continue;
      if (seen.has(code)) continue;
      seen.add(code);
      cleaned.push({
        code,
        service: String((value as any).service || "").trim(),
        created_at: String((value as any).created_at || "").trim(),
        savedAt,
      });
      if (cleaned.length >= MAX_ITEMS) break;
    }
    return cleaned;
  } catch {
    return [];
  }
}

function writeStored(items: TicketHistoryItem[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // localStorage penuh / diblokir: fitur riwayat dilewati, aplikasi tetap jalan.
  }
}

/** Muat riwayat yang masih valid; item kedaluwarsa otomatis dibuang. */
export function loadTicketHistory(): TicketHistoryItem[] {
  return readStored();
}

/**
 * Simpan/perbarui satu tiket. Tiket dengan kode yang sama dipindahkan ke atas,
 * bukan diduplikasi. Hanya metadata aman yang disimpan.
 */
export function rememberTicket(input: TicketHistoryInput): TicketHistoryItem[] {
  const code = normalizeCode(input.ticket_code || input.kode_tiket);
  if (!code) return loadTicketHistory();

  const now = Date.now();
  const previous = loadTicketHistory().filter((item) => item.code !== code);
  const next: TicketHistoryItem[] = [
    {
      code,
      service: String(input.jenis_dokumen || "").trim(),
      created_at: String(input.created_at || "").trim(),
      savedAt: now,
    },
    ...previous,
  ].slice(0, MAX_ITEMS);

  writeStored(next);
  return next;
}

/** Hapus seluruh riwayat tiket di perangkat ini. */
export function clearTicketHistory(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
