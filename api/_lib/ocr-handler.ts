// Handler OCR bersama untuk /api/ocr dan /api/scan-document (Vercel Serverless).
// Logic dipindah 1:1 dari server.ts agar perilaku identik.

import { GoogleGenAI } from "@google/genai";
import { visionViaNaraRoute } from "../../services/ai_providers.js";
import {
  BUKAN_KTP_MESSAGE,
  extractNaraApiKey,
  getGeminiClient,
  isNaraConfigured,
  JENIS_DOKUMEN_VALID,
  JENIS_NIK_OPSIONAL,
  normalizeJenisDokumen,
  normalizeStatusVerifikasi,
  parseAiJsonResponse,
} from "./store.js";
import { parseMultipartBuffer, readJsonBody, readRawBody } from "./http.js";
import { classifyAiFailure } from "./ai-errors.js";
import {
  checkOcrRateLimit,
  getClientIp,
  hashIp,
  isTurnstileVerified,
  markTurnstileVerified,
  ocrLimits,
  peekOcrWindowCount,
  rateLimitHeaders,
} from "./rate-limit.js";
import { isTurnstileConfigured, verifyTurnstile } from "./turnstile.js";
import { sha256Hex, validateUploadBuffer } from "./file-guard.js";
import { getCachedOcr, setCachedOcr } from "./ocr-cache.js";
import { isUsableAiParsed } from "./ai-response-guard.js";
import { logOcrAttempt } from "./abuse-log.js";

