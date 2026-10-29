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
import { OcrPreScreenResult, PreScreenInitialData, PreScreenPage } from "../types";
import { BLUR_SEVERITY_STYLE, blurAreaLabel, hasEstimatedBlurAreas } from "../lib/blurAreas";
import { buildScanRecommendations } from "../lib/recommendations";
import { BUKAN_KTP_MESSAGE } from "../lib/messages";
import { JENIS_META, isNikWajib, jenisLabel } from "../lib/jenisDokumen";
import { RecommendationCard } from "./RecommendationCard";
import { SpeakResultButton } from "./SpeakResultButton";
import { buildPreScreenSpeech, buildPreScreenSummarySpeech } from "../lib/speech";
import {
  makePreScreenPage,
  parseOcrPageResponse,
  pickDefaultMainIndex,
  prepareOcrPages,
  summarizeIdentities,
  isUsablePage,
  mainPageIdentityNote,
  toVerificationResult,
  enrichBlurEstimate,
  type PreparedOcrPage,
} from "../lib/preScreenPages";
import {
  PAGE_STARTED_AT,
  QUOTA_MAX,
  formatCountdown,
  getCooldownSec,
  getQuotaState,
  getTurnstileSiteKey,
  getTurnstileToken,
  isQuotaBlockedMessage,
  isQuotaFreeCode,
  isTransientAiError,
  readErrorJson,
  recordScanAttempt,
  setCooldown,
  transientRetrySec,
} from "../lib/antiSpam";

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

/** Error per halaman; stopScan=true menghentikan sisa halaman (kuota/rate limit/jaringan). */
class PageOcrError extends Error {
  stopScan: boolean;
  constructor(message: string, stopScan = true) {
    super(message);
    this.name = "PageOcrError";
    this.stopScan = stopScan;
  }
}

function friendlyOcrError(rawMsg: string): string {
  let msg = /failed to fetch|networkerror|load failed|network request failed/i.test(rawMsg)
    ? "Gagal menghubungi server OCR. Periksa koneksi internet lalu pindai ulang."
    : rawMsg || "Gagal menghubungi server OCR. Periksa koneksi lalu pindai ulang.";
  if (isAiSystemErrorMessage(msg) && !/bukan salah foto anda/i.test(msg)) {
    msg += " Bukan salah foto Anda.";
  }
  return msg;
}

/** Label & warna badge per jenis dokumen — satu sumber di lib/jenisDokumen. */
export { JENIS_META, jenisLabel } from "../lib/jenisDokumen";

/**
 * Penilaian offline lokal — dipakai HANYA saat Layanan AI gangguan
 * (kunci akses tidak valid / belum dikonfigurasi / sibuk) agar
 * "Uji Coba Cepat" tetap memberi jawaban jujur, bukan mentok.
 *
 * Prinsip: tanpa AI kita TIDAK BISA memastikan e-KTP asli.
 * Yang bisa dipastikan: file yang JELAS bukan dokumen kependudukan
 * dari nama berkasnya (mis. "Infografis Taman Siswa.jpg", poster,
 * screenshot, selfie). Untuk kasus itu kembalikan vonis TIDAK_VALID
 * berlabel demo-offline; selain itu kembalikan null (tetap tampil
 * kartu system-error + tombol Lanjut Manual).
 */
const NON_KTP_FILENAME_KEYWORDS = [
  "infografis", "poster", "brosur", "pamflet", "flyer",
  "taman", "siswa", "sekolah", "pendidikan", "wisuda",
  "selfie", "swafoto", "screenshot", "tangkapan",
  "sim", "paspor", "passport", "npwp", "bpjs",
  "struk", "nota", "kwitansi", "sertifikat",
];

function looksLikeNonDukcapilByName(fileName: string): boolean {
  const lower = String(fileName || "").toLowerCase();
  if (!lower) return false;
  // Nama file yang menyebut dokumen resmi justru JANGAN dianggap non-KTP.
  if (/\b(ktp|kk\b|kartu.keluarga|akta|nik|dukcapil|e-ktp|kematian|perkawinan|kawin|nikah|pindah|skpwni|kia)\b/.test(lower)) return false;
  return NON_KTP_FILENAME_KEYWORDS.some((kw) => lower.includes(kw));
}

/** True bila pesan error menandakan gangguan AI server (bukan salah foto warga). */
function isAiSystemErrorMessage(msg: string): boolean {
  return /kunci akses|belum dikonfigurasi|sedang sibuk|sedang gangguan|gagal memproses|jawaban tak valid|gangguan sistem|verifikasi manual|coba lagi nanti|hubungi petugas loket/i.test(
    String(msg || "")
  );
}

/** Peringatan konteks saat dokumen utama bukan KTP pemohon. */

