import React, { useState, useRef, useEffect } from "react";
import QRCode from "qrcode";
import confetti from "canvas-confetti";
import { Ticket, VerificationResult, PreScreenInitialData, PreScreenPage } from "../types";
import { buildTicketQrText, downloadTicketQrPng } from "../lib/ticketQr";
import { AipexLogo } from "./AipexLogo";
import { JENIS_NIK_OPSIONAL, jenisLabel, normalizeJenis } from "../lib/jenisDokumen";
import { catalogServices } from "../data/servicesData";
import { BLUR_SEVERITY_STYLE, blurAreaLabel, normalizeBlurAreas } from "../lib/blurAreas";
import { buildScanRecommendations } from "../lib/recommendations";
import { BUKAN_KTP_MESSAGE } from "../lib/messages";
import { RecommendationCard } from "./RecommendationCard";
import {
  clearDraft,
  loadDraft,
  saveDraft,
  type CombinedPdfPage,
  type WizardDraft,
} from "../lib/draftStore";
import { PdfCombinedUpload, type CombinedPdfReadyPage } from "./PdfCombinedUpload";
import {
  assignmentsToUploads,
  buildDefaultAssignments,
  isUsablePage,
  mainPageIdentityNote,
  summarizeIdentities,
  type PageAssignment,
  type PageAssignments,
} from "../lib/preScreenPages";
import {
  PAGE_STARTED_AT,
  formatCountdown,
  getCooldownSec,
  getQuotaState,
  getTurnstileSiteKey,
  getTurnstileToken,
  isQuotaFreeCode,
  recordScanAttempt,
  setCooldown,
} from "../lib/antiSpam";

interface InteractiveWizardProps {
  initialService?: string;
  initialPreScreenData?: PreScreenInitialData | null;
  onBackToPortal: () => void;
  onTicketCreated: (ticket: Ticket) => void;
}

const isPdfDataUrl = (value?: string | null): boolean =>
  !!value && /^data:application\/pdf[;,]/.test(value);

const toDataUrl = (base64: string, mimeType: string): string =>
  /^data:/.test(base64) ? base64 : `data:${mimeType || "application/pdf"};base64,${base64}`;

const formatDraftTime = (ts?: number): string => {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
};

const MAX_FILE_MB = 4;