const OCR_SYSTEM = `Anda adalah sistem AI Vision OCR profesional yang dikhususkan untuk menganalisis dan memverifikasi dokumen kependudukan resmi Indonesia (e-KTP, Kartu Keluarga/KK, KIA, akta kelahiran/kematian/perkawinan, dan Surat Pindah/SKPWNI).

Tugas utama Anda:
1. Identifikasi Jenis Dokumen (wajib tepat):
   - "KTP": e-KTP Republik Indonesia. Ciri wajib: ada tulisan "NIK" 16 digit, header provinsi/kabupaten, foto wajah, tulisan "KARTU TANDA PENDUDUK" / "e-KTP". Varian tulisan "e-KTP", "KTP-EL", "KTP EL" semuanya tetap "KTP".
   - "KK": Kartu Keluarga.
   - "AKTA": Akta Kelahiran (kutipan akta kelahiran).
   - "AKTA_KEMATIAN": Akta Kematian / kutipan akta kematian Dukcapil, atau surat keterangan kematian resmi (RS/dokter/kelurahan).
   - "AKTA_PERKAWINAN": Akta Perkawinan / kutipan akta perkawinan (termasuk perkawinan non-Muslim yang dilegalisasi).
   - "SURAT_PINDAH": Surat Keterangan Pindah WNI (SKPWNI) atau formulir permohonan pindah penduduk.
   - "KIA": Kartu Identitas Anak.
   - "LAINNYA": WAJIB dipakai HANYA jika gambar bukan salah satu dari ketujuh dokumen di atas (misal: SIM, paspor, foto selfie, screenshot HP, dokumen asing, kertas kosong, foto blur total tanpa ciri Dukcapil).

2. Ekstraksi Data Utama:
   - NIK: Cari 16-digit Nomor Induk Kependudukan (pada akta kematian: NIK almarhum; pada akta perkawinan: NIK yang paling jelas). Bersihkan dari spasi atau simbol. Jika tidak ditemukan, kabur, atau tidak bernilai 16 digit, set ke null — dokumen non-kartu tetap valid walau NIK null.
   - Nama: Ambil nama lengkap utama sesuai teks resmi (pemilik dokumen / almarhum / pasangan / anak). Jika bukan dokumen Dukcapil, set ke null.

3. Evaluasi Kualitas Fisik & Kejelasan Foto:
   - Periksa kejelasan teks (apakah terjadi motion blur atau out-of-focus).
   - Periksa gangguan cahaya (pantulan flash, silau/glare, atau bayangan gelap).
   - Periksa kerapian pemotongan (apakah ada sudut dokumen yang terpotong).

4. Kalkulasi Skor Kejelasan (0 - 100):
   - 80 - 100: Teks sangat tajam, seluruh digit NIK terbaca sempurna tanpa keraguan.
   - 50 - 79: Teks agak kabur/silau, namun NIK masih dapat diidentifikasi.
   - 0 - 49: Foto sangat buram, NIK tertutup silau, terpotong, atau tidak terbaca.
   - 0 - 25: Bukan dokumen kependudukan (wajib skor rendah).

5. Penentuan Status Verifikasi (wajib konsisten dengan jenis):
   - "BERHASIL": Dokumen kependudukan yang didukung (KTP/KK/AKTA/AKTA_KEMATIAN/AKTA_PERKAWINAN/SURAT_PINDAH/KIA) dan skor kejelasan >= 70.
   - "BURAM": Dokumen kependudukan yang didukung, namun skor kejelasan < 70 (memerlukan foto ulang).
   - "TIDAK_VALID": WAJIB dipakai jika jenis_dokumen "LAINNYA" (gambar bukan dokumen kependudukan resmi Indonesia).

6. Deteksi Area Kurang Jelas (WAJIB bila skor_kejelasan < 80 dan dokumen kependudukan yang didukung, bukan LAINNYA):
   - Identifikasi bagian dokumen yang buram, silau, gelap, terpotong, atau tidak terbaca.
   - Gunakan istilah baku dokumen untuk "area": "nik", "nama", "foto_wajah", "tanggal_lahir", "tempat_lahir", "jenis_kelamin", "alamat", "rt_rw", "kelurahan", "kecamatan", "agama", "pekerjaan", "kewarganegaraan", "status_perkawinan", "golongan_darah", "berlaku_hingga", "tanda_tangan", "kepala_keluarga", "anggota_keluarga", "nomor_akta", "tanggal_peristiwa", "pasangan", atau "lainnya".
   - "severity": "high" (teks kunci tidak terbaca), "medium" (terbaca sebagian), "low" (terbaca namun kurang tajam).
   - "bbox": [x, y, width, height] dalam PERSEN 0-100 relatif terhadap gambar, (x, y) = pojok kiri atas area. Perkiraan posisi yang wajar sudah cukup.
   - "description": penyebab singkat, contoh "motion blur", "silau flash", "kurang cahaya", "bayangan", "terpotong", "out of focus".
   - Contoh: [{"area":"nik","severity":"high","bbox":[8,42,46,9],"description":"silau flash"}].
   - PENTING: skor 70–79 tetap berstatus "BERHASIL", tetapi area buram WAJIB diisi. Status BERHASIL bukan alasan mengembalikan array kosong.
   - Jika skor < 80, blur_areas TIDAK BOLEH kosong: isi minimal 1 dan maksimal 4 area. Bila posisi tidak yakin, tetap berikan bbox perkiraan yang wajar.
   - Hanya kembalikan [] jika skor >= 80 DAN seluruh teks dinilai tajam, atau dokumen LAINNYA.

7. Catatan Perbaikan (Saran Singkat):
   - Jika status BURAM, berikan 1 kalimat saran konkret (contoh: "Foto KTP terlalu silau di area NIK, harap matikan lampu flash dan ambil ulang foto di tempat terang").
   - Jika status TIDAK_VALID, WAJIB awali catatan dengan kalimat persis: "File bukan Kartu Kependudukan Indonesia." lalu lanjutkan saran mengunggah foto dokumen kependudukan yang didukung (e-KTP, KK, KIA, akta kelahiran/kematian/perkawinan, atau Surat Pindah/SKPWNI).

PENTING: Jawab HANYA dengan JSON valid memakai key: nik, nama, jenis_dokumen, skor_kejelasan, status_verifikasi, catatan, blur_areas.`;

const OCR_USER_PROMPT =
  "Analisis foto dokumen kependudukan ini. Periksa kejelasan teks, ekstrak NIK 16 digit jika ada, dan tentukan apakah foto layak untuk verifikasi. Jika skor kejelasan di bawah 80, WAJIB isi blur_areas minimal satu area yang kurang jelas.";

/** Batas maksimum area yang ditampilkan agar overlay tidak menutupi seluruh foto. */
const MAX_BLUR_AREAS = 4;

