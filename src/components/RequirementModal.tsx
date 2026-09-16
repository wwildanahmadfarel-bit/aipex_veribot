import React from "react";
import { ServiceCatalogItem } from "../types";

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
  if (!isOpen || !service) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1c30]/70 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white max-w-lg w-full rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#2563eb] flex items-center justify-center shrink-0 shadow-xs">
              <span className="material-symbols-outlined text-[24px]">assignment_turned_in</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 font-heading">Syarat Kelengkapan</h3>
              <p className="text-xs text-[#2563eb] font-semibold">{service.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 flex flex-col gap-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            Sebelum mendatangi loket atau mengunggah berkas secara mandiri, pastikan Anda telah
            menyiapkan dokumen asli berikut:
          </p>

          <div className="space-y-3">
            {service.requirements.map((req, idx) => (
              <div
                key={idx}
                className="flex items-start justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200/60 gap-3"
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={`material-symbols-outlined text-[20px] mt-0.5 ${
                      req.mandatory ? "text-emerald-600" : "text-[#2563eb]"
                    }`}
                  >
                    {req.mandatory ? "check_circle" : "info"}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-slate-800">{req.title}</span>
                    <span className="text-[11px] text-slate-500 mt-0.5">{req.description}</span>
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase whitespace-nowrap ${
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

          <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-3 text-xs text-blue-800 flex items-start gap-2">
            <span className="material-symbols-outlined text-blue-600 text-[18px] shrink-0 mt-0.5">
              verified
            </span>
            <span>
              <strong>Jalur Fast-Track:</strong> Berkas yang lolos pra-pemeriksaan AI VeriBot akan
              langsung diproses petugas tanpa formulir tambahan di loket!
            </span>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onStartService(service.title);
            }}
            className="px-5 py-2.5 rounded-lg bg-[#2563eb] text-white font-semibold text-xs hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            <span>Mulai Pengajuan Mandiri</span>
            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
};
