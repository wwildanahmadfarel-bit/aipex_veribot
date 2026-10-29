import { useEffect, useRef } from "react";
import { BULAN_LABEL } from "../lib/monthLabels";

export interface MonthlyRekapRow {
  masuk: number;
  disetujui: number;
  ditolak: number;
  sisa: number;
}

interface AdminMonthlyChartProps {
  monthly: MonthlyRekapRow[];
  selectedMonth: number;
  onSelectMonth: (monthIndex: number) => void;
  year: number;
  totalTahun: number;
}

const TICKS = [0, 0.25, 0.5, 0.75, 1];

function barHeight(value: number, maxBar: number): string {
  if (value <= 0 || maxBar <= 0) return "0%";
  return `${Math.min(100, (value / maxBar) * 100)}%`;
}

function DonutCard({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : null;
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const filled = pct === null ? 0 : (pct / 100) * circumference;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-col items-center text-center">
      <div
        className="relative w-24 h-24"
        role="img"
        aria-label={
          pct === null
            ? `${label}: belum ada tiket`
            : `${label}: ${pct} persen (${value} dari ${total} tiket)`
        }
      >
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#E2E8F0" strokeWidth="12" />
          {pct !== null && pct > 0 && (
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${filled} ${circumference}`}
              transform="rotate(-90 60 60)"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-extrabold text-[#0F172A] leading-none">
            {pct === null ? "—" : `${pct}%`}
          </span>
          <span className="text-[9px] text-slate-400 mt-1">
            {pct === null ? "Belum ada" : `${value}/${total}`}
          </span>
        </div>
      </div>
      <p className="mt-2 text-[11px] font-bold text-slate-700 leading-tight">{label}</p>
      <p className="text-[10px] text-slate-400 leading-tight">
        {pct === null ? "Belum ada tiket" : `${value} dari ${total} tiket`}
      </p>
    </div>
  );
}

export default function AdminMonthlyChart({
  monthly,
  selectedMonth,
  onSelectMonth,
  year,
  totalTahun,
}: AdminMonthlyChartProps) {
  const maxValue = Math.max(
    1,
    ...monthly.map((r) => Math.max(r.disetujui, r.sisa, r.ditolak))
  );
  // Skala bulat agar sumbu Y mudah dibaca (0, 3, 6, 9, 12 — bukan 2,5).
  const step = Math.max(1, Math.ceil(maxValue / 4));
  const maxBar = step * 4;
  const tickLabels = TICKS.map((t) => Math.round(maxBar * t));
  const bulan = monthly[selectedMonth] || { masuk: 0, disetujui: 0, ditolak: 0, sisa: 0 };

  // Di mobile chart lebih lebar dari layar. Geser otomatis ke bulan terpilih
  // agar highlight dan donut tidak "hilang" di luar layar.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const monthRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const container = scrollRef.current;
    const target = monthRefs.current[selectedMonth];
    if (!container || !target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const delta =
      targetRect.left + targetRect.width / 2 - (containerRect.left + containerRect.width / 2);
    if (Math.abs(delta) > 4) {
      container.scrollTo({ left: Math.max(0, container.scrollLeft + delta), behavior: "smooth" });
    }
  }, [selectedMonth]);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div>
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Grafik {year} (total {totalTahun})
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Klik salah satu bulan untuk melihat detail di tabel.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Disetujui
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" /> Perlu Verifikasi
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" /> Ditolak
          </span>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row gap-5">
        {/* Grouped bar chart — scroll horizontal di mobile */}
        <div className="flex-1 min-w-0">
          <div className="overflow-x-auto pb-1" role="region" aria-label={`Grafik rekap bulanan ${year}`} ref={scrollRef}>
            <div className="min-w-[640px]">
              <div className="flex gap-2">
                {/* Sumbu Y */}
                <div className="w-8 shrink-0 relative h-44 sticky left-0 z-10 bg-slate-50" aria-hidden="true">
                  <div className="absolute inset-x-0 top-4 bottom-0">
                    {tickLabels.map((label) => (
                      <span
                        key={label}
                        className="absolute right-1 -translate-y-1/2 text-[9px] font-semibold text-slate-400"
                        style={{ bottom: `${(label / maxBar) * 100}%` }}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Area batang */}
                <div className="flex-1 relative h-44">
                  <div className="absolute inset-x-0 top-4 bottom-0">
                    {TICKS.map((t) => (
                      <span
                        key={t}
                        className={`absolute inset-x-0 border-t ${
                          t === 0 ? "border-slate-300" : "border-slate-200/80"
                        }`}
                        style={{ bottom: `${t * 100}%` }}
                      />
                    ))}
                  </div>

                  <div className="absolute inset-x-0 top-4 bottom-0 flex items-end gap-1.5 sm:gap-2 px-1">
                    {monthly.map((r, i) => {
                      const selected = i === selectedMonth;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => onSelectMonth(i)}
                          aria-label={`Rekap ${BULAN_LABEL[i]}: ${r.masuk} masuk, ${r.disetujui} disetujui, ${r.sisa} perlu verifikasi, ${r.ditolak} ditolak`}
                          aria-pressed={selected}
                          title={`${BULAN_LABEL[i]} ${year}: ${r.masuk} masuk • ${r.disetujui} disetujui • ${r.sisa} perlu verifikasi • ${r.ditolak} ditolak`}
                          className={`group relative flex-1 h-full min-w-[36px] rounded-md transition cursor-pointer ${
                            selected
                              ? "bg-blue-50 ring-1 ring-blue-200"
                              : "hover:bg-slate-100/80"
                          }`}
                        >
                          <span
                            className={`absolute top-0 inset-x-0 text-center text-[9px] sm:text-[10px] font-bold leading-none ${
                              selected ? "text-blue-700" : "text-slate-500"
                            }`}
                          >
                            {r.masuk > 0 ? r.masuk : ""}
                          </span>
                          <div className="absolute inset-x-0 top-4 bottom-0 flex items-end justify-center gap-[2px] px-1">
                            <span
                              className="w-2 sm:w-2.5 rounded-t-sm bg-emerald-500 group-hover:bg-emerald-600 transition-colors"
                              style={{
                                height: barHeight(r.disetujui, maxBar),
                                minHeight: r.disetujui > 0 ? 3 : 0,
                              }}
                            />
                            <span
                              className="w-2 sm:w-2.5 rounded-t-sm bg-amber-400 group-hover:bg-amber-500 transition-colors"
                              style={{
                                height: barHeight(r.sisa, maxBar),
                                minHeight: r.sisa > 0 ? 3 : 0,
                              }}
                            />
                            <span
                              className="w-2 sm:w-2.5 rounded-t-sm bg-red-500 group-hover:bg-red-600 transition-colors"
                              style={{
                                height: barHeight(r.ditolak, maxBar),
                                minHeight: r.ditolak > 0 ? 3 : 0,
                              }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Label bulan */}
              <div className="flex gap-2 mt-1">
                <div className="w-8 shrink-0 sticky left-0 z-10 bg-slate-50" />
                <div className="flex-1 flex gap-1.5 sm:gap-2 px-1">
                  {monthly.map((_, i) => {
                    const selected = i === selectedMonth;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onSelectMonth(i)}
                        ref={(el) => {
                          monthRefs.current[i] = el;
                        }}
                        aria-label={`Pilih ${BULAN_LABEL[i]} ${year}`}
                        className={`flex-1 min-w-[36px] min-h-[28px] rounded-md text-[10px] font-semibold transition cursor-pointer ${
                          selected
                            ? "text-blue-700 bg-blue-50"
                            : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {BULAN_LABEL[i]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Dua donut gauge — data bulan terpilih */}
        <div className="grid grid-cols-2 gap-3 xl:w-[280px] shrink-0">
          <DonutCard
            label="Tingkat Persetujuan"
            value={bulan.disetujui}
            total={bulan.masuk}
            color="#10B981"
          />
          <DonutCard
            label="Tingkat Perlu Verifikasi"
            value={bulan.sisa}
            total={bulan.masuk}
            color="#F59E0B"
          />
        </div>
      </div>
    </div>
  );
}
