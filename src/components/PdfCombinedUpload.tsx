import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Lock,
  Upload,
  X,
} from 'lucide-react';
import {
  revokePreviewUrls,
  splitPdfClientSide,
  validatePdfFile,
  type PdfPageData,
  type SplitResult,
} from '../lib/pdfSplitter';

export interface PdfSlot {
  title: string;
  mandatory: boolean;
  description: string;
}

export interface CombinedPdfReadyPage {
  base64: string;
  mimeType: string;
  docType: string;
  fileName: string;
  slotTitle: string;
}

interface PdfCombinedUploadProps {
  /** Slot dokumen wajib sesuai katalog layanan (slot pertama = dokumen utama OCR). */
  slots: PdfSlot[];
  selectedService: string;
  onPagesReady: (pages: CombinedPdfReadyPage[]) => void;
  onCancel: () => void;
  className?: string;
}

const OTHER_SLOT = '__LAINNYA__';
const OTHER_LABEL = 'Dokumen Pendukung Lainnya';

function docTypeFromSlot(title: string): string {
  const t = String(title || '').toUpperCase();
  if (t.includes('KTP') || t.includes('TANDA PENDUDUK')) return 'KTP';
  if (t.includes('KARTU KELUARGA') || /\bKK\b/.test(t)) return 'KK';
  if (t.includes('AKTA') || t.includes('AKTE')) return 'AKTA';
  return 'LAINNYA';
}

/**
 * Upload SATU PDF gabungan. PDF dipecah 100% di browser (pdf-lib) — file utuh
 * tidak pernah dikirim ke server. Setiap halaman dipetakan ke slot syarat.
 */
