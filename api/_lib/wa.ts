// Helper WhatsApp via Fonnte — AIPEX VeriBot.
// Dipakai transaksional oleh PATCH /api/admin/tickets: bila WA gagal,
// status tiket di-rollback (mode ketat, sesuai keputusan user).
// Token HANYA dari env FONNTE_TOKEN — tidak pernah ke frontend/log.

export class WaError extends Error {
  code = "WA_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "WaError";
  }
}

export function isWaEnabled(): boolean {
  return String(process.env.WA_ENABLED || "").toLowerCase() === "true";
}

function fonnteToken(): string {
  return String(process.env.FONNTE_TOKEN || "").trim();
}

/** Normalisasi nomor Indonesia ke format 628xx. Return null bila invalid. */
export function normalizeWa(raw: unknown): string | null {
  let d = String(raw || "").replace(/[\s\-().]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (/^08\d{8,12}$/.test(d)) return `62${d.slice(1)}`;
  if (/^628\d{8,12}$/.test(d)) return d;
  return null;
}

export type TicketStatus = "DISETUJUI" | "DITOLAK" | "PERLU_PERBAIKAN" | string;

export function ticketStatusMessage(args: {
  nama?: string;
  kode?: string;
  jenis?: string;
  status: TicketStatus;
  catatan?: string | null;
}): string {
  const nama = String(args.nama || "Bapak/Ibu").trim() || "Bapak/Ibu";
  const kode = String(args.kode || "-").trim() || "-";
  const jenis = String(args.jenis || "Dokumen").trim() || "Dokumen";
  const sender = String(process.env.WA_SENDER_LABEL || "Kelurahan Sukamaju").trim() || "Kelurahan Sukamaju";
  const catatan = String(args.catatan || "").trim();
  if (args.status === "DISETUJUI") {
    return (
      `Halo Sdr/i *${nama}*,\n\n` +
      `Dokumen *${jenis}* (Kode Tiket: *${kode}*) Anda telah *VALID & DISETUJUI* oleh petugas *${sender}*.\n\n` +
      `Silakan datang ke Kantor Kelurahan pada jam operasional dengan membawa berkas asli.\n\nTerima kasih.`
    );
  }
  if (args.status === "DITOLAK") {
    return (
      `Halo Sdr/i *${nama}*,\n\n` +
      `Mohon maaf, dokumen *${jenis}* (Kode Tiket: *${kode}*) Anda *DITOLAK*.\n\n` +
      `*Catatan Petugas:* ${catatan || "-"}\n\n` +
      `Untuk informasi lebih lanjut, hubungi layanan *${sender}*.`
    );
  }
  return (
    `Halo Sdr/i *${nama}*,\n\n` +
    `Dokumen *${jenis}* (Kode Tiket: *${kode}*) Anda *PERLU PERBAIKAN*.\n\n` +
    `*Catatan Petugas:* ${catatan || "Mohon unggah ulang foto dokumen yang lebih jelas."}\n\n` +
    `Layanan Bantuan: *${sender}*.`
  );
}

interface SendArgs {
  to: string;
  message: string;
  timeoutMs?: number;
}

/** Kirim 1 pesan via Fonnte. Throw WaError bila gagal (invalid token/device/kuota/timeout). */
export async function sendFonnteWa({ to, message, timeoutMs = 15_000 }: SendArgs): Promise<void> {
  const token = fonnteToken();
  if (!token) throw new WaError("FONNTE_TOKEN belum dikonfigurasi di server.");
  const target = normalizeWa(to);
  if (!target) throw new WaError("Nomor WhatsApp warga tidak valid (harap 08xxxxxxxxxx).");
  if (!message.trim()) throw new WaError("Pesan WA kosong.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = new URLSearchParams();
    body.set("target", target);
    body.set("message", message);
    body.set("countryCode", "62");
    body.set("delay", "2");
    body.set("typing", "false");

    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: token },
      body,
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => "");
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    const ok = res.ok && (json?.status === true || /success|sent|queued/i.test(text));
    if (!ok) {
      const reason =
        String(json?.reason || json?.message || text || `HTTP ${res.status}`).slice(0, 300) ||
        `HTTP ${res.status}`;
      try {
        console.warn(`[WA] Fonnte gagal ke ${target.slice(0, 6)}****: ${reason.slice(0, 200)}`);
      } catch {}
      throw new WaError(`Gagal kirim WA: ${reason}`);
    }
    try {
      console.log(`[WA] terkirim ke ${target.slice(0, 6)}****`);
    } catch {}
  } catch (err: any) {
    if (err instanceof WaError) throw err;
    const msg =
      err?.name === "AbortError" ? "Timeout 15 dtk ke Fonnte." : String(err?.message || err).slice(0, 200);
    try {
      console.warn(`[WA] error jaringan: ${msg}`);
    } catch {}
    throw new WaError(`Gagal kirim WA: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}
