import React, { useEffect, useState } from "react";

interface EvalAggregate {
  batch_id: string;
  created_at?: string;
  n: number;
  precision?: number | null;
  recall?: number | null;
  f1?: number | null;
  f1_lainnya?: number | null;
  f1_buram?: number | null;
  latency_p50?: number | null;
  latency_p95?: number | null;
  cache_hit_rate?: number | null;
  notes?: string | null;
}

interface EvalDetailRow {
  file_id: string;
  jenis_true: string;
  status_true: string;
  jenis_pred: string | null;
  status_pred: string | null;
  skor: number | null;
  latency_ms: number | null;
  source: string | null;
}

function getOfficerToken(): string {
  try {
    const raw = localStorage.getItem("aipex_officer");
    if (!raw) return "";
    const o = JSON.parse(raw) as { token?: string };
    return typeof o?.token === "string" ? o.token : "";
  } catch {
    return "";
  }
}

export const TransparencyPage: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
  const [agg, setAgg] = useState<EvalAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<EvalDetailRow[]>([]);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "denied" | "empty">("idle");
  const [retention, setRetention] = useState(14);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/eval?action=results&batch_id=ycwc-001");
        const j = await res.json().catch(() => null);
        if (!alive) return;
        if (j?.data) setAgg(j.data as EvalAggregate);
        if (typeof j?.retention_days === "number") setRetention(j.retention_days);
      } catch {
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadDetail = async () => {
    const token = getOfficerToken();
    if (!token) {
      setDetailState("denied");
      return;
    }
    setDetailState("loading");
    try {
      const res = await fetch("/api/eval?action=detail&batch_id=ycwc-001", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        setDetailState("denied");
        return;
      }
      const j = await res.json().catch(() => null);
      const rows = (j?.data || []) as EvalDetailRow[];
      setDetail(rows);
      setDetailState(rows.length ? "ready" : "empty");
    } catch {
      setDetailState("denied");
    }
  };

  const pct = (v?: number | null) => (typeof v === "number" ? `${Math.round(v * 100)}%` : "—");
  const f1 = (v?: number | null) => (typeof v === "number" ? v.toFixed(2) : "—");

  return (
    <div className="flex flex-col w-full space-y-6" id="transparansiView">
      <section className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 md:p-7">
        <span className="text-[11px] font-bold text-[#2563eb] bg-blue-50 border border-blue-200 px-3 py-1 rounded-full uppercase tracking-wider">
          Transparansi AI • Tier-1 Publik
        </span>
        <h1 className="text-xl md:text-2xl font-bold text-slate-900 mt-3 font-heading">
          Metrik Evaluasi OCR — Batch ycwc-001 (100 foto asli)
        </h1>
        <p className="text-xs md:text-sm text-slate-500 mt-1 leading-relaxed">
          Agregat saja, tanpa data pribadi (UU PDP No. 27/2022). Foto asli tersimpan terenkripsi di bucket
          privat <code className="font-code-num">eval-fotos</code>, retensi {retention} hari, lalu di-purge.
          Detail per-file hanya di Tier-2 terkunci (login petugas).
        </p>

        {loading ? (
          <p className="text-xs text-slate-500 mt-4" role="status" aria-live="polite">Memuat agregat…</p>
        ) : !agg ? (
          <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 leading-relaxed">
            Belum ada run evaluasi. Setelah 100 foto terupload via <code className="font-code-num">POST /api/eval/upload</code>,
            jalankan <code className="font-code-num">python scripts/evaluate-eval-bucket.py --batch ycwc-001</code>.
            Metodologi lengkap: <code className="font-code-num">docs/METRIK-TRANSPARANSI.md</code>.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4" role="status" aria-live="polite">
            {[
              { label: "F1 Global", value: f1(agg.f1) },
              { label: "F1 LAINNYA", value: f1(agg.f1_lainnya) },
              { label: "F1 BURAM", value: f1(agg.f1_buram) },
              { label: "n foto", value: String(agg.n ?? "—") },
              { label: "Precision", value: pct(agg.precision) },
              { label: "Recall", value: pct(agg.recall) },
              { label: "Latency p50", value: agg.latency_p50 != null ? `${agg.latency_p50} ms` : "—" },
              { label: "Latency p95", value: agg.latency_p95 != null ? `${agg.latency_p95} ms` : "—" },
            ].map((k) => (
              <div key={k.label} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div className="text-[11px] text-slate-500 uppercase tracking-wide">{k.label}</div>
                <div className="text-lg font-bold text-slate-900 font-code-num">{k.value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-900 leading-relaxed">
          <strong>Contoh redacted (3 file):</strong> NIK/wajah/alamat ditutup kotak hitam, EXIF dibersihkan,
          max 800px. Letakkan di <code className="font-code-num">public/evidence/metrics/redacted-0*.jpg</code> —
          halaman ini otomatis menampilkannya bila file ada (di bawah).
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          {[1, 2, 3].map((i) => (
            <figure key={i} className="bg-slate-900 rounded-xl overflow-hidden border border-slate-200 aspect-video flex items-center justify-center relative">
              <img
                src={`/evidence/metrics/redacted-0${i}.jpg`}
                alt={`Contoh redacted ${i} (NIK dan wajah ditutup)`}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget.parentElement as HTMLElement).innerHTML =
                    `<span class="text-[11px] text-slate-400 px-3 text-center">redacted-0${i}.jpg belum diunggah<br/>(placeholder, bukan error)</span>`;
                }}
              />
            </figure>
          ))}
        </div>
      </section>

      <section className="bg-[#1E293B] text-slate-300 rounded-2xl p-5 md:p-7 border border-slate-700/60">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base md:text-lg font-bold text-white font-heading">Tier-2 Terkunci — Detail per-file (petugas)</h2>
            <p className="text-xs text-slate-400 mt-1">
              Tanpa foto, tanpa path, tanpa hash, tanpa NIK — hanya vonis vs label + skor + latency.
              Butuh sesi petugas (JWT 8 jam).
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!getOfficerToken() ? (
              <button
                type="button"
                onClick={onLogin}
                className="px-4 py-2 rounded-xl bg-white text-[#1E293B] text-xs font-bold hover:bg-slate-100 cursor-pointer"
              >
                Login Petugas untuk Audit
              </button>
            ) : (
              <button
                type="button"
                onClick={loadDetail}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 cursor-pointer"
              >
                Muat Detail Run Terbaru
              </button>
            )}
          </div>
        </div>
        {detailState === "loading" && <p className="text-xs text-slate-400 mt-3" role="status">Memuat…</p>}
        {detailState === "denied" && (
          <p className="text-xs text-amber-300 mt-3">
            Sesi petugas tidak valid. Login ulang via menu Login Petugas, lalu buka halaman ini lagi.
          </p>
        )}
        {detailState === "empty" && <p className="text-xs text-slate-400 mt-3">Belum ada prediksi run terbaru.</p>}
        {detailState === "ready" && (
          <div className="overflow-x-auto mt-3 rounded-xl border border-slate-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-slate-300">
                <tr>
                  {["File", "Jenis true→pred", "Status true→pred", "Skor", "Latency", "Source"].map((h) => (
                    <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.map((r) => (
                  <tr key={r.file_id} className="border-t border-slate-700/60">
                    <td className="px-3 py-2 font-code-num text-white">{r.file_id}</td>
                    <td className="px-3 py-2">{r.jenis_true} → {r.jenis_pred || "—"}</td>
                    <td className="px-3 py-2">{r.status_true} → {r.status_pred || "—"}</td>
                    <td className="px-3 py-2 font-code-num">{r.skor ?? "—"}</td>
                    <td className="px-3 py-2 font-code-num">{r.latency_ms != null ? `${r.latency_ms}ms` : "—"}</td>
                    <td className="px-3 py-2">{r.source || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
