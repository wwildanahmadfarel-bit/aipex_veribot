import React, { useEffect } from "react";
import { LogOut, X } from "lucide-react";

interface ExitDashboardConfirmModalProps {
  isOpen: boolean;
  officerName?: string;
  destLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ExitDashboardConfirmModal: React.FC<ExitDashboardConfirmModalProps> = ({
  isOpen,
  officerName,
  destLabel = "Portal Warga",
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1E293B]/70 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Konfirmasi keluar dashboard"
    >
      <div
        className="bg-white max-w-md w-full rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
              <LogOut className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Keluar dari Panel Petugas?</h3>
              <p className="text-xs text-slate-500">Tujuan: {destLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Batal"
            className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <p className="text-sm text-slate-600 leading-relaxed">
            Anda sedang login{officerName ? ` sebagai ${officerName}` : ""} di dashboard petugas.
            Pindah ke {destLabel} <strong>tidak menghapus sesi</strong> — Anda bisa kembali via
            Login Petugas tanpa memasukkan kode ulang (selama browser tidak di-clear).
          </p>
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors cursor-pointer"
            >
              Batal (Tetap di Dashboard)
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              Ya, ke {destLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExitDashboardConfirmModal;
