import React, { useState, useRef } from "react";
import {
  Upload,
  RefreshCw,
  Eye,
  Sun,
  Camera,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  FileText,
  X,
  ScanLine
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { OcrPreScreenResult, PreScreenInitialData } from "../types";

interface OcrPreScreenCardProps {
  onProceedToWizard: (data: PreScreenInitialData) => void;
}

const INITIAL_RESULT: OcrPreScreenResult = {
  imageBase64: "",
  imageName: "",
  status_kelayakan: "TIDAK_LAYAK",
  skor_kejelasan: 0,
  status_kejelasan: "KURANG_TAJAM",
  nik_terdeteksi: false,
  nik_value: "",
  nama_terdeteksi: "",
  pencahayaan_status: "KURANG_TERANG",
  catatan: "",
  jenis_dokumen: "LAINNYA",
  status_verifikasi: "TIDAK_VALID",
};

const BUKAN_KTP_MESSAGE =
  "File bukan Kartu Kependudukan Indonesia. Silakan unggah foto e-KTP asli yang jelas dan tidak terpotong.";

function normalizeJenis(raw: unknown): string {
  const upper = String(raw ?? "").toUpperCase().trim();
  if (!upper) return "LAINNYA";
  if (upper.includes("KTP") || upper.includes("TANDA PENDUDUK")) return "KTP";
  if (upper === "KK" || upper.startsWith("KK ") || upper.includes("KARTU KELUARGA")) return "KK";
  if (upper.includes("AKTA") || upper.includes("AKTE")) return "AKTA";
  return "LAINNYA";
}

function normalizeStatus(raw: unknown): string {
  const upper = String(raw ?? "").toUpperCase().trim().replace(/[\s-]+/g, "_");
  if (["BERHASIL", "VALID", "LULUS", "LAYAK", "SUCCESS"].includes(upper)) return "BERHASIL";
  if (
    ["TIDAK_VALID", "TIDAKVALID", "INVALID", "LAINNYA", "REJECTED", "DITOLAK"].includes(upper) ||
    upper.includes("BUKAN")
  )
    return "TIDAK_VALID";
  return "BURAM";
}

export const OcrPreScreenCard: React.FC<OcrPreScreenCardProps> = ({ onProceedToWizard }) => {
  // State kondisi: false (tampilan awal minimalis), true (setelah diunggah & dipindai)
  const [isScanned, setIsScanned] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [scanStepText, setScanStepText] = useState<string>("Memulai analisis dokumen...");
  const [previewResult, setPreviewResult] = useState<OcrPreScreenResult>(INITIAL_RESULT);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Race-guard: hanya hasil pindaian TERBARU yang boleh tampil (abaikan respons basi).
  const scanIdRef = useRef<number>(0);
  const stepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStepTimeout = () => {
    if (stepTimeoutRef.current) {
      clearTimeout(stepTimeoutRef.current);
      stepTimeoutRef.current = null;
    }
  };

  // Kartu gagal jujur (validasi file / baca file / sistem) — bukan vonis "bukan KTP".
  const failPreview = (base64: string, fileName: string, message: string) => {
    clearStepTimeout();
    setScanProgress(100);
    setPreviewResult({
      imageBase64: base64,
      imageName: fileName,
      status_kelayakan: "TIDAK_LAYAK",
      skor_kejelasan: 0,
      status_kejelasan: "DITOLAK",
      nik_terdeteksi: false,
      nik_value: "Tidak Terdeteksi",
      nama_terdeteksi: "Tidak Terbaca",
      pencahayaan_status: "KURANG_TERANG",
      catatan: message,
      jenis_dokumen: "LAINNYA",
      status_verifikasi: "TIDAK_VALID",
      isSystemError: true,
    });
    setIsScanning(false);
    setIsScanned(true);
  };

  const isSupportedFile = (file: File): boolean => {
    if (file.type.startsWith("image/")) return true;
    if (file.type === "application/pdf") return true;
    return /\.(jpe?g|png|webp|pdf)$/i.test(file.name);
  };

  const processUploadedFile = (file: File) => {
    if (!file) return;

    // Validasi lebih dulu: tipe & ukuran (samakan dengan backend: maks 10MB)
    if (!isSupportedFile(file)) {
      failPreview("", file.name, "Format file harus JPG, PNG, WEBP, atau PDF.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      failPreview("", file.name, "Ukuran file melebihi 10MB. Kompres/kecilkan foto lalu unggah ulang.");
      return;
    }

    const myScanId = ++scanIdRef.current;
    const reader = new FileReader();
    reader.onerror = () => {
      if (myScanId !== scanIdRef.current) return;
      failPreview("", file.name, "Gagal membaca file di perangkat. Coba file lain atau ulangi.");
    };
    reader.onload = async () => {
      if (myScanId !== scanIdRef.current) return;
      const base64 = reader.result as string;
      setIsScanning(true);
      setScanProgress(25);
      setScanStepText("1/3 Memindai berkas kependudukan warga...");

      clearStepTimeout();
      stepTimeoutRef.current = setTimeout(() => {
        if (myScanId !== scanIdRef.current) return;
        setScanProgress(65);
        setScanStepText("2/3 Menjalankan OCR Gemini Vision & validasi NIK 16 digit...");
      }, 500);

      try {
        let response: Response;
        try {
          response = await fetch("/api/ocr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageBase64: base64,
            }),
          });
          if (!response.ok) {
            throw new Error("fallback to scan-document");
          }
        } catch {
          response = await fetch("/api/scan-document", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageBase64: base64,
            }),
          });
          if (myScanId !== scanIdRef.current) return;
          if (!response.ok) {
            // Error sistem (AI down, 5xx) JANGAN disamarkan jadi "bukan KTP"
            let errMsg = `Layanan OCR gangguan (HTTP ${response.status}). Coba lagi sesaat.`;
            try {
              const errJson: any = await response.clone().json();
              errMsg = errJson?.message || errJson?.error || errMsg;
            } catch {}
            throw new Error(errMsg);
          }
        }

        if (myScanId !== scanIdRef.current) return;
        const data = await response.json();
        if (myScanId !== scanIdRef.current) return;
        clearStepTimeout();
        setScanProgress(100);

        // Gangguan sistem yang dikembalikan sebagai 200 + flag: tampilkan jujur, bukan vonis invalid
        const parsedRes = data.data || data;
        const sysErr =
          Boolean((data as any)?.isSystemError) ||
          Boolean(parsedRes?.isSystemError) ||
          /belum dikonfigurasi|gagal memproses|jawaban tak valid|gangguan sistem|verifikasi manual/i.test(
            String((data as any)?.message || parsedRes?.catatan || "")
          );
        if (sysErr) {
          throw new Error(
            String((data as any)?.message || "Layanan AI gagal memproses foto. Coba lagi dengan foto lebih jelas.")
          );
        }
        const jenis = normalizeJenis(parsedRes.jenis_dokumen);
        let status = normalizeStatus(parsedRes.status_verifikasi);
        // Konsistensi silang: LAINNYA pasti TIDAK_VALID
        if (jenis === "LAINNYA") status = "TIDAK_VALID";
        const tidakValid = status === "TIDAK_VALID" || jenis === "LAINNYA";
        const isLayak =
          !tidakValid &&
          (status === "BERHASIL" || parsedRes.status_kualitas === "LAYAK");
        const score = tidakValid
          ? (typeof parsedRes.skor_kejelasan === "number" ? Math.min(parsedRes.skor_kejelasan, 20) : 0)
          : typeof parsedRes.skor_kejelasan === "number"
            ? parsedRes.skor_kejelasan
            : isLayak
              ? 92
              : 45;

        setPreviewResult({
          imageBase64: base64,
          imageName: file.name,
          status_kelayakan: isLayak ? "LAYAK" : "TIDAK_LAYAK",
          skor_kejelasan: score,
          status_kejelasan: tidakValid ? "DITOLAK" : isLayak ? "LULUS" : "KURANG_TAJAM",
          nik_terdeteksi: tidakValid ? false : !!parsedRes.nik,
          nik_value: tidakValid
            ? "Tidak Terdeteksi"
            : parsedRes.nik ||
              (parsedRes.nik_partial ? `${parsedRes.nik_partial} (sebagian)` : "Tidak Terdeteksi"),
          nama_terdeteksi: tidakValid ? "Tidak Terbaca" : parsedRes.nama || "Tidak Terbaca",
          pencahayaan_status: isLayak ? "SESUAI_STANDAR" : "KURANG_TERANG",
          catatan: tidakValid
            ? BUKAN_KTP_MESSAGE
            : parsedRes.catatan ||
              (isLayak
                ? "Dokumen valid dan terbaca jelas oleh AI."
                : "Foto kurang tajam atau tidak memenuhi standar pencahayaan fisik."),
          jenis_dokumen: jenis,
          status_verifikasi: status,
          isSystemError: false,
        });
        if (myScanId !== scanIdRef.current) return;
        setIsScanning(false);
        setIsScanned(true);
      } catch (err: any) {
        if (myScanId !== scanIdRef.current) return;
        clearStepTimeout();
        setScanProgress(100);
        // Pesan jaringan mentah (Inggris) diterjemahkan agar warga paham
        const rawMsg = String(err?.message || "");
        const friendlyMsg = /failed to fetch|networkerror|load failed|network request failed/i.test(rawMsg)
          ? "Gagal menghubungi server OCR. Periksa koneksi internet lalu pindai ulang foto e-KTP asli."
          : rawMsg || "Gagal menghubungi server OCR. Periksa koneksi lalu pindai ulang foto e-KTP asli.";
        // Gangguan sistem/koneksi: tandai isSystemError agar banner TIDAK memvonis "bukan KTP"
        setPreviewResult({
          imageBase64: base64,
          imageName: file.name,
          status_kelayakan: "TIDAK_LAYAK",
          skor_kejelasan: 0,
          status_kejelasan: "DITOLAK",
          nik_terdeteksi: false,
          nik_value: "Tidak Terdeteksi",
          nama_terdeteksi: "Tidak Terbaca",
          pencahayaan_status: "KURANG_TERANG",
          catatan: friendlyMsg,
          jenis_dokumen: "LAINNYA",
          status_verifikasi: "TIDAK_VALID",
          isSystemError: true,
        });
        setIsScanning(false);
        setIsScanned(true);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCustomFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processUploadedFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processUploadedFile(file);
    }
  };

  // Reset kembali ke tampilan awal (Initial State: isScanned = false)
  const handleReset = () => {
    scanIdRef.current += 1; // batalkan pindaian yang masih berjalan
    clearStepTimeout();
    setIsScanned(false);
    setIsScanning(false);
    setScanProgress(0);
    setScanStepText("Memulai analisis dokumen...");
    setPreviewResult(INITIAL_RESULT);
    setIsModalOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleProceed = () => {
    if (!previewResult) return;
    // Hanya file BUKAN kependudukan yang diblokir total.
    // Dokumen valid (LAYAK maupun BURAM/KURANG_TAJAM) boleh lanjut → QR terbit di wizard.
    // Gangguan sistem juga diblokir (bukan vonis invalid, tapi belum ada bukti scan valid).
    if (
      previewResult.isSystemError ||
      previewResult.status_verifikasi === "TIDAK_VALID" ||
      previewResult.jenis_dokumen === "LAINNYA"
    ) {
      return;
    }
    onProceedToWizard({
      service: "Penerbitan KTP-EL Baru / Penggantian",
      // Hanya NIK 16 digit utuh yang diteruskan — NIK parsial ("(sebagian)") JANGAN
      // diloloskan agar wizard tidak menolak dengan alert dan user tidak mentok.
      nik: previewResult.nik_terdeteksi && /^\d{16}$/.test(previewResult.nik_value.replace(/\D/g, ""))
        ? previewResult.nik_value.replace(/\D/g, "")
        : "",
      nama: previewResult.nama_terdeteksi && !previewResult.nama_terdeteksi.includes("Tidak")
        ? previewResult.nama_terdeteksi
        : "",
      imageBase64: previewResult.imageBase64,
      imageName: previewResult.imageName,
      preScreenScore: previewResult.skor_kejelasan,
    });
  };

  // Gangguan sistem (AI/koneksi) DIBEDAKAN dari vonis "bukan KTP":
  // kartu system-error tidak boleh berjudul merah "File Bukan..." dan tidak boleh lanjut ke QR.
  const isSystemError = previewResult.isSystemError === true;
  const isTidakValid =
    previewResult.status_verifikasi === "TIDAK_VALID" ||
    previewResult.jenis_dokumen === "LAINNYA" ||
    previewResult.status_kejelasan === "DITOLAK";
  const isLayak = previewResult.status_kelayakan === "LAYAK" && !isTidakValid && !isSystemError;

  return (
    <section
      id="ocrScannerSection"
      className="w-full max-w-5xl mx-auto p-2 sm:p-4 font-sans"
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={handleCustomFileUpload}
        className="hidden"
      />

      {/* CONTAINER UTAMA */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-6 shadow-xs">
        
        {/* KONDISI 1: PROSES SCANNING BERLANGSUNG */}
        {isScanning && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-xl mx-auto bg-slate-950 rounded-2xl border border-cyan-500/40 p-8 sm:p-12 flex flex-col items-center justify-center text-center relative overflow-hidden min-h-[340px] shadow-2xl"
          >
            {/* Animasi Laser Pemindai Neon Bergerak */}
            <div className="absolute inset-x-0 h-16 animate-scan-beam pointer-events-none z-30">
              <div className="w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_20px_#22d3ee,0_0_35px_#06b6d4]"></div>
              <div className="w-full h-14 bg-gradient-to-b from-cyan-400/25 to-transparent"></div>
            </div>

            {/* Corner Markers */}
            <div className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-cyan-400/80 rounded-tl-md pointer-events-none"></div>
            <div className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-cyan-400/80 rounded-tr-md pointer-events-none"></div>
            <div className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-cyan-400/80 rounded-bl-md pointer-events-none"></div>
            <div className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-cyan-400/80 rounded-br-md pointer-events-none"></div>

            {/* Live Indicator */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-slate-900/90 border border-cyan-400/50 text-cyan-300 text-[11px] font-mono px-3 py-1 rounded-full flex items-center gap-2 shadow-xs">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
              <span>MEMINDAI DOKUMEN...</span>
            </div>

            <div className="mt-8 relative z-20">
              <h4 className="text-base sm:text-lg font-bold text-white font-heading">
                Menganalisis Fisik Dokumen Kependudukan
              </h4>
              <p className="text-xs sm:text-sm text-cyan-200 mt-1 max-w-sm font-medium">
                {scanStepText}
              </p>
            </div>

            {/* Progress Bar */}
            <div className="w-full max-w-xs bg-slate-800 h-2 rounded-full overflow-hidden mt-6 border border-slate-700 relative z-20">
              <div
                className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 transition-all duration-300 rounded-full"
                style={{ width: `${scanProgress}%` }}
              ></div>
            </div>

            <span className="text-[11px] text-slate-400 mt-2.5 relative z-20 font-mono">
              {scanProgress}% • OCR Neural Vision
            </span>
          </motion.div>
        )}

        {/* KONDISI 2: SEBELUM DIUNGGAH (isScanned === false) - TAMPILAN MINIMALIS BERSIH */}
        {!isScanned && !isScanning && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center justify-center py-4"
          >
            {/* AREA UTAMA SCANNER (Kotak Pemindai Hitam di Tengah) */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`w-full max-w-xl bg-slate-950 rounded-2xl border p-6 sm:p-10 relative overflow-hidden flex flex-col items-center justify-center text-center shadow-lg group cursor-pointer transition-all duration-200 ${
                isDragging
                  ? "border-cyan-400 ring-4 ring-cyan-500/20 scale-[0.99]"
                  : "border-slate-800 hover:border-cyan-500/60 hover:shadow-cyan-950/30 hover:shadow-xl"
              }`}
              title="Klik atau Drag berkas dokumen ke area pemindai ini"
            >
              {/* Animasi Laser Pindaian Berjalan (Pulsing Neon Scan Beam) */}
              <div className="absolute inset-x-0 h-16 animate-scan-beam pointer-events-none z-20">
                <div className="w-full h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_20px_#22d3ee,0_0_30px_#06b6d4]"></div>
                <div className="w-full h-12 bg-gradient-to-b from-cyan-400/20 to-transparent"></div>
              </div>

              {/* Grid Garis Latar Scanner */}
              <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-40 pointer-events-none"></div>

              {/* Target Corner Viewfinder Lines */}
              <div className="absolute top-3.5 left-3.5 w-7 h-7 border-t-2 border-l-2 border-cyan-400/80 rounded-tl pointer-events-none group-hover:scale-105 transition-transform"></div>
              <div className="absolute top-3.5 right-3.5 w-7 h-7 border-t-2 border-r-2 border-cyan-400/80 rounded-tr pointer-events-none group-hover:scale-105 transition-transform"></div>
              <div className="absolute bottom-3.5 left-3.5 w-7 h-7 border-b-2 border-l-2 border-cyan-400/80 rounded-bl pointer-events-none group-hover:scale-105 transition-transform"></div>
              <div className="absolute bottom-3.5 right-3.5 w-7 h-7 border-b-2 border-r-2 border-cyan-400/80 rounded-br pointer-events-none group-hover:scale-105 transition-transform"></div>

              {/* Status Header Bar Scanner */}
              <div className="absolute top-3 inset-x-4 flex justify-between items-center text-[10px] font-mono text-cyan-400/80 z-20">
                <span className="flex items-center gap-1.5 bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
                  SCAN_VIEWPORT READY
                </span>
                <span className="bg-slate-900/90 px-2 py-0.5 rounded border border-slate-800 text-slate-400">
                  AI OCR 3.6
                </span>
              </div>

              {/* Icon Kamera / Pemindai di Tengah */}
              <div className="relative z-20 my-5 flex flex-col items-center">
                <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-slate-900 border border-slate-800 group-hover:border-cyan-400/60 flex items-center justify-center shadow-md transition-all group-hover:scale-105">
                  <ScanLine className="w-8 h-8 sm:w-9 sm:h-9 text-cyan-400 group-hover:text-cyan-300 transition-colors" />
                </div>
              </div>

              {/* Tombol Utama Unggah / Ambil Foto */}
              <div className="relative z-20 space-y-3 w-full max-w-xs">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold text-xs sm:text-sm py-3 px-5 rounded-xl shadow-lg shadow-cyan-950/40 hover:shadow-cyan-900/60 transition-all flex items-center justify-center gap-2 cursor-pointer group-hover:brightness-105"
                >
                  <Camera className="w-4 h-4" />
                  <span>Unggah Berkas / Ambil Foto</span>
                </button>

                <p className="text-[11px] text-slate-400 group-hover:text-slate-300 transition-colors">
                  atau tarik & lepas foto e-KTP / KK ke sini (JPG, PNG, PDF)
                </p>
              </div>

              {/* Footer Bar Scanner */}
              <div className="absolute bottom-3 inset-x-4 flex justify-center items-center text-[10px] font-mono text-slate-500 z-20">
                <span>Ekstraksi NIK & Uji Kejelasan Otomatis</span>
              </div>
            </div>
          </motion.div>
        )}

        {/* KONDISI 3: SETELAH DIUNGGAH & DIPINDAI (isScanned === true) - TAMPILKAN HASIL STATISTIK */}
        {isScanned && !isScanning && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-5"
          >
            {/* 1. ALERT BANNER HASIL */}
            <div
              className={`rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border ${
                isSystemError
                  ? "bg-slate-100/90 border-slate-300"
                  : isTidakValid
                    ? "bg-red-50/90 border-red-200"
                    : isLayak
                      ? "bg-emerald-50/90 border-emerald-200"
                      : "bg-amber-50/90 border-amber-200"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`p-2 rounded-lg shrink-0 mt-0.5 sm:mt-0 ${
                    isSystemError
                      ? "bg-slate-500/10 text-slate-600"
                      : isTidakValid
                        ? "bg-red-500/10 text-red-600"
                        : isLayak
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-amber-500/10 text-amber-600"
                  }`}
                >
                  {isLayak ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`px-2.5 py-0.5 font-bold text-xs rounded-md uppercase tracking-wide text-white ${
                        isSystemError
                          ? "bg-slate-500"
                          : isTidakValid
                            ? "bg-red-600"
                            : isLayak
                              ? "bg-emerald-600"
                              : "bg-amber-500"
                      }`}
                    >
                      {isSystemError
                        ? "Gagal Memindai — Coba Lagi"
                        : isTidakValid
                          ? "File Bukan Kartu Kependudukan Indonesia"
                          : isLayak
                            ? "Dokumen Layak & Terbaca Jelas"
                            : "Foto Buram / Perlu Perbaikan"}
                    </span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-md ${
                        isSystemError
                          ? "text-slate-700 bg-slate-200 border border-slate-300"
                          : isTidakValid
                            ? "text-red-800 bg-red-100 border border-red-200"
                            : isLayak
                              ? "text-emerald-800 bg-emerald-100 border border-emerald-200"
                              : "text-amber-800 bg-amber-100 border border-amber-200"
                      }`}
                    >
                      Skor AI: {previewResult.skor_kejelasan}/100
                    </span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-md border ${
                        (previewResult.jenis_dokumen || "LAINNYA") === "KTP"
                          ? "text-blue-800 bg-blue-100 border-blue-200"
                          : "text-slate-700 bg-white border-slate-200"
                      }`}
                    >
                      Jenis Dokumen: {previewResult.jenis_dokumen || "LAINNYA"}
                    </span>
                  </div>
                  <p
                    className={`text-xs sm:text-sm mt-1 leading-relaxed ${
                      isSystemError
                        ? "text-slate-700"
                        : isTidakValid
                          ? "text-red-900/90"
                          : isLayak
                            ? "text-emerald-900/90"
                            : "text-amber-900/90"
                    }`}
                  >
                    {previewResult.catatan}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className={`self-end sm:self-center text-xs font-semibold bg-white px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer border ${
                  isSystemError
                    ? "text-slate-700 hover:bg-slate-100/50 border-slate-300"
                    : isTidakValid
                      ? "text-red-900 hover:bg-red-100/50 border-red-300"
                      : isLayak
                        ? "text-emerald-900 hover:bg-emerald-100/50 border-emerald-300"
                        : "text-amber-900 hover:bg-amber-100/50 border-amber-300"
                }`}
              >
                Lihat Detail
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 2. GRID: PRATINJAU GAMBAR & CARD STATISTIK */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              
              {/* KOLOM KIRI: PRATINJAU GAMBAR DOKUMEN (5 Cols) */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="lg:col-span-5 bg-slate-950 rounded-xl border border-slate-800 p-3 relative overflow-hidden flex flex-col justify-between min-h-[250px] shadow-inner group cursor-pointer hover:border-cyan-500/50 transition-colors"
                title="Klik untuk mengganti dokumen"
              >
                {/* Viewport Corners */}
                <div className="absolute inset-2.5 border border-cyan-500/30 rounded-lg pointer-events-none flex flex-col justify-between p-2 z-20">
                  <div className="flex justify-between text-[10px] font-mono text-cyan-400/70">
                    <span>┌ SCAN_ZONE</span>
                    <span>┐</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-mono text-cyan-400/70">
                    <span>└ AUTO_CROPPED</span>
                    <span>┘</span>
                  </div>
                </div>

                {/* Top Info */}
                <div className="flex justify-between items-center z-10 text-[10px]">
                  <span className="bg-slate-900/90 text-slate-300 border border-slate-700/80 px-2 py-0.5 rounded font-mono max-w-[150px] truncate">
                    {previewResult.imageName || "dokumen.png"}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded font-mono font-medium border ${
                      isLayak
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    }`}
                  >
                    {isLayak ? "Auto-Crop OK" : "Perlu Foto Ulang"}
                  </span>
                </div>

                {/* Center Image (PDF tidak bisa di-<img>: tampilkan placeholder berkas) */}
                <div className="my-auto py-2 flex items-center justify-center z-10 max-h-[170px]">
                  {previewResult.imageBase64 &&
                  !/\.pdf$/i.test(previewResult.imageName || "") &&
                  !previewResult.imageBase64.startsWith("data:application/pdf") ? (
                    <img
                      src={previewResult.imageBase64}
                      alt="Pratinjau Dokumen"
                      className="max-h-[160px] w-auto max-w-full object-contain rounded-lg shadow-md border border-slate-800"
                    />
                  ) : previewResult.imageBase64 ? (
                    <div className="py-6 text-center text-slate-300">
                      <FileText className="w-10 h-10 mx-auto text-red-400 mb-1" />
                      <span className="text-xs font-mono block max-w-[220px] truncate">
                        {previewResult.imageName || "dokumen.pdf"}
                      </span>
                      <span className="text-[10px] text-slate-400">Pratinjau PDF tidak tersedia</span>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-slate-400">
                      <FileText className="w-8 h-8 mx-auto text-slate-600 mb-1" />
                      <span className="text-xs">Dokumen Terunggah</span>
                    </div>
                  )}
                </div>

                {/* Bottom Footer */}
                <div className="z-10 flex justify-between items-center pt-2 border-t border-slate-900 text-[10px] text-slate-400 font-mono">
                  <span className="text-cyan-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                    Hasil Pindaian Selesai
                  </span>
                  <span className="hover:text-cyan-300">Ganti Dokumen ↻</span>
                </div>
              </div>

              {/* KOLOM KANAN: 3 CARD STATISTIK & TOMBOL AKSI (7 Cols) */}
              <div className="lg:col-span-7 space-y-4">
                
                {/* 3 CARD METRIK */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  
                  {/* METRIK 1: KEJELASAN TEKS */}
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-2">
                    <div className="flex justify-between items-center text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                      <span>Kejelasan Teks</span>
                      <Eye className="w-4 h-4 text-blue-500" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-800">
                        {previewResult.skor_kejelasan}% -{" "}
                        {previewResult.status_kejelasan === "LULUS"
                          ? "LULUS TAJAM"
                          : previewResult.status_kejelasan === "DITOLAK"
                            ? "DITOLAK"
                            : "KURANG TAJAM"}
                      </div>
                      <div className="w-full bg-slate-200 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isLayak
                              ? "bg-emerald-500"
                              : isTidakValid && !isSystemError
                                ? "bg-red-500"
                                : "bg-amber-500"
                          }`}
                          style={{ width: `${previewResult.skor_kejelasan}%` }}
                        ></div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {isLayak
                        ? "DPI tajam & kontras teks sangat jelas."
                        : "Huruf kabur pada area NIK."}
                    </p>
                  </div>

                  {/* METRIK 2: 16-DIGIT NIK */}
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-2">
                    <div className="flex justify-between items-center text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                      <span>16-Digit NIK</span>
                      {previewResult.nik_terdeteksi ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-800 font-mono truncate">
                        {previewResult.nik_terdeteksi ? previewResult.nik_value : "Tidak Terdeteksi"}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {previewResult.nik_terdeteksi
                          ? "NIK lengkap dan terbaca valid."
                          : "Digit terpotong / tertutup silau."}
                      </p>
                    </div>
                  </div>

                  {/* METRIK 3: PENCAHAYAAN */}
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-2">
                    <div className="flex justify-between items-center text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                      <span>Pencahayaan</span>
                      <Sun className={`w-4 h-4 ${isLayak ? "text-blue-500" : "text-amber-500"}`} />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-800">
                        {previewResult.pencahayaan_status === "SESUAI_STANDAR"
                          ? "Sesuai Standar"
                          : "Kurang Terang"}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {previewResult.pencahayaan_status === "SESUAI_STANDAR"
                          ? "Pencahayaan merata tanpa silau."
                          : "Pencahayaan redup / ada refleksi."}
                      </p>
                    </div>
                  </div>

                </div>

                {/* TOMBOL AKSI — dokumen valid (layak/buram) selalu bisa lanjut ke QR */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  {isSystemError ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 bg-slate-600 hover:bg-slate-700 active:bg-slate-800 text-white font-semibold text-xs sm:text-sm py-2.5 px-4 rounded-xl shadow-xs hover:shadow transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Coba Pindai Ulang</span>
                    </button>
                  ) : isLayak ? (
                    <button
                      type="button"
                      onClick={handleProceed}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs sm:text-sm py-2.5 px-4 rounded-xl shadow-xs hover:shadow transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span>Lanjut ke Formulir dengan Data Ini</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  ) : isTidakValid ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold text-xs sm:text-sm py-2.5 px-4 rounded-xl shadow-xs hover:shadow transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Unggah Ulang Foto e-KTP Asli</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleProceed}
                      className="flex-1 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold text-xs sm:text-sm py-2.5 px-4 rounded-xl shadow-xs hover:shadow transition flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ArrowRight className="w-4 h-4" />
                      <span>Dokumen Valid (Buram) — Tetap Lanjut ke QR</span>
                    </button>
                  )}
                  
                  <button
                    type="button"
                    onClick={handleReset}
                    className="sm:w-auto bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs sm:text-sm py-2.5 px-4 rounded-xl border border-slate-300 transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4 text-slate-500" />
                    <span>Pindai Ulang</span>
                  </button>
                </div>

              </div>

            </div>
          </motion.div>
        )}

      </div>

      {/* MODAL POPUP DETAIL (Jika user mengklik "Lihat Detail") */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6 relative"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                    <FileText className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                    Detail Pemeriksaan Fisik Dokumen
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-8 h-8 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Status Badge */}
              <div className="mt-4">
                <div
                  className={`p-3 rounded-xl border flex items-center justify-between ${
                    isSystemError
                      ? "bg-slate-100 border-slate-300 text-slate-800"
                      : isTidakValid
                        ? "bg-red-50 border-red-200 text-red-900"
                        : isLayak
                          ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                          : "bg-amber-50 border-amber-200 text-amber-900"
                  }`}
                >
                  <span className="font-bold text-xs uppercase">
                    Status:{" "}
                    {isSystemError
                      ? "Gagal Memindai — Coba Lagi"
                      : isTidakValid
                        ? "File Bukan KTP Indonesia"
                        : isLayak
                          ? "Layak Diproses"
                          : "Perlu Perbaikan"}
                  </span>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-white/80">
                    Skor: {previewResult.skor_kejelasan}/100
                  </span>
                </div>
              </div>

              {/* Detail Items */}
              <div className="mt-4 space-y-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                  <span className="text-slate-400 block text-[11px]">Jenis Dokumen Terdeteksi:</span>
                  <p className="font-bold text-slate-800">
                    {previewResult.jenis_dokumen || "LAINNYA"}
                    {previewResult.status_verifikasi
                      ? ` • ${previewResult.status_verifikasi}`
                      : ""}
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                  <span className="text-slate-400 block text-[11px]">Nama Berkas:</span>
                  <p className="font-mono font-medium text-slate-800">{previewResult.imageName || "-"}</p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                  <span className="text-slate-400 block text-[11px]">16-Digit NIK:</span>
                  <p className="font-mono font-bold text-slate-800">
                    {previewResult.nik_terdeteksi ? previewResult.nik_value : "Tidak Terdeteksi"}
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                  <span className="text-slate-400 block text-[11px]">Nama Pemohon Terdeteksi:</span>
                  <p className="font-semibold text-slate-800">{previewResult.nama_terdeteksi || "Tidak Terbaca"}</p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                  <span className="text-slate-400 block text-[11px]">Catatan Analisis:</span>
                  <p className="text-slate-700 leading-relaxed">{previewResult.catatan}</p>
                </div>
              </div>

              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-xs transition cursor-pointer"
                >
                  Tutup Rincian
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </section>
  );
};
