// Label & parsing bulan — SATU sumber untuk dashboard admin dan ekspor Excel.
// Sengaja tanpa dependency agar bisa dimuat di chunk Excel tanpa menarik library lain.

export const BULAN_LABEL = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
] as const;

export const BULAN_PANJANG = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

export interface TicketMonth {
  y: number;
  m: number;
}

/** Parse tanggal campuran: ISO ("2026-09-08T07:23") dan "YYYY-MM-DD HH:mm". */
export function parseTicketMonth(raw: unknown): TicketMonth | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const d = new Date(s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s);
  if (!Number.isNaN(d.getTime())) return { y: d.getFullYear(), m: d.getMonth() };
  const m = /(\d{4})-(\d{2})/.exec(s);
  if (m) {
    const mm = Number(m[2]);
    if (mm >= 1 && mm <= 12) return { y: Number(m[1]), m: mm - 1 };
  }
  return null;
}

/** Format tanggal untuk laporan (tanpa detik, waktu lokal). */
export function formatTicketDate(raw: unknown): string {
  if (!raw) return "-";
  const s = String(raw).trim();
  const d = new Date(s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s);
  if (Number.isNaN(d.getTime())) return s || "-";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isApprovedStatus(raw: unknown): boolean {
  return ["DISETUJUI", "APPROVED"].includes(String(raw || "").toUpperCase().trim());
}

export function isRejectedStatus(raw: unknown): boolean {
  return ["DITOLAK", "REJECTED", "TIDAK_VALID"].includes(
    String(raw || "").toUpperCase().trim()
  );
}

export function isPendingStatus(raw: unknown): boolean {
  return !isApprovedStatus(raw) && !isRejectedStatus(raw);
}