function getImageDimensions(base64: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    try {
      if (!base64 || base64.startsWith("data:application/pdf")) return resolve(null);
      const img = new Image();
      const timer = setTimeout(() => resolve(null), 4000);
      img.onload = () => {
        clearTimeout(timer);
        resolve({ w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = base64;
    } catch {
      resolve(null);
    }
  });
}

export const OcrPreScreenCard: React.FC<OcrPreScreenCardProps> = ({ onProceedToWizard }) => {
  // State kondisi: false (tampilan awal minimalis), true (setelah diunggah & dipindai)
  const [isScanned, setIsScanned] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [scanStepText, setScanStepText] = useState<string>("Memulai analisis dokumen...");
  // Semua halaman hasil OCR. previewResult = halaman yang sedang dilihat.
  const [pageResults, setPageResults] = useState<PreScreenPage[]>([]);
  const [selectedPageIndex, setSelectedPageIndex] = useState<number>(0);
  const [mainPageIndex, setMainPageIndex] = useState<number>(0);
  // ID hasil scan untuk auto-baca. Stabil saat area blur diperbarui di
  // belakang layar, sehingga speech tidak ter-restart/cancel.
  const [scanResultId, setScanResultId] = useState<number>(0);
  const previewResult = pageResults[selectedPageIndex]?.result ?? INITIAL_RESULT;
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  // Anti-spam: picu render ulang info kuota lokal (advisory, server otoritatif).
  const [quotaTick, setQuotaTick] = useState<number>(0);
  void quotaTick;
  const quota = getQuotaState();

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
    const result: OcrPreScreenResult = {
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
    };
    setPageResults([
      {
        pageIndex: 0,
        pageNumber: 1,
        imageBase64: base64,
        imageName: fileName,
        mimeType: "application/octet-stream",
        result,
        verification: toVerificationResult(result),
      },
    ]);
    setSelectedPageIndex(0);
    setMainPageIndex(0);
    setIsScanning(false);
    setIsScanned(true);
  };

  /**
   * Fallback ketajaman lokal dijalankan SETELAH hasil tampil agar tidak
   * menunda auto-baca. Setiap halaman diperbarui satu per satu; race-guard
   * memakai scanIdRef supaya hasil scan lama tidak menimpa scan baru.
   */
  const enrichPagesInBackground = async (myScanId: number, pages: PreScreenPage[]) => {
    const next = [...pages];
    for (let i = 0; i < next.length; i++) {
      if (myScanId !== scanIdRef.current) return;
      try {
        const enriched = await enrichBlurEstimate(next[i].result);
        if (myScanId !== scanIdRef.current) return;
        if (enriched === next[i].result) continue;
        next[i] = {
          ...next[i],
          result: enriched,
          verification: toVerificationResult(enriched),
        };
        setPageResults([...next]);
      } catch {
        // Analisis lokal bersifat best-effort; jangan ganggu hasil OCR.
      }
    }
  };

  const isSupportedFile = (file: File): boolean => {
    if (file.type.startsWith("image/")) return true;
    if (file.type === "application/pdf") return true;
    return /\.(jpe?g|png|webp|pdf)$/i.test(file.name);
  };

  /** Kirim satu halaman ke OCR; mengembalikan JSON respons. */
  const requestPageOcr = async (
    imageBase64: string,
    pageLabel: string,
    myScanId: number
  ): Promise<any> => {
    const siteKey = getTurnstileSiteKey();
    let turnstileToken: string | null = null;
    if (siteKey && getQuotaState().remaining <= 1) {
      setScanStepText(`${pageLabel}: memverifikasi manusia (captcha)...`);
      turnstileToken = await getTurnstileToken(siteKey);
    }

    const buildBody = () =>
      JSON.stringify({
        imageBase64,
        startedAt: PAGE_STARTED_AT,
        website_confirm: "",
        ...(turnstileToken ? { turnstileToken } : {}),
      });

    // POST dengan timeout 60 dtk agar "fetch failed" tidak gantung.
    const postOnce = (url: string): Promise<Response> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildBody(),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
    };

    // Satu percobaan penuh: POST -> fallback (404 saja) -> captcha 403.
    const doAttempt = async (): Promise<Response> => {
      let response: Response;
      try {
        response = await postOnce("/api/ocr");
      } catch {
        response = await postOnce("/api/scan-document");
      }
      if (myScanId !== scanIdRef.current) return response;
      if (response.status === 404) {
        try {
          const alt = await postOnce("/api/scan-document");
          if (myScanId !== scanIdRef.current) return response;
          response = alt;
        } catch {
          // pertahankan respons awal
        }
      }
      if (response.status === 403) {
        const err0 = await readErrorJson(response);
        if (err0.captchaRequired) {
          if (myScanId !== scanIdRef.current) return response;
          setScanStepText(`${pageLabel}: memverifikasi manusia (captcha)...`);
          turnstileToken = await getTurnstileToken(siteKey);
          if (myScanId !== scanIdRef.current) return response;
          if (turnstileToken) {
            try {
              response = await postOnce("/api/ocr");
            } catch {
              response = await postOnce("/api/scan-document");
            }
            if (myScanId !== scanIdRef.current) return response;
          } else {
            throw new PageOcrError(
              "Verifikasi manusia diperlukan dan captcha gagal dimuat. Periksa koneksi lalu pindai ulang, atau lanjut via Isi Manual di bawah."
            );
          }
        }
      }
      return response;
    };

    const ensureOkOrRetry = async (attempt: 0 | 1): Promise<Response> => {
      const response = await doAttempt();
      if (myScanId !== scanIdRef.current) return response;
      if (response.ok) {
        recordScanAttempt();
        setQuotaTick((t) => t + 1);
        return response;
      }
      const err = await readErrorJson(response);
      if (isTransientAiError(err, response.status) && attempt === 0) {
        const waitSec = transientRetrySec(err.subcode, err.retryAfter);
        for (let left = waitSec; left > 0; left--) {
          if (myScanId !== scanIdRef.current) return response;
          setScanStepText(
            `${pageLabel}: layanan AI sibuk — mencoba otomatis dalam ${left} dtk (percobaan 2/2)...`
          );
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (myScanId !== scanIdRef.current) return response;
        setScanStepText(`${pageLabel}: menjalankan OCR ulang...`);
        return ensureOkOrRetry(1);
      }
      if (!isQuotaFreeCode(err.code)) {
        recordScanAttempt();
        setQuotaTick((t) => t + 1);
      }
      let msg = String(err.message || `Gagal memindai halaman (HTTP ${response.status}).`);
      if (response.status === 429 && err.retryAfter > 0) {
        msg += ` Coba lagi dalam ${formatCountdown(err.retryAfter)}.`;
      } else if (isTransientAiError(err, response.status)) {
        const waitSec = transientRetrySec(err.subcode, err.retryAfter);
        msg += ` Layanan AI masih sibuk. Coba lagi sekitar ${waitSec} detik atau lanjut isi manual.`;
      }
      throw new PageOcrError(msg);
    };

    const response = await ensureOkOrRetry(0);
    if (!response.ok) {
      // ensureOkOrRetry sudah melempar; ini jaga-jaga bila respons basi.
      throw new PageOcrError(`Gagal memindai halaman (HTTP ${response.status}).`, false);
    }
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") {
      throw new PageOcrError("Respons OCR tidak valid. Coba pindai ulang.", false);
    }
    return data;
  };

  const processUploadedFile = (file: File) => {
    if (!file) return;

    // Anti-spam: cooldown lokal 30 detik antar-pindaian.
    const cd = getCooldownSec();
    if (cd > 0) {
      failPreview("", file.name, `Terlalu cepat mengirim berkas. Tunggu ${formatCountdown(cd)} sebelum memindai lagi.`);
      return;
    }

    if (!isSupportedFile(file)) {
      failPreview("", file.name, "Format file harus JPG, PNG, WEBP, atau PDF.");
      return;
    }

    const myScanId = ++scanIdRef.current;
    setIsScanning(true);
    setIsScanned(false);
    setScanProgress(0);
    setScanStepText("Menyiapkan halaman dokumen...");
    setPageResults([]);
    setSelectedPageIndex(0);
    setMainPageIndex(0);
    clearStepTimeout();

    void (async () => {
      let prepared: PreparedOcrPage[];
      try {
        prepared = await prepareOcrPages(file);
      } catch (err: any) {
        if (myScanId !== scanIdRef.current) return;
        failPreview("", file.name, err?.message || "Gagal membaca file di perangkat.");
        return;
      }
      if (myScanId !== scanIdRef.current) return;
      if (!prepared.length) {
        failPreview("", file.name, "Tidak ada halaman yang bisa dipindai.");
        return;
      }

      const total = prepared.length;
      const quotaNow = getQuotaState();
      if (quotaNow.remaining > 0 && quotaNow.remaining < total) {
        setScanStepText(
          `PDF ${total} halaman, sisa kuota ${quotaNow.remaining}. Pindaian mungkin terhenti — hasil halaman yang selesai tetap ditampilkan.`
        );
        await new Promise((r) => setTimeout(r, 700));
      } else {
        setScanStepText(
          total > 1
            ? `PDF ${total} halaman — setiap halaman dipindai terpisah (${total} kuota OCR).`
            : "Memindai dokumen..."
        );
      }

      const collected: PreScreenPage[] = [];
      let stopped = false;

      for (let i = 0; i < total; i++) {
        if (myScanId !== scanIdRef.current) return;
        const page = prepared[i];
        const pageLabel = total > 1 ? `Halaman ${i + 1}/${total}` : "Dokumen";
        setScanProgress(Math.round((i / total) * 100));
        setScanStepText(`${pageLabel}: menjalankan OCR...`);

        try {
          const data = await requestPageOcr(page.imageBase64, pageLabel, myScanId);
          if (myScanId !== scanIdRef.current) return;
          const parsed = parseOcrPageResponse(data, page.imageBase64, page.imageName);
          collected.push(makePreScreenPage(page, parsed.result));
          setPageResults([...collected]);
        } catch (err: any) {
          if (myScanId !== scanIdRef.current) return;
          const rawMsg = String(err?.message || "Gagal memindai halaman.");
          const message = friendlyOcrError(rawMsg);
          const parsedErr = parseOcrPageResponse(
            { isSystemError: true, message },
            page.imageBase64,
            page.imageName
          );
          collected.push(makePreScreenPage(page, parsedErr.result));
          setPageResults([...collected]);
          stopped = err instanceof PageOcrError ? err.stopScan : true;
        }

        if (stopped) {
          // Pindaian berhenti karena kuota/rate limit/jaringan/AI. Sisa halaman
          // tetap ditampilkan sebagai "belum dipindai" agar warga tahu ada
          // halaman yang belum diperiksa — bukan seolah-olah PDF hanya segitu.
          if (i < total - 1) {
            for (let j = i + 1; j < total; j++) {
              const remaining = prepared[j];
              const parsedSkipped = parseOcrPageResponse(
                {
                  isSystemError: true,
                  message: `Halaman ${j + 1} belum dipindai karena pemindaian halaman sebelumnya terhenti (kuota, jaringan, atau layanan AI). Pindai ulang atau lanjut isi manual.`,
                },
                remaining.imageBase64,
                remaining.imageName
              );
              collected.push(makePreScreenPage(remaining, parsedSkipped.result));
            }
            setPageResults([...collected]);
          }
          break;
        }
      }

      if (myScanId !== scanIdRef.current) return;
      clearStepTimeout();
      setScanProgress(100);

      // Fallback offline: file yang JELAS bukan dokumen kependudukan dari
      // nama berkasnya tetap divonis TIDAK_VALID meski AI mati.
      const hasUsable = collected.some(
        (p) =>
          !p.result.isSystemError &&
          p.result.jenis_dokumen !== "LAINNYA" &&
          p.result.status_verifikasi !== "TIDAK_VALID"
      );
      if (
        !hasUsable &&
        collected.length === 1 &&
        collected[0].result.isSystemError &&
        looksLikeNonDukcapilByName(file.name)
      ) {
        const dims = await getImageDimensions(collected[0].imageBase64);
        if (myScanId !== scanIdRef.current) return;
        const dimInfo = dims ? ` Dimensi gambar ${dims.w}x${dims.h}px.` : "";
        const offlineResult: OcrPreScreenResult = {
          ...collected[0].result,
          status_kelayakan: "TIDAK_LAYAK",
          skor_kejelasan: 10,
          status_kejelasan: "DITOLAK",
          nik_terdeteksi: false,
          nik_value: "Tidak Terdeteksi",
          nama_terdeteksi: "Tidak Terbaca",
          pencahayaan_status: "KURANG_TERANG",
          catatan:
            `${BUKAN_KTP_MESSAGE} (Penilaian offline sementara — Layanan AI sedang gangguan, ` +
            `jadi file dinilai dari nama & bentuk berkas.${dimInfo} ` +
            `Untuk kepastian, pindai ulang foto dokumen kependudukan asli saat layanan pulih.)`,
          jenis_dokumen: "LAINNYA",
          status_verifikasi: "TIDAK_VALID",
          isSystemError: false,
          isOfflineDemo: true,
          blur_areas: [],
        };
        collected[0] = makePreScreenPage(prepared[0], offlineResult);
        setPageResults([...collected]);
      }

      const finalMain = pickDefaultMainIndex(collected);
      setPageResults([...collected]);
      setMainPageIndex(finalMain);
      setSelectedPageIndex(finalMain);
      setCooldown();
      setScanResultId(myScanId);
      setIsScanning(false);
      setIsScanned(true);

      // Hasil + auto-baca tampil lebih dulu; fallback ketajaman lokal menyusul.
      window.setTimeout(() => {
        void enrichPagesInBackground(myScanId, collected);
      }, 0);
    })();
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
    setPageResults([]);
    setSelectedPageIndex(0);
    setMainPageIndex(0);
    setIsModalOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const mainPage = pageResults[mainPageIndex] || pageResults[0] || null;
  const mainIsUsable = isUsablePage(mainPage || undefined);
  // "Layak" mengikuti status AI sebenarnya (BURAM tetap dihitung perlu diperiksa),
  // bukan sekadar "halaman bisa dipetakan" seperti isUsablePage.
  const layakPageCount = pageResults.filter(
    (page) => !page.result.isSystemError && page.result.status_verifikasi === "BERHASIL"
  ).length;
  const hasSystemErrorPage = pageResults.some((p) => p.result.isSystemError === true);
  const identitySummary = summarizeIdentities(pageResults);
  const summarySpeech = buildPreScreenSummarySpeech({
    pages: pageResults.map((page) => ({
      pageNumber: page.pageNumber,
      jenis: page.result.jenis_dokumen,
      statusVerifikasi: page.result.status_verifikasi,
      statusKelayakan: page.result.status_kelayakan,
      skor: page.result.skor_kejelasan,
      isSystemError: page.result.isSystemError,
    })),
    mainPageIndex,
    identityConflict: identitySummary.hasConflict,
  });

  const handleSelectPage = (index: number) => {
    if (!pageResults[index]) return;
    setSelectedPageIndex(index);
  };

  const handleSetMainPage = (index: number) => {
    if (!isUsablePage(pageResults[index])) return;
    setMainPageIndex(index);
    setSelectedPageIndex(index);
  };

  const handleProceed = () => {
    if (!mainPage || !mainIsUsable) return;
    const r = mainPage.result;
    const jenisLanjut = String(r.jenis_dokumen || "LAINNYA");
    // Akta kematian: NIK/nama milik almarhum, BUKAN pemohon. Hanya referensi.
    const autoFillPemohon = jenisLanjut !== "AKTA_KEMATIAN";
    onProceedToWizard({
      // Hanya KTP yang otomatis memilih layanan KTP-EL. KK/Akta diteruskan
      // apa adanya agar user memilih urusan yang sesuai di wizard.
      ...(jenisLanjut === "KTP" ? { service: "Penerbitan KTP-EL Baru / Penggantian" } : {}),
      // Gunakan hasil normalisasi: hanya NIK 16 digit utuh yang diteruskan.
      nik: autoFillPemohon ? mainPage.verification.nik || "" : "",
      nama: autoFillPemohon ? mainPage.verification.nama || "" : "",
      imageBase64: mainPage.imageBase64,
      imageName: mainPage.imageName,
      preScreenScore: r.skor_kejelasan,
      jenisDokumen: jenisLanjut,
      verificationResult: mainPage.verification,
      pages: pageResults,
      mainPageIndex,
    });
  };

  // Gangguan sistem: user TETAP bisa lanjut isi formulir manual
  // (NIK + nama diketik sendiri dari fisik dokumen). Bukan vonis invalid,
  // jadi wizard dibuka dengan data kosong + foto terlampir untuk verifikasi loket.
  const handleProceedManual = () => {
    const page = pageResults[mainPageIndex] || pageResults[0];
    if (!page) return;
    onProceedToWizard({
      nik: "",
      nama: "",
      imageBase64: page.imageBase64,
      imageName: page.imageName,
      preScreenScore: 0,
      jenisDokumen: "LAINNYA",
      pages: pageResults,
      mainPageIndex,
    });
  };

  // Gangguan sistem (AI/koneksi) DIBEDAKAN dari vonis "bukan KTP":
  // kartu system-error tidak boleh berjudul merah "File Bukan...".
  // Hasil demo-offline (penilaian nama berkas saat AI mati) adalah vonis
  // TIDAK_VALID yang sah untuk diblokir total.
  // Blokir kuota DIBEDAKAN lagi: AI belum sempat melihat berkas sama sekali,
  // jadi banner harus tegas "bukan salah foto" + tawarkan isi manual.
  const isSystemError = previewResult.isSystemError === true;
  const isQuotaBlocked = isSystemError && isQuotaBlockedMessage(previewResult.catatan);
  const isOfflineDemo = previewResult.isOfflineDemo === true;
  const isTidakValid =
    !isSystemError &&
    (previewResult.status_verifikasi === "TIDAK_VALID" ||
      previewResult.jenis_dokumen === "LAINNYA" ||
      previewResult.status_kejelasan === "DITOLAK");
  const isLayak = previewResult.status_kelayakan === "LAYAK" && !isTidakValid && !isSystemError;
  const blurAreas = previewResult.blur_areas || [];
  const blurEstimated = hasEstimatedBlurAreas(blurAreas);
  const blurNeedsManualCheck =
    !isSystemError &&
    !isTidakValid &&
    blurAreas.length === 0 &&
    previewResult.skor_kejelasan > 0 &&
    previewResult.skor_kejelasan < 80;
  // NIK parsial ("12345678 (sebagian)") harus tetap tampil, bukan "Tidak Terdeteksi".
  const nikDigitsShown = previewResult.nik_value.replace(/\D/g, "");
  const nikPartialShown = !previewResult.nik_terdeteksi && nikDigitsShown.length > 0;

  return (
    <section
      id="ocrScannerSection"
      className="w-full max-w-5xl mx-auto p-2 sm:p-4"
      style={{ fontFamily: "'Poppins', sans-serif" }}
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
                  atau tarik & lepas foto dokumen kependudukan (e-KTP, KK, KIA, akta, surat pindah) ke sini (JPG, PNG, PDF)
                </p>
                <p className="text-[10px] font-mono text-cyan-400/70">
                  Kesempatan pindai: {quota.remaining}/{QUOTA_MAX} per 10 mnt
                  {quota.resetSec > 0 && quota.remaining === 0 ? ` • reset ${formatCountdown(quota.resetSec)}` : ""}
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
            {/* 0. RINGKASAN SEMUA HALAMAN (PDF multi-halaman) */}
            {pageResults.length > 1 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      {pageResults.length} halaman dipindai
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {layakPageCount} layak • {pageResults.length - layakPageCount} perlu diperiksa
                      {mainPage ? ` • Dokumen utama: Halaman ${mainPage.pageNumber} (${jenisLabel(mainPage.result.jenis_dokumen)})` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <SpeakResultButton
                      text={summarySpeech}
                      autoPlay
                      autoPlayKey={`summary-${scanResultId}`}
                      idleLabel="Bacakan Ringkasan"
                    />
                    <span className="text-[10px] font-mono text-slate-500 bg-white border border-slate-200 rounded-md px-2 py-1">
                      PDF → {pageResults.length} halaman
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {pageResults.map((page, i) => {
                    const usable = isUsablePage(page);
                    const active = i === selectedPageIndex;
                    const isMain = i === mainPageIndex;
                    const p = page.result;
                    return (
                      <button
                        key={`page-card-${page.pageIndex}-${i}`}
                        type="button"
                        onClick={() => handleSelectPage(i)}
                        className={`text-left rounded-xl border p-2.5 transition cursor-pointer ${
                          active
                            ? "bg-white border-blue-500 ring-2 ring-blue-100"
                            : "bg-white border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono font-bold text-slate-500">
                            HALAMAN {page.pageNumber}
                          </span>
                          {isMain && (
                            <span className="text-[9px] font-bold uppercase tracking-wide text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                              Utama
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-bold text-slate-900 mt-1 truncate">
                          {p.isSystemError ? "Gagal dipindai" : jenisLabel(p.jenis_dokumen)}
                        </p>
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              p.isSystemError
                                ? "bg-slate-100 text-slate-600"
                                : usable
                                  ? p.status_verifikasi === "BERHASIL"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-amber-50 text-amber-700"
                                  : "bg-red-50 text-red-700"
                            }`}
                          >
                            {p.isSystemError ? "SISTEM" : p.status_verifikasi || "–"}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">
                            {p.isSystemError ? "–" : `${p.skor_kejelasan}/100`}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate mt-1">{page.imageName}</p>
                      </button>
                    );
                  })}
                </div>

                {selectedPageIndex !== mainPageIndex && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white border border-slate-200 p-2.5">
                    <span className="text-[11px] text-slate-600">
                      Halaman {pageResults[selectedPageIndex]?.pageNumber || "-"} sedang dilihat.
                    </span>
                    {isUsablePage(pageResults[selectedPageIndex]) ? (
                      <button
                        type="button"
                        onClick={() => handleSetMainPage(selectedPageIndex)}
                        className="text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md min-h-9 px-3 py-1.5 hover:bg-blue-100 transition cursor-pointer"
                      >
                        Jadikan dokumen utama
                      </button>
                    ) : (
                      <span className="text-[11px] text-amber-700">
                        Halaman ini tidak bisa dijadikan dokumen utama.
                      </span>
                    )}
                  </div>
                )}

                {identitySummary.hasConflict && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900">
                    <b>Data pemilik dokumen berbeda.</b> NIK/nama yang dipakai adalah dari dokumen
                    utama
                    {mainPage
                      ? ` (Halaman ${mainPage.pageNumber} — ${jenisLabel(mainPage.result.jenis_dokumen)})`
                      : ""}
                    . Pastikan dokumen utama memang milik pemohon.
                  </div>
                )}

                {mainPage && mainPageIdentityNote(mainPage.result.jenis_dokumen) && (
                  <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-[11px] leading-relaxed text-slate-600">
                    {mainPageIdentityNote(mainPage.result.jenis_dokumen)}
                  </div>
                )}
              </div>
            )}

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
                        ? "bg-red-500/10 text-red-500"
                        : isLayak
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-amber-500/10 text-amber-500"
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
                            ? "bg-red-500"
                            : isLayak
                              ? "bg-emerald-600"
                              : "bg-amber-500"
                      }`}
                    >
                      {isQuotaBlocked
                        ? "Kuota Pindaian Habis — AI Belum Memeriksa Berkas"
                        : isSystemError
                          ? "Gagal Memindai — Coba Lagi"
                          : isTidakValid
                            ? "File Bukan Kartu Kependudukan Indonesia"
                            : isLayak
                              ? previewResult.skor_kejelasan >= 80
                                ? "Dokumen Layak & Terbaca Jelas"
                                : "Dokumen Layak — Area Kurang Tajam"
                              : "Foto Buram / Perlu Perbaikan"}
                    </span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-md ${
                        isSystemError
                          ? "text-slate-700 bg-slate-200 border border-slate-300"
                          : isTidakValid
                            ? "text-red-700 bg-red-100 border border-red-200"
                            : isLayak
                              ? "text-emerald-800 bg-emerald-100 border border-emerald-200"
                              : "text-amber-800 bg-amber-100 border border-amber-200"
                      }`}
                    >
                      {isSystemError ? "Skor AI: –" : `Skor AI: ${previewResult.skor_kejelasan}/100`}
                    </span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-md border ${
                        isSystemError
                          ? "text-slate-700 bg-slate-200 border-slate-300"
                          : JENIS_META[previewResult.jenis_dokumen || "LAINNYA"]?.badge ||
                            "text-slate-700 bg-white border-slate-200"
                      }`}
                    >
                      {isSystemError
                        ? "Jenis Dokumen: –"
                        : `Jenis Dokumen: ${jenisLabel(previewResult.jenis_dokumen)}`}
                    </span>
                    {isOfflineDemo && (
                      <span className="text-xs font-bold px-2.5 py-0.5 rounded-md text-amber-800 bg-amber-100 border border-amber-200">
                        Penilaian Offline (AI gangguan)
                      </span>
                    )}
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
                  {!isSystemError && blurAreas.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {blurAreas.map((a, i) => {
                        const style = BLUR_SEVERITY_STYLE[a.severity] || BLUR_SEVERITY_STYLE.medium;
                        return (
                          <li key={`blur-legend-${i}`} className="flex items-start gap-1.5 text-[11px] leading-snug">
                            <span
                              className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold ${style.chip}`}
                            >
                              {i + 1}
                            </span>
                            <span className="opacity-90">
                              <b>{blurAreaLabel(a.area)}</b> — {style.label}
                              {a.description ? ` (${a.description})` : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {blurEstimated && (
                    <p className="mt-1.5 text-[10px] leading-snug text-amber-800/90">
                      Kotak bergaris putus-putus adalah perkiraan dari analisis ketajaman lokal,
                      bukan vonis AI. Periksa tetap seluruh permukaan dokumen.
                    </p>
                  )}
                  {blurNeedsManualCheck && (
                    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-900">
                      <b>Area buram tidak dapat dipetakan otomatis.</b> AI menilai dokumen kurang
                      tajam ({previewResult.skor_kejelasan}/100). Periksa seluruh teks, foto, dan
                      tepi dokumen; foto ulang di tempat terang bila perlu.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                {pageResults.length <= 1 && (
                  <SpeakResultButton
                    text={buildPreScreenSpeech({
                      isSystemError,
                      isQuotaBlocked,
                      isTidakValid,
                      isLayak,
                      skor: previewResult.skor_kejelasan,
                      jenis: isSystemError ? undefined : jenisLabel(previewResult.jenis_dokumen),
                      catatan: isSystemError ? undefined : previewResult.catatan,
                    })}
                    autoPlay={isLayak}
                    autoPlayKey={`page-${scanResultId}-${selectedPageIndex}`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setIsModalOpen(true)}
                  className={`text-xs font-semibold bg-white min-h-9 px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 shrink-0 shadow-xs cursor-pointer border ${
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
            </div>

            {/* REKOMENDASI PERBAIKAN & TINDAK LANJUT — dihitung di klien dari
                sinyal hasil pindai, tetap tampil walau AI sedang gangguan. */}
            {(() => {
              const nikDigits = previewResult.nik_value?.replace(/\D/g, "").length || 0;
              const { perbaikan, tindakLanjut } = buildScanRecommendations({
                jenis_dokumen: previewResult.jenis_dokumen,
                skor: previewResult.skor_kejelasan,
                blur_areas: previewResult.blur_areas,
                nik_digits: isSystemError ? null : nikDigits,
                nama_terdeteksi: isSystemError
                  ? undefined
                  : !!(
                      previewResult.nama_terdeteksi &&
                      !String(previewResult.nama_terdeteksi).includes("Tidak")
                    ),
                is_system_error: isSystemError,
                is_offline_demo: isOfflineDemo,
                lulus: previewResult.status_verifikasi === "BERHASIL",
              });
              return <RecommendationCard perbaikan={perbaikan} tindakLanjut={tindakLanjut} />;
            })()}

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
                    <div className="relative inline-block max-w-full">
                      <img
                        src={previewResult.imageBase64}
                        alt="Pratinjau Dokumen"
                        className="block max-h-[160px] w-auto max-w-full object-contain rounded-lg shadow-md border border-slate-800"
                      />
                      {blurAreas.map((a, i) => {
                        const style = BLUR_SEVERITY_STYLE[a.severity] || BLUR_SEVERITY_STYLE.medium;
                        return (
                          <div
                            key={`blur-box-${i}`}
                            className={`absolute rounded-sm border ${style.box} ${
                              a.estimated ? "border-dashed" : ""
                            }`}
                            style={{
                              left: `${a.bbox[0]}%`,
                              top: `${a.bbox[1]}%`,
                              width: `${a.bbox[2]}%`,
                              height: `${a.bbox[3]}%`,
                            }}
                          >
                            <span
                              className={`absolute -left-px -top-px flex h-4 w-4 items-center justify-center rounded-br-sm text-[9px] font-bold leading-none ${style.chip}`}
                            >
                              {i + 1}
                            </span>
                          </div>
                        );
                      })}
                      {blurNeedsManualCheck && (
                        <div className="pointer-events-none absolute inset-1 rounded-md border-2 border-dashed border-amber-400 bg-amber-300/10">
                          <span className="absolute left-1 top-1 rounded bg-amber-400 px-1 py-0.5 text-[8px] font-bold leading-none text-amber-950">
                            Periksa seluruh dokumen
                          </span>
                        </div>
                      )}
                    </div>
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
                      <div className="text-sm font-bold text-[#0F172A]">
                        {isSystemError ? (
                          "–"
                        ) : (
                          <>
                            {previewResult.skor_kejelasan}% -{" "}
                            {previewResult.status_kejelasan === "LULUS"
                              ? "LULUS TAJAM"
                              : previewResult.status_kejelasan === "DITOLAK"
                                ? "DITOLAK"
                                : "KURANG TAJAM"}
                          </>
                        )}
                      </div>
                      <div className="w-full bg-slate-200 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isSystemError
                              ? "bg-slate-300"
                              : isLayak
                                ? "bg-emerald-500"
                                : isTidakValid
                                  ? "bg-red-500"
                                  : "bg-amber-500"
                          }`}
                          style={{ width: isSystemError ? "0%" : `${previewResult.skor_kejelasan}%` }}
                        ></div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {isSystemError
                        ? "Belum dinilai (gangguan sistem)."
                        : isLayak && previewResult.skor_kejelasan >= 80
                          ? "DPI tajam & kontras teks sangat jelas."
                          : isLayak
                            ? "Lolos ambang, tetapi beberapa bagian masih kurang tajam."
                            : "Dokumen dinilai kurang tajam — periksa area yang ditandai."}
                    </p>
                  </div>

                  {/* METRIK 2: 16-DIGIT NIK */}
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-2">
                    <div className="flex justify-between items-center text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                      <span>16-Digit NIK</span>
                      {previewResult.nik_terdeteksi ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : !isSystemError && !isNikWajib(previewResult.jenis_dokumen) ? (
                        <CheckCircle2 className="w-4 h-4 text-slate-400" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-[#0F172A] font-mono truncate">
                        {isSystemError
                          ? "–"
                          : previewResult.nik_terdeteksi || nikPartialShown
                            ? previewResult.nik_value
                            : "Tidak Terdeteksi"}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {previewResult.nik_terdeteksi
                          ? "NIK lengkap dan terbaca valid."
                          : nikPartialShown
                            ? `Terbaca ${nikDigitsShown.length}/16 digit — dilengkapi manual / foto ulang.`
                            : isSystemError
                              ? "Belum dinilai (gangguan sistem)."
                              : !isNikWajib(previewResult.jenis_dokumen)
                                ? "NIK opsional untuk jenis dokumen ini — boleh dilengkapi di formulir bila tercantum."
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
                      <div className="text-sm font-bold text-[#0F172A]">
                        {isSystemError
                          ? "–"
                          : previewResult.pencahayaan_status === "SESUAI_STANDAR"
                            ? "Sesuai Standar"
                            : "Kurang Terang"}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {isSystemError
                          ? "Belum dinilai (gangguan sistem)."
                          : previewResult.pencahayaan_status === "SESUAI_STANDAR"
                            ? "Pencahayaan merata tanpa silau."
                            : "Pencahayaan redup / ada refleksi."}
                      </p>
                    </div>
                  </div>

                </div>

                {/* TOMBOL AKSI — status tombol mengikuti DOKUMEN UTAMA, bukan
                    halaman yang sedang dilihat. Halaman lain bisa saja invalid
                    tanpa memblokir lanjut. */}
                {mainPage && selectedPageIndex !== mainPageIndex && (
                  <p className="text-[11px] leading-relaxed text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    Anda sedang melihat Halaman {pageResults[selectedPageIndex]?.pageNumber || "-"}. Tombol di
                    bawah memakai <b className="text-slate-700">dokumen utama</b>: Halaman {mainPage.pageNumber} —{" "}
                    {jenisLabel(mainPage.result.jenis_dokumen)}.
                  </p>
                )}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  {mainIsUsable ? (
                    <button
                      type="button"
                      onClick={handleProceed}
                      className={`flex-1 text-white font-semibold text-xs sm:text-sm py-2.5 px-4 rounded-xl shadow-xs hover:shadow transition flex items-center justify-center gap-2 cursor-pointer ${
                        mainPage?.result.status_kelayakan === "LAYAK"
                          ? "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
                          : "bg-amber-500 hover:bg-amber-600 active:bg-amber-700"
                      }`}
                    >
                      {mainPage?.result.status_kelayakan === "LAYAK" ? (
                        <>
                          <span>Lanjut ke Formulir dengan Data Ini</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      ) : (
                        <>
                          <ArrowRight className="w-4 h-4" />
                          <span>Diterima — Lanjut dengan Verifikasi Loket</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        title={
                          hasSystemErrorPage && isQuotaBlocked
                            ? "Kuota masih habis — pindaian akan ditolak lagi sampai reset. Gunakan Lanjut Isi Manual."
                            : undefined
                        }
                        className={`flex-1 text-white font-semibold text-xs sm:text-sm py-2.5 px-4 rounded-xl shadow-xs hover:shadow transition flex items-center justify-center gap-2 cursor-pointer ${
                          hasSystemErrorPage
                            ? "bg-slate-600 hover:bg-slate-700 active:bg-slate-800"
                            : "bg-red-500 hover:bg-red-600 active:bg-red-700"
                        }`}
                      >
                        {hasSystemErrorPage ? (
                          <>
                            <RefreshCw className="w-4 h-4" />
                            <span>{isQuotaBlocked ? "Coba Lagi Nanti (Kuota Habis)" : "Coba Pindai Ulang"}</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4" />
                            <span>Unggah Ulang Foto Dokumen Asli</span>
                          </>
                        )}
                      </button>
                      {hasSystemErrorPage && (
                        <button
                          type="button"
                          onClick={handleProceedManual}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs sm:text-sm py-2.5 px-4 rounded-xl shadow-xs hover:shadow transition flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <ArrowRight className="w-4 h-4" />
                          <span>Lanjut Isi Manual (Tanpa Skor AI)</span>
                        </button>
                      )}
                    </>
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
                      ? "bg-slate-100 border-slate-300 text-[#0F172A]"
                      : isTidakValid
                        ? "bg-red-50 border-red-200 text-red-900"
                        : isLayak
                          ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                          : "bg-amber-50 border-amber-200 text-amber-900"
                  }`}
                >
                  <span className="font-bold text-xs uppercase">
                    Status:{" "}
                    {isQuotaBlocked
                      ? "Kuota Habis — Belum Dinilai AI"
                      : isSystemError
                        ? "Gagal Memindai — Coba Lagi"
                        : isTidakValid
                          ? "File Bukan KTP Indonesia"
                          : isLayak
                            ? "Layak Diproses"
                            : "Perlu Perbaikan"}
                  </span>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-white/80">
                    Skor: {isSystemError ? "–" : `${previewResult.skor_kejelasan}/100`}
                  </span>
                </div>
              </div>

              {/* Detail Items */}
              <div className="mt-4 space-y-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                  <span className="text-slate-400 block text-[11px]">Jenis Dokumen Terdeteksi:</span>
                  <p className="font-bold text-[#0F172A]">
                    {isQuotaBlocked
                      ? "Belum dinilai (terblokir kuota — AI belum melihat berkas)"
                      : isSystemError
                        ? "Tidak diketahui (gangguan sistem)"
                        : jenisLabel(previewResult.jenis_dokumen)}
                    {!isSystemError && previewResult.status_verifikasi
                      ? ` • ${previewResult.status_verifikasi}`
                      : ""}
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                  <span className="text-slate-400 block text-[11px]">Nama Berkas:</span>
                  <p className="font-mono font-medium text-[#0F172A]">{previewResult.imageName || "-"}</p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                  <span className="text-slate-400 block text-[11px]">16-Digit NIK:</span>
                  <p className="font-mono font-bold text-[#0F172A]">
                    {isQuotaBlocked
                      ? "– (belum dinilai — terblokir kuota)"
                      : isSystemError
                        ? "– (belum dinilai)"
                        : previewResult.nik_terdeteksi || nikPartialShown
                          ? previewResult.nik_value
                          : !isNikWajib(previewResult.jenis_dokumen)
                            ? "Opsional (tidak tercantum di dokumen ini)"
                            : "Tidak Terdeteksi"}
                  </p>
                  {nikPartialShown && (
                    <p className="text-[11px] text-amber-700">
                      Terbaca {nikDigitsShown.length}/16 digit — dilengkapi manual di formulir atau foto ulang.
                    </p>
                  )}
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                  <span className="text-slate-400 block text-[11px]">Nama Pemohon Terdeteksi:</span>
                  <p className="font-semibold text-[#0F172A]">
                    {isQuotaBlocked ? "– (belum dinilai — terblokir kuota)" : isSystemError ? "– (belum dinilai)" : previewResult.nama_terdeteksi || "Tidak Terbaca"}
                  </p>
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
