import React, { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { Ticket } from "../types";

interface TicketStatusModalProps {
  ticket: Ticket | null;
  isOpen: boolean;
  onClose: () => void;
}

export const TicketStatusModal: React.FC<TicketStatusModalProps> = ({ ticket, isOpen, onClose }) => {
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (ticket && qrCanvasRef.current) {
      QRCode.toCanvas(
        qrCanvasRef.current,
        `AIPEX-VERIBOT:${ticket.ticket_code}|NIK:${ticket.nik_encrypted}|STATUS:${ticket.status_verifikasi}`,
        {
          width: 140,
          margin: 1,
          color: {
            dark: "#0b1c30",
            light: "#ffffff",
          },
        }
      );
    }
  }, [ticket]);

  if (!isOpen || !ticket) return null;

  const isApproved = ticket.status_verifikasi === "APPROVED";
  const isPending = ticket.status_verifikasi === "PENDING";
  const isRevision = ticket.status_verifikasi === "REVISI" || ticket.status_verifikasi === "REJECTED";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1c30]/70 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white max-w-lg w-full rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100"
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
                : isPending
                ? "bg-blue-50 border-blue-200 text-blue-900"
                : "bg-amber-50 border-amber-200 text-amber-900"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[24px] shrink-0 mt-0.5 ${
                isApproved ? "text-emerald-600" : isPending ? "text-[#2563eb]" : "text-amber-600"
              }`}
            >
              {isApproved ? "check_circle" : isPending ? "hourglass_empty" : "warning"}
            </span>
            <div className="flex flex-col">
              <span className="font-bold text-xs uppercase tracking-wide">
                {isApproved
                  ? "Berkas Disetujui (Siap Cetak / Pengambilan)"
                  : isPending
                  ? "Menunggu Panggilan Loket (Fast-Track)"
                  : "Perlu Tindak Lanjut / Perbaikan"}
              </span>
              <p className="text-xs mt-1 leading-relaxed">
                {ticket.catatan_petugas ||
                  ticket.catatan_ai ||
                  "Berkas telah tercatat dalam sistem administrasi kependudukan Kelurahan Sukamaju."}
              </p>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/60 text-xs">
            <div>
              <span className="text-[11px] text-slate-500 block">Nama Pemohon:</span>
              <strong className="text-slate-800 text-sm">{ticket.nama_warga}</strong>
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

          {/* QR & Fast Track Badge */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                KARTU TIKET FAST-TRACK
              </span>
              <div className="flex items-center gap-2">
                <span className="font-code-num text-lg font-bold text-emerald-600">
                  {ticket.skor_ai}%
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold text-[10px] border border-emerald-200">
                  Lulus AI Fast-Track
                </span>
              </div>
              <span className="text-[11px] text-slate-500 max-w-[240px]">
                Tunjukkan QR Code ini ke layar verifikator meja loket kelurahan.
              </span>
            </div>
            <div className="p-1 rounded-lg border border-slate-200 bg-white shadow-xs shrink-0">
              <canvas ref={qrCanvasRef}></canvas>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            UU PDP: Data dienkripsi aman Dukcapil
          </span>
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
  );
};
