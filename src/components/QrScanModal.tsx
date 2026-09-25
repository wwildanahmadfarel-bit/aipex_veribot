import React, { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { X, Camera } from "lucide-react";
import { extractTicketCode } from "../lib/ticketQr";

interface QrScanModalProps {
  isOpen: boolean;
  onDetected: (kodeTiket: string) => void;
  onClose: () => void;
}

const REGION_ID = "aipex-qr-scan-region";

/** Modal kamera pemindai QR tiket (khusus QR buatan sistem). */
export const QrScanModal: React.FC<QrScanModalProps> = ({ isOpen, onDetected, onClose }) => {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const doneRef = useRef(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!isOpen) return;
    doneRef.current = false;
    setError("");
    let stopped = false;

    const start = async () => {
      try {
        // Konteks aman wajib untuk kamera (HTTPS / localhost).
        if (!window.isSecureContext) {
          setError("Kamera membutuhkan koneksi aman (HTTPS atau localhost). Gunakan ketik manual di bawah.");
          return;
        }
        const scanner = new Html5Qrcode(REGION_ID, { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0 },
          (decodedText) => {
            if (doneRef.current || stopped) return;
            const kode = extractTicketCode(decodedText);
            if (!kode) {
              setError("QR terbaca tapi bukan QR tiket AIPEX. Arahkan ke QR tiket yang benar.");
              return;
            }
            doneRef.current = true;
            onDetected(kode);
          },
          () => {
            // frame tanpa QR — abaikan diam-diam.
          }
        );
      } catch (err: any) {
        if (stopped) return;
        const msg = String(err?.message || err || "");
        if (/permission|NotAllowed/i.test(msg)) {
          setError("Izin kamera ditolak. Izinkan akses kamera di browser, atau gunakan ketik manual.");
        } else if (/notfound|NotFound|device/i.test(msg)) {
          setError("Kamera tidak ditemukan di perangkat ini. Gunakan ketik manual.");
        } else {
          setError("Kamera gagal dibuka. Gunakan ketik manual.");
        }
      }
    };

    // Tunggu 1 frame agar div region ter-mount sebelum start.
    const t = setTimeout(start, 60);
    return () => {
      stopped = true;
      clearTimeout(t);
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        try {
          const p = s.stop();
          if (p && typeof (p as Promise<void>).catch === "function") {
            (p as Promise<void>).catch(() => {});
          }
        } catch {}
        try {
          s.clear();
        } catch {}
      }
    };
  }, [isOpen, onDetected]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#1E293B]/80 backdrop-blur-xs p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Pindai QR tiket"
    >
      <div
        className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#2563EB] flex items-center justify-center">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#0F172A]">Pindai QR Tiket</h3>
              <p className="text-[11px] text-slate-500">Arahkan kamera ke QR tiket warga</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pemindai"
            className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          <div id={REGION_ID} className="w-full rounded-xl overflow-hidden bg-slate-950 min-h-[240px]" />
          {error ? (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5 mt-3 leading-relaxed">
              {error}
            </p>
          ) : (
            <p className="text-[11px] text-slate-500 mt-3 text-center">
              Menunggu QR tiket masuk bingkai kamera…
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default QrScanModal;
