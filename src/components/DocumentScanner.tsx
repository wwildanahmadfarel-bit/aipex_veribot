import React, { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  CheckCircle2,
  Copy,
  Check,
  TicketIcon,
  Upload,
  FileCheck,
  AlertCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { PrescreeningResult } from "../types";

export interface TicketData {
  kode_tiket: string;
  nik: string;
  nama: string;
  jenis_dokumen: string;
  status_verifikasi: string;
  created_at?: string;
  skor_kejelasan?: number;
  catatan?: string;
}

export interface DocumentScannerProps {
  onProceedToForm?: (data: PrescreeningResult) => void;
  className?: string;
}

export default function DocumentScanner({ onProceedToForm, className = "" }: DocumentScannerProps = {}) {
  const [scanResult, setScanResult] = useState<any>(null);
  const [createdTicket, setCreatedTicket] = useState<TicketData | null>(null);
  const [copied, setCopied] = useState(false);

  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [manualNik, setManualNik] = useState<string>("");

  const BUKAN_KTP_MESSAGE =
    "File bukan Kartu Kependudukan Indonesia. Silakan unggah foto e-KTP asli yang jelas dan tidak terpotong.";

  const normalizeJenis = (raw: unknown): string => {
    const upper = String(raw ?? "").toUpperCase().trim();
    if (!upper) return "LAINNYA";
    if (upper.includes("KTP") || upper.includes("TANDA PENDUDUK")) return "KTP";
    if (
      upper === "KK" ||
      upper.startsWith("KK ") ||
      upper.startsWith("KK-") ||
      upper.includes("KARTU KELUARGA")
    )
      return "KK";
    if (upper.includes("AKTA") || upper.includes("AKTE")) return "AKTA";
    return "LAINNYA";
  };

  const normalizeStatus = (raw: unknown): string => {
    const upper = String(raw ?? "").toUpperCase().trim().replace(/[\s-]+/g, "_");
    if (["BERHASIL", "VALID", "LULUS", "LAYAK", "SUCCESS"].includes(upper)) return "BERHASIL";
    if (
      ["TIDAK_VALID", "TIDAKVALID", "INVALID", "LAINNYA", "REJECTED", "DITOLAK"].includes(upper) ||
      upper.includes("BUKAN")
    )
      return "TIDAK_VALID";
    return "BURAM";
  };

  const isTidakValidResult = (r: any): boolean => {
    if (!r) return false;
    const jenis = normalizeJenis(r.jenis_dokumen);
    const status = normalizeStatus(r.status_verifikasi);
    return status === "TIDAK_VALID" || jenis === "LAINNYA";
  };

  const isLayakResult = (r: any): boolean => {
    if (!r || isTidakValidResult(r)) return false;
    const status = normalizeStatus(r.status_verifikasi);
    return status === "BERHASIL" || r.status_kualitas === "LAYAK";
  };

  // Dokumen kependudukan valid (KTP/KK/AKTA) — BERHASIL maupun BURAM — wajib hasilkan QR.
  // Hanya TIDAK_VALID / LAINNYA yang tidak dapat QR.
  const isValidDocResult = (r: any): boolean => {
    if (!r || isTidakValidResult(r)) return false;
    return ["KTP", "KK", "AKTA"].includes(normalizeJenis(r.jenis_dokumen));
  };

  const isBuramValidResult = (r: any): boolean => {
    if (!r || !isValidDocResult(r)) return false;
    return normalizeStatus(r.status_verifikasi) === "BURAM" || r.status_kualitas !== "LAYAK";
  };

  const handleScanUpload = async (formData: FormData) => {
    setLoading(true);
    setError(null);
    setCreatedTicket(null);
    setManualNik("");

    try {
      let res: Response;
      let lastHttpStatus = 0;
      try {
        res = await fetch("/api/ocr", {
          method: "POST",
          body: formData,
        });
        lastHttpStatus = res.status;
        if (!res.ok) {
          throw new Error("fallback to scan-document");
        }
      } catch {
        try {
          res = await fetch("/api/scan-document", {
            method: "POST",
            body: formData,
          });
          lastHttpStatus = res.status;
          if (!res.ok) {
            // Baca pesan error jujur (mis. AI belum dikonfigurasi) — jangan samarkan jadi "bukan KTP"
            let errJson: any = null;
            try {
              errJson = await res.clone().json();
            } catch {}
            const errMsg =
              errJson?.message || errJson?.error || `Gagal memindai dokumen (HTTP ${res.status})`;
            throw new Error(errMsg);
          }
        } catch (innerErr: any) {
          // Teruskan pesan error HTTP jujur dari backend (Vercel serverless, same-origin)
          throw innerErr instanceof Error
            ? innerErr
            : new Error(`Gagal memindai dokumen (HTTP ${lastHttpStatus || "unknown"})`);
        }
      }

      const json = await res.json();
      void lastHttpStatus;

      if (!res.ok && !json.data && !json.jenis_dokumen) {
        throw new Error(json.message || json.detail || json.error || "Gagal memindai dokumen");
      }

      // Backend baru: TIDAK_VALID → success:false tanpa tiket.
      // Dokumen valid BERHASIL / BURAM → success:true + ticket (QR wajib tampil).
      const ocrData = json.data || json;
      // Tiket bisa ada di top-level (json.ticket) atau nested (json.data.ticket)
      const serverTicket = (json as any).ticket || (ocrData as any)?.ticket || null;
      if (!ocrData || typeof ocrData !== "object" || (!ocrData.jenis_dokumen && !ocrData.status_verifikasi && !json.success)) {
        throw new Error(json.message || "Gagal memindai dokumen. Respons server tidak valid.");
      }

      // Normalisasi defensif di frontend (backend sudah otoritatif)
      ocrData.jenis_dokumen = normalizeJenis(ocrData.jenis_dokumen);
      ocrData.status_verifikasi = normalizeStatus(ocrData.status_verifikasi);
      const tidakValid = isTidakValidResult(ocrData);
      const berhasil =
        !tidakValid &&
        (ocrData.status_verifikasi === "BERHASIL" || ocrData.status_kualitas === "LAYAK");
      const buramValid =
        !tidakValid &&
        !berhasil &&
        ["KTP", "KK", "AKTA"].includes(ocrData.jenis_dokumen as string);
      const validDoc = berhasil || buramValid;
      ocrData.status_kualitas = berhasil ? "LAYAK" : "TIDAK_LAYAK";
      if (tidakValid && !/bukan kartu kependudukan/i.test(String(ocrData.catatan || ""))) {
        ocrData.catatan = BUKAN_KTP_MESSAGE;
      }
      if (buramValid && !ocrData.catatan) {
        ocrData.catatan =
          "Dokumen kependudukan asli terdeteksi namun buram. QR tetap terbit — bawa fisik dokumen asli untuk verifikasi ulang di loket.";
      }
      setScanResult(ocrData);

      // QR WAJIB tampil untuk dokumen valid (BERHASIL maupun BURAM).
      // Hanya file bukan kependudukan yang tidak dapat tiket/QR.
      const ticketCandidate = serverTicket || (json.success && (json as any).ticket) || null;
      if (validDoc && ticketCandidate?.kode_tiket) {
        console.log("Tiket + QR terbit:", ticketCandidate.kode_tiket);
        setCreatedTicket(ticketCandidate);
      } else if (validDoc) {
        // Fallback agar dokumen VALID tetap dapat QR lokal walau backend/Supabase gangguan
        // atau NIK tak terbaca (pakai placeholder, petugas verifikasi manual di loket).
        const fallbackTicket: TicketData = {
          kode_tiket: "TKT-" + Date.now().toString().slice(-6),
          nik: ocrData.nik || "0000000000000000",
          nama: ocrData.nama || "Warga (Nama tidak terdeteksi)",
          jenis_dokumen: ocrData.jenis_dokumen || "KTP",
          status_verifikasi: ocrData.status_verifikasi || (berhasil ? "BERHASIL" : "BURAM"),
          skor_kejelasan: ocrData.skor_kejelasan ?? 75,
          catatan: ocrData.catatan || "Dokumen kependudukan terverifikasi otomatis.",
          created_at: new Date().toISOString(),
        };
        setCreatedTicket(fallbackTicket);
      } else {
        setCreatedTicket(null);
        // Untuk BURAM valid tanpa NIK pun backend seharusnya sudah kirim tiket;
        // jika sampai sini berarti respons tak lengkap — tampilkan pesan jujur.
        if (!tidakValid && validDoc && json.success === false && json.message) {
          setError(json.message);
        } else if (!tidakValid && json.success === false && json.message) {
          setError(json.message);
        }
      }
    } catch (err: any) {
      console.error("Gagal melakukan verifikasi dokumen:", err);
      setError(err?.message || "Terjadi kesalahan koneksi server saat memeriksa dokumen.");
    } finally {
      setLoading(false);
    }
  };

  const processFile = async (file: File) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|webp|pdf)$/i)) {
      setError("Format file harus JPG, PNG, WEBP, atau PDF.");
      return;
    }

    setFileName(file.name);
    setScanResult(null);
    setCreatedTicket(null);
    setManualNik("");

    const formData = new FormData();
    formData.append("file", file);

    await handleScanUpload(formData);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  // Koreksi NIK manual: untuk KTP valid yang NIK-nya tak terbaca AI (buram/silau),
  // warga ketik 16 digit dari fisik KTP → QR diperbarui tanpa perlu pindai ulang.
  const applyManualNik = () => {
    const clean = manualNik.replace(/\D/g, "");
    if (clean.length !== 16) {
      setError("NIK manual harus tepat 16 digit angka sesuai fisik e-KTP.");
      return;
    }
    if (!scanResult || isTidakValidResult(scanResult)) return;
    setError(null);
    const updated = { ...scanResult, nik: clean, nik_partial: undefined };
    setScanResult(updated);
    setCreatedTicket((prev) => {
      if (prev) return { ...prev, nik: clean };
      return {
        kode_tiket: "TKT-" + Date.now().toString().slice(-6),
        nik: clean,
        nama: updated.nama || "Warga (Nama tidak terdeteksi)",
        jenis_dokumen: updated.jenis_dokumen || "KTP",
        status_verifikasi: updated.status_verifikasi || "BURAM",
        skor_kejelasan: updated.skor_kejelasan ?? 75,
        catatan: "NIK dikoreksi manual dari fisik KTP. Petugas verifikasi ulang di loket.",
        created_at: new Date().toISOString(),
      };
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`space-y-6 ${className}`}>
      <div className="bg-white p-6 rounded-2xl border border-blue-100 shadow-sm max-w-xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold text-slate-900 font-heading">Uji Keterbacaan Berkas (OCR AI)</h3>
          <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-blue-600" />
            <span>UU PDP Memory RAM</span>
          </span>
        </div>
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          Cek kualitas fisik & kejelasan NIK dari rumah tanpa mengisi formulir terlebih dahulu. Dokumen diproses murni di memori sementara.
        </p>

        {/* Area Upload File */}
        <label
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all ${
            isDragging
              ? "border-blue-500 bg-blue-100/50 scale-[0.99]"
              : "border-blue-200 hover:border-blue-500 bg-blue-50/50"
          }`}
        >
          <Upload className="w-8 h-8 text-blue-600 mb-2 transition-transform hover:scale-110" />
          <span className="text-xs font-semibold text-slate-700 text-center">
            {fileName ? `File: ${fileName}` : "Klik atau Drag File e-KTP / KK Di Sini"}
          </span>
          <span className="text-[10px] text-slate-400 mt-1">Format JPG, PNG, WEBP, PDF (Maks 10MB)</span>
          <input
            type="file"
            onChange={handleFileUpload}
            accept="image/*,.pdf"
            className="hidden"
            disabled={loading}
          />
        </label>

        {/* Indikator Loading */}
        {loading && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-center gap-2 text-blue-700 text-xs">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span className="font-medium">Memeriksa kejelasan teks & NIK dengan Gemini AI...</span>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Preview Result Status */}
        {scanResult &&
          (() => {
            const tidakValid = isTidakValidResult(scanResult);
            const layak = isLayakResult(scanResult);
            const buramValid = isBuramValidResult(scanResult);
            const validDoc = isValidDocResult(scanResult);
            const jenisLabel = normalizeJenis(scanResult.jenis_dokumen);
            return (
              <div
                className={`mt-4 p-4 rounded-xl space-y-3 animate-in fade-in-50 duration-200 border ${
                  tidakValid
                    ? "bg-red-50 border-red-200"
                    : layak
                      ? "bg-slate-50 border-slate-200"
                      : "bg-amber-50/60 border-amber-200"
                }`}
              >
                {tidakValid && (
                  <div className="p-3 bg-red-600 text-white text-xs font-semibold rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      File bukan Kartu Kependudukan Indonesia. Silakan unggah foto e-KTP asli yang
                      jelas dan tidak terpotong.
                    </span>
                  </div>
                )}
                {buramValid && (
                  <div className="p-3 bg-amber-500 text-white text-xs font-semibold rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Dokumen kependudukan asli terdeteksi namun buram. QR tetap terbit di bawah —
                      bawa fisik dokumen asli untuk verifikasi ulang di loket.
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-medium text-slate-500">Status Kelayakan:</span>
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-full border flex items-center gap-1 ${
                      tidakValid
                        ? "bg-red-100 text-red-800 border-red-200"
                        : layak
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : "bg-amber-100 text-amber-800 border-amber-200"
                    }`}
                  >
                    {tidakValid
                      ? "✕ File Bukan KTP Indonesia"
                      : layak
                        ? "✓ Dokumen Layak — QR Terbit"
                        : buramValid
                          ? "⚠ Dokumen Valid (Buram) — QR Tetap Terbit"
                          : "⚠ Kualitas Buram / Kurang Layak"}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs font-medium text-slate-500">Jenis Dokumen:</span>
                  <span
                    className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                      jenisLabel === "KTP"
                        ? "bg-blue-100 text-blue-800 border-blue-200"
                        : jenisLabel === "LAINNYA"
                          ? "bg-red-100 text-red-800 border-red-200"
                          : "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {jenisLabel === "KTP"
                      ? "🪪 Jenis Dokumen: KTP"
                      : `Jenis Dokumen: ${jenisLabel}`}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-100 shadow-2xs">
                    <p className="text-slate-400 text-[10px] font-medium">Skor Kejelasan</p>
                    <p
                      className={`font-bold text-sm ${scanResult.skor_kejelasan >= 70 ? "text-blue-600" : tidakValid ? "text-red-600" : "text-amber-600"}`}
                    >
                      {scanResult.skor_kejelasan || 0}%
                    </p>
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-100 shadow-2xs">
                    <p className="text-slate-400 text-[10px] font-medium">NIK Terdeteksi</p>
                    <p className="font-bold text-slate-800 font-mono truncate">
                      {scanResult.nik ||
                        (scanResult.nik_partial
                          ? `${scanResult.nik_partial} (sebagian)`
                          : "Tidak Terbaca")}
                    </p>
                    {!scanResult.nik && scanResult.nik_partial && (
                      <p className="text-[10px] text-amber-600 mt-0.5">
                        Terbaca {String(scanResult.nik_partial).length}/16 digit — foto ulang lebih fokus atau koreksi manual di bawah.
                      </p>
                    )}
                  </div>
                </div>

                {scanResult.nama && !tidakValid && (
                  <div className="bg-white px-2.5 py-1.5 rounded-lg border border-slate-100 text-xs flex items-center justify-between">
                    <span className="text-slate-400 text-[10px]">Nama Lengkap:</span>
                    <span className="font-semibold text-slate-800">{scanResult.nama}</span>
                  </div>
                )}

                {scanResult.catatan && (
                  <p
                    className={`text-[11px] italic p-2 rounded-lg border ${
                      tidakValid
                        ? "text-red-700 bg-white/80 border-red-100"
                        : "text-slate-600 bg-white/60 border-slate-100"
                    }`}
                  >
                    &ldquo;{scanResult.catatan}&rdquo;
                  </p>
                )}

                {/* Koreksi NIK manual — khusus dokumen VALID yang NIK-nya tak terbaca AI */}
                {validDoc && !scanResult.nik && (
                  <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3 space-y-2">
                    <p className="text-[11px] text-blue-900 font-semibold">
                      Jenis dokumen sudah benar ({jenisLabel}) tapi NIK tidak terbaca. Ketik 16 digit NIK dari fisik {jenisLabel} untuk melengkapi QR:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={16}
                        value={manualNik}
                        onChange={(e) => setManualNik(e.target.value.replace(/\D/g, ""))}
                        placeholder="16 digit NIK"
                        className="flex-1 h-9 px-3 rounded-lg bg-white border border-blue-200 text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500"
                      />
                      <button
                        type="button"
                        onClick={applyManualNik}
                        className="px-3 h-9 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
                      >
                        Pakai NIK
                      </button>
                    </div>
                    <p className="text-[10px] text-blue-700/80">
                      {manualNik.length}/16 digit • QR diperbarui + petugas verifikasi ulang di loket.
                    </p>
                  </div>
                )}

                <div className="pt-1 flex items-center gap-2">
                  {validDoc && onProceedToForm ? (
                    <button
                      type="button"
                      onClick={() => onProceedToForm(scanResult)}
                      className="w-full bg-[#2563eb] hover:bg-blue-700 text-white font-semibold text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                    >
                      <FileCheck className="w-4 h-4" />
                      <span>
                        {layak
                          ? "Dokumen Layak — Lanjut ke Form Mandiri →"
                          : "Dokumen Valid (Buram) — Tetap Lanjut →"}
                      </span>
                    </button>
                  ) : tidakValid ? (
                    <label className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer">
                      <RefreshCw className="w-4 h-4" />
                      <span>Unggah Ulang Foto e-KTP Asli</span>
                      <input
                        type="file"
                        onChange={handleFileUpload}
                        accept="image/*,.pdf"
                        className="hidden"
                        disabled={loading}
                      />
                    </label>
                  ) : (
                    <label className="w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer">
                      <RefreshCw className="w-4 h-4" />
                      <span>Foto Ulang Dokumen (Terlalu Buram)</span>
                      <input
                        type="file"
                        onChange={handleFileUpload}
                        accept="image/*,.pdf"
                        className="hidden"
                        disabled={loading}
                      />
                    </label>
                  )}
                </div>
              </div>
            );
          })()}
      </div>

      {/* Tampilan Tiket Digital & QR Code — wajib muncul untuk dokumen valid (BERHASIL/BURAM) */}
      {createdTicket && scanResult && isValidDocResult(scanResult) && (
        <div className="bg-slate-900 border border-blue-500/30 text-white rounded-2xl p-6 shadow-2xl relative overflow-hidden max-w-xl mx-auto">
          {/* Header Tiket */}
          <div className="flex justify-between items-start border-b border-slate-800 pb-4">
            <div>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-3 h-3" /> {createdTicket.status_verifikasi}
              </span>
              <h3 className="text-lg font-bold text-white mt-2">Tiket Layanan Fast-Track</h3>
              <p className="text-xs text-slate-400">Scan QR Code ini pada scanner loket kelurahan</p>
              {createdTicket.status_verifikasi === "BURAM" && (
                <p className="text-[11px] text-amber-300 mt-1">
                  Dokumen buram — QR tetap berlaku, bawa fisik dokumen asli untuk verifikasi ulang.
                </p>
              )}
            </div>
            <TicketIcon className="w-8 h-8 text-blue-400 opacity-75" />
          </div>

          {/* Body: QR Code & Detail Tiket */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-6 items-center">
            {/* Display QR Code */}
            <div className="flex flex-col items-center justify-center p-3 bg-white rounded-xl shadow-md w-fit mx-auto">
              <QRCodeSVG
                value={createdTicket.kode_tiket}
                size={130}
                bgColor="#FFFFFF"
                fgColor="#0F172A"
                level="H"
              />
              <span className="text-[10px] font-mono font-bold text-slate-700 mt-2">
                {createdTicket.kode_tiket}
              </span>
            </div>

            {/* Informasi Pemohon */}
            <div className="md:col-span-2 space-y-3 text-xs text-slate-300">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Kode Resi Tiket</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xl font-mono font-bold text-blue-400">{createdTicket.kode_tiket}</span>
                  <button
                    onClick={() => copyToClipboard(createdTicket.kode_tiket)}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition cursor-pointer"
                    title="Salin Kode"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">Nama Pemohon</span>
                  <span className="font-semibold text-white truncate block">{createdTicket.nama}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">NIK</span>
                  <span className="font-mono font-semibold text-white truncate block">
                    {createdTicket.nik && createdTicket.nik !== "0000000000000000"
                      ? createdTicket.nik
                      : "Belum terbaca — verifikasi di loket"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