export type BlurArea = {
  area: string;
  severity: "high" | "medium" | "low";
  /** [x, y, width, height] dalam persen (0-100) relatif terhadap gambar. */
  bbox: [number, number, number, number];
  description: string;
};

/**
 * Validasi & normalisasi `blur_areas` dari AI.
 * AI bisa mengembalikan koordinat desimal, di luar batas, atau field rusak —
 * jangan sampai seluruh pindaian gagal hanya karena overlay bermasalah.
 */
function sanitizeBlurAreas(raw: unknown): BlurArea[] {
  if (!Array.isArray(raw)) return [];
  const rank: Record<BlurArea["severity"], number> = { high: 0, medium: 1, low: 2 };
  const out: BlurArea[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const it = item as any;
    const bboxRaw = Array.isArray(it.bbox) ? it.bbox : null;
    if (!bboxRaw || bboxRaw.length !== 4) continue;

    const nums = bboxRaw.map((v: unknown) => Number(v));
    if (nums.some((n: number) => !Number.isFinite(n))) continue;

    const clamp = (n: number) => Math.max(0, Math.min(100, n));
    let [x, y, w, h] = nums.map(clamp);
    if (x >= 100 || y >= 100) continue;
    w = Math.min(w, 100 - x);
    h = Math.min(h, 100 - y);
    // Abaikan kotak yang terlalu kecil untuk terlihat (noise dari model).
    if (w < 2 || h < 2) continue;

    const area = String(it.area ?? "lainnya").trim().toLowerCase().slice(0, 40) || "lainnya";
    const sevRaw = String(it.severity ?? "").trim().toLowerCase();
    const severity: BlurArea["severity"] =
      sevRaw === "high" || sevRaw === "medium" || sevRaw === "low" ? (sevRaw as BlurArea["severity"]) : "medium";

    out.push({
      area,
      severity,
      bbox: [
        Math.round(x * 10) / 10,
        Math.round(y * 10) / 10,
        Math.round(w * 10) / 10,
        Math.round(h * 10) / 10,
      ],
      description: String(it.description ?? "").trim().slice(0, 120),
    });
  }

  out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return out.slice(0, MAX_BLUR_AREAS);
}


async function extractImage(req: any): Promise<{ fileBytes: Buffer | null; mimeType: string; bodyFields: any }> {
  const contentType = String(req.headers?.["content-type"] || "");
  // Jika Vercel sudah parse JSON, pakai langsung
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return { fileBytes: null, mimeType: "image/jpeg", bodyFields: req.body };
  }
  if (contentType.includes("multipart/form-data")) {
    const raw = await readRawBody(req);
    const parsed = parseMultipartBuffer(raw, contentType);
    if (parsed?.fileBytes) {
      return { fileBytes: parsed.fileBytes, mimeType: parsed.mimeType, bodyFields: parsed.fields };
    }
    return { fileBytes: null, mimeType: "image/jpeg", bodyFields: parsed?.fields || {} };
  }
  const body = await readJsonBody(req);
  try {
    (req as any).body = body;
  } catch {}
  return { fileBytes: null, mimeType: "image/jpeg", bodyFields: body };
}

