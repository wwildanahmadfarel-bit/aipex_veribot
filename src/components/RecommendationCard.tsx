import React from "react";
import type { RecommendationItem } from "../lib/recommendations";

interface RecommendationCardProps {
  perbaikan?: RecommendationItem[];
  tindakLanjut?: RecommendationItem[];
  title?: string;
  compact?: boolean;
  className?: string;
}

const SEVERITY_STYLE: Record<RecommendationItem["severity"], { icon: string; chip: string }> = {
  high: { icon: "error", chip: "bg-red-100 text-red-600 border-red-200" },
  medium: { icon: "build", chip: "bg-amber-100 text-amber-600 border-amber-200" },
  info: { icon: "info", chip: "bg-blue-100 text-blue-600 border-blue-200" },
  success: { icon: "check_circle", chip: "bg-emerald-100 text-emerald-600 border-emerald-200" },
};

/** Kartu "Rekomendasi Perbaikan & Tindak Lanjut" — dipakai lintas komponen. */
export const RecommendationCard: React.FC<RecommendationCardProps> = ({
  perbaikan = [],
  tindakLanjut = [],
  title = "Rekomendasi Perbaikan & Tindak Lanjut",
  compact = false,
  className = "",
}) => {
  if (perbaikan.length === 0 && tindakLanjut.length === 0) return null;
  return (
    <div
      className={`rounded-xl border border-indigo-200 bg-indigo-50/70 overflow-hidden text-left ${className}`}
    >
      <div
        className={`${
          compact ? "px-3 py-2" : "px-4 py-2.5"
        } bg-indigo-100/80 border-b border-indigo-200 flex items-center gap-2`}
      >
        <span className="material-symbols-outlined text-[18px] text-indigo-600">
          tips_and_updates
        </span>
        <span className="text-[11px] sm:text-xs font-bold text-indigo-900 uppercase tracking-wide">
          {title}
        </span>
      </div>
      <div className={`flex flex-col ${compact ? "gap-2 p-3" : "gap-2.5 p-4"}`}>
        {perbaikan.length > 0 && (
          <ul className="flex flex-col gap-2">
            {perbaikan.map((item, i) => {
              const st = SEVERITY_STYLE[item.severity] || SEVERITY_STYLE.info;
              return (
                <li key={`rec-p-${i}`} className="flex items-start gap-2.5">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${st.chip}`}
                  >
                    <span className="material-symbols-outlined text-[14px]">{st.icon}</span>
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#0F172A] leading-snug">{item.title}</p>
                    <p className="text-[11px] text-slate-600 leading-snug mt-0.5">{item.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {tindakLanjut.length > 0 && (
          <div className="flex flex-col gap-2">
            {tindakLanjut.map((item, i) => (
              <div
                key={`rec-t-${i}`}
                className="flex items-start gap-2.5 rounded-lg bg-white/80 border border-indigo-100 px-3 py-2.5"
              >
                <span className="material-symbols-outlined text-[18px] text-indigo-600 mt-px">
                  directions_walk
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">
                    Tindak lanjut
                  </p>
                  <p className="text-xs font-bold text-[#0F172A] leading-snug">{item.title}</p>
                  <p className="text-[11px] text-slate-600 leading-snug mt-0.5">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
