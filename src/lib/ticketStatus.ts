// Status tiket & verifikasi — SATU sumber untuk QR, badge UI, dashboard, dan Excel.
// Tanpa dependency agar aman dimuat di chunk ekspor Excel (tidak menarik lib QR).

export type TicketStatusTone = "green" | "amber" | "red" | "blue";

export interface TicketStatusInput {
  status_verifikasi?: string;
  status_ai?: string;
  skor_ai?: number;
  skor_kejelasan?: number;
}

export interface TicketStatusInfo {
  /** Status tiket: DITERIMA (masuk antrean), DISETUJUI, atau DITOLAK. */
  statusTiket: "DITERIMA" | "DISETUJUI" | "DITOLAK";
  /** Status verifikasi: lolos pra-pemeriksaan, verifikasi loket, atau keputusan petugas. */
  verifikasi: string;
  tone: TicketStatusTone;
  isApproved: boolean;
  isRejected: boolean;
  /** Lolos pra-pemeriksaan AI (skor >= 70) atau sudah disetujui petugas. */
  lulusPra: boolean;
  skor: number | null;
}

/**
 * Aturan label final:
 * - DISETUJUI hanya setelah petugas menyetujui.
 * - DITERIMA — LOLOS PRA-PEMERIKSAAN untuk dokumen kependudukan skor >= 70.
 * - DITERIMA — VERIFIKASI LOKET untuk dokumen kependudukan skor < 70 / buram.
 * - DITOLAK untuk bukan dokumen kependudukan atau keputusan petugas.
 */
export function getTicketStatusInfo(t: TicketStatusInput): TicketStatusInfo {
  const raw = String(t.status_verifikasi || "").toUpperCase().trim();
  const skorRaw = Number(t.skor_ai ?? t.skor_kejelasan ?? NaN);
  const skor = Number.isFinite(skorRaw) ? skorRaw : null;

  if (raw === "DISETUJUI" || raw === "APPROVED") {
    return {
      statusTiket: "DISETUJUI",
      verifikasi: "DISETUJUI PETUGAS",
      tone: "green",
      isApproved: true,
      isRejected: false,
      lulusPra: true,
      skor,
    };
  }

  if (raw === "DITOLAK" || raw === "REJECTED" || raw === "TIDAK_VALID") {
    return {
      statusTiket: "DITOLAK",
      verifikasi: raw === "TIDAK_VALID" ? "BUKAN DOKUMEN KEPENDUDUKAN" : "DITOLAK PETUGAS",
      tone: "red",
      isApproved: false,
      isRejected: true,
      lulusPra: false,
      skor,
    };
  }

  const ditandaiBuram = ["BURAM", "REVISI", "PERLU_PERBAIKAN"].includes(raw);
  const aiLulus = String(t.status_ai || "").toUpperCase().trim() === "LULUS";
  const lulusPra =
    !ditandaiBuram &&
    (skor !== null ? skor >= 70 : raw === "BERHASIL" || aiLulus);

  return {
    statusTiket: "DITERIMA",
    verifikasi: lulusPra ? "LOLOS PRA-PEMERIKSAAN" : "VERIFIKASI LOKET",
    tone: lulusPra ? "green" : "amber",
    isApproved: false,
    isRejected: false,
    lulusPra,
    skor,
  };
}

/** NIK selalu disamarkan untuk tampilan/ekspor default (UU PDP). */
export function maskNik(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text || text === "—" || text === "-") return "-";
  if (/\*/.test(text)) return text;
  const digits = text.replace(/\D/g, "");
  if (!digits) return text;
  if (digits.length >= 12) return `${digits.slice(0, 6)}******${digits.slice(-4)}`;
  return `${digits.slice(0, 3)}***${digits.slice(-2)}`;
}
