import type { ServiceDownload } from "../types";

interface DownloadableFormsProps {
  downloads?: ServiceDownload[];
  /** Versi ringkas untuk wizard Langkah 2. */
  compact?: boolean;
}

function PdfBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-700 border border-red-200">
      <span className="material-symbols-outlined text-[12px]">picture_as_pdf</span>
      PDF
    </span>
  );
}

function DownloadButton({ form, compact = false }: { form: ServiceDownload; compact?: boolean }) {
  return (
    <a
      href={form.file}
      download={form.fileName}
      aria-label={`Unduh ${form.title}`}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#2563eb] px-3 font-bold text-white transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
        compact ? "min-h-[44px] text-[11px]" : "min-h-[44px] text-xs"
      }`}
    >
      <span className="material-symbols-outlined text-[16px]">download</span>
      Unduh
    </a>
  );
}

export function DownloadableForms({ downloads = [], compact = false }: DownloadableFormsProps) {
  if (downloads.length === 0) {
    if (compact) return null;
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4 text-xs text-slate-600">
        <div className="flex items-start gap-2.5">
          <span className="material-symbols-outlined mt-0.5 text-[20px] text-slate-400">info</span>
          <div>
            <p className="font-bold text-slate-800">Tidak ada formulir unduhan khusus.</p>
            <p className="mt-1 leading-relaxed">
              Siapkan dokumen asli/fotokopi sesuai daftar syarat di atas. Petugas loket akan
              membantu bila ada berkas tambahan yang perlu dilengkapi.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined mt-0.5 text-[18px] text-amber-700">download</span>
          <div className="min-w-0">
            <p className="font-bold text-amber-950">Formulir pendukung — unduh jika berlaku</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
              Formulir ini tidak wajib diunggah. Unduh, isi, lalu bawa/dilampirkan sesuai kondisi Anda.
            </p>
          </div>
        </div>
        <ul className="mt-2.5 space-y-2">
          {downloads.map((form) => (
            <li
              key={form.code}
              className="flex flex-col gap-2 rounded-lg border border-amber-200/80 bg-white/80 p-2.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[11px] font-bold text-slate-900">{form.title}</p>
                  <PdfBadge />
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-slate-600">{form.condition}</p>
              </div>
              <div className="shrink-0">
                <DownloadButton form={form} compact />
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <span className="material-symbols-outlined text-[20px]">download_for_offline</span>
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-900">Formulir yang Perlu Diunduh</h4>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
              Unduh hanya formulir yang sesuai kondisi Anda. Formulir ini bukan slot unggahan wajib.
            </p>
          </div>
        </div>
        <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-amber-700">
          Wajib jika berlaku
        </span>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {downloads.map((form) => (
          <div
            key={form.code}
            className="flex flex-col gap-2.5 rounded-xl border border-amber-200/80 bg-white p-3 shadow-2xs"
          >
            <div className="flex items-start gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                <span className="material-symbols-outlined text-[20px]">picture_as_pdf</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold leading-snug text-slate-900">{form.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{form.condition}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <PdfBadge />
                  <span className="text-[10px] text-slate-500">{form.size}</span>
                </div>
              </div>
            </div>
            <div className="mt-auto flex items-center gap-2">
              <DownloadButton form={form} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-amber-200/70 pt-2.5">
        <p className="text-[10px] text-amber-800">
          Formulir resmi disiapkan sebagai panduan. Beberapa formulir bersifat alternatif — pilih
          sesuai kondisi Anda.
        </p>
      </div>
    </section>
  );
}
