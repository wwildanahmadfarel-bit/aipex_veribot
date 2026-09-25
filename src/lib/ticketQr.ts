// Payload QR tiket — teks multi-baris berlabel agar hasil scan HP langsung
// terbaca rapi tanpa internet. NIK SELALU versi tersamar (UU PDP).
// Satu-satunya sumber payload untuk InteractiveWizard, TicketStatusModal,
// DocumentScanner (layar + cetak). Tidak ada parser format lama di repo.

import QRCode from "qrcode";

export interface QrTicketInput {
  ticket_code?: string;
  kode_tiket?: string;
  nama_warga?: string;
  nama?: string;
  nik_encrypted?: string;
  nik?: string;
  nik_raw?: string;
  jenis_dokumen?: string;
  skor_ai?: number;
  skor_kejelasan?: number;
  status_ai?: string;
  status_verifikasi?: string;
  created_at?: string;
}

/** Samakan dengan label status UI (TicketStatusModal). */
function qrStatusLabel(raw: unknown): string {
  const s = String(raw || "").toUpperCase().trim();
  if (s === "APPROVED" || s === "DISETUJUI" || s === "BERHASIL") return "DISETUJUI";
  if (s === "REJECTED" || s === "DITOLAK" || s === "TIDAK_VALID") return "DITOLAK";
  if (s === "REVISI" || s === "BURAM" || s === "PERLU_PERBAIKAN") return "PERLU PERBAIKAN";
  if (s === "PENDING") return "MENUNGGU VERIFIKASI";
  return s || "-";
}

function pickCode(t: QrTicketInput): string {
  return String(t.ticket_code || t.kode_tiket || "-").trim() || "-";
}

function pickNama(t: QrTicketInput): string {
  const n = String(t.nama_warga || t.nama || "").trim();
  return n && !/tidak terbaca|tidak terdeteksi/i.test(n) ? n : "-";
}

/** NIK mask saja — tidak pernah full 16 digit di QR (tiket bisa tercecer). */
function pickNikMask(t: QrTicketInput): string {
  const masked = String(t.nik_encrypted || "").trim();
  if (masked && /\*/.test(masked)) return masked;
  const raw = String(t.nik || t.nik_raw || "").replace(/\D/g, "");
  if (raw.length >= 12) return `${raw.slice(0, 6)}******${raw.slice(-4)}`;
  if (raw) return `${raw.slice(0, 3)}***${raw.slice(-2)}`;
  return "-";
}

function pickSkor(t: QrTicketInput): string {
  const n = Number(t.skor_ai ?? t.skor_kejelasan ?? NaN);
  if (!Number.isFinite(n)) return "-";
  const lulus = String(t.status_ai || "").toUpperCase() === "LULUS" || n >= 70;
  return `${Math.round(n)}%${lulus ? " (Lulus Fast-Track)" : " (Perlu Verifikasi)"}`;
}

export function buildTicketQrText(t: QrTicketInput): string {
  return [
    "AIPEX VERIBOT - Kelurahan Sukamaju",
    `Kode Tiket : ${pickCode(t)}`,
    `Nama       : ${pickNama(t)}`,
    `NIK        : ${pickNikMask(t)}`,
    `Layanan    : ${String(t.jenis_dokumen || "-").trim() || "-"}`,
    `Skor AI    : ${pickSkor(t)}`,
    `Status     : ${qrStatusLabel(t.status_verifikasi)}`,
    `Terbit     : ${String(t.created_at || "-").trim() || "-"}`,
    "Cek status: lacak di portal AIPEX",
  ].join("\n");
}

/** Kode tiket dari teks hasil scan (payload baru maupun kode polos). */
export function extractTicketCode(scanned: string): string | null {
  const m = /TKT-[A-Za-z0-9-]+/.exec(String(scanned || ""));
  return m ? m[0].toUpperCase() : null;
}

/** Unduh QR tiket sebagai PNG (512px) — dipakai wizard, modal resi, modal admin. */
export async function downloadTicketQrPng(t: QrTicketInput): Promise<void> {
  const dataUrl = await QRCode.toDataURL(buildTicketQrText(t), {
    width: 512,
    margin: 2,
    color: { dark: "#1E293B", light: "#ffffff" },
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `tiket-${pickCode(t)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