export async function handleOcr(req: any, res: any) {
  try {
    const { fileBytes: uploadBytes, mimeType: uploadMime, bodyFields } = await extractImage(req);

    let fileBytes: Buffer | null = uploadBytes;
    let mimeType = uploadMime;

    const imageBase64 =
      bodyFields?.imageBase64 || (req.body && (req.body as any).imageBase64);
    if (!fileBytes && typeof imageBase64 === "string" && imageBase64) {
      const cleanBase64 = imageBase64.replace(/^data:[a-zA-Z0-9/+\-.]+;base64,/, "");
      if (cleanBase64.trim()) {
        fileBytes = Buffer.from(cleanBase64, "base64");
        const mm = imageBase64.match(/^data:([a-zA-Z0-9/+\-.]+);base64,/);
        if (mm) mimeType = mm[1];
      }
    }
    if (fileBytes && fileBytes.length === 0) fileBytes = null;

    const ocrStart = Date.now();
    const clientIp = getClientIp(req);    const ipHash = hashIp(clientIp, req?.headers?.["user-agent"]);
    const limits = ocrLimits();

    // --- Anti-spam L1: honeypot + dwell-time (tanpa AI) ---------------------
    const honeypot =
      bodyFields?.website_confirm ?? bodyFields?.honeypot ?? (req.body && (req.body as any).website_confirm);
    const startedAtRaw = bodyFields?.startedAt ?? (req.body && (req.body as any).startedAt);
    const startedAt = Number(startedAtRaw);
    if (typeof honeypot === "string" && honeypot.trim()) {
      await logOcrAttempt({ ipHash, fileHash: "", mime: mimeType, sizeBytes: fileBytes?.length ?? 0, status: "BOT_HONEYPOT", source: "blocked:honeypot", latencyMs: Date.now() - ocrStart });
      return res.status(400).json({
        success: false,
        code: "BOT_DETECTED",
        message: "Terdeteksi aktivitas otomatis. Muat ulang halaman lalu unggah foto e-KTP asli.",
      });
    }
    if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < 3000) {
      await logOcrAttempt({ ipHash, fileHash: "", mime: mimeType, sizeBytes: fileBytes?.length ?? 0, status: "BOT_FAST", source: "blocked:dwell", latencyMs: Date.now() - ocrStart });
      return res.status(400).json({
        success: false,
        code: "BOT_DETECTED",
        message: "Terlalu cepat mengirim berkas. Tunggu sejenak lalu unggah ulang foto e-KTP asli.",
      });
    }

    // --- Anti-spam L2: captcha adaptif (scan terakhir wajib token manusia) ------
    // Peek dulu agar 403 captcha TIDAK memakan kuota.
    const turnstileToken =
      bodyFields?.turnstileToken ?? (req.body && (req.body as any).turnstileToken) ?? null;
    let turnstileOk = await isTurnstileVerified(ipHash);
    if (!turnstileOk && isTurnstileConfigured()) {
      const used = await peekOcrWindowCount(ipHash);
      if (used >= limits.per10Min - 1) {
        const v = await verifyTurnstile(turnstileToken, clientIp);
        if (!v.ok) {
          await logOcrAttempt({ ipHash, fileHash: "", mime: mimeType, sizeBytes: fileBytes?.length ?? 0, status: "CAPTCHA_REQUIRED", source: "blocked:captcha", latencyMs: Date.now() - ocrStart });
          return res.status(403).json({
            success: false,
            code: "CAPTCHA_REQUIRED",
            captchaRequired: true,
            message: "Verifikasi manusia diperlukan untuk pemindaian terakhir. Selesaikan captcha lalu coba lagi (kuota Anda tidak berkurang).",
          });
        }
        turnstileOk = true;
        await markTurnstileVerified(ipHash);
      } else if (typeof turnstileToken === "string" && turnstileToken.trim()) {
        // Token sukarela di percobaan awal: verifikasi & tandai agar percobaan terakhir mulus.
        const v = await verifyTurnstile(turnstileToken, clientIp);
        if (v.ok) {
          turnstileOk = true;
          await markTurnstileVerified(ipHash);
        }
      }
    }

    // --- Anti-spam L3: rate-limit (20x/10 mnt/IP, 20x/hari/IP, 300x/hari, via ocrLimits()) ----
    const rl = await checkOcrRateLimit(req);
    for (const [k, v] of Object.entries(rateLimitHeaders(rl.remaining10, rl.retryAfterSec))) {
      try { res.setHeader(k, v); } catch {}
    }
    if (!rl.allowed) {
      const msg =
        rl.code === "GLOBAL_LIMIT"
          ? "Layanan sedang padat (kuota harian tercapai). Coba lagi besok atau hubungi petugas loket."
          : rl.code === "DAY_LIMIT"
            ? `Kuota harian Anda habis (${limits.perDayIp}x/hari). AI belum memeriksa berkas ini — bukan salah foto Anda. Coba lagi besok atau hubungi petugas loket / lanjut isi manual.`
            : `Terlalu sering memindai. Sisa kuota 0/${limits.per10Min} per 10 menit. AI belum memeriksa berkas ini — bukan salah foto Anda.`;
      await logOcrAttempt({ ipHash, fileHash: "", mime: mimeType, sizeBytes: fileBytes?.length ?? 0, status: rl.code, source: "blocked:rate", latencyMs: Date.now() - ocrStart });
      return res.status(429).json({
        success: false,
        code: "RATE_LIMITED",
        limitCode: rl.code,
        isSystemError: true,
        message: msg,
        retryAfter: rl.retryAfterSec,
        remaining: 0,
        limit: limits.per10Min,
      });
    }

    // --- Anti-spam L4: validasi file murah (magic-bytes, ukuran, dimensi) ---
    const guard = validateUploadBuffer(fileBytes, mimeType);
    if (!guard.ok) {
      await logOcrAttempt({ ipHash, fileHash: "", mime: mimeType, sizeBytes: fileBytes?.length ?? 0, status: "INVALID_FILE", source: `blocked:${guard.reason}`, latencyMs: Date.now() - ocrStart });
      return res.status(guard.reason === "too-large" ? 413 : 400).json({
        success: false,
        code: "INVALID_FILE",
        message: guard.message,
        data: {
          nik: null,
          nama: null,
          jenis_dokumen: "LAINNYA",
          skor_kejelasan: 0,
          status_verifikasi: "TIDAK_VALID",
          status_kualitas: "TIDAK_LAYAK",
          catatan: guard.message,
        },
      });
    }

    // --- Anti-spam L5: dedup hash (file sama = tanpa AI) --------------------
    const fileHash = sha256Hex(fileBytes as Buffer);
    let parsed: any = await getCachedOcr(fileHash);
    const cacheHit = Boolean(parsed);
    let aiSource = cacheHit ? "cache" : "";

    if (!fileBytes) {
      return res.status(400).json({
        success: false,
        message: "File tidak ditemukan. Silakan unggah foto e-KTP (JPG/PNG/WEBP/PDF).",
        data: {
          nik: null,
          nama: null,
          jenis_dokumen: "LAINNYA",
          skor_kejelasan: 0,
          status_verifikasi: "TIDAK_VALID",
          status_kualitas: "TIDAK_LAYAK",
          catatan: BUKAN_KTP_MESSAGE,
        },
      });
    }

    // Lewati AI bila cache hit (fileHash sudah pernah diproses <24 jam).
    const skipAi = cacheHit && parsed && typeof parsed === "object";
    if (skipAi) aiSource = "cache";

    const naraApiKey = extractNaraApiKey({ ...req, body: bodyFields });
    const naraConfigured = isNaraConfigured(naraApiKey);
    const client: GoogleGenAI | null = getGeminiClient();

    const ocrModels = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
    let responseText = "";
    let lastAiError = "";
    const isPdf = /pdf/i.test(mimeType || "");

    if (!skipAi) {
    // Prioritas 1: Gemini (utama — mendukung gambar + PDF).
    if (!responseText && client) {
      const aiDeadline = Date.now() + 50_000;
      for (const modelName of ocrModels) {
        if (Date.now() >= aiDeadline) {
          lastAiError = "Batas waktu OCR AI habis sebelum semua model dicoba";
          break;
        }
        try {
          const response = await client.models.generateContent({
            model: modelName,
            contents: [
              { inlineData: { data: fileBytes.toString("base64"), mimeType } },
              { text: OCR_USER_PROMPT },
            ],
            config: {
              systemInstruction: OCR_SYSTEM,
              responseMimeType: "application/json",
              temperature: 0.0,
              maxOutputTokens: 8192,
              // Batasi tiap model agar kegagalan jaringan tidak menggantung lama.
              httpOptions: { timeout: 18000 },
              responseSchema: {
                type: "OBJECT",
                properties: {
                  nik: { type: "STRING", nullable: true },
                  nama: { type: "STRING", nullable: true },
                  jenis_dokumen: { type: "STRING" },
                  skor_kejelasan: { type: "INTEGER" },
                  status_verifikasi: { type: "STRING" },
                  catatan: { type: "STRING" },
                  blur_areas: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        area: { type: "STRING" },
                        severity: { type: "STRING" },
                        description: { type: "STRING" },
                        bbox: {
                          type: "ARRAY",
                          items: { type: "NUMBER" },
                        },
                      },
                      required: ["area", "severity", "bbox"],
                    },
                  },
                },
                required: ["jenis_dokumen", "skor_kejelasan", "status_verifikasi", "blur_areas"],
              },
            },
          });
          const candidateText = (response as any)?.text;
          if (candidateText) {
            try {
              const candidate = parseAiJsonResponse(candidateText);
              if (isUsableAiParsed(candidate)) {
                responseText = candidateText;
                aiSource = "gemini";
                break;
              }
              lastAiError = `Gemini ${modelName}: jawaban tidak lengkap / terindikasi halusinasi`;
            } catch {
              lastAiError = `Gemini ${modelName}: JSON tidak valid`;
            }
          }
        } catch (modelErr: any) {
          lastAiError = `Gemini ${modelName}: ${modelErr?.message || modelErr}`;
        }
      }
    }

    // Prioritas 2 (cadangan): nara-route — hanya image (PDF dilewati).
    if (!responseText && naraConfigured && !isPdf) {
      try {
        const naraText = await visionViaNaraRoute({
          apiKey: naraApiKey,
          model:
            ((bodyFields?.naraModel || bodyFields?.bynaraModel) as string) ||
            process.env.NARA_ROUTE_MODEL ||
            process.env.BYNARA_MODEL ||
            undefined,
          systemPrompt: OCR_SYSTEM,
          userPrompt: OCR_USER_PROMPT,
          imageBase64: fileBytes.toString("base64"),
          mimeType,
        });
        if (naraText) {
          try {
            const candidate = parseAiJsonResponse(naraText);
            if (isUsableAiParsed(candidate)) {
              responseText = naraText;
              aiSource = "nara-route";
            } else {
              lastAiError = "nara-route: jawaban tidak lengkap / terindikasi halusinasi";
            }
          } catch {
            lastAiError = "nara-route: JSON tidak valid";
          }
        }
      } catch (naraErr: any) {
        lastAiError = `nara-route: ${naraErr?.message || naraErr}`;
      }
    }
    } // end if (!skipAi)

    if (!skipAi && !responseText && !client && !naraConfigured) {
      return res.status(503).json({
        success: false,
        isSystemError: true,
        message: "Layanan AI OCR belum dikonfigurasi (GEMINI_API_KEY / NARA_ROUTE_API_KEY / BYNARA_API_KEY kosong). Bukan salah foto Anda — lanjut isi formulir manual atau hubungi petugas untuk verifikasi manual.",
        data: {
          nik: null, nama: null, jenis_dokumen: "LAINNYA", skor_kejelasan: 0,
          status_verifikasi: "TIDAK_VALID", status_kualitas: "TIDAK_LAYAK",
          isSystemError: true,
          catatan: "Layanan AI belum dikonfigurasi (gangguan sistem). Bukan salah foto Anda — lanjut isi manual atau hubungi petugas untuk verifikasi manual.",
        },
      });
    }

    if (!skipAi && !responseText) {
      // JANGAN kirim detail mentah provider ke user (bocor + membingungkan).
      const aiFail = classifyAiFailure(lastAiError);
      return res.status(502).json({
        success: false,
        isSystemError: true,
        code: aiFail.code,
        subcode: aiFail.subcode,
        provider: aiFail.provider,
        retryable: aiFail.retryable,
        retryAfter: aiFail.retryAfterSec,
        message: aiFail.message,
        data: {
          nik: null, nama: null, jenis_dokumen: "LAINNYA", skor_kejelasan: 0,
          status_verifikasi: "TIDAK_VALID", status_kualitas: "TIDAK_LAYAK",
          isSystemError: true,
          catatan: aiFail.message,
        },
      });
    }

    if (!skipAi) {
    try {
      parsed = parseAiJsonResponse(responseText);
    } catch {
      // Buffer foto dinol-kan sebelum keluar (UU PDP: minimalkan sisa data di RAM).
      try {
        if (fileBytes) fileBytes.fill(0);
      } catch {}
      return res.status(502).json({
        success: false,
        isSystemError: true,
        message: "AI mengembalikan jawaban tak valid. Silakan ulangi pindaian dengan foto lebih jelas.",
        data: {
          nik: null, nama: null, jenis_dokumen: "LAINNYA", skor_kejelasan: 0,
          status_verifikasi: "TIDAK_VALID", status_kualitas: "TIDAK_LAYAK",
          isSystemError: true,
          catatan: "AI mengembalikan jawaban tak valid. Silakan ulangi pindaian.",
        },
      });
    }
    // Foto sudah selesai dipakai AI: nol-kan buffer asli
    // (panjang tak berubah, aman untuk log size).
    try {
      if (fileBytes) fileBytes.fill(0);
    } catch {}
    // Jejak sumber AI untuk logging (gemini utama, nara cadangan) — bukan rahasia.
    if (!skipAi && !aiSource) aiSource = client ? "gemini" : naraConfigured ? "nara-route" : "ai";
    }

    parsed.jenis_dokumen = normalizeJenisDokumen(parsed.jenis_dokumen);
    parsed.status_verifikasi = normalizeStatusVerifikasi(parsed.status_verifikasi);
    if (typeof parsed.skor_kejelasan !== "number") {
      const asNum = Number(parsed.skor_kejelasan);
      parsed.skor_kejelasan = Number.isFinite(asNum) ? Math.round(asNum) : 0;
    }
    parsed.skor_kejelasan = Math.max(0, Math.min(100, Math.round(parsed.skor_kejelasan)));

    // Overlay area buram: selalu array valid agar frontend tak perlu guard berlapis.
    parsed.blur_areas = sanitizeBlurAreas(parsed.blur_areas);

    if (parsed.nik) {
      // Hanya terima NIK yang benar-benar 16 digit setelah membuang label/pemisah.
      // Jangan sekadar membuang SEMUA non-digit: teks sampah dari model bisa
      // menyisakan 16 digit palsu (mis. "3201...Drafting note...").
      const nikRaw = String(parsed.nik).trim().replace(/^NIK\b[:\s]*/i, "");
      const nikClean = nikRaw.replace(/[\s.\-:/]/g, "");
      const nikDigits = nikClean.replace(/\D/g, "");
      if (!/^\d{16}$/.test(nikClean)) {
        if (nikDigits.length >= 8) parsed.nik_partial = nikDigits;
        parsed.nik = null;
        // Untuk dokumen non-kartu (akta kematian/perkawinan & surat pindah),
        // NIK memang sering tidak tercantum → cukup kosongkan, jangan
        // menurunkan vonis BERHASIL menjadi BURAM.
        if (
          parsed.status_verifikasi === "BERHASIL" &&
          !(JENIS_NIK_OPSIONAL as readonly string[]).includes(String(parsed.jenis_dokumen))
        ) {
          parsed.status_verifikasi = "BURAM";
          parsed.catatan =
            nikDigits.length === 16
              ? "Format NIK tidak valid (ada karakter tambahan). Foto ulang e-KTP dengan fokus tajam tanpa silau."
              : `NIK terbaca sebagian (${nikDigits.length || 0}/16 digit). Foto ulang e-KTP dengan fokus tajam tanpa silau.`;
        }
      } else {
        parsed.nik = nikClean;
      }
    }

    if (parsed.jenis_dokumen === "LAINNYA") parsed.status_verifikasi = "TIDAK_VALID";
    if (parsed.status_verifikasi === "BERHASIL" && parsed.skor_kejelasan < 70) {
      parsed.status_verifikasi = "BURAM";
      if (!parsed.catatan) {
        parsed.catatan = "Dokumen terdeteksi namun skor kejelasan di bawah 70. Foto ulang di tempat terang tanpa flash.";
      }
    }

    if (parsed.status_verifikasi === "TIDAK_VALID") {
      parsed.jenis_dokumen = "LAINNYA";
      parsed.nik = null;
      // Bukan dokumen kependudukan → overlay area tidak relevan.
      parsed.blur_areas = [];
      if (!parsed.nama || typeof parsed.nama !== "string") parsed.nama = null as any;
      if (typeof parsed.skor_kejelasan !== "number" || parsed.skor_kejelasan > 25) {
        parsed.skor_kejelasan = typeof parsed.skor_kejelasan === "number" ? Math.min(parsed.skor_kejelasan, 20) : 0;
      }
      if (!parsed.catatan || !/bukan kartu kependudukan/i.test(String(parsed.catatan))) {
        parsed.catatan = BUKAN_KTP_MESSAGE;
      }
    }

    const isTidakValid = parsed.status_verifikasi === "TIDAK_VALID" || parsed.jenis_dokumen === "LAINNYA";
    const isBerhasil = parsed.status_verifikasi === "BERHASIL" && !isTidakValid;
    const isBuramValid =
      parsed.status_verifikasi === "BURAM" &&
      !isTidakValid &&
      (JENIS_DOKUMEN_VALID as readonly string[]).includes(String(parsed.jenis_dokumen));
    if (isTidakValid) {
      parsed.status_verifikasi = "TIDAK_VALID";
      parsed.jenis_dokumen = "LAINNYA";
    }
    parsed.status_kualitas = isBerhasil ? "LAYAK" : "TIDAK_LAYAK";

    // Simpan hasil AI ke cache agar file sama tidak memakan token lagi.
    // (Hanya saat hasil berasal dari AI fresh, bukan dari cache itu sendiri.)
    if (!skipAi) {
      if (!parsed._cacheHit) await setCachedOcr(fileHash, parsed);
      if (parsed.status_verifikasi === "TIDAK_VALID") aiSource = aiSource || "ai";
    }

    if (isTidakValid) {
      await logOcrAttempt({ ipHash, fileHash, mime: mimeType, sizeBytes: fileBytes.length, skor: parsed.skor_kejelasan ?? null, status: "TIDAK_VALID", source: aiSource || "ai", latencyMs: Date.now() - ocrStart });
      return res.json({ success: false, message: BUKAN_KTP_MESSAGE, data: parsed, ...parsed });
    }

    const isValidDoc = isBerhasil || isBuramValid;
    if (!isValidDoc) {
      return res.json({
        success: false,
        message: parsed.catatan || "Dokumen buram, silakan foto ulang.",
        data: parsed,
        ...parsed,
      });
    }

    const finalStatus = isBerhasil ? "BERHASIL" : "BURAM";
    const finalCatatan =
      parsed.catatan ||
      (isBerhasil
        ? "Dokumen kependudukan valid dan terbaca jelas. Hasil uji tersimpan — lanjutkan untuk menerbitkan tiket QR."
        : "Dokumen kependudukan asli terdeteksi namun buram. Anda tetap dapat melanjutkan — tiket terbit dengan catatan revisi; bawa fisik dokumen asli untuk verifikasi ulang di loket.");
    parsed.catatan = finalCatatan;
    parsed.status_verifikasi = finalStatus;
    parsed.status_kualitas = isBerhasil ? "LAYAK" : "TIDAK_LAYAK";

    // Log OCR attempt
    await logOcrAttempt({ ipHash, fileHash, mime: mimeType, sizeBytes: fileBytes.length, skor: parsed.skor_kejelasan ?? null, status: finalStatus, source: aiSource || "ai", latencyMs: Date.now() - ocrStart });
    try {
      res.setHeader("X-Ocr-Source", aiSource || "ai");
      res.setHeader("X-RateLimit-Remaining", String(rl.remaining10));
    } catch {}
    return res.json({
      success: true,
      message: finalCatatan,
      needsRephoto: !isBerhasil,
      data: parsed,
      ...parsed,
    });
  } catch (error: any) {
    try {
      console.error(`[OCR] tak terduga (server-only): ${String(error?.message || error).slice(0, 400)}`);
    } catch {}
    return res.status(500).json({
      success: false,
      isSystemError: true,
      code: "OCR_SYSTEM_ERROR",
      message: "Terjadi gangguan sistem saat memindai. Coba lagi sesaat atau hubungi petugas untuk verifikasi manual.",
      data: {
        nik: null, nama: null, jenis_dokumen: "LAINNYA", skor_kejelasan: 0,
        status_verifikasi: "TIDAK_VALID", status_kualitas: "TIDAK_LAYAK",
        isSystemError: true,
        catatan: "Terjadi gangguan sistem saat memindai. Coba lagi, atau hubungi petugas untuk verifikasi manual.",
      },
    });
  }
}
