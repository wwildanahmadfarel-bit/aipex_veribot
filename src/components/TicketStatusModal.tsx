import React, { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { Ticket } from "../types";
import { buildTicketQrText, downloadTicketQrPng } from "../lib/ticketQr";
import { getTicketStatusInfo } from "../lib/ticketStatus";
import { buildTicketFollowUp } from "../lib/recommendations";
import { formatTicketDate } from "../lib/monthLabels";
import { RecommendationCard } from "./RecommendationCard";

interface TicketStatusModalProps {
  ticket: Ticket | null;
  isOpen: boolean;
  onClose: () => void;
}

const TIMELINE_LABELS: Record<string, string> = {
  DITERIMA: "Tiket diterbitkan",
  PENDING: "Tiket diterbitkan",
  MENUNGGU: "Menunggu verifikasi petugas",
  BERHASIL: "Lolos pra-pemeriksaan",
  BURAM: "Diterima — verifikasi loket",
  REVISI: "Diterima — verifikasi loket",
  PERLU_PERBAIKAN: "Diminta perbaikan berkas",
  DISETUJUI: "Disetujui petugas",
  APPROVED: "Disetujui petugas",
  DITOLAK: "Ditolak petugas",
  REJECTED: "Ditolak petugas",
  TIDAK_VALID: "Ditolak — bukan dokumen kependudukan",
};

function timelineLabel(status: unknown): string {
  const key = String(status || "").toUpperCase().trim();
  return TIMELINE_LABELS[key] || key || "Status diperbarui";
}

function timelineVisual(status: unknown): { icon: string; className: string } {
  const key = String(status || "").toUpperCase().trim();
  if (["DISETUJUI", "APPROVED"].includes(key)) {
    return { icon: "check_circle", className: "bg-emerald-100 text-emerald-600 border-emerald-200" };
  }
  if (["DITOLAK", "REJECTED", "TIDAK_VALID"].includes(key)) {
    return { icon: "cancel", className: "bg-red-100 text-red-600 border-red-200" };
  }
  if (["PERLU_PERBAIKAN", "REVISI", "BURAM"].includes(key)) {
    return { icon: "build", className: "bg-amber-100 text-amber-600 border-amber-200" };
  }
  if (["MENUNGGU", "BERHASIL"].includes(key)) {
    return { icon: "hourglass_empty", className: "bg-blue-100 text-blue-600 border-blue-200" };
  }
  return { icon: "flag", className: "bg-slate-100 text-slate-600 border-slate-200" };
}

export const TicketStatusModal: React.FC<TicketStatusModalProps> = ({ ticket, isOpen, onClose }) => {
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (ticket && qrCanvasRef.current) {
      QRCode.toCanvas(
        qrCanvasRef.current,
        buildTicketQrText(ticket),
        {
          width: 160,
          margin: 1,
          color: {
            dark: "#1E293B",
            light: "#ffffff",
          },
        }
      );
    }
  }, [ticket]);

  if (!isOpen || !ticket) return null;

  // Normalisasi status dari semua sumber: frontend (APPROVED/PENDING/REVISI)
  // + backend admin (BERHASIL/BURAM/DISETUJUI/DITOLAK/PERLU_PERBAIKAN).
  // + public API (MENUNGGU for PENDING). BERHASIL ≠ disetujui: masih menunggu petugas.
  const rawStatus = String(ticket.status_verifikasi || "").toUpperCase().trim();
  const statusInfo = getTicketStatusInfo(ticket);
  const isApproved = statusInfo.isApproved;
  const isRejected = statusInfo.isRejected;
  const isLulusAI = statusInfo.lulusPra;
  const riwayat =
    ticket.riwayat && ticket.riwayat.length > 0
      ? ticket.riwayat
      : [{ status: "DITERIMA", created_at: ticket.created_at }];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1E293B]/70 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* Cetak Resi: hanya kartu status yang tampil di kertas. */}
      <style>{`@media print { body * { visibility: hidden !important; } #ticketStatusPrintCard, #ticketStatusPrintCard * { visibility: visible !important; } #ticketStatusPrintCard { position: absolute !important; left: 0; top: 0; width: 100% !important; max-width: 100% !important; max-height: none !important; overflow: visible !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; } #ticketStatusPrintCard .no-print { display: none !important; } }`}</style>
      <div
        id="ticketStatusPrintCard"
        className="bg-white max-w-lg w-full max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[#2563eb] text-[24px]">verified</span>
            <div>
              <h3 className="text-base font-bold text-slate-900 font-heading">
                Status Berkas Mandiri
              </h3>
              <p className="font-code-num text-xs text-[#2563eb] font-semibold">
                {ticket.ticket_code}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-colors cursor-pointer shadow-2xs"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-4">
          {/* Status Alert Banner */}
          <div
            className={`p-4 rounded-xl border flex items-start gap-3 ${
              isApproved
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : isRejected
                ? "bg-red-50 border-red-200 text-red-900"
                : isLulusAI
                ? "bg-blue-50 border-blue-200 text-blue-900"
                : "bg-amber-50 border-amber-200 text-amber-900"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[24px] shrink-0 mt-0.5 ${
                isApproved ? "text-emerald-600" : isRejected ? "text-red-500" : isLulusAI ? "text-[#2563eb]" : "text-amber-500"
              }`}
            >
              {isApproved ? "check_circle" : isRejected ? "cancel" : isLulusAI ? "hourglass_empty" : "warning"}
            </span>
            <div className="flex flex-col">
              <span className="font-bold text-xs uppercase tracking-wide">
                {isApproved
                  ? "Berkas Disetujui (Siap Cetak / Pengambilan)"
                  : isRejected
                  ? "Berkas Ditolak Petugas"
                  : isLulusAI
                  ? "Diterima — Lolos Pra-Pemeriksaan (Menunggu Petugas)"
                  : "Diterima — Verifikasi Loket"}
              </span>
              <p className="text-xs mt-1 leading-relaxed">
                {ticket.catatan_petugas ||
                  ticket.catatan_ai ||
                  "Berkas telah tercatat dalam sistem administrasi kependudukan Kelurahan Sukamaju."}
              </p>
            </div>
          </div>

          {/* Tindak lanjut kontekstual sesuai status tiket. */}
          {(() => {
            const tl = buildTicketFollowUp(rawStatus);
            return tl ? (
              <RecommendationCard tindakLanjut={[tl]} title="Rekomendasi Tindak Lanjut" compact />
            ) : null;
          })()}

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/60 text-xs">
            <div>
              <span className="text-[11px] text-slate-500 block">Nama Pemohon:</span>
              <strong className="text-[#0F172A] text-sm">{ticket.nama_warga}</strong>
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">NIK Terenkripsi:</span>
              <span className="font-code-num text-slate-700 font-semibold">{ticket.nik_encrypted}</span>
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">Layanan:</span>
              <span className="text-slate-700 font-medium">{ticket.jenis_dokumen}</span>
            </div>
            <div>
              <span className="text-[11px] text-slate-500 block">Waktu Registrasi:</span>
              <span className="font-code-num text-slate-700">{ticket.created_at}</span>
            </div>
          </div>

          {/* Riwayat status — aman untuk publik: tanpa identitas petugas. */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                Riwayat Status
              </span>
              <span className="text-[10px] text-slate-400">{riwayat.length} langkah</span>
            </div>
            <ol className="space-y-3" aria-label="Riwayat status tiket">
              {riwayat.map((item, idx) => {
                const visual = timelineVisual(item.status);
                const isLast = idx === riwayat.length - 1;
                return (
                  <li key={`${item.status}-${item.created_at}-${idx}`} className="relative pl-8">
                    {!isLast && (
                      <span
                        aria-hidden="true"
                        className="absolute left-[11px] top-7 bottom-0 w-px bg-slate-200"
                      />
                    )}
                    <span
                      className={`absolute left-0 top-0 w-6 h-6 rounded-full border flex items-center justify-center ${visual.className}`}
                    >
                      <span className="material-symbols-outlined text-[14px]">{visual.icon}</span>
                    </span>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span
                        className={`text-xs font-bold ${
                          isLast ? "text-[#0F172A]" : "text-slate-600"
                        }`}
                      >
                        {timelineLabel(item.status)}
                      </span>
                      <span className="text-[10px] text-slate-400 font-code-num">
                        {formatTicketDate(item.created_at)}
                      </span>
                    </div>
                    {item.catatan && (
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                        {item.catatan}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {/* QR & status verifikasi */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                KARTU TIKET ANTREAN
              </span>
              <div className="flex items-center gap-2">
                <span
                  className={`font-code-num text-lg font-bold ${
                    isApproved || isLulusAI
                      ? "text-emerald-600"
                      : isRejected
                      ? "text-red-600"
                      : "text-amber-600"
                  }`}
                >
                  {ticket.skor_ai}%
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full font-semibold text-[10px] border ${
                    isApproved || isLulusAI
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : isRejected
                      ? "bg-red-50 text-red-700 border-red-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}
                >
                  {isApproved
                    ? "Disetujui Petugas"
                    : isRejected
                    ? statusInfo.verifikasi
                    : isLulusAI
                    ? "Lolos Pra-Pemeriksaan"
                    : "Verifikasi Loket"}
                </span>
              </div>
              <span className="text-[11px] text-slate-500 sm:max-w-[240px]">
                Tunjukkan QR Code ini ke layar verifikator meja loket kelurahan.
              </span>
              <span className="text-[10px] text-slate-400 sm:max-w-[240px]">
                QR ini tiket antrean, bukan bukti dokumen sah.
              </span>
            </div>
            <div className="p-1 rounded-lg border border-slate-200 bg-white shadow-xs shrink-0 self-center sm:self-auto">
              <canvas ref={qrCanvasRef}></canvas>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="no-print p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] text-slate-500">
            UU PDP: Data dienkripsi aman Dukcapil
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                downloadTicketQrPng(ticket).catch(() => alert('Gagal mengunduh QR PNG.'));
              }}
              className="px-4 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              <span>QR PNG</span>
            </button>
            <button
              onClick={() => window.print()}
              className="px-4 py-2 rounded-lg bg-[#2563eb] hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              <span>Cetak Resi Tiket</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