export const PdfCombinedUpload: React.FC<PdfCombinedUploadProps> = ({
  slots,
  selectedService,
  onPagesReady,
  onCancel,
  className,
}) => {
  const [splitResult, setSplitResult] = useState<SplitResult | null>(null);
  const [mappings, setMappings] = useState<Record<number, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [expandedPreview, setExpandedPreview] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const splitRef = useRef<SplitResult | null>(null);

  useEffect(() => {
    splitRef.current = splitResult;
  }, [splitResult]);

  // Blob URL preview harus selalu dibebaskan saat komponen unmount.
  useEffect(() => {
    return () => {
      if (splitRef.current) revokePreviewUrls(splitRef.current.pages);
    };
  }, []);

  const resetSplit = useCallback(() => {
    if (splitResult) revokePreviewUrls(splitResult.pages);
    setSplitResult(null);
    setMappings({});
    setExpandedPreview(null);
    setError('');
  }, [splitResult]);

  const handleFileSelect = useCallback(
    async (file: File) => {
      const validation = validatePdfFile(file);
      if (!validation.valid) {
        setError(validation.error || 'File PDF tidak valid.');
        return;
      }
      resetSplit();
      setIsProcessing(true);
      setError('');
      try {
        const result = await splitPdfClientSide(file);
        if (!result.pages.length) {
          throw new Error('PDF tidak memiliki halaman yang bisa diproses.');
        }
        const initial: Record<number, string> = {};
        result.pages.forEach((page, idx) => {
          initial[page.index] = slots[idx]?.title || OTHER_SLOT;
        });
        setSplitResult(result);
        setMappings(initial);
      } catch (err: any) {
        console.error('PDF split error:', err);
        setError(
          err?.message ||
            'Gagal memproses PDF. Pastikan file tidak terenkripsi, tidak korup, dan berukuran wajar.'
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [resetSplit, slots]
  );

  /** Validasi: setiap halaman punya mapping; slot wajib terisi tepat satu halaman. */
  const { pageErrors, missingMandatory, isReady } = useMemo(() => {
    const errors: Record<number, string> = {};
    const usedBy = new Map<string, number>();

    if (splitResult) {
      splitResult.pages.forEach((page) => {
        const mapped = mappings[page.index];
        if (!mapped) {
          errors[page.index] = 'Pilih jenis dokumen untuk halaman ini.';
          return;
        }
        if (mapped !== OTHER_SLOT) {
          const firstPage = usedBy.get(mapped);
          if (firstPage !== undefined) {
            errors[page.index] = `Slot "${mapped}" sudah dipakai halaman ${firstPage + 1}.`;
          } else {
            usedBy.set(mapped, page.index);
          }
        }
      });
    }

    const missing = slots
      .filter((slot) => slot.mandatory && !usedBy.has(slot.title))
      .map((slot) => slot.title);

    return {
      pageErrors: errors,
      missingMandatory: missing,
      isReady:
        !!splitResult &&
        splitResult.pages.length > 0 &&
        missing.length === 0 &&
        Object.keys(errors).length === 0,
    };
  }, [splitResult, mappings, slots]);

  const handleSubmit = () => {
    if (!splitResult || !isReady) return;
    const slotOrder = new Map<string, number>(
      slots.map((slot, idx) => [slot.title, idx] as [string, number])
    );
    const pages: CombinedPdfReadyPage[] = splitResult.pages.map((page) => {
      const slotTitle = mappings[page.index] === OTHER_SLOT ? OTHER_LABEL : mappings[page.index];
      return {
        base64: page.base64,
        mimeType: page.mimeType,
        docType: docTypeFromSlot(slotTitle),
        fileName: `${splitResult.fileName.replace(/\.pdf$/i, '')}_hal-${page.index + 1}.pdf`,
        slotTitle,
      };
    });
    pages.sort((a, b) => {
      const ia = slotOrder.has(a.slotTitle) ? slotOrder.get(a.slotTitle)! : 999;
      const ib = slotOrder.has(b.slotTitle) ? slotOrder.get(b.slotTitle)! : 999;
      return ia - ib;
    });
    onPagesReady(pages);
  };

  return (
    <div className={`space-y-4 ${className || ''}`}>
      {/* Privasi */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm text-blue-900 leading-relaxed">
            <strong className="block mb-1">Privasi &amp; Keamanan Data (UU PDP No. 27/2022)</strong>
            <ul className="space-y-1 pl-4 list-disc">
              <li>
                PDF dipecah <strong>100% di browser Anda</strong> — file utuh tidak dikirim ke server.
              </li>
              <li>Hanya halaman dokumen utama yang dikirim untuk dipindai AI.</li>
              <li>Halaman lain hanya dicatat sebagai nama lampiran untuk verifikasi loket.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Dropzone */}
      {!splitResult ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFileSelect(file);
          }}
          className="border-2 border-dashed border-blue-300 rounded-2xl p-6 sm:p-8 flex flex-col items-center justify-center text-center bg-slate-50/40 hover:bg-blue-50/50 transition-colors"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelect(file);
              e.currentTarget.value = '';
            }}
          />
          <div className="w-14 h-14 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mb-3">
            {isProcessing ? <Loader2 className="w-7 h-7 animate-spin" /> : <Upload className="w-7 h-7" />}
          </div>
          <p className="text-sm font-bold text-slate-900">
            {isProcessing ? 'Memecah PDF di browser...' : 'Pilih atau seret SATU PDF gabungan'}
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-md">
            Semua halaman dokumen wajib dijadikan satu PDF. Setelah dipecah, Anda memetakan tiap
            halaman ke dokumen yang sesuai. Maksimal 10 MB.
          </p>
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2563eb] text-white text-xs sm:text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>Pilih PDF Gabungan</span>
          </button>
          <p className="text-[11px] text-slate-400 mt-2">
            Layanan: <span className="font-semibold text-slate-600">{selectedService}</span>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                  {splitResult.fileName}
                </p>
                <p className="text-[11px] text-slate-500">
                  {splitResult.totalPages} halaman • {Math.max(1, Math.round(splitResult.fileSize / 1024))} KB
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={resetSplit}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Ganti PDF
            </button>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
            <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Petakan halaman ke dokumen
              </span>
              <span className="text-[11px] text-slate-500">
                {slots.filter((s) => s.mandatory).length} dokumen wajib
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {splitResult.pages.map((page: PdfPageData) => {
                const mapped = mappings[page.index] || '';
                return (
                  <div key={page.index} className="p-3 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 shrink-0 sm:w-20">
                        <FileText className="w-3.5 h-3.5 text-blue-600" />
                        Hal. {page.index + 1}
                      </span>
                      <select
                        value={mapped}
                        onChange={(e) => {
                          const value = e.target.value;
                          setMappings((prev) => ({ ...prev, [page.index]: value }));
                        }}
                        className={`flex-1 h-9 px-2 rounded-lg border text-xs bg-white outline-none focus:ring-2 focus:ring-blue-100 ${
                          pageErrors[page.index]
                            ? 'border-red-300 text-red-700'
                            : 'border-slate-300 text-slate-800'
                        }`}
                      >
                        <option value="" disabled>
                          Pilih dokumen...
                        </option>
                        {slots.map((slot) => (
                          <option key={slot.title} value={slot.title}>
                            {slot.title}
                            {slot.mandatory ? ' (wajib)' : ''}
                          </option>
                        ))}
                        <option value={OTHER_SLOT}>{OTHER_LABEL}</option>
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPreview((prev) => (prev === page.index ? null : page.index))
                        }
                        className="inline-flex items-center justify-center gap-1 h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
                      >
                        {expandedPreview === page.index ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                        {expandedPreview === page.index ? 'Tutup' : 'Lihat'}
                      </button>
                    </div>
                    {pageErrors[page.index] && (
                      <p className="text-[11px] text-red-600 flex items-start gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                        {pageErrors[page.index]}
                      </p>
                    )}
                    {expandedPreview === page.index && (
                      <div className="h-64 sm:h-80 rounded-lg border border-slate-200 overflow-hidden bg-slate-100">
                        <iframe
                          title={`Pratinjau halaman ${page.index + 1}`}
                          src={page.previewUrl}
                          className="w-full h-full"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {missingMandatory.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <div>
                <strong>Dokumen wajib belum dipetakan:</strong> {missingMandatory.join(', ')}.
                Tambahkan halamannya di PDF atau pilih slot yang benar.
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onCancel}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              Batal, unggah terpisah
            </button>
            <button
              type="button"
              disabled={!isReady}
              onClick={handleSubmit}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#2563eb] text-white text-xs sm:text-sm font-bold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              Proses &amp; Lanjutkan ({splitResult.totalPages} halaman)
            </button>
          </div>
        </div>
      )}

      {error && !splitResult && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

export default PdfCombinedUpload;