/** Syarat WAJIB untuk sebuah layanan (sumber: servicesData.ts). */
const getRequiredDocsForService = (service: string) => {
  const svc = catalogServices.find((s) => s.title === service);
  const wajib = svc?.requirements.filter((r) => r.mandatory) || [];
  if (wajib.length > 0) return wajib;
  return [{ title: "Foto Dokumen Kependudukan", description: "Foto asli dokumen (JPG/PNG/WEBP).", mandatory: true }];
};


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
  // Slot 0 (docImageBase64) = dokumen UTAMA, dipindai AI di Langkah 3.
  // Slot 1..N (supportFiles) = berkas pendukung WAJIB sesuai syarat layanan.
  const [docImageBase64, setDocImageBase64] = useState<string | null>(null);
  const [docImageName, setDocImageName] = useState<string>("");
  const [supportFiles, setSupportFiles] = useState<{ base64: string; name: string }[]>([]);
  // Halaman hasil pra-pemeriksaan OCR (PDF multi-halaman) + pemetaan ke slot syarat.
  const [preScreenPages, setPreScreenPages] = useState<PreScreenPage[]>([]);
  const [pageAssignments, setPageAssignments] = useState<PageAssignments>({});

  // Mode unggah: foto/PDF terpisah per slot, atau SATU PDF gabungan (dipecah di browser).
  const [uploadMode, setUploadMode] = useState<"individual" | "combined">("individual");
  const [combinedPages, setCombinedPages] = useState<CombinedPdfPage[]>([]);

  // Draft IndexedDB (TTL 24 jam) + guard keluar.
  const [draftBanner, setDraftBanner] = useState<WizardDraft | null>(null);
  const [draftReady, setDraftReady] = useState<boolean>(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState<boolean>(false);
  const applyingDraftRef = useRef<boolean>(false);
  const draftSuppressedRef = useRef<boolean>(false);
  const draftSnapshotRef = useRef<Omit<WizardDraft, "id" | "updatedAt" | "expiresAt"> | null>(null);
  const saveNowRef = useRef<() => Promise<void>>(async () => {});
  // Refs for file inputs to clear them after validation
  const mainFileInputRef = useRef<HTMLInputElement>(null);

  // Daftar berkas WAJIB mengikuti syarat layanan (badge WAJIB di katalog).
  // Sumber kebenaran tunggal: servicesData.ts — ubah di sana bila ketentuan berubah.
  const requiredDocs = getRequiredDocsForService(selectedService);
  const supportDocs = requiredDocs.slice(1);

  // ---------------------------------------------------------------------
  // Pemetaan halaman OCR → slot syarat (dokumen utama + lampiran).
  // ---------------------------------------------------------------------
  const getMainIndexFromAssignments = (assignments: PageAssignments): number => {
    const entry = Object.entries(assignments).find(([, a]) => a.kind === "main");
    return entry ? Number(entry[0]) : -1;
  };

  const shouldAutoFillApplicant = (service: string, mainPage: PreScreenPage | null): boolean => {
    if (!mainPage || !isUsablePage(mainPage)) return false;
    // Akta kematian memuat data almarhum — jangan pernah dipakai sebagai pemohon.
    if (/akta kematian/i.test(service)) return false;
    if (normalizeJenis(mainPage.result.jenis_dokumen) === "AKTA_KEMATIAN") return false;
    if (normalizeJenis(initialPreScreenData?.jenisDokumen) === "AKTA_KEMATIAN") return false;
    return true;
  };

  /**
   * Isi NIK/nama dari dokumen utama. Nilai yang sudah diketik manual TIDAK
   * ditimpa, kecuali `force` (inisialisasi awal) atau masih sama dengan
   * identitas dokumen utama sebelumnya.
   */
  const syncIdentityFromMainPage = (
    nextMain: PreScreenPage | null,
    prevMain: PreScreenPage | null,
    service: string,
    force = false
  ) => {
    const autoFill = shouldAutoFillApplicant(service, nextMain);
    const nextNik = autoFill ? nextMain?.verification.nik || "" : "";
    const nextNama = autoFill ? nextMain?.verification.nama || "" : "";
    const prevNik = prevMain?.verification.nik || "";
    const prevNama = prevMain?.verification.nama || "";
    setNik((current) => (force || !current.trim() || current === prevNik ? nextNik : current));
    setNama((current) => (force || !current.trim() || current === prevNama ? nextNama : current));
  };

  /** Tulis assignment ke state upload wizard (dokumen utama + supportFiles). */
  const applyPreScreenAssignments = (
    pages: PreScreenPage[],
    requirements: ReturnType<typeof getRequiredDocsForService>,
    assignments: PageAssignments,
    service: string,
    options: { prevMain?: PreScreenPage | null; forceIdentity?: boolean } = {}
  ) => {
    const { mainPage, supportFiles: mapped } = assignmentsToUploads(pages, requirements, assignments);
    setPageAssignments(assignments);
    setSupportFiles(mapped);
    setUploadMode("individual");
    setCombinedPages([]);
    if (!mainPage) {
      setDocImageBase64(null);
      setDocImageName("");
      setVerificationResult(null);
      return;
    }
    setDocImageBase64(mainPage.imageBase64);
    setDocImageName(mainPage.imageName);
    setVerificationResult(isUsablePage(mainPage) ? mainPage.verification : null);
    syncIdentityFromMainPage(mainPage, options.prevMain || null, service, options.forceIdentity === true);
  };

  /** Petakan ulang halaman saat layanan berganti — tanpa memindai ulang. */
  const remapPreScreenForService = (
    service: string,
    options: { preferredMainIndex?: number; forceIdentity?: boolean; pages?: PreScreenPage[] } = {}
  ) => {
    const pages = options.pages || preScreenPages;
    if (!pages.length) return;
    const requirements = getRequiredDocsForService(service);
    const prevMain = pages[getMainIndexFromAssignments(pageAssignments)] || null;
    const { assignments } = buildDefaultAssignments(pages, requirements, options.preferredMainIndex);
    applyPreScreenAssignments(pages, requirements, assignments, service, {
      prevMain,
      forceIdentity: options.forceIdentity,
    });
  };

  /** Pengguna mengganti berkas manual → pemetaan otomatis dilepas. */
  const detachPreScreenMapping = () => {
    if (!preScreenPages.length && !Object.keys(pageAssignments).length) return;
    setPreScreenPages([]);
    setPageAssignments({});
  };

  const handleServiceChange = (nextService: string) => {
    setSelectedService(nextService);
    if (preScreenPages.length > 0) {
      remapPreScreenForService(nextService);
    } else {
      // Perilaku lama: syarat berkas berubah → ulangi upload dari nol.
      resetAllUploads();
    }
  };

  /** Halaman valid terbaik selain `excludeIndex` untuk menggantikan dokumen utama. */
  const pickFallbackMainIndex = (excludeIndex: number): number => {
    const usable = preScreenPages
      .map((page, index) => ({ page, index }))
      .filter(({ page, index }) => index !== excludeIndex && isUsablePage(page));
    if (!usable.length) return -1;
    const ktp = usable
      .filter(({ page }) => page.result.jenis_dokumen === "KTP")
      .sort((a, b) => b.page.result.skor_kejelasan - a.page.result.skor_kejelasan)[0];
    return (ktp || usable[0]).index;
  };

  /** Koreksi manual pemetaan halaman → dokumen utama / slot lampiran. */
  const handleAssignmentChange = (pageIndex: number, value: string) => {
    const page = preScreenPages[pageIndex];
    if (!page) return;
    if (value !== "unused" && !isUsablePage(page)) return;

    const prevMainIndex = getMainIndexFromAssignments(pageAssignments);
    const prevMain = preScreenPages[prevMainIndex] || null;
    const next: PageAssignments = { ...pageAssignments };

    const clearMain = () => {
      for (const key of Object.keys(next)) {
        if (next[Number(key)].kind === "main") next[Number(key)] = { kind: "unused" };
      }
    };
    const clearSupportSlot = (slot: number) => {
      for (const key of Object.keys(next)) {
        const a = next[Number(key)];
        if (a.kind === "support" && a.slot === slot) next[Number(key)] = { kind: "unused" };
      }
    };

    if (value === "main") {
      clearMain();
      next[pageIndex] = { kind: "main" };
    } else if (value.startsWith("support:")) {
      const slot = Number(value.slice("support:".length));
      if (!Number.isInteger(slot) || slot < 1 || slot >= requiredDocs.length) return;
      if (prevMainIndex === pageIndex) {
        const fallback = pickFallbackMainIndex(pageIndex);
        if (fallback < 0) return; // jangan tinggalkan wizard tanpa dokumen utama
        clearSupportSlot(slot);
        next[fallback] = { kind: "main" };
      } else {
        clearSupportSlot(slot);
      }
      next[pageIndex] = { kind: "support", slot };
    } else {
      if (prevMainIndex === pageIndex) {
        const fallback = pickFallbackMainIndex(pageIndex);
        if (fallback < 0) return;
        next[fallback] = { kind: "main" };
      }
      next[pageIndex] = { kind: "unused" };
    }

    applyPreScreenAssignments(preScreenPages, requiredDocs, next, selectedService, { prevMain });
  };

  /** Reset seluruh file saat ganti jenis urusan (slot mengikuti syarat layanan baru). */
  const resetAllUploads = () => {
    setDocImageBase64(null);
    setDocImageName("");
    setSupportFiles([]);
    setCombinedPages([]);
    setUploadMode("individual");
    setVerificationResult(null); // Clear stale scan result when service changes
    setPreScreenPages([]);
    setPageAssignments({});
  };

  // Step 3: AI Scanner & Verification
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  // Overlay area buram pada pratinjau foto (default tampil, bisa disembunyikan warga).
  const [showBlurAreas, setShowBlurAreas] = useState<boolean>(true);

  // Step 4: Generated Ticket
  const [generatedTicket, setGeneratedTicket] = useState<Ticket | null>(null);
  // true = nomor WA ikut tersimpan di DB (prefill modal petugas otomatis).
  const [phoneSaved, setPhoneSaved] = useState<boolean | null>(null);
  // Guard untuk mencegah double-submit saat menerbitkan tiket
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  // Update selectedService when initialService prop changes
  useEffect(() => {
    if (initialService) {
      setSelectedService(initialService);
    }
  }, [initialService]);

  // Pre-populate data from OCR pre-screening if available
  useEffect(() => {
    if (!initialPreScreenData) return;
    const pages = initialPreScreenData.pages || [];
    const effectiveService = initialPreScreenData.service || initialService;
    setSelectedService(effectiveService);

    if (pages.length > 0) {
      // Multi-halaman: petakan semua halaman ke slot syarat layanan.
      setPreScreenPages(pages);
      remapPreScreenForService(effectiveService, {
        preferredMainIndex: initialPreScreenData.mainPageIndex,
        forceIdentity: true,
        pages,
      });
      return;
    }

    // Jalur lama satu berkas (tanpa array pages).
    setPreScreenPages([]);
    setPageAssignments({});
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
    // Prefill verification result but stay on Step 1 for WA/alamat input
    // User must complete Step 1 & 2 validation before proceeding
    if (initialPreScreenData.verificationResult) {
      setVerificationResult(initialPreScreenData.verificationResult);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPreScreenData]);

  // ---------------------------------------------------------------------
  // Draft IndexedDB: pulihkan, autosave, dan bersihkan setelah tiket terbit.
  // ---------------------------------------------------------------------
  const hasDraftData = !!(
    nik.trim() ||
    nama.trim() ||
    wa.trim() ||
    alamat.trim() ||
    docImageBase64 ||
    supportFiles.some((f) => !!f?.base64) ||
    combinedPages.length > 0
  );

  const applyDraft = (draft: WizardDraft) => {
    applyingDraftRef.current = true;
    draftSuppressedRef.current = false;
    setSelectedService(draft.service || initialService);
    setNik(draft.nik || "");
    setNama(draft.nama || "");
    setWa(draft.wa || "");
    setAlamat(draft.alamat || "");
    // Hasil scan tidak disimpan; kembalikan ke Langkah 2 agar warga memindai ulang.
    setCurrentStep((draft.currentStep >= 3 ? 2 : draft.currentStep || 1) as 1 | 2 | 3 | 4);
    setDocImageBase64(draft.docImageBase64 || null);
    setDocImageName(draft.docImageName || "");
    setSupportFiles(draft.supportFiles || []);
    setUploadMode(draft.uploadMode || "individual");
    setCombinedPages(draft.combinedPdfPages || []);
    setPreScreenPages([]);
    setPageAssignments({});
    setVerificationResult(null);
    setGeneratedTicket(null);
    setDraftBanner(null);
    setDraftSavedAt(draft.updatedAt || null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => {
      applyingDraftRef.current = false;
    }, 250);
  };

  const startFresh = () => {
    draftSuppressedRef.current = false;
    setSelectedService(initialService);
    setNik("");
    setNama("");
    setWa("");
    setAlamat("");
    resetAllUploads();
    setCurrentStep(1);
    setVerificationResult(null);
    setGeneratedTicket(null);
    setDraftBanner(null);
    setDraftSavedAt(null);
    setExitConfirmOpen(false);
    void clearDraft();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const discardDraft = () => {
    setDraftBanner(null);
    setDraftSavedAt(null);
    void clearDraft();
  };

  // Muat draft sekali saat wizard dibuka (kecuali datang dari pre-screen OCR).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const draft = await loadDraft();
      if (cancelled) return;
      if (draft && !initialPreScreenData) setDraftBanner(draft);
      setDraftReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshot terbaru untuk autosave & flush saat tab disembunyikan.
  draftSnapshotRef.current = {
    service: selectedService,
    nik,
    nama,
    wa,
    alamat,
    currentStep: (currentStep <= 2 ? currentStep : 2) as 1 | 2,
    docImageBase64,
    docImageName,
    supportFiles,
    uploadMode,
    combinedPdfPages: combinedPages,
  };

  const saveNow = async () => {
    if (draftSuppressedRef.current) return;
    if (!hasDraftData || currentStep === 4) return;
    const snapshot = draftSnapshotRef.current;
    if (!snapshot) return;
    try {
      await saveDraft(snapshot);
      setDraftSavedAt(Date.now());
    } catch {
      // Draft tidak boleh memblokir alur utama.
    }
  };
  saveNowRef.current = saveNow;

  // Autosave debounce 500 ms.
  useEffect(() => {
    if (!draftReady || applyingDraftRef.current || draftSuppressedRef.current) return;
    if (currentStep === 4 || !hasDraftData) return;
    const timer = window.setTimeout(() => {
      void saveNowRef.current();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    draftReady,
    hasDraftData,
    currentStep,
    selectedService,
    nik,
    nama,
    wa,
    alamat,
    docImageBase64,
    docImageName,
    supportFiles,
    uploadMode,
    combinedPages,
  ]);

  // Flush saat tab ditutup/disembunyikan (IndexedDB tetap bisa ditulis).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void saveNowRef.current();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  // Peringatan native bila tab ditutup saat masih ada data.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasDraftData && currentStep < 4) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasDraftData, currentStep]);

  const exitOriginRef = useRef<"button" | "back">("button");
  const handleRequestExit = (origin: "button" | "back" = "button") => {
    exitOriginRef.current = origin;
    if (hasDraftData && currentStep < 4) {
      setExitConfirmOpen(true);
      return;
    }
    onBackToPortal();
  };
  const handleContinueFilling = () => {
    setExitConfirmOpen(false);
    // Back browser sudah memindahkan history ke portal; pulihkan entri wizard.
    if (exitOriginRef.current === "back") {
      try {
        history.pushState({ aipexView: "wizard" }, "");
      } catch {}
    }
  };
  const handleConfirmExit = async () => {
    await saveNow();
    setExitConfirmOpen(false);
    onBackToPortal();
  };

  // Browser Back ditahan oleh App (popstate) lalu diteruskan ke wizard.
  useEffect(() => {
    const onWizardBack = () => handleRequestExit("back");
    window.addEventListener("aipex:wizard-back", onWizardBack as EventListener);
    return () =>
      window.removeEventListener("aipex:wizard-back", onWizardBack as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDraftData, currentStep, onBackToPortal]);


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
    "Surat Pindah (SKPWNI)":
      "Pengajuan surat pindah domisili antar kelurahan, kecamatan, atau kota.",
    "Konsolidasi / Sinkronisasi NIK":
      "Sinkronisasi NIK yang belum aktif di BPJS, bank, atau sistem publik.",
    "Surat Keterangan Usaha (SKU)":
      "Penerbitan surat pengantar keterangan usaha warga untuk legalitas & perbankan.",
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      alert(`Ukuran file maksimal ${MAX_FILE_MB} MB. Kompres foto atau pilih file yang lebih kecil.`);
      // Clear input so user can re-select same file
      if (e.target) e.target.value = "";
      return;
    }
    detachPreScreenMapping();
    setUploadMode("individual");
    setCombinedPages([]);
    setDocImageName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setDocImageBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
    // Clear stale scan result when main document changes
    setVerificationResult(null);
    // Clear input so user can re-select same file if needed
    if (e.target) e.target.value = "";
  };

  /** Unggah berkas pendukung wajib (slot mengikuti urutan syarat layanan). */
  const handleSupportUpload = (slot: number, file: File | undefined, inputEl?: HTMLInputElement) => {
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      alert(`Ukuran file maksimal ${MAX_FILE_MB} MB. Kompres file atau pilih file yang lebih kecil.`);
      if (inputEl) inputEl.value = "";
      return;
    }
    detachPreScreenMapping();
    const reader = new FileReader();
    reader.onload = () => {
      setSupportFiles((prev) => {
        const next = [...prev];
        next[slot] = { base64: reader.result as string, name: file.name };
        return next;
      });
    };
    reader.readAsDataURL(file);
    // Clear stale scan result when supporting documents change
    setVerificationResult(null);
    if (inputEl) inputEl.value = "";
  };

  const removeSupportFile = (slot: number) => {
    detachPreScreenMapping();
    // Pertahankan indeks slot (jangan filter) agar selaras dengan urutan syarat.
    setSupportFiles((prev) => {
      const next = [...prev];
      next[slot] = { base64: "", name: "" };
      return next;
    });
  };

  /** Hasil pecahan PDF gabungan → dokumen utama (slot 0) + lampiran slot 1..N. */
  const handlePdfPagesReady = (pages: CombinedPdfReadyPage[]) => {
    if (!pages.length) return;
    detachPreScreenMapping();
    const mainSlotTitle = requiredDocs[0]?.title;
    const main = pages.find((p) => p.slotTitle === mainSlotTitle) || pages[0];
    const rest = pages.filter((p) => p !== main);
    // Server membatasi payload 4,2 MB. Base64 ~= 4/3 ukuran biner.
    const mainBytes = Math.ceil((main.base64.length * 3) / 4);
    if (mainBytes > 4 * 1024 * 1024) {
      alert(
        "Halaman dokumen utama lebih dari 4 MB setelah dipecah. Kompres PDF atau unggah halaman itu sebagai foto JPG/PNG agar bisa dipindai."
      );
      return;
    }
    setCombinedPages(
      pages.map((p) => ({
        base64: p.base64,
        mimeType: p.mimeType,
        docType: p.docType,
        fileName: p.fileName,
        slotTitle: p.slotTitle,
      }))
    );
    setDocImageBase64(toDataUrl(main.base64, main.mimeType));
    setDocImageName(main.fileName);
    setSupportFiles(
      rest.map((p) => ({ base64: toDataUrl(p.base64, p.mimeType), name: p.fileName }))
    );
    setUploadMode("combined");
    // Clear stale scan result when combined PDF changes
    setVerificationResult(null);
  };

  const removeCombinedPdf = () => {
    setCombinedPages([]);
    setDocImageBase64(null);
    setDocImageName("");
    setSupportFiles([]);
    setUploadMode("combined");
    setVerificationResult(null); // Clear stale scan result when PDF is removed
    setPreScreenPages([]);
    setPageAssignments({});
  };

  /** Judul syarat yang berkasnya BELUM diunggah (untuk pesan validasi). */
  const getMissingDocs = (): string[] => {
    const missing: string[] = [];
    if (!docImageBase64) missing.push(requiredDocs[0]?.title || "Dokumen utama");
    supportDocs.forEach((req, i) => {
      if (!supportFiles[i]?.base64) missing.push(req.title);
    });
    return missing;
  };

  // Step 1 Validation — NIK 16 digit angka + WA format Indonesia.
  // NIK OPSIONAL bila jenis dokumen sudah diketahui non-kartu dari pra-pemeriksaan
  // (akta kematian/perkawinan & surat pindah lama sering tidak mencantumkan NIK).
  // verificationResult lebih dulu karena ikut berubah saat pemetaan halaman dikoreksi.
  const praJenis = verificationResult?.jenis_dokumen || initialPreScreenData?.jenisDokumen || "";
  const jenisPraPindai = normalizeJenis(praJenis);
  const praIdentityNote = mainPageIdentityNote(praJenis);
  // Layanan yang dokumennya memang non-kartu (akta kematian/perkawinan & surat
  // pindah) → NIK opsional walau pra-pemeriksaan belum dijalankan.
  const layananNonKartu = /akta kematian|akta perkawinan|surat pindah/i.test(selectedService);
  const nikOpsional = JENIS_NIK_OPSIONAL.includes(jenisPraPindai) || layananNonKartu;
  // Ringkasan pemetaan halaman (hanya untuk pra-pemeriksaan multi-halaman).
  const mainAssignmentIndex = getMainIndexFromAssignments(pageAssignments);
  const mainDocPage = preScreenPages[mainAssignmentIndex] || null;
  const preScreenIdentity = summarizeIdentities(preScreenPages);
  const isValidWa = (v: string) => /^(08\d{8,12}|628\d{8,12}|\+628\d{8,12})$/.test(v.replace(/[\s-]/g, ""));
  const handleProceedToStep2 = () => {
    if (!nama.trim() || !wa.trim() || (!nikOpsional && !nik.trim())) {
      alert(
        nikOpsional
          ? "Mohon lengkapi Nama Lengkap dan Nomor WhatsApp aktif Anda terlebih dahulu (NIK opsional untuk dokumen ini)."
          : "Mohon lengkapi NIK, Nama Lengkap, dan Nomor WhatsApp aktif Anda terlebih dahulu."
      );
      return;
    }
    if (nik.trim() && !/^\d{16}$/.test(nik.trim())) {
      alert(
        "NIK harus tepat 16 digit angka (tanpa huruf/spasi), atau biarkan kosong bila tidak tercantum pada dokumen."
      );
      return;
    }
    if (!isValidWa(wa.trim())) {
      alert("Nomor WhatsApp tidak valid. Gunakan format 08xxxxxxxxxx atau 628xxxxxxxxxx.");
      return;
    }
    setCurrentStep(2);
    window.scrollTo({ top: 120, behavior: "smooth" });
  };

  // Step 2 Validation & trigger Scan Step
  const handleStartAiScan = async () => {
    // Wajib unggah SEMUA berkas sesuai syarat WAJIB layanan — bukan cuma 1 foto.
    // (Dokumen utama dipindai AI; sisanya dilampirkan untuk verifikasi loket.)
    const missing = getMissingDocs();
    if (missing.length > 0) {
      alert(
        `Berkas wajib belum lengkap (${missing.length}/${requiredDocs.length}). Yang belum diunggah:\n• ${missing.join("\n• ")}`
      );
      return;
    }
    // If we already have a verification result from pre-screen, skip actual scan
    // but still go to Step 3 to show the result (user has completed Step 1 & 2 validation)
    if (verificationResult) {
      setCurrentStep(3);
      window.scrollTo({ top: 120, behavior: "smooth" });
      return;
    }
    // Anti-spam: cooldown lokal 30 detik antar-pindaian.
    const cdLeft = getCooldownSec();
    if (cdLeft > 0) {
      alert(`Terlalu cepat mengirim berkas. Tunggu ${formatCountdown(cdLeft)} sebelum memindai lagi.`);
      return;
    }
    setCurrentStep(3);
    setIsScanning(true);
    setScanProgress(10);
    setShowBlurAreas(true);
    setVerificationResult(null);
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
      // Anti-spam: token manusia untuk percobaan terakhir + field bot-check.
      const siteKey = getTurnstileSiteKey();
      let turnstileToken: string | null = null;
      if (siteKey && getQuotaState().remaining <= 1) {
        turnstileToken = await getTurnstileToken(siteKey);
      }
      const buildBody = () =>
        JSON.stringify({
          imageBase64: docImageBase64,
          serviceType: selectedService,
          inputNama: nama,
          inputNik: nik,
          // Nomor WA sudah diisi di langkah 1 — ikutkan agar tiket hasil pindai
          // langsung punya nomor (prefill modal petugas otomatis).
          phone: wa || undefined,
          // Nama berkas pendukung wajib (dilampirkan, diverifikasi manual di loket).
          lampiran: supportFiles.filter((f) => f?.base64).map((f) => f.name),
          startedAt: PAGE_STARTED_AT,
          website_confirm: "",
          ...(turnstileToken ? { turnstileToken } : {}),
        });
      const postScan = () =>
        fetch("/api/scan-document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: buildBody(),
        });
      let response = await postScan();
      // Captcha adaptif: 403 -> ambil token lalu ulangi SEKALI.
      if (response.status === 403) {
        const err0: any = await response.clone().json().catch(() => null);
        if (err0?.captchaRequired || err0?.code === "CAPTCHA_REQUIRED") {
          turnstileToken = await getTurnstileToken(siteKey);
          if (turnstileToken) {
            response = await postScan();
          } else {
            throw new Error(
              "Verifikasi manusia diperlukan untuk pemindaian terakhir dan captcha gagal dimuat. Periksa koneksi lalu pindai ulang, atau lanjut via Isi Manual."
            );
          }
        }
      }
      if (!response.ok) {
        const errJ: any = await response.clone().json().catch(() => null);
        if (!isQuotaFreeCode(errJ?.code)) recordScanAttempt();
        setCooldown();
        let msg = String(
          errJ?.message || errJ?.error || `Gagal memindai dokumen (HTTP ${response.status})`
        );
        const ra = Number(errJ?.retryAfter);
        if (response.status === 429 && Number.isFinite(ra) && ra > 0) {
          msg += ` Coba lagi dalam ${formatCountdown(ra)}.`;
        }
        throw new Error(msg);
      }
      recordScanAttempt();
      setCooldown();
      const data = await response.json();
      clearInterval(interval);
      setScanProgress(100);

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

      const parsed = data?.data || data || {};
      // Area buram (overlay bbox) — hanya dipakai bila bentuknya valid.
      const blurAreas = normalizeBlurAreas(parsed.blur_areas);
      const jenisNorm = normalizeJenis(parsed.jenis_dokumen);
      let statusNorm = normalizeStatus(parsed.status_verifikasi);
      if (jenisNorm === "LAINNYA") statusNorm = "TIDAK_VALID";
      const tidakValid =
        statusNorm === "TIDAK_VALID" || jenisNorm === "LAINNYA" || data?.success === false;
      // Backend: TIDAK_VALID → success:false; dokumen valid (BERHASIL/BURAM) →
      // success:true TANPA tiket — tiket dibuat di /api/tickets oleh wizard.
      const backendGagal = data?.success === false;
      const skorBackend =
        typeof parsed.skor_kejelasan === "number"
          ? parsed.skor_kejelasan
          : typeof parsed.skor === "number"
            ? parsed.skor
            : 0;

      let result: VerificationResult;
      if (tidakValid) {
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
          blur_areas: [],
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
          blur_areas: blurAreas,
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
          blur_areas: blurAreas,
        };
      }

      setVerificationResult(result);
      setIsScanning(false);
    } catch (err) {
      console.error(err);
      clearInterval(interval);
      setScanProgress(100);
      // JANGAN palsukan LULUS saat gagal; tampilkan pesan jujur (termasuk info limit).
      const rawMsg = err instanceof Error ? err.message : "";
      const catatan = /failed to fetch|networkerror|load failed|network request failed/i.test(rawMsg)
        ? "Gagal menghubungi server OCR. Periksa koneksi lalu ulangi pindaian dokumen."
        : rawMsg || "Gagal menghubungi server OCR. Periksa koneksi lalu ulangi pindaian dokumen.";
      setVerificationResult({
        nik: nik,
        nama: nama,
        jenis_dokumen: "LAINNYA",
        status_kualitas: "GAGAL",
        skor: 0,
        catatan,
      });
      setIsScanning(false);
    }
  };

  // Step 3 to Step 4: Generate QR — wajib untuk dokumen valid (LULUS maupun BURAM).
  // Hanya file BUKAN kependudukan (LAINNYA) yang diblokir (frontend + backend ganda).
  // Gangguan jaringan dibedakan pesannya agar tak disangka "bukan KTP".
  const handleGenerateTicket = async () => {
    if (isSubmitting) return;
    const catatan = verificationResult?.catatan || "";
    // Gangguan sistem/kunci AI juga diblokir seperti gangguan jaringan.
    const isNetworkError =
      !!verificationResult && /gagal menghubungi|koneksi|jaringan|gangguan sistem|sedang gangguan|kunci akses|sedang sibuk|petugas loket/i.test(catatan);
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
      alert(`${BUKAN_KTP_MESSAGE} Tiket/QR tidak dapat diterbitkan.`);
      return;
    }
    setIsSubmitting(true);
    try {
      // Petakan hasil scan ke status backend: LULUS→BERHASIL, GAGAL+valid→BURAM, GAGAL+LAINNYA→TIDAK_VALID
      const scanStatus =
        verificationResult.status_kualitas === "LULUS"
          ? "BERHASIL"
          : verificationResult.jenis_dokumen === "LAINNYA"
            ? "TIDAK_VALID"
            : "BURAM";
      const lampiranNames = [
        docImageName || requiredDocs[0]?.title || "Dokumen utama",
        ...supportFiles.filter((f) => f?.base64).map((f) => f.name),
      ];
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
          catatan_ai: `${verificationResult?.catatan || ""}\nLampiran berkas wajib (${lampiranNames.length}/${requiredDocs.length}): ${lampiranNames.join("; ")}.`,
          lampiran: lampiranNames,
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
        // Bukti simpan nomor: false = kolom phone belum dimigrasi / DB mati.
        setPhoneSaved(resData.phoneSaved === true);
        onTicketCreated(resData.data);
        // Tiket sudah terbit → draft tidak diperlukan lagi (hapus data sensitif).
        draftSuppressedRef.current = true;
        void clearDraft();
        setDraftSavedAt(null);
        setDraftBanner(null);
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
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render QR Code in Step 4 (teks rapi multi-baris, NIK mask — satu sumber)
  useEffect(() => {
    if (currentStep === 4 && generatedTicket && qrCanvasRef.current) {
      QRCode.toCanvas(
        qrCanvasRef.current,
        buildTicketQrText(generatedTicket),
        {
          width: 180,
          margin: 1,
          color: {
            dark: "#1E293B",
            light: "#ffffff",
          },
        }
      );
    }
  }, [currentStep, generatedTicket]);

  return (
    <div className="flex flex-col w-full" id="wizardView">
      {/* Sub-bar Navigation */}
      <div className="w-full max-w-5xl mx-auto flex items-center justify-between gap-2 mb-4 px-1">
        <button
          onClick={() => handleRequestExit("button")}
          type="button"
          className="inline-flex items-center gap-1.5 min-h-9 text-brand hover:text-blue-800 font-semibold text-xs sm:text-sm transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          <span>Kembali ke Beranda</span>
        </button>

        <div className="flex items-center gap-2">
          {draftSavedAt && hasDraftData && currentStep < 4 && (
            <span className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 text-[11px] font-semibold">
              <span className="material-symbols-outlined text-[14px]">cloud_done</span>
              Draft tersimpan {formatDraftTime(draftSavedAt)}
            </span>
          )}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-slate-300 bg-white/90 text-slate-700 text-xs font-medium backdrop-blur-xs shadow-2xs">
            <span className="material-symbols-outlined text-[15px] text-brand">verified_user</span>
            <span>Mode Mandiri Warga • UU PDP Protected</span>
          </div>
          {hasDraftData && currentStep < 4 && (
            <button
              type="button"
              onClick={discardDraft}
              title="Hapus draft yang tersimpan"
              aria-label="Hapus draft yang tersimpan"
              className="w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-full border border-slate-300 bg-white text-slate-500 hover:text-red-600 hover:border-red-300 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[15px]">delete</span>
            </button>
          )}
        </div>
      </div>

      {/* Banner resume draft */}
      {draftBanner && (
        <div className="w-full max-w-5xl mx-auto mb-4 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-amber-600 text-[24px]">history</span>
              <div>
                <p className="text-sm font-bold text-amber-950">Draft pengisian ditemukan</p>
                <p className="text-xs text-amber-800 mt-0.5">
                  Terakhir disimpan {formatDraftTime(draftBanner.updatedAt)}. Data dan berkas
                  tersimpan di browser ini maksimal 24 jam.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => applyDraft(draftBanner)}
                className="px-3 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition-colors cursor-pointer"
              >
                Lanjutkan draft
              </button>
              <button
                type="button"
                onClick={startFresh}
                className="px-3 py-2 rounded-lg border border-amber-300 bg-white text-amber-900 text-xs font-semibold hover:bg-amber-100 transition-colors cursor-pointer"
              >
                Mulai baru
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Card Container */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-5 md:p-8 max-w-5xl mx-auto w-full">
        {/* Top Badges Row */}
        <div className="flex items-center gap-2 mb-3">
          <span className="px-2.5 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-brand text-xs font-bold tracking-wide uppercase">
            FORMULIR INTERAKTIF
          </span>
          <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
            Kelurahan Sukamaju (Semarang)
          </span>
        </div>

        {/* Heading */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight leading-snug font-heading">
              Pre-Screening Dokumen Mandiri
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Pilih urusan kependudukan, lengkapi identitas, dan dapatkan sertifikat validasi AI resmi.
            </p>
          </div>
        </div>

        {/* 4-Step Stepper Bar */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-1.5 grid grid-cols-2 md:grid-cols-4 gap-1.5 sm:gap-2 my-6">
          <div
            className={`rounded-lg px-2.5 sm:px-4 py-2.5 font-semibold text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 transition-all ${
              currentStep === 1
                ? "bg-brand text-white shadow-xs"
                : currentStep > 1
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "text-slate-400"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                currentStep === 1
                  ? "bg-white text-brand"
                  : currentStep > 1
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-200 text-slate-500"
              }`}
            >
              {currentStep > 1 ? "✓" : "1"}
            </span>
            <span className="min-w-0 leading-tight">Data Diri</span>
          </div>

          <div
            className={`rounded-lg px-2.5 sm:px-4 py-2.5 font-semibold text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 transition-all ${
              currentStep === 2
                ? "bg-brand text-white shadow-xs"
                : currentStep > 2
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "text-slate-400"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                currentStep === 2
                  ? "bg-white text-brand"
                  : currentStep > 2
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-200 text-slate-500"
              }`}
            >
              {currentStep > 2 ? "✓" : "2"}
            </span>
            <span className="min-w-0 leading-tight">Upload Berkas</span>
          </div>

          <div
            className={`rounded-lg px-2.5 sm:px-4 py-2.5 font-semibold text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 transition-all ${
              currentStep === 3
                ? "bg-brand text-white shadow-xs"
                : currentStep > 3
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "text-slate-400"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                currentStep === 3
                  ? "bg-white text-brand"
                  : currentStep > 3
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-200 text-slate-500"
              }`}
            >
              {currentStep > 3 ? "✓" : "3"}
            </span>
            <span className="min-w-0 leading-tight">Scanner AI</span>
          </div>

          <div
            className={`rounded-lg px-2.5 sm:px-4 py-2.5 font-semibold text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 transition-all ${
              currentStep === 4
                ? "bg-brand text-white shadow-xs"
                : "text-slate-400"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                currentStep === 4 ? "bg-white text-brand" : "bg-slate-200 text-slate-500"
              }`}
            >
              4
            </span>
            <span className="min-w-0 leading-tight">Tiket QR</span>
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
              </div>
            </div>

            {/* Hasil pra-pemeriksaan yang terbawa (jenis dokumen + skor) */}
            {initialPreScreenData && (praJenis || initialPreScreenData.imageBase64) && (
              <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 flex items-start gap-3">
                <span className="material-symbols-outlined text-violet-600 text-[22px] shrink-0 mt-0.5">
                  document_scanner
                </span>
                <div className="text-xs md:text-sm text-slate-700 leading-relaxed">
                  <strong className="text-slate-900 font-semibold">
                    Hasil pra-pemeriksaan: {jenisLabel(praJenis)}
                    {typeof (verificationResult?.skor ?? initialPreScreenData.preScreenScore) === "number"
                      ? ` (skor ${verificationResult?.skor ?? initialPreScreenData.preScreenScore}/100)`
                      : ""}
                  </strong>
                  {praJenis && praJenis !== "KTP" && (
                    <span className="block mt-0.5">
                      Dokumen utama terdeteksi sebagai {jenisLabel(praJenis)} — pastikan
                      pilihan <em>Jenis Urusan</em> di bawah sesuai dengan keperluan Anda (tidak harus layanan KTP).
                    </span>
                  )}
                  {praIdentityNote && (
                    <span className="block mt-1 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-amber-800">
                      {praIdentityNote}
                    </span>
                  )}
                  {normalizeJenis(initialPreScreenData.jenisDokumen) === "AKTA_KEMATIAN" &&
                    praJenis !== "AKTA_KEMATIAN" && (
                      <span className="block mt-1 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-amber-800">
                        Dokumen awal adalah akta kematian. NIK/nama almarhum tidak diisikan otomatis sebagai
                        pemohon — isi data pemohon (keluarga) secara manual.
                      </span>
                    )}
                  {(!initialPreScreenData.nik || !initialPreScreenData.nama) && (
                    <span className="block mt-0.5 text-amber-700">
                      Sebagian data tidak terbaca AI — lengkapi NIK/nama manual sesuai fisik dokumen.
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* OTP Alert Box */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-start gap-3">
              <span className="material-symbols-outlined text-brand text-[22px] shrink-0 mt-0.5">
                verified_user
              </span>
              <p className="text-xs md:text-sm text-slate-700 leading-relaxed">
                <strong className="text-slate-900 font-semibold">Notifikasi WhatsApp</strong> — Pastikan
                nomor WhatsApp Anda aktif. Status tiket (disetujui/ditolak/perlu perbaikan) dikirim
                otomatis via WhatsApp oleh petugas setelah verifikasi.
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
                    onChange={(e) => handleServiceChange(e.target.value)}
                    className="w-full h-12 pl-4 pr-10 rounded-xl bg-slate-50 border border-slate-300 text-xs sm:text-sm text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all outline-none appearance-none cursor-pointer"
                  >
                    <option value="Penerbitan KTP-EL Baru / Penggantian">
                      Penerbitan KTP-EL Baru / Penggantian
                    </option>
                    <option value="Kartu Identitas Anak (KIA)">Kartu Identitas Anak (KIA)</option>
                    <option value="Aktivasi Identitas Digital (IKD)">Aktivasi Identitas Digital (IKD)</option>
                    <option value="Akta Kematian">Akta Kematian</option>
                    <option value="Akta Perkawinan">Akta Perkawinan</option>
                    <option value="Surat Pindah (SKPWNI)">Surat Pindah (SKPWNI)</option>
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
                      {nikOpsional
                        ? "NOMOR INDUK KEPENDUDUKAN (NIK) — OPSIONAL"
                        : "NOMOR INDUK KEPENDUDUKAN (NIK) *"}
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
                      placeholder={nikOpsional ? "16 digit angka (kosongkan bila tidak tercantum)" : "16 digit angka (contoh: 320101...)"}
                      className="w-full h-12 pl-10 pr-4 rounded-xl bg-slate-50 border border-slate-300 font-code-num text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all outline-none"
                    />
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {nikOpsional
                      ? "NIK opsional untuk akta kematian/perkawinan & surat pindah — kosongkan bila tidak tercantum."
                      : "Standar Ditjen Dukcapil Kemendagri"}
                  </span>
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
                onClick={() => handleRequestExit("button")}
                className="w-full sm:w-auto px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
                <span>Batal & Kembali</span>
              </button>
              <button
                type="button"
                onClick={handleProceedToStep2}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-brand hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
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
                  Langkah 2: Unggah Berkas Dokumen ({requiredDocs.length} berkas wajib)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedService} — unggah SEMUA berkas bertanda WAJIB sesuai syarat ketentuan.
                  Berkas pertama adalah dokumen utama yang dipindai AI.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full bg-blue-50 text-brand border border-blue-200 text-xs font-semibold self-start sm:self-center">
                UU PDP In-Memory Auto-Purge
              </span>
            </div>

            {/* Pemetaan halaman hasil OCR multi-halaman → slot syarat layanan */}
            {preScreenPages.length > 1 && (
              <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-3 sm:p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-violet-600 text-[20px]">account_tree</span>
                      Pemetaan {preScreenPages.length} halaman dokumen
                    </p>
                    <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                      Setiap halaman sudah dikenali terpisah. Periksa pemetaan di bawah — Anda bisa
                      mengubah dokumen utama atau memindahkan halaman ke lampiran yang sesuai.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remapPreScreenForService(selectedService)}
                    className="min-h-10 px-3 py-2 rounded-lg bg-white border border-violet-200 text-violet-700 text-[11px] font-semibold hover:bg-violet-100 transition-colors shrink-0 cursor-pointer"
                  >
                    Petakan Ulang Otomatis
                  </button>
                </div>

                <div className="space-y-2">
                  {preScreenPages.map((page, index) => {
                    const assignment: PageAssignment = pageAssignments[index] || { kind: "unused" };
                    const usable = isUsablePage(page);
                    const value =
                      assignment.kind === "main"
                        ? "main"
                        : assignment.kind === "support"
                          ? `support:${assignment.slot}`
                          : "unused";
                    return (
                      <div
                        key={`prepage-${page.pageIndex}-${index}`}
                        className={`flex flex-col sm:flex-row sm:items-center gap-2.5 rounded-xl border p-2.5 ${
                          assignment.kind === "main"
                            ? "bg-white border-blue-300 ring-1 ring-blue-100"
                            : "bg-white border-slate-200"
                        }`}
                      >
                        {isPdfDataUrl(page.imageBase64) ? (
                          <span className="w-16 h-12 rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-[24px] text-red-500">picture_as_pdf</span>
                          </span>
                        ) : (
                          <img
                            src={page.imageBase64}
                            alt={`Halaman ${page.pageNumber}`}
                            className="w-16 h-12 object-cover rounded-lg border border-slate-200 bg-white shrink-0"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-900">Halaman {page.pageNumber}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                              {page.result.isSystemError ? "Gagal dipindai" : jenisLabel(page.result.jenis_dokumen)}
                            </span>
                            {assignment.kind === "main" && (
                              <span className="text-[9px] font-bold uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                                Dokumen utama
                              </span>
                            )}
                            <span
                              className={`text-[10px] font-semibold ${
                                !usable
                                  ? "text-red-600"
                                  : page.result.status_verifikasi === "BERHASIL"
                                    ? "text-emerald-700"
                                    : "text-amber-700"
                              }`}
                            >
                              {page.result.isSystemError
                                ? "gangguan sistem"
                                : `${page.result.status_verifikasi} • ${page.result.skor_kejelasan}/100`}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 truncate mt-0.5">{page.imageName}</p>
                        </div>
                        <select
                          value={value}
                          disabled={!usable}
                          onChange={(e) => handleAssignmentChange(index, e.target.value)}
                          className="w-full sm:w-64 h-10 px-2 rounded-lg bg-slate-50 border border-slate-300 text-[11px] text-slate-800 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <option value="unused">Tidak dipakai</option>
                          <option value="main">
                            Dokumen utama — {requiredDocs[0]?.title}
                          </option>
                          {supportDocs.map((req, i) => (
                            <option key={`assign-${i}`} value={`support:${i + 1}`}>
                              Lampiran {i + 1} — {req.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-lg bg-white border border-slate-200 p-2.5 text-[11px] leading-relaxed text-slate-600">
                  <b className="text-slate-900">Dokumen utama saat ini:</b>{" "}
                  {mainDocPage
                    ? `Halaman ${mainDocPage.pageNumber} — ${jenisLabel(mainDocPage.result.jenis_dokumen)}`
                    : "belum dipilih"}
                  . NIK/nama pemohon diisi otomatis dari dokumen utama dan bisa Anda ubah di Langkah 1.
                </div>

                {preScreenIdentity.hasConflict && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900">
                    <b>Data pemilik dokumen berbeda antar halaman.</b> NIK/nama yang dipakai adalah
                    dari dokumen utama. Pastikan dokumen utama memang milik pemohon; data KK/akta
                    bisa milik kepala keluarga, anak, pasangan, atau almarhum.
                  </div>
                )}

                {mainDocPage && mainPageIdentityNote(mainDocPage.result.jenis_dokumen) && (
                  <div className="rounded-lg border border-amber-200 bg-white p-2.5 text-[11px] leading-relaxed text-amber-900">
                    {mainPageIdentityNote(mainDocPage.result.jenis_dokumen)}
                  </div>
                )}

                {normalizeJenis(initialPreScreenData?.jenisDokumen) === "AKTA_KEMATIAN" && (
                  <div className="rounded-lg border border-slate-300 bg-white p-2.5 text-[11px] leading-relaxed text-slate-700">
                    Dokumen awal adalah akta kematian. NIK/nama almarhum hanya menjadi referensi dan
                    tidak diisikan otomatis sebagai pemohon — isi data pemohon secara manual.
                  </div>
                )}
              </div>
            )}

            {/* Mode unggah: terpisah per slot atau satu PDF gabungan */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1.5 rounded-xl bg-slate-100 border border-slate-200">
              <button
                type="button"
                onClick={() => setUploadMode("individual")}
                className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                  uploadMode === "individual"
                    ? "bg-white text-brand shadow-2xs border border-blue-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span className="material-symbols-outlined text-[16px] align-middle mr-1">photo_library</span>
                Unggah Terpisah (Foto/PDF)
              </button>
              <button
                type="button"
                onClick={() => setUploadMode("combined")}
                className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                  uploadMode === "combined"
                    ? "bg-white text-brand shadow-2xs border border-blue-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span className="material-symbols-outlined text-[16px] align-middle mr-1">picture_as_pdf</span>
                Satu PDF Gabungan
              </button>
            </div>

            {/* Daftar syarat wajib + progres kelengkapan */}
            {(() => {
              const filledSupport = supportFiles.slice(0, supportDocs.length).filter((f) => f?.base64).length;
              const doneCount = (docImageBase64 ? 1 : 0) + filledSupport;
              return (
                <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-4 text-xs">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-bold text-ink uppercase tracking-wide">
                      Syarat Wajib {selectedService}
                    </span>
                    <span className={`font-bold px-2.5 py-0.5 rounded-full border ${doneCount === requiredDocs.length ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-white text-brand border-blue-200"}`}>
                      {doneCount}/{requiredDocs.length} berkas terunggah
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {requiredDocs.map((req, i) => {
                      const filled = i === 0 ? !!docImageBase64 : !!supportFiles[i - 1]?.base64;
                      return (
                        <li key={i} className="flex items-start gap-2 text-slate-700">
                          <span className={`material-symbols-outlined text-[16px] mt-0.5 shrink-0 ${filled ? "text-emerald-600" : "text-slate-400"}`}>
                            {filled ? "check_circle" : "radio_button_unchecked"}
                          </span>
                          <span>
                            <strong className={filled ? "text-emerald-800" : "text-ink"}>{i + 1}. {req.title}</strong>
                            <span className="ml-1.5 px-1.5 py-px rounded text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200">Wajib</span>
                            {i === 0 && <span className="ml-1.5 px-1.5 py-px rounded text-[10px] font-bold uppercase bg-blue-50 text-brand border border-blue-200">Dipindai AI</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}

            {uploadMode === "combined" ? (
              combinedPages.length > 0 ? (
                <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-4 sm:p-5 flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[26px]">picture_as_pdf</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-emerald-950">
                        PDF gabungan berhasil dipecah di browser
                      </p>
                      <p className="text-xs text-emerald-800 mt-0.5">
                        {combinedPages.length} halaman terpetakan ke syarat layanan. Halaman dokumen
                        utama siap dipindai AI; halaman lain tercatat sebagai lampiran.
                      </p>
                      <p className="text-[11px] text-emerald-700 mt-1 truncate">
                        Dokumen utama: {docImageName || "-"}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold uppercase shrink-0">
                      Siap
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={removeCombinedPdf}
                      className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      Ganti / proses ulang PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => setUploadMode("individual")}
                      className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      Beralih ke unggah terpisah
                    </button>
                  </div>
                </div>
              ) : (
                <PdfCombinedUpload
                  slots={requiredDocs}
                  selectedService={selectedService}
                  onPagesReady={handlePdfPagesReady}
                  onCancel={() => setUploadMode("individual")}
                />
              )
            ) : (
              <>
            {/* Slot 1: Dokumen utama (dipindai AI) */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-6 h-6 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center shrink-0">1</span>
                <span className="text-sm font-bold text-ink">{requiredDocs[0]?.title}</span>
                <span className="px-1.5 py-px rounded text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200">Wajib</span>
                <span className="px-1.5 py-px rounded text-[10px] font-bold uppercase bg-blue-50 text-brand border border-blue-200">Dipindai AI</span>
              </div>
              <p className="text-[11px] text-slate-500 -mt-1">{requiredDocs[0]?.description}</p>
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-2xl p-6 bg-slate-50/50 hover:bg-blue-50/40 transition-colors relative">
              {docImageBase64 ? (
                <div className="flex flex-col items-center gap-3 w-full">
                  <div className="relative max-w-md w-full rounded-xl overflow-hidden shadow-sm border border-slate-200 bg-white">
                    {isPdfDataUrl(docImageBase64) ? (
                      <div className="w-full h-56 flex flex-col items-center justify-center bg-slate-100 text-slate-600 gap-1.5 px-4 text-center">
                        <span className="material-symbols-outlined text-[48px] text-red-500">picture_as_pdf</span>
                        <span className="text-xs font-bold truncate max-w-full">
                          {docImageName || "Dokumen PDF"}
                        </span>
                        <span className="text-[11px] text-slate-500">PDF halaman dokumen utama</span>
                      </div>
                    ) : (
                      <img
                        src={docImageBase64}
                        alt="Preview Dokumen"
                        className="w-full h-56 object-cover"
                      />
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 backdrop-blur-xs p-2 text-white flex items-center justify-between text-xs">
                      <span className="truncate max-w-55">{docImageName || "Dokumen Berkas Terpilih"}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setDocImageBase64(null);
                          setDocImageName("");
                        }}
                        className="min-h-10 px-2 -my-1 rounded-md text-red-300 hover:text-red-100 hover:bg-white/10 flex items-center gap-1 cursor-pointer"
                        aria-label="Hapus dan ganti dokumen utama"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                        <span>Ganti</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    <span>Berkas siap dianalisis oleh Cognitive AI</span>
                  </p>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full cursor-pointer py-6">
                  <div className="w-14 h-14 rounded-full bg-blue-100 text-brand flex items-center justify-center mb-3 shadow-xs">
                    <span className="material-symbols-outlined text-[28px]">cloud_upload</span>
                  </div>
                  <span className="text-sm font-bold text-ink">
                    Klik untuk Pilih Foto Dokumen atau Seret File ke Sini
                  </span>
                  <span className="text-xs text-slate-500 mt-1">
                    Format: JPG, PNG, WEBP, atau PDF (Maksimal 4MB)
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    onChange={(e) => handleFileUpload(e)}
                    ref={mainFileInputRef}
                    className="hidden"
                  />
                </label>
              )}
            </div>
            </div>

            {/* Slot 2..N: berkas pendukung WAJIB (dilampirkan, diverifikasi manual di loket) */}
            {supportDocs.map((req, i) => {
              const f = supportFiles[i];
              const filled = !!f?.base64;
              return (
                <div key={`${selectedService}-${i}`} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="w-6 h-6 rounded-full bg-slate-700 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{i + 2}</span>
                    <span className="text-sm font-bold text-ink">{req.title}</span>
                    <span className="px-1.5 py-px rounded text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200">Wajib</span>
                    <span className="px-1.5 py-px rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-600 border border-slate-200">Lampiran</span>
                  </div>
                  <p className="text-[11px] text-slate-500 -mt-1">{req.description}</p>
                  {filled ? (
                    <div className="flex items-center gap-3 border border-emerald-200 bg-emerald-50/50 rounded-2xl p-3">
                      {isPdfDataUrl(f.base64) ? (
                        <span className="w-16 h-12 rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[24px] text-red-500">picture_as_pdf</span>
                        </span>
                      ) : (
                        <img src={f.base64} alt={req.title} className="w-16 h-12 object-cover rounded-lg border border-slate-200 bg-white shrink-0" />
                      )}
                      <span className="text-xs font-semibold text-ink truncate flex-1">{f.name}</span>
                      <span className="text-xs text-emerald-700 font-semibold hidden sm:inline">Terunggah</span>
                      <label className="min-h-10 inline-flex items-center justify-center px-3 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-ink text-xs font-semibold shadow-2xs cursor-pointer shrink-0">
                        Ganti
                        <input
                          type="file"
                          accept="image/*,application/pdf,.pdf"
                          className="hidden"
                          onChange={(e) => handleSupportUpload(i, e.target.files?.[0], e.currentTarget)}
                        />
                      </label>
                      <button type="button" onClick={() => removeSupportFile(i)} className="min-h-10 px-3 py-2 rounded-lg bg-white border border-red-200 hover:bg-red-50 text-red-700 text-xs font-semibold cursor-pointer shrink-0">
                        Hapus
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-3 border-2 border-dashed border-slate-300 rounded-2xl p-5 bg-slate-50/50 hover:bg-blue-50/40 transition-colors cursor-pointer">
                      <span className="w-10 h-10 rounded-full bg-blue-100 text-brand flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[22px]">cloud_upload</span>
                      </span>
                      <span>
                        <span className="block text-xs font-bold text-ink">Klik untuk unggah {req.title}</span>
                        <span className="block text-[11px] text-slate-500 mt-0.5">Format: JPG, PNG, WEBP, atau PDF (Maksimal 4MB)</span>
                      </span>
                      <input
                        type="file"
                        accept="image/*,application/pdf,.pdf"
                        className="hidden"
                        onChange={(e) => handleSupportUpload(i, e.target.files?.[0], e.currentTarget)}
                      />
                    </label>
                  )}
                </div>
              );
            })}
              </>
            )}

            {/* UU PDP Compliance Notice */}
            <div className="bg-emerald-50 border border-emerald-200/80 rounded-xl p-4 flex items-start gap-3 text-xs text-emerald-900 leading-relaxed">
              <span className="material-symbols-outlined text-emerald-600 text-[22px] shrink-0 mt-0.5">
                security
              </span>
              <div>
                <strong>Jaminan Kepatuhan UU No. 27/2022 (UU PDP):</strong> Foto yang Anda
                unggah disimpan sementara terenkripsi dan hanya terlihat petugas serta Anda sendiri,
                lalu dihapus otomatis (purge) seketika tiket disetujui/ditolak. Yang tercatat permanen
                hanya jenis dokumen kependudukan untuk rekap.
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
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-brand hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
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
              <span className="px-2.5 py-1 rounded-full bg-blue-50 text-brand border border-blue-200 text-xs font-bold font-code-num">
                {scanProgress}% SELESAI
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-brand h-full transition-all duration-300 rounded-full"
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
                  // Gangguan sistem (AI/kunci/coneksi) bukan vonis dokumen — tampil abu-abu.
                  const sysErr =
                    !lulus &&
                    !bukanKtp &&
                    /gagal menghubungi|koneksi|jaringan|gangguan sistem|sedang gangguan|kunci akses|sedang sibuk|petugas loket/i.test(
                      verificationResult.catatan || ""
                    );
                  return (
                <div
                  className={`p-5 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 ${
                    lulus
                      ? "bg-emerald-50/80 border-emerald-200 text-emerald-950"
                      : bukanKtp
                        ? "bg-red-50/80 border-red-200 text-red-950"
                        : sysErr
                          ? "bg-slate-100 border-slate-300 text-ink"
                          : "bg-amber-50/80 border-amber-200 text-amber-950"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
                        lulus
                          ? "bg-emerald-600 text-white"
                          : bukanKtp
                            ? "bg-red-500 text-white"
                            : sysErr
                              ? "bg-slate-500 text-white"
                              : "bg-amber-500 text-white"
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
                              : sysErr
                                ? "Gangguan Sistem — Coba Lagi"
                                : "Dokumen Memerlukan Perbaikan"}
                        </h3>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            verificationResult.jenis_dokumen === "KTP"
                              ? "bg-blue-100 text-blue-800 border-blue-200"
                              : verificationResult.jenis_dokumen === "LAINNYA"
                                ? "bg-red-100 text-red-700 border-red-200"
                                : "bg-white text-slate-600 border-slate-200"
                          }`}
                        >
                          Jenis Dokumen: {jenisLabel(verificationResult.jenis_dokumen)}
                        </span>
                      </div>
                      <p className="text-xs mt-1 leading-relaxed max-w-xl">
                        {verificationResult.catatan}
                      </p>
                    </div>
                  </div>

                  {/* Score Pill */}
                  <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-white border border-slate-200 shadow-2xs shrink-0 self-stretch sm:self-auto min-w-30">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                      SKOR KELAYAKAN
                    </span>
                    <span
                      className={`font-code-num text-2xl font-extrabold ${
                        verificationResult.skor >= 70 ? "text-emerald-600" : bukanKtp ? "text-red-500" : "text-amber-500"
                      }`}
                    >
                      {verificationResult.skor}%
                    </span>
                    <span className="text-[10px] text-slate-500 font-medium">
                      {verificationResult.skor >= 70 ? "≥ 70% Lulus Uji Kejelasan" : "< 70% Butuh Perbaikan"}
                    </span>
                  </div>
                </div>
                  );
                })()}

                {/* REKOMENDASI PERBAIKAN & TINDAK LANJUT — dihitung di klien dari
                    sinyal hasil pindai, tetap tampil walau AI sedang gangguan. */}
                {(() => {
                  const bukanKtp =
                    verificationResult.jenis_dokumen === "LAINNYA" ||
                    /bukan kartu kependudukan/i.test(verificationResult.catatan || "");
                  const lulus = verificationResult.status_kualitas === "LULUS" && !bukanKtp;
                  const sysErr =
                    !lulus &&
                    !bukanKtp &&
                    /gagal menghubungi|koneksi|jaringan|gangguan sistem|sedang gangguan|kunci akses|sedang sibuk|petugas loket/i.test(
                      verificationResult.catatan || ""
                    );
                  const { perbaikan, tindakLanjut } = buildScanRecommendations({
                    jenis_dokumen: verificationResult.jenis_dokumen,
                    skor: verificationResult.skor,
                    blur_areas: verificationResult.blur_areas,
                    is_system_error: sysErr,
                    lulus,
                  });
                  return <RecommendationCard perbaikan={perbaikan} tindakLanjut={tindakLanjut} />;
                })()}

                {/* Peta Area Kurang Jelas — overlay bbox di atas pratinjau foto */}
                {(() => {
                  const areas = verificationResult.blur_areas || [];
                  const bukanKtp =
                    verificationResult.jenis_dokumen === "LAINNYA" ||
                    /bukan kartu kependudukan/i.test(verificationResult.catatan || "");
                  if (!docImageBase64 || bukanKtp) return null;
                  return (
                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3">
                        <div>
                          <span className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                            Peta Area Kurang Jelas
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {areas.length > 0
                              ? `${areas.length} area terdeteksi — posisi pada foto bersifat perkiraan.`
                              : "Tidak ada area bermasalah yang terdeteksi pada dokumen."}
                          </span>
                        </div>
                        {areas.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowBlurAreas((v) => !v)}
                            className="shrink-0 px-2.5 py-1 rounded-lg border border-slate-300 text-[11px] font-semibold text-slate-600 hover:bg-white transition-colors cursor-pointer"
                          >
                            {showBlurAreas ? "Sembunyikan area" : "Tampilkan area"}
                          </button>
                        )}
                      </div>

                      <div className="p-3 sm:p-4 bg-slate-900 flex justify-center">
                        {isPdfDataUrl(docImageBase64) ? (
                          <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-slate-300 text-center">
                            <span className="material-symbols-outlined text-[56px] text-red-400">picture_as_pdf</span>
                            <p className="text-xs text-slate-300 font-semibold">
                              Pratinjau overlay tidak tersedia untuk PDF
                            </p>
                            <p className="text-[11px] text-slate-400 max-w-xs">
                              Area buram tetap terdaftar di bawah berdasarkan koordinat halaman PDF.
                              Untuk melihat kotak overlay, unggah ulang sebagai foto JPG/PNG.
                            </p>
                            <p className="text-[11px] text-slate-500 font-code-num truncate max-w-65">
                              {docImageName}
                            </p>
                          </div>
                        ) : (
                        <div className="relative inline-block max-w-full">
                          <img
                            src={docImageBase64}
                            alt="Pratinjau dokumen yang dipindai"
                            className="block max-h-105 w-auto max-w-full rounded-lg select-none"
                          />
                          {showBlurAreas &&
                            areas.map((a, i) => {
                              const style = BLUR_SEVERITY_STYLE[a.severity] || BLUR_SEVERITY_STYLE.medium;
                              return (
                                <div
                                  key={`blur-box-${i}`}
                                  className={`absolute rounded-md border-2 ${style.box}`}
                                  style={{
                                    left: `${a.bbox[0]}%`,
                                    top: `${a.bbox[1]}%`,
                                    width: `${a.bbox[2]}%`,
                                    height: `${a.bbox[3]}%`,
                                  }}
                                >
                                  <span
                                    className={`absolute left-0 -top-0.5 -translate-y-full whitespace-nowrap rounded-t-md px-1.5 py-0.5 text-[10px] font-bold shadow-sm ${style.chip}`}
                                  >
                                    {blurAreaLabel(a.area)}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                        )}
                      </div>

                      {areas.length > 0 && (
                        <ul className="divide-y divide-slate-100 text-xs">
                          {areas.map((a, i) => {
                            const style = BLUR_SEVERITY_STYLE[a.severity] || BLUR_SEVERITY_STYLE.medium;
                            return (
                              <li key={`blur-row-${i}`} className="flex items-start gap-2 px-4 py-2">
                                <span className={`mt-1 w-2.5 h-2.5 rounded-sm shrink-0 ${style.dot}`} />
                                <div className="min-w-0">
                                  <span className="font-semibold text-ink">{blurAreaLabel(a.area)}</span>
                                  <span className="text-slate-400"> — {style.label}</span>
                                  {a.description && <span className="text-slate-500"> ({a.description})</span>}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })()}

                {/* Extracted Comparison Table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                  <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                    <span>Hasil Ekstraksi OCR Mesin AI vs Formulir</span>
                    <span className="text-slate-400 font-normal normal-case">
                      Model: Gemini Vision (fallback otomatis)
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-3 p-3 gap-2">
                      <span className="text-slate-500 font-medium">Nomor Induk Kependudukan (NIK)</span>
                      <span className="font-code-num font-semibold text-ink">{verificationResult.nik || "—"}</span>
                      {nikOpsional && !nik.trim() ? (
                        <span className="font-semibold flex items-center gap-1 text-slate-500">
                          <span className="material-symbols-outlined text-[15px]">info</span>
                          <span>NIK opsional — tidak wajib untuk dokumen ini</span>
                        </span>
                      ) : (
                        <span className={`font-semibold flex items-center gap-1 ${verificationResult.nik && verificationResult.nik === nik && verificationResult.nik.length === 16 ? "text-emerald-600" : "text-red-500"}`}>
                          <span className="material-symbols-outlined text-[15px]">
                            {verificationResult.nik && verificationResult.nik === nik && verificationResult.nik.length === 16 ? "check_circle" : "cancel"}
                          </span>
                          <span>
                            {verificationResult.nik && verificationResult.nik === nik && verificationResult.nik.length === 16
                              ? "16 Digit Valid & Cocok"
                              : verificationResult.nik && verificationResult.nik.length === 16
                                ? "NIK Tidak Cocok dengan Formulir"
                                : "NIK Belum Terextrakt / Tidak Valid"}
                          </span>
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 p-3 gap-2">
                      <span className="text-slate-500 font-medium">Nama Pemohon</span>
                      <span className="font-semibold text-ink">{verificationResult.nama || "—"}</span>
                      <span className={`font-semibold flex items-center gap-1 ${verificationResult.nama && verificationResult.nama.toLowerCase().trim() === nama.toLowerCase().trim() && verificationResult.nama.length > 0 ? "text-emerald-600" : "text-red-500"}`}>
                        <span className="material-symbols-outlined text-[15px]">
                          {verificationResult.nama && verificationResult.nama.toLowerCase().trim() === nama.toLowerCase().trim() && verificationResult.nama.length > 0 ? "check_circle" : "cancel"}
                        </span>
                        <span>
                          {verificationResult.nama && verificationResult.nama.toLowerCase().trim() === nama.toLowerCase().trim() && verificationResult.nama.length > 0
                            ? "Sesuai Identitas"
                            : verificationResult.nama && verificationResult.nama.length > 0
                              ? "Nama Tidak Cocok dengan Formulir"
                              : "Nama Belum Terextrakt"}
                        </span>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 p-3 gap-2">
                      <span className="text-slate-500 font-medium">Jenis Urusan / Berkas</span>
                      <span className="text-ink">
                        {jenisLabel(verificationResult.jenis_dokumen)}
                        <span className="text-slate-400"> • {selectedService}</span>
                      </span>
                      <span
                        className={`font-semibold flex items-center gap-1 ${
                          verificationResult.jenis_dokumen === "KTP"
                            ? "text-blue-600"
                            : verificationResult.jenis_dokumen === "LAINNYA"
                              ? "text-red-500"
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
                const isDisabled = terblokir || isSubmitting;
                return (
                  <div className="w-full sm:w-auto flex flex-col items-stretch gap-1.5">
                    <button
                      type="button"
                      onClick={handleGenerateTicket}
                      disabled={isDisabled}
                      title={
                        isSubmitting
                          ? "Sedang memproses..."
                          : terblokir
                          ? networkBawah
                            ? "Koneksi OCR gagal — ulangi pindaian dahulu"
                            : "File bukan dokumen kependudukan — tiket tidak dapat diterbitkan"
                          : "Terbitkan tiket QR"
                      }
                      className={`w-full sm:w-auto px-6 py-3 rounded-xl font-semibold text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 ${
                        isDisabled
                          ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                          : "bg-brand hover:bg-blue-700 text-white cursor-pointer"
                      }`}
                    >
                      <span>
                        {isSubmitting
                          ? "Memproses..."
                          : terblokir
                          ? networkBawah
                            ? "Koneksi Gagal — Ulangi Pindaian"
                            : "Tiket Diblokir — Bukan Dokumen Kependudukan"
                          : "Terbitkan Tiket QR Fast-Track"}
                      </span>
                      <span className="material-symbols-outlined text-[18px]">qr_code_2</span>
                    </button>
                    {terblokir && (
                      <span className="text-[11px] text-red-500 text-center sm:text-right">
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
            {/* Cetak hanya kartu tiket — sisanya disembunyikan saat print. */}
            <style>{`@media print { body * { visibility: hidden !important; } #wizardTicketPrintCard, #wizardTicketPrintCard * { visibility: visible !important; } #wizardTicketPrintCard { position: absolute !important; left: 0; top: 0; width: 100% !important; max-width: 100% !important; border-radius: 0 !important; box-shadow: none !important; } #wizardTicketPrintCard .no-print { display: none !important; } }`}</style>
            {/* Voucher Card Container */}
            <div id="wizardTicketPrintCard" className="w-full max-w-lg bg-gradient-to-b from-blue-700 to-blue-900 text-white rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden border border-blue-400/30">
              <div className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-white/10 blur-2xl"></div>

              {/* Card Top Title */}
              <div className="flex items-center justify-between border-b border-white/20 pb-4 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-white p-1 flex items-center justify-center">
                    <AipexLogo className="w-full h-full" size={24} />
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
                  <span className="text-white font-medium text-right max-w-55">
                    {generatedTicket.jenis_dokumen}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-200">Skor AI Pre-Screening:</span>
                  <span className={`font-code-num font-bold ${generatedTicket.skor_ai >= 70 ? "text-emerald-300" : "text-amber-300"}`}>
                    {generatedTicket.skor_ai}% {generatedTicket.skor_ai >= 70 ? "(Lulus Uji Kejelasan)" : "(Verifikasi Ulang di Loket)"}
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
              {phoneSaved !== null && (
                <p className={`text-[11px] text-center leading-tight ${phoneSaved ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {phoneSaved
                    ? 'Nomor WA tersimpan — petugas bisa kirim notifikasi otomatis.'
                    : 'Nomor WA tidak tersimpan (kolom DB belum ada) — petugas akan mengetik manual.'}
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3 w-full max-w-lg">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 min-w-35 px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-ink text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
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
                className="flex-1 min-w-35 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">share</span>
                <span>Kirim ke WhatsApp</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  downloadTicketQrPng(generatedTicket).catch(() => alert('Gagal mengunduh QR PNG.'));
                }}
                className="flex-1 min-w-35 px-4 py-2.5 rounded-xl bg-ink hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                <span>Unduh QR PNG</span>
              </button>

              <button
                type="button"
                onClick={onBackToPortal}
                className="w-full px-5 py-3 rounded-xl bg-brand hover:bg-blue-700 text-white text-xs sm:text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer mt-1"
              >
                <span>Selesai & Kembali ke Beranda</span>
                <span className="material-symbols-outlined text-[18px]">home</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal konfirmasi keluar — data tetap tersimpan sebagai draft */}
      {exitConfirmOpen && (
        <div
          className="fixed inset-0 z-9999 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-wizard-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[24px]">draft</span>
              </div>
              <div>
                <h3 id="exit-wizard-title" className="text-base font-bold text-slate-900">
                  Keluar dari pengisian?
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Data yang sudah Anda isi disimpan sebagai draft di browser ini selama 24 jam,
                  termasuk foto/PDF. Anda bisa melanjutkannya nanti.
                </p>
                {draftSavedAt && (
                  <p className="text-[11px] text-emerald-700 font-semibold mt-2">
                    Draft terakhir tersimpan {formatDraftTime(draftSavedAt)}.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleContinueFilling}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs sm:text-sm font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Lanjutkan mengisi
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmExit()}
                className="flex-1 px-4 py-2.5 rounded-xl bg-brand text-white text-xs sm:text-sm font-bold hover:bg-blue-700 transition-colors cursor-pointer"
              >
                Keluar (draft tersimpan)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
