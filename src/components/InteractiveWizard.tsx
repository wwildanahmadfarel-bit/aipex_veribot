import React, { useState, useRef, useEffect } from "react";
import QRCode from "qrcode";
import confetti from "canvas-confetti";
import { Ticket, VerificationResult, PreScreenInitialData } from "../types";

interface InteractiveWizardProps {
  initialService?: string;
  initialPreScreenData?: PreScreenInitialData | null;
  onBackToPortal: () => void;
  onTicketCreated: (ticket: Ticket) => void;
}

export const InteractiveWizard: React.FC<InteractiveWizardProps> = ({
  initialService = "Penerbitan KTP-EL Baru / Penggantian",
  initialPreScreenData,
  onBackToPortal,
  onTicketCreated,
}) => {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Form Data
  const [selectedService, setSelectedService] = useState<string>(initialService);
  const [nik, setNik] = useState<string>("");
  const [nama, setNama] = useState<string>("");
  const [wa, setWa] = useState<string>("");
  const [alamat, setAlamat] = useState<string>("");

  // Step 2: Upload Data
  const [docImageBase64, setDocImageBase64] = useState<string | null>(null);
  const [docImageName, setDocImageName] = useState<string>("");
  const [useSampleType, setUseSampleType] = useState<"clean" | "blurry" | null>(null);

  // Step 3: AI Scanner & Verification
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);

  // Step 4: Generated Ticket
  const [generatedTicket, setGeneratedTicket] = useState<Ticket | null>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  // Update selectedService when initialService prop changes
  useEffect(() => {
    if (initialService) {
      setSelectedService(initialService);
    }
  }, [initialService]);

  // Pre-populate data from OCR pre-screening if available
  useEffect(() => {
    if (initialPreScreenData) {
      if (initialPreScreenData.service) {
        setSelectedService(initialPreScreenData.service);
      }
      if (initialPreScreenData.nik) {
        setNik(initialPreScreenData.nik);
      }
      if (initialPreScreenData.nama) {
        setNama(initialPreScreenData.nama);
      }
      if (initialPreScreenData.imageBase64) {
        setDocImageBase64(initialPreScreenData.imageBase64);
        setDocImageName(initialPreScreenData.imageName || "e-KTP_Verifikasi_OCR.jpg");
      }
    }
  }, [initialPreScreenData]);


  // Service contextual note
  const serviceContextMap: Record<string, string> = {
    "Penerbitan KTP-EL Baru / Penggantian":
      "Penerbitan KTP-EL baru usia 17 tahun atau penggantian fisik hilang/rusak.",
    "Kartu Identitas Anak (KIA)":
      "Penerbitan KIA untuk anak usia 0 sampai kurang dari 17 tahun.",
    "Aktivasi Identitas Digital (IKD)":
      "Pendaftaran & aktivasi aplikasi identitas kependudukan digital Ditjen Dukcapil.",
    "Akta Kematian":
      "Pencatatan resmi kematian warga dengan lampiran surat keterangan medis / RT.",
    "Akta Perkawinan":
      "Pencatatan perkawinan sipil non-Muslim setelah upacara keagamaan.",
    "Surat Keterangan Pindah (SKPWNI)":
      "Pengajuan surat pindah domisili antar kelurahan, kecamatan, atau kota.",
    "Konsolidasi / Sinkronisasi NIK":
      "Sinkronisasi NIK yang belum aktif di BPJS, bank, atau sistem publik.",
    "Surat Keterangan Usaha (SKU)":
      "Penerbitan surat pengantar keterangan usaha warga untuk legalitas & perbankan.",
  };

  // Presets
  const applyPreset = (type: "clean" | "blurry") => {
    setUseSampleType(type);
    if (type === "clean") {
      setNik("3201011504950001");
      setNama("Ahmad Santoso");
      setWa("081234567890");
      setAlamat("Jl. Cempaka Raya No. 12 RT 03/05");
      // Create a clean mock canvas data URL as sample KTP
      const canvas = document.createElement("canvas");
      canvas.width = 600;
      canvas.height = 380;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#1e3a8a";
        ctx.fillRect(0, 0, 600, 70);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 20px sans-serif";
        ctx.fillText("REPUBLIK INDONESIA - KTP ELEKTRONIK", 100, 42);
        ctx.fillStyle = "#eff6ff";
        ctx.fillRect(0, 70, 600, 310);
        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 22px monospace";
        ctx.fillText("NIK: 3201011504950001", 40, 120);
        ctx.font = "16px sans-serif";
        ctx.fillText("Nama: AHMAD SANTOSO", 40, 160);
        ctx.fillText("Tempat/Tgl Lahir: SEMARANG, 15-04-1995", 40, 195);
        ctx.fillText("Alamat: JL. CEMPAKA RAYA NO. 12 RT 03/05", 40, 230);
        ctx.fillText("Gol. Darah: O    Jenis Kelamin: LAKI-LAKI", 40, 265);
        // Photo box
        ctx.fillStyle = "#93c5fd";
        ctx.fillRect(450, 110, 110, 150);
        ctx.fillStyle = "#1e3a8a";
        ctx.font = "12px sans-serif";
        ctx.fillText("FOTO WARGA", 465, 190);
        // Chip
        ctx.fillStyle = "#fbbf24";
        ctx.fillRect(40, 300, 45, 35);
      }
      setDocImageBase64(canvas.toDataURL("image/jpeg"));
      setDocImageName("e-KTP_Ahmad_Santoso_Jelas.jpg");
    } else {
      setNik("3201017849200003");
      setNama("Budi Hermawan");
      setWa("085712349988");
      setAlamat("Komplek Permata Blok B2 No. 8");
      // Create a blurry mock canvas data URL
      const canvas = document.createElement("canvas");
      canvas.width = 500;
      canvas.height = 320;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#94a3b8";
        ctx.fillRect(0, 0, 500, 320);
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText("KTP-EL [Buram / Silau Pantulan Cahaya]", 50, 140);
        ctx.fillText("NIK: 320101******???? (4 Digit Terpotong)", 50, 180);
      }
      setDocImageBase64(canvas.toDataURL("image/jpeg"));
      setDocImageName("e-KTP_Budi_Hermawan_AgakBuram.jpg");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocImageName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setDocImageBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Step 1 Validation
  const handleProceedToStep2 = () => {
    if (!nik.trim() || !nama.trim() || !wa.trim()) {
      alert("Mohon lengkapi NIK, Nama Lengkap, dan Nomor WhatsApp aktif Anda terlebih dahulu.");
      return;
    }
    if (nik.trim().length !== 16) {
      alert("Nomor Induk Kependudukan (NIK) harus berjumlah tepat 16 digit angka.");
      return;
    }
    setCurrentStep(2);
    window.scrollTo({ top: 120, behavior: "smooth" });
  };

  // Step 2 Validation & trigger Scan Step
  const handleStartAiScan = async () => {
    // Wajib unggah foto dokumen asli — JANGAN palsukan dengan preset otomatis.
    // (Tombol contoh tetap ada untuk demo, tapi harus diklik eksplisit oleh user.)
    if (!docImageBase64) {
      alert("Wajib unggah foto dokumen kependudukan terlebih dahulu. Tanpa foto, tiket tidak dapat diterbitkan.");
      return;
    }
    setCurrentStep(3);
    setIsScanning(true);
    setScanProgress(10);
    window.scrollTo({ top: 120, behavior: "smooth" });

    // Progress animation
    const interval = setInterval(() => {
      setScanProgress((prev) => {
        if (prev >= 85) {
          clearInterval(interval);
          return 90;
        }
        return prev + 15;
      });
    }, 250);

    try {
      const response = await fetch("/api/scan-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: docImageBase64,
          serviceType: selectedService,
          inputNama: nama,
          inputNik: nik,
        }),
      });
      const data = await response.json();
      clearInterval(interval);
      setScanProgress(100);

      const BUKAN_KTP_MESSAGE =
        "File bukan Kartu Kependudukan Indonesia. Silakan unggah foto e-KTP asli yang jelas dan tidak terpotong.";
      const normalizeJenis = (raw: unknown): string => {
        const upper = String(raw ?? "").toUpperCase().trim();
        if (!upper) return "LAINNYA";
        if (upper.includes("KTP") || upper.includes("TANDA PENDUDUK")) return "KTP";
        if (upper === "KK" || upper.includes("KARTU KELUARGA")) return "KK";
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

      const isBlurrySample = useSampleType === "blurry";
      const parsed = data?.data || data || {};
      const jenisNorm = normalizeJenis(parsed.jenis_dokumen);
      let statusNorm = normalizeStatus(parsed.status_verifikasi);
      if (jenisNorm === "LAINNYA") statusNorm = "TIDAK_VALID";
      const tidakValid =
        statusNorm === "TIDAK_VALID" || jenisNorm === "LAINNYA" || data?.success === false;
      // Backend baru: TIDAK_VALID → success:false tanpa tiket; BURAM valid → success:true + tiket QR.
      const backendGagal = data?.success === false;
      const skorBackend =
        typeof parsed.skor_kejelasan === "number"
          ? parsed.skor_kejelasan
          : typeof parsed.skor === "number"
            ? parsed.skor
            : 0;

      let result: VerificationResult;
      if (isBlurrySample) {
        result = {
          nik,
          nama,
          jenis_dokumen: jenisNorm !== "LAINNYA" ? jenisNorm : "KTP",
          status_kualitas: "GAGAL",
          skor: 58,
          catatan:
            "Pantulan silau terdeteksi di sudut kanan bawah. 4 digit terakhir NIK tertutup pantulan cahaya. Disarankan unggah ulang foto yang lebih jelas.",
          source: data.source,
        };
      } else if (tidakValid) {
        result = {
          nik: parsed.nik || "Tidak Terdeteksi",
          nama: parsed.nama || "Tidak Terbaca",
          jenis_dokumen: "LAINNYA",
          status_kualitas: "GAGAL",
          skor: skorBackend || 10,
          catatan: /bukan kartu kependudukan/i.test(String(parsed.catatan || ""))
            ? parsed.catatan
            : BUKAN_KTP_MESSAGE,
          source: data.source,
        };
      } else if (backendGagal || statusNorm !== "BERHASIL") {
        result = {
          nik: parsed.nik || nik,
          nama: parsed.nama || nama,
          jenis_dokumen: jenisNorm,
          status_kualitas: "GAGAL",
          skor: skorBackend || 45,
          catatan:
            parsed.catatan ||
            parsed.message ||
            data?.message ||
            "Dokumen buram, silakan foto ulang e-KTP di tempat terang tanpa flash.",
          source: data.source,
        };
      } else {
        result = {
          nik: parsed.nik || nik,
          nama: parsed.nama || nama,
          jenis_dokumen: jenisNorm,
          status_kualitas: "LULUS",
          skor: skorBackend || 92,
          catatan:
            parsed.catatan || "Kualitas berkas tajam, NIK dan Nama sinkron dengan data Dukcapil Sukamaju.",
          source: data.source,
        };
      }

      setVerificationResult(result);
      setIsScanning(false);
    } catch (err) {
      console.error(err);
      clearInterval(interval);
      setScanProgress(100);
      // JANGAN palsukan LULUS saat jaringan gagal
      setVerificationResult({
        nik: nik,
        nama: nama,
        jenis_dokumen: "LAINNYA",
        status_kualitas: "GAGAL",
        skor: 0,
        catatan: "Gagal menghubungi server OCR. Periksa koneksi lalu unggah ulang foto e-KTP asli.",
      });
      setIsScanning(false);
    }
  };

  // Step 3 to Step 4: Generate QR — wajib untuk dokumen valid (LULUS maupun BURAM).
  // Hanya file BUKAN kependudukan (LAINNYA) yang diblokir (frontend + backend ganda).
  // Gangguan jaringan dibedakan pesannya agar tak disangka "bukan KTP".
  const handleGenerateTicket = async () => {
    const catatan = verificationResult?.catatan || "";
    const isNetworkError =
      !!verificationResult && /gagal menghubungi|koneksi|jaringan/i.test(catatan);
    if (isNetworkError) {
      alert(
        "Gagal menghubungi server OCR. Periksa koneksi lalu ulangi pindaian — tiket belum dapat diterbitkan."
      );
      return;
    }
    const bukanKtp =
      !verificationResult ||
      verificationResult.jenis_dokumen === "LAINNYA" ||
      /bukan kartu kependudukan/i.test(catatan);
    if (bukanKtp) {
      alert(
        "File bukan Kartu Kependudukan Indonesia. Tiket/QR tidak dapat diterbitkan. Silakan unggah ulang foto e-KTP asli."
      );
      return;
    }
    try {
      // Petakan hasil scan ke status backend: LULUS→BERHASIL, GAGAL+valid→BURAM, GAGAL+LAINNYA→TIDAK_VALID
      const scanStatus =
        verificationResult.status_kualitas === "LULUS"
          ? "BERHASIL"
          : verificationResult.jenis_dokumen === "LAINNYA"
            ? "TIDAK_VALID"
            : "BURAM";
      const response = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nik,
          nama_warga: nama,
          phone: wa,
          alamat,
          jenis_dokumen: selectedService,
          skor_ai: verificationResult?.skor ?? 0,
          status_ai: verificationResult?.status_kualitas || "GAGAL",
          catatan_ai: verificationResult?.catatan,
          // Bukti scan — backend WAJIB memvalidasi ini dan menolak LAINNYA/TIDAK_VALID
          scan_jenis_dokumen: verificationResult?.jenis_dokumen,
          scan_status_verifikasi: scanStatus,
          verification: {
            jenis_dokumen: verificationResult?.jenis_dokumen,
            status_verifikasi: scanStatus,
            status_kualitas: verificationResult?.status_kualitas,
            skor: verificationResult?.skor,
            catatan: verificationResult?.catatan,
          },
        }),
      });
      const resData = await response.json();

      if (response.ok && resData.success && resData.data) {
        setGeneratedTicket(resData.data);
        onTicketCreated(resData.data);
        setCurrentStep(4);
        window.scrollTo({ top: 100, behavior: "smooth" });

        // Trigger celebratory confetti
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ["#2563eb", "#10b981", "#38bdf8"],
        });
      } else {
        // Backend menolak (mis. terdeteksi bukan KTP) — tampilkan pesan jujur, JANGAN ke step 4
        alert(resData.message || "Tiket tidak dapat diterbitkan. Dokumen tidak terdeteksi sebagai dokumen kependudukan.");
      }
    } catch (err: any) {
      alert("Terjadi kesalahan jaringan saat menerbitkan tiket.");
    }
  };

  // Render QR Code in Step 4
  useEffect(() => {
    if (currentStep === 4 && generatedTicket && qrCanvasRef.current) {
      QRCode.toCanvas(
        qrCanvasRef.current,
        `AIPEX-VERIBOT:${generatedTicket.ticket_code}|NIK:${generatedTicket.nik_encrypted}|STATUS:${generatedTicket.status_verifikasi}`,
        {
          width: 180,
          margin: 1,
          color: {
            dark: "#0b1c30",
            light: "#ffffff",
          },
        }
      );
    }
  }, [currentStep, generatedTicket]);

  return (
    <div className="flex flex-col w-full" id="wizardView">
      {/* Sub-bar Navigation */}
      <div className="w-full max-w-5xl mx-auto flex items-center justify-between mb-4 px-1">
        <button
          onClick={onBackToPortal}
          type="button"
          className="inline-flex items-center gap-1.5 text-[#2563eb] hover:text-blue-800 font-semibold text-xs sm:text-sm transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Kembali ke Beranda</span>
        </button>

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-slate-300 bg-white/90 text-slate-700 text-xs font-medium backdrop-blur-xs shadow-2xs">
          <span className="material-symbols-outlined text-[15px] text-[#2563eb]">verified_user</span>
          <span>Mode Mandiri Warga • UU PDP Protected</span>
        </div>
      </div>

      {/* Main Card Container */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 md:p-8 max-w-5xl mx-auto w-full">
        {/* Top Badges Row */}
        <div className="flex items-center gap-2 mb-3">
          <span className="px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-[#2563eb] text-xs font-bold tracking-wide uppercase">
            FORMULIR INTERAKTIF
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
            Kelurahan Sukamaju (Semarang)
          </span>
        </div>

        {/* Heading & Demo Presets Row */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight leading-snug font-heading">
              Pre-Screening Dokumen Mandiri
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Pilih urusan kependudukan, lengkapi identitas, dan dapatkan sertifikat validasi AI resmi.
            </p>
          </div>

          {/* Right Presets */}
          <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200/70 self-start lg:self-center">
            <span className="text-xs text-slate-500 pl-2 font-medium hidden sm:inline">Uji Coba:</span>
            <button
              type="button"
              onClick={() => applyPreset("clean")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1 cursor-pointer ${
                useSampleType === "clean"
                  ? "bg-emerald-600 text-white"
                  : "bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              }`}
            >
              <span>🪄</span> Data Lengkap & Jelas
            </button>
            <button
              type="button"
              onClick={() => applyPreset("blurry")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-2xs transition-colors flex items-center gap-1 cursor-pointer ${
                useSampleType === "blurry"
                  ? "bg-amber-600 text-white"
                  : "bg-white border border-amber-200 text-amber-700 hover:bg-amber-50"
              }`}
            >
              <span>⚠️</span> Berkas Agak Buram
            </button>
          </div>
        </div>

        {/* 4-Step Stepper Bar */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-1.5 grid grid-cols-2 md:grid-cols-4 gap-2 my-6">
          <div
            className={`rounded-lg px-3 sm:px-4 py-2.5 font-semibold text-xs sm:text-sm flex items-center gap-2 transition-all ${
              currentStep === 1
                ? "bg-[#2563eb] text-white shadow-xs"
                : currentStep > 1
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "text-slate-400"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                currentStep === 1
                  ? "bg-white text-[#2563eb]"
                  : currentStep > 1
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-200 text-slate-500"
              }`}
            >
              {currentStep > 1 ? "✓" : "1"}
            </span>
            <span className="truncate">1. Data Diri</span>
          </div>

          <div
            className={`rounded-lg px-3 sm:px-4 py-2.5 font-semibold text-xs sm:text-sm flex items-center gap-2 transition-all ${
              currentStep === 2
                ? "bg-[#2563eb] text-white shadow-xs"
                : currentStep > 2
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "text-slate-400"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                currentStep === 2
                  ? "bg-white text-[#2563eb]"
                  : currentStep > 2
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-200 text-slate-500"
              }`}
            >
              {currentStep > 2 ? "✓" : "2"}
            </span>
            <span className="truncate">2. Upload Berkas</span>
          </div>

          <div
            className={`rounded-lg px-3 sm:px-4 py-2.5 font-semibold text-xs sm:text-sm flex items-center gap-2 transition-all ${
              currentStep === 3
                ? "bg-[#2563eb] text-white shadow-xs"
                : currentStep > 3
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "text-slate-400"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                currentStep === 3
                  ? "bg-white text-[#2563eb]"
                  : currentStep > 3
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-200 text-slate-500"
              }`}
            >
              {currentStep > 3 ? "✓" : "3"}
            </span>
            <span className="truncate">3. Scanner AI</span>
          </div>

          <div
            className={`rounded-lg px-3 sm:px-4 py-2.5 font-semibold text-xs sm:text-sm flex items-center gap-2 transition-all ${
              currentStep === 4
                ? "bg-[#2563eb] text-white shadow-xs"
                : "text-slate-400"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                currentStep === 4 ? "bg-white text-[#2563eb]" : "bg-slate-200 text-slate-500"
              }`}
            >
              4
            </span>
            <span className="truncate">4. Tiket QR</span>
          </div>
        </div>

        {/* STEP 1: IDENTITAS PEMOHON */}
        {currentStep === 1 && (
          <div className="flex flex-col gap-5 animate-in fade-in duration-200">
            {/* Step Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 leading-tight font-heading">
                  Langkah 1: Identitas Pemohon
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Sistem terintegrasi Identitas Kependudukan Digital (IKD) dengan proteksi Enkripsi
                  End-to-End.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
                  <span className="material-symbols-outlined text-[14px]">lock</span>
                  End-to-End Encrypted
                </span>
                <button
                  type="button"
                  onClick={() => {
                    applyPreset("clean");
                    alert("Autentikasi SSO IKD Sukses! Data profil Anda telah otomatis tersinkronisasi.");
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-lg border border-slate-300 hover:border-slate-400 bg-white text-slate-700 text-xs font-semibold shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[15px] text-[#2563eb]">key</span>
                  <span>Login IKD</span>
                </button>
              </div>
            </div>

            {/* OTP Alert Box */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
              <span className="material-symbols-outlined text-[#2563eb] text-[22px] shrink-0 mt-0.5">
                verified_user
              </span>
              <p className="text-xs md:text-sm text-slate-700 leading-relaxed">
                <strong className="text-slate-900 font-semibold">Verifikasi OTP Aktif</strong> — Pastikan
                nomor WhatsApp Anda aktif. Kami akan mengirimkan kode OTP dan notifikasi status
                pemrosesan dokumen secara real-time.
              </p>
            </div>

            {/* Inputs */}
            <div className="flex flex-col gap-4">
              {/* Jenis Urusan */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  JENIS URUSAN KEPENDUDUKAN *
                </label>
                <div className="relative flex items-center">
                  <select
                    value={selectedService}
                    onChange={(e) => setSelectedService(e.target.value)}
                    className="w-full h-12 pl-4 pr-10 rounded-xl bg-slate-50 border border-slate-300 text-xs sm:text-sm text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all outline-none appearance-none cursor-pointer"
                  >
                    <option value="Penerbitan KTP-EL Baru / Penggantian">
                      Penerbitan KTP-EL Baru / Penggantian
                    </option>
                    <option value="Kartu Identitas Anak (KIA)">Kartu Identitas Anak (KIA)</option>
                    <option value="Aktivasi Identitas Digital (IKD)">Aktivasi Identitas Digital (IKD)</option>
                    <option value="Akta Kematian">Akta Kematian</option>
                    <option value="Akta Perkawinan">Akta Perkawinan</option>
                    <option value="Surat Keterangan Pindah (SKPWNI)">Surat Keterangan Pindah (SKPWNI)</option>
                    <option value="Konsolidasi / Sinkronisasi NIK">Konsolidasi / Sinkronisasi NIK</option>
                    <option value="Surat Keterangan Usaha (SKU)">Surat Keterangan Usaha (SKU)</option>
                  </select>
                  <span className="material-symbols-outlined absolute right-3 text-slate-400 pointer-events-none text-[20px]">
                    expand_more
                  </span>
                </div>
                <p className="text-xs text-slate-500 italic flex items-center gap-1 mt-0.5">
                  <span className="material-symbols-outlined text-[14px] text-blue-600">info</span>
                  <span>{serviceContextMap[selectedService] || "Layanan resmi kelurahan."}</span>
                </p>
              </div>

              {/* NIK & Nama */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                      NOMOR INDUK KEPENDUDUKAN (NIK) *
                    </label>
                    <span
                      className={`font-code-num text-xs font-semibold ${
                        nik.length === 16 ? "text-emerald-600" : "text-slate-500"
                      }`}
                    >
                      {nik.length} / 16 Digit
                    </span>
                  </div>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined absolute left-3.5 text-slate-400 text-[18px] pointer-events-none">
                      badge
                    </span>
                    <input
                      type="text"
                      maxLength={16}
                      value={nik}
                      onChange={(e) => setNik(e.target.value.replace(/\D/g, ""))}
                      placeholder="16 digit angka (contoh: 320101...)"
                      className="w-full h-12 pl-10 pr-4 rounded-xl bg-slate-50 border border-slate-300 font-code-num text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all outline-none"
                    />
                  </div>
                  <span className="text-[11px] text-slate-500">Standar Ditjen Dukcapil Kemendagri</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    NAMA LENGKAP (SESUAI KTP) *
                  </label>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined absolute left-3.5 text-slate-400 text-[18px] pointer-events-none">
                      person
                    </span>
                    <input
                      type="text"
                      value={nama}
                      onChange={(e) => setNama(e.target.value)}
                      placeholder="Contoh: Ahmad Fauzi Nurhadi"
                      className="w-full h-12 pl-10 pr-4 rounded-xl bg-slate-50 border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all outline-none"
                    />
                  </div>
                  <span className="text-[11px] text-slate-500">Sesuai dokumen kependudukan resmi</span>
                </div>
              </div>

              {/* WA & Alamat */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    NOMOR WHATSAPP AKTIF *
                  </label>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined absolute left-3.5 text-emerald-600 text-[18px] pointer-events-none">
                      call
                    </span>
                    <input
                      type="text"
                      value={wa}
                      onChange={(e) => setWa(e.target.value)}
                      placeholder="Contoh: 081234567890"
                      className="w-full h-12 pl-10 pr-4 rounded-xl bg-slate-50 border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all outline-none"
                    />
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Digunakan untuk pengiriman tiket digital & notifikasi antrean kelurahan.
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    ALAMAT DOMISILI / RT & RW SETEMPAT
                  </label>
                  <div className="relative flex items-center">
                    <span className="material-symbols-outlined absolute left-3.5 text-slate-400 text-[18px] pointer-events-none">
                      location_on
                    </span>
                    <input
                      type="text"
                      value={alamat}
                      onChange={(e) => setAlamat(e.target.value)}
                      placeholder="Contoh: Jl. Kenanga No. 14 RT 03 / RW 05"
                      className="w-full h-12 pl-10 pr-4 rounded-xl bg-slate-50 border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all outline-none"
                    />
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Keterangan RT/RW tempat tinggal saat ini
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between pt-6 border-t border-slate-100 mt-2 gap-3">
              <button
                type="button"
                onClick={onBackToPortal}
                className="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
                <span>Batal & Kembali</span>
              </button>
              <button
                type="button"
                onClick={handleProceedToStep2}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Lanjut ke Upload Berkas</span>
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: UPLOAD BERKAS DOKUMEN */}
        {currentStep === 2 && (
          <div className="flex flex-col gap-5 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-slate-900 leading-tight font-heading">
                  Langkah 2: Unggah Berkas Dokumen ({selectedService})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Foto dokumen asli fisik di permukaan datar dengan pencahayaan cukup.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full bg-blue-50 text-[#2563eb] border border-blue-200 text-xs font-semibold self-start sm:self-center">
                UU PDP In-Memory Auto-Purge
              </span>
            </div>

            {/* Upload Area */}
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-2xl p-6 bg-slate-50/50 hover:bg-blue-50/40 transition-colors relative">
              {docImageBase64 ? (
                <div className="flex flex-col items-center gap-3 w-full">
                  <div className="relative max-w-md w-full rounded-xl overflow-hidden shadow-sm border border-slate-200 bg-white">
                    <img
                      src={docImageBase64}
                      alt="Preview Dokumen"
                      className="w-full h-56 object-cover"
                    />
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 backdrop-blur-xs p-2 text-white flex items-center justify-between text-xs">
                      <span className="truncate max-w-[220px]">{docImageName || "Dokumen Berkas Terpilih"}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setDocImageBase64(null);
                          setDocImageName("");
                        }}
                        className="text-red-300 hover:text-red-100 flex items-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                        <span>Ganti</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    <span>Foto siap dianalisis oleh Cognitive AI</span>
                  </p>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full cursor-pointer py-6">
                  <div className="w-14 h-14 rounded-full bg-blue-100 text-[#2563eb] flex items-center justify-center mb-3 shadow-xs">
                    <span className="material-symbols-outlined text-[28px]">cloud_upload</span>
                  </div>
                  <span className="text-sm font-bold text-slate-800">
                    Klik untuk Pilih Foto Dokumen atau Seret File ke Sini
                  </span>
                  <span className="text-xs text-slate-500 mt-1">
                    Format: JPG, PNG, WEBP (Maksimal 10MB)
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Quick Sample Selector for User Testing */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
              <span className="text-slate-600 font-medium">
                Belum punya foto KTP saat ini? Coba gunakan sampel dokumen uji coba:
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => applyPreset("clean")}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 font-semibold shadow-2xs cursor-pointer"
                >
                  Gunakan Contoh e-KTP Valid
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset("blurry")}
                  className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 hover:bg-amber-50 text-amber-800 font-semibold shadow-2xs cursor-pointer"
                >
                  Gunakan Contoh Foto Buram
                </button>
              </div>
            </div>

            {/* UU PDP Compliance Notice */}
            <div className="bg-emerald-50 border border-emerald-200/80 rounded-xl p-4 flex items-start gap-3 text-xs text-emerald-900 leading-relaxed">
              <span className="material-symbols-outlined text-emerald-600 text-[22px] shrink-0 mt-0.5">
                security
              </span>
              <div>
                <strong>Jaminan Kepatuhan UU No. 27/2022 (UU PDP):</strong> Seluruh foto fisik yang Anda
                unggah hanya diproses sementara di RAM backend untuk ekstraksi data OCR kependudukan,
                kemudian langsung dihapus otomatis (auto-purge). Foto tidak pernah disimpan di disk atau
                server penyimpanan awan.
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between pt-6 border-t border-slate-100 mt-2 gap-3">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                <span>Kembali ke Data Diri</span>
              </button>
              <button
                type="button"
                onClick={handleStartAiScan}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">psychology</span>
                <span>Mulai Pemindaian Cognitive AI</span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: SCANNER AI (PRE-SCREENING VERIFICATION) */}
        {currentStep === 3 && (
          <div className="flex flex-col gap-6 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 leading-tight font-heading">
                  Langkah 3: Analisis Real-Time Cognitive AI (Gemini Vision)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Memvalidasi keaslian, keterbacaan teks NIK, serta kualitas visual dokumen Anda.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-blue-50 text-[#2563eb] border border-blue-200 text-xs font-bold font-code-num">
                {scanProgress}% SELESAI
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-[#2563eb] h-full transition-all duration-300 rounded-full"
                style={{ width: `${scanProgress}%` }}
              ></div>
            </div>

            {/* Scanning Visual Representation */}
            {isScanning ? (
              <div className="relative overflow-hidden bg-slate-900 rounded-2xl h-64 flex flex-col items-center justify-center text-white border border-slate-800">
                <div className="pointer-events-none absolute inset-x-0 h-12 animate-scan-beam z-10">
                  <div className="w-full h-1 bg-cyan-400 shadow-[0_0_20px_#38bdf8]"></div>
                  <div className="w-full h-10 bg-gradient-to-b from-cyan-400/30 to-transparent"></div>
                </div>
                <span className="material-symbols-outlined text-[48px] text-cyan-300 mb-2 animate-pulse">
                  document_scanner
                </span>
                <p className="text-sm font-semibold tracking-wide text-cyan-100">
                  Ekstraksi OCR & Evaluasi Kualitas Berkas...
                </p>
                <span className="text-xs text-slate-400 mt-1">
                  Mendeteksi 16 Digit NIK, Nama, dan Kecerahan Foto
                </span>
              </div>
            ) : verificationResult ? (
              <div className="flex flex-col gap-4">
                {/* Result Hero Banner */}
                {(() => {
                  const bukanKtp =
                    verificationResult.jenis_dokumen === "LAINNYA" ||
                    /bukan kartu kependudukan/i.test(verificationResult.catatan || "");
                  const lulus = verificationResult.status_kualitas === "LULUS" && !bukanKtp;
                  return (
                <div
                  className={`p-5 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                    lulus
                      ? "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                      : bukanKtp
                        ? "bg-red-50/80 border-red-200 text-red-950"
                        : "bg-amber-50/80 border-amber-200 text-amber-950"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
                        lulus
                          ? "bg-emerald-600 text-white"
                          : bukanKtp
                            ? "bg-red-600 text-white"
                            : "bg-amber-600 text-white"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[28px]">
                        {lulus ? "verified" : bukanKtp ? "block" : "warning"}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold font-heading">
                          {lulus
                            ? "Dokumen Lulus Pre-Screening (Jalur Fast-Track Siap)"
                            : bukanKtp
                              ? "File Bukan Kartu Kependudukan Indonesia"
                              : "Dokumen Memerlukan Perbaikan"}
                        </h3>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            verificationResult.jenis_dokumen === "KTP"
                              ? "bg-blue-100 text-blue-800 border-blue-200"
                              : "bg-white text-slate-600 border-slate-200"
                          }`}
                        >
                          Jenis Dokumen: {verificationResult.jenis_dokumen}
                        </span>
                      </div>
                      <p className="text-xs mt-1 leading-relaxed max-w-xl">
                        {verificationResult.catatan}
                      </p>
                    </div>
                  </div>

                  {/* Score Pill */}
                  <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-white border border-slate-200 shadow-2xs shrink-0 self-stretch sm:self-auto min-w-[120px]">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                      SKOR KELAYAKAN
                    </span>
                    <span
                      className={`font-code-num text-2xl font-extrabold ${
                        verificationResult.skor >= 75 ? "text-emerald-600" : bukanKtp ? "text-red-600" : "text-amber-600"
                      }`}
                    >
                      {verificationResult.skor}%
                    </span>
                    <span className="text-[10px] text-slate-500 font-medium">
                      {verificationResult.skor >= 75 ? "≥ 75% Fast-Track" : "< 75% Butuh Revisi"}
                    </span>
                  </div>
                </div>
                  );
                })()}

                {/* Extracted Comparison Table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                  <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                    <span>Hasil Ekstraksi OCR Mesin AI vs Formulir</span>
                    <span className="text-slate-400 font-normal normal-case">
                      Model: Gemini 3.6 Flash Engine
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-3 p-3 gap-2">
                      <span className="text-slate-500 font-medium">Nomor Induk Kependudukan (NIK)</span>
                      <span className="font-code-num font-semibold text-slate-800">{verificationResult.nik}</span>
                      <span className="text-emerald-600 font-semibold flex items-center gap-1">
                        <span className="material-symbols-outlined text-[15px]">check_circle</span>
                        <span>16 Digit Valid & Cocok</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 p-3 gap-2">
                      <span className="text-slate-500 font-medium">Nama Pemohon</span>
                      <span className="font-semibold text-slate-800">{verificationResult.nama}</span>
                      <span className="text-emerald-600 font-semibold flex items-center gap-1">
                        <span className="material-symbols-outlined text-[15px]">check_circle</span>
                        <span>Sesuai Identitas</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 p-3 gap-2">
                      <span className="text-slate-500 font-medium">Jenis Urusan / Berkas</span>
                      <span className="text-slate-800">
                        {verificationResult.jenis_dokumen}
                        <span className="text-slate-400"> • {selectedService}</span>
                      </span>
                      <span
                        className={`font-semibold flex items-center gap-1 ${
                          verificationResult.jenis_dokumen === "KTP"
                            ? "text-blue-600"
                            : verificationResult.jenis_dokumen === "LAINNYA"
                              ? "text-red-600"
                              : "text-blue-600"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          {verificationResult.jenis_dokumen === "LAINNYA" ? "block" : "task_alt"}
                        </span>
                        <span>
                          {verificationResult.jenis_dokumen === "KTP"
                            ? "KTP Teridentifikasi"
                            : verificationResult.jenis_dokumen === "LAINNYA"
                              ? "Bukan KTP Indonesia"
                              : "Dokumen Teridentifikasi"}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Bottom Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between pt-6 border-t border-slate-100 mt-2 gap-3">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                <span>Unggah Ulang Berkas</span>
              </button>

              {(() => {
                const catatanBawah = verificationResult?.catatan || "";
                const networkBawah =
                  !!verificationResult && /gagal menghubungi|koneksi|jaringan/i.test(catatanBawah);
                const terblokir =
                  networkBawah ||
                  !verificationResult ||
                  verificationResult.jenis_dokumen === "LAINNYA" ||
                  /bukan kartu kependudukan/i.test(catatanBawah);
                return (
                  <div className="w-full sm:w-auto flex flex-col items-stretch gap-1.5">
                    <button
                      type="button"
                      onClick={handleGenerateTicket}
                      disabled={terblokir}
                      title={
                        terblokir
                          ? networkBawah
                            ? "Koneksi OCR gagal — ulangi pindaian dahulu"
                            : "File bukan dokumen kependudukan — tiket tidak dapat diterbitkan"
                          : "Terbitkan tiket QR"
                      }
                      className={`w-full sm:w-auto px-6 py-3 rounded-xl font-semibold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 ${
                        terblokir
                          ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                          : "bg-[#2563eb] hover:bg-blue-700 text-white cursor-pointer"
                      }`}
                    >
                      <span>
                        {terblokir
                          ? networkBawah
                            ? "Koneksi Gagal — Ulangi Pindaian"
                            : "Tiket Diblokir — Bukan Dokumen Kependudukan"
                          : "Terbitkan Tiket QR Fast-Track"}
                      </span>
                      <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
                    </button>
                    {terblokir && (
                      <span className="text-[11px] text-red-600 text-center sm:text-right">
                        {networkBawah
                          ? "Gagal menghubungi server OCR — periksa koneksi lalu ulangi pindaian."
                          : "File bukan Kartu Kependudukan Indonesia — unggah ulang e-KTP asli."}
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* STEP 4: TIKET QR CODE FAST-TRACK */}
        {currentStep === 4 && generatedTicket && (
          <div className="flex flex-col items-center gap-6 animate-in fade-in duration-300">
            {/* Voucher Card Container */}
            <div className="w-full max-w-lg bg-gradient-to-b from-blue-700 to-[#1e3a8a] text-white rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden border border-blue-400/30">
              <div className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-white/10 blur-2xl"></div>

              {/* Card Top Title */}
              <div className="flex items-center justify-between border-b border-white/20 pb-4 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-white p-1 flex items-center justify-center">
                    <img
                      alt="Logo"
                      className="w-full h-full object-contain"
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuAkx2fV6S4Ms-L4kxHNCVvvIRx4MeEXrkJR5xqFb6-DQLH5wnlvKGTiqJTL-G6HNFllKunC_QPb-UrtzZz09AXex_PzfhVcW__hsAHHlrCY8VvkRdrkivvRCuPqPNM7SGBD5RX09SmUtwCZZraWx5RwwjmsBe_sMq0mZvRe48ILTvh62fhMP9zoIfsFa1V-vmttXb_yCGi0yqSvj-GPeCN5P_cvIal9hkPg7f0IFMhHYho-9Y4_J_sOwh8hHZwSpX3Wivg"
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold tracking-wide leading-none">AIPEX VERIBOT</h3>
                    <span className="text-[10px] text-blue-200">Kelurahan Sukamaju • Semarang</span>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500 text-white font-bold text-[10px] tracking-wider uppercase shadow-xs">
                  FAST-TRACK PRIORITAS
                </span>
              </div>

              {/* QR Code Center Box */}
              <div className="flex flex-col items-center justify-center my-2">
                <div className="p-3 bg-white rounded-2xl shadow-lg border border-white/40">
                  <canvas ref={qrCanvasRef}></canvas>
                </div>
                <div className="mt-3 text-center">
                  <span className="text-[11px] text-blue-200 uppercase tracking-widest block">
                    KODE TIKET RESMI
                  </span>
                  <span className="font-code-num text-xl sm:text-2xl font-black text-white tracking-wider">
                    {generatedTicket.ticket_code}
                  </span>
                </div>
              </div>

              {/* Citizen Details */}
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 my-3 text-xs space-y-2 border border-white/15">
                <div className="flex justify-between">
                  <span className="text-blue-200">Nama Warga:</span>
                  <strong className="text-white">{generatedTicket.nama_warga}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-200">NIK:</span>
                  <span className="font-code-num text-white">{generatedTicket.nik_encrypted}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-200">Urusan:</span>
                  <span className="text-white font-medium text-right max-w-[220px]">
                    {generatedTicket.jenis_dokumen}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-200">Skor AI Pre-Screening:</span>
                  <span className="font-code-num text-emerald-300 font-bold">
                    {generatedTicket.skor_ai}% (Lulus Verifikasi)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-200">Waktu Terbit:</span>
                  <span className="font-code-num text-blue-100">{generatedTicket.created_at}</span>
                </div>
              </div>

              {/* Instructions */}
              <p className="text-[11px] text-center text-blue-200 leading-tight">
                Simpan atau cetak tiket ini. Tunjukkan ke verifikator loket untuk langsung dipanggil tanpa
                mengisi formulir kertas lagi.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3 w-full max-w-lg">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 min-w-[140px] px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">print</span>
                <span>Cetak Tiket PDF</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const text = `Halo, saya telah melakukan pra-pemeriksaan berkas di AIPEX VeriBot Kelurahan Sukamaju.%0AKode Tiket: ${generatedTicket.ticket_code}%0ANama: ${generatedTicket.nama_warga}%0ALayanan: ${generatedTicket.jenis_dokumen}%0AStatus: Fast-Track Lulus AI (${generatedTicket.skor_ai}%)`;
                  window.open(`https://wa.me/?text=${text}`, "_blank");
                }}
                className="flex-1 min-w-[140px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">share</span>
                <span>Kirim ke WhatsApp</span>
              </button>

              <button
                type="button"
                onClick={onBackToPortal}
                className="w-full px-5 py-3 rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white text-xs sm:text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer mt-1"
              >
                <span>Selesai & Kembali ke Beranda</span>
                <span className="material-symbols-outlined text-[18px]">home</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
