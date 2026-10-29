import React, { useEffect, useRef } from "react";
import { ServiceCatalogItem } from "../types";
import { DownloadableForms } from "./DownloadableForms";

interface RequirementModalProps {
  service: ServiceCatalogItem | null;
  isOpen: boolean;
  onClose: () => void;
  onStartService: (serviceName: string) => void;
}

export const RequirementModal: React.FC<RequirementModalProps> = ({
  service,
  isOpen,
  onClose,
  onStartService,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape menutup modal, Tab berputar di dalam dialog, fokus kembali ke pemicu.
  useEffect(() => {
    if (!isOpen || !service) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [isOpen, service]);

  if (!isOpen || !service) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-[#1E293B]/70 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="requirement-modal-title"
        className="bg-white w-full max-w-lg max-h-[92dvh] sm:max-h-[85dvh] rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#2563eb] flex items-center justify-center shrink-0 shadow-xs">
              <span className="material-symbols-outlined text-[24px]">assignment_turned_in</span>
            </div>
            <div className="min-w-0">
              <h3
                id="requirement-modal-title"
                className="text-base sm:text-lg font-bold text-slate-900 font-heading"
              >
                Syarat Kelengkapan
              </h3>
              <p className="text-xs text-[#2563eb] font-semibold truncate">{service.title}</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup syarat kelengkapan"
            className="w-11 h-11 shrink-0 rounded-full bg-slate-100 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Modal Content — scrollable di layar kecil */}
        <div className="p-4 sm:p-6 flex flex-col gap-4 overflow-y-auto overscroll-contain">
          <p className="text-sm text-slate-600 leading-relaxed">
            Sebelum mendatangi loket atau mengunggah berkas secara mandiri, pastikan Anda telah
            menyiapkan dokumen asli berikut. Seluruh dokumen bertanda{" "}
            <strong className="text-red-700">WAJIB</strong> harus diunggah satu per satu pada
            Langkah 2 pengajuan — tanpa lengkap, pemindaian AI tidak dapat dimulai.
          </p>

          <div className="space-y-3">
            {service.requirements.map((req, idx) => (
              <div
                key={idx}
                className="flex items-start justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200/60 gap-3"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <span
                    className={`material-symbols-outlined text-[20px] mt-0.5 shrink-0 ${
                      req.mandatory ? "text-emerald-600" : "text-[#2563eb]"
                    }`}
                  >
                    {req.mandatory ? "check_circle" : "info"}
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold text-[#0F172A]">{req.title}</span>
                    <span className="text-[11px] text-slate-500 mt-0.5">{req.description}</span>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase whitespace-nowrap shrink-0 ${
                    req.mandatory
                      ? "bg-red-50 text-red-700 border border-red-200"
                      : "bg-blue-50 text-blue-700 border border-blue-200"
                  }`}
                >
                  {req.mandatory ? "Wajib" : "Opsional"}
                </span>
              </div>
            ))}
          </div>

          <DownloadableForms downloads={service.downloads} />

          <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-3 text-xs text-blue-800 flex items-start gap-2">
            <span className="material-symbols-outlined text-blue-600 text-[18px] shrink-0 mt-0.5">
              verified
            </span>
            <span>
              <strong>Tiket QR Antrean:</strong> Berkas yang lolos pra-pemeriksaan AI VeriBot (skor ≥70%)
              akan langsung diproses petugas tanpa formulir tambahan di loket. Skor di bawah 70% tetap
              mendapat tiket QR dengan label <strong>Verifikasi Loket</strong>.
            </span>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3 sm:p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onStartService(service.title);
            }}
            className="min-h-11 px-4 sm:px-5 py-2.5 rounded-lg bg-[#2563eb] text-white font-semibold text-xs hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <span>Mulai Pengajuan Mandiri</span>
            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
};
