// Handler OCR bersama untuk /api/ocr dan /api/scan-document (Vercel Serverless).
// Logic dipindah 1:1 dari server.ts agar perilaku identik.

import { GoogleGenAI } from "@google/genai";
import { visionViaNaraRoute } from "../../services/ai_providers.js";
import {
  BUKAN_KTP_MESSAGE,
  extractNaraApiKey,
  getGeminiClient,
  getSupabase,
  isNaraConfigured,
  maskNik,
  memTickets,
  normalizeJenisDokumen,
  normalizeStatusVerifikasi,
  parseAiJsonResponse,
  type TicketRow,
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
import { logOcrAttempt } from "./abuse-log.js";

const OCR_SYSTEM = `Anda adalah sistem AI Vision OCR profesional yang dikhususkan untuk menganalisis dan memverifikasi dokumen kependudukan resmi Indonesia (e-KTP, Kartu Keluarga / KK, dan Akta Kelahiran).

Tugas utama Anda:
1. Identifikasi Jenis Dokumen (wajib tepat):
   - "KTP": e-KTP Republik Indonesia. Ciri wajib: ada tulisan "NIK" 16 digit, header provinsi/kabupaten, foto wajah, tulisan "KARTU TANDA PENDUDUK" / "e-KTP". Varian tulisan "e-KTP", "KTP-EL", "KTP EL" semuanya tetap "KTP".
   - "KK": Kartu Keluarga.
   - "AKTA": Akta Kelahiran.
   - "LAINNYA": WAJIB dipakai jika gambar BUKAN salah satu dari ketiga dokumen di atas (misal: SIM, paspor, foto selfie, screenshot HP, dokumen asing, kertas kosong, foto blur total tanpa ciri Dukcapil).

2. Ekstraksi Data Utama:
   - NIK: Cari 16-digit Nomor Induk Kependudukan. Bersihkan dari spasi atau simbol. Jika tidak ditemukan, kabur, atau tidak bernilai 16 digit, set ke null.
   - Nama: Ambil nama lengkap pemilik dokumen sesuai teks resmi. Jika bukan dokumen Dukcapil, set ke null.

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
   - "BERHASIL": Dokumen valid (KTP/KK/AKTA) dan skor kejelasan >= 70.
   - "BURAM": Dokumen kependudukan asli (KTP/KK/AKTA), namun skor kejelasan < 70 (memerlukan foto ulang).
   - "TIDAK_VALID": WAJIB dipakai jika jenis_dokumen "LAINNYA" (gambar bukan dokumen kependudukan resmi Indonesia).

6. Catatan Perbaikan (Saran Singkat):
   - Jika status BURAM, berikan 1 kalimat saran konkret (contoh: "Foto KTP terlalu silau di area NIK, harap matikan lampu flash dan ambil ulang foto di tempat terang").
   - Jika status TIDAK_VALID, WAJIB awali catatan dengan kalimat persis: "File bukan Kartu Kependudukan Indonesia." lalu lanjutkan saran unggah e-KTP asli.

PENTING: Jawab HANYA dengan JSON valid memakai key: nik, nama, jenis_dokumen, skor_kejelasan, status_verifikasi, catatan.`;

const OCR_USER_PROMPT =
  "Analisis foto dokumen kependudukan ini. Periksa kejelasan teks, ekstrak NIK 16 digit jika ada, dan tentukan apakah foto layak untuk verifikasi.";

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
    // Salinan foto untuk arsip sementara terenkripsi (diisi setelah AI selesai).
    let fotoCopy: Buffer | null = null;
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

    const ocrModels = ["gemini-2.5-flash", "gemini-3.6-flash"];
    let responseText = "";
    let lastAiError = "";
    const isPdf = /pdf/i.test(mimeType || "");

    if (!skipAi) {
    // Prioritas 1: Gemini (utama — mendukung gambar + PDF).
    if (!responseText && client) {
      for (const modelName of ocrModels) {
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
              responseSchema: {
                type: "OBJECT",
                properties: {
                  nik: { type: "STRING", nullable: true },
                  nama: { type: "STRING", nullable: true },
                  jenis_dokumen: { type: "STRING" },
                  skor_kejelasan: { type: "INTEGER" },
                  status_verifikasi: { type: "STRING" },
                  catatan: { type: "STRING" },
                },
                required: ["jenis_dokumen", "skor_kejelasan", "status_verifikasi"],
              },
            },
          });
          if (response && (response as any).text) {
            responseText = (response as any).text;
            aiSource = "gemini";
            break;
          }
        } catch (modelErr: any) {
          lastAiError = `Gemini ${modelName}: ${modelErr?.message || modelErr}`;
        }
      }
    }

    // Prioritas 2 (cadangan): nara-route — hanya image (PDF dilewati).
    if (!responseText && naraConfigured && !isPdf) {
      try {
        responseText = await visionViaNaraRoute({
          apiKey: naraApiKey,
          model: (bodyFields?.naraModel as string) || process.env.NARA_ROUTE_MODEL || undefined,
          systemPrompt: OCR_SYSTEM,
          userPrompt: OCR_USER_PROMPT,
          imageBase64: fileBytes.toString("base64"),
          mimeType,
        });
        if (responseText) aiSource = "nara-route";
      } catch (naraErr: any) {
        lastAiError = `nara-route: ${naraErr?.message || naraErr}`;
      }
    }
    } // end if (!skipAi)

    if (!skipAi && !responseText && !client && !naraConfigured) {
      return res.status(503).json({
        success: false,
        isSystemError: true,
        message: "Layanan AI OCR belum dikonfigurasi (GEMINI_API_KEY / NARA_ROUTE_API_KEY kosong). Bukan salah foto Anda — lanjut isi formulir manual atau hubungi petugas untuk verifikasi manual.",
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
    // Foto sudah selesai dipakai AI: salin untuk arsip sementara terenkripsi,
    // lalu nol-kan buffer asli (panjang tak berubah, aman untuk log size).
    fotoCopy = null;
    try {
      if (fileBytes) fotoCopy = Buffer.from(fileBytes);
    } catch {}
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

    if (parsed.nik) {
      const nikClean = String(parsed.nik).replace(/\D/g, "");
      if (nikClean.length !== 16) {
        if (nikClean.length >= 8) parsed.nik_partial = nikClean;
        parsed.nik = null;
        if (parsed.status_verifikasi === "BERHASIL") {
          parsed.status_verifikasi = "BURAM";
          parsed.catatan = `NIK terbaca sebagian (${nikClean.length || 0}/16 digit). Foto ulang e-KTP dengan fokus tajam tanpa silau.`;
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
      ["KTP", "KK", "AKTA"].includes(parsed.jenis_dokumen);
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

    const kodeTiket = `TKT-${Date.now().toString().slice(-6)}`;
    const finalStatus = isBerhasil ? "BERHASIL" : "BURAM";
    const finalCatatan =
      parsed.catatan ||
      (isBerhasil
        ? "Dokumen kependudukan valid dan terbaca jelas. QR Fast-Track terbit."
        : "Dokumen kependudukan asli terdeteksi namun buram. QR tetap terbit — bawa fisik dokumen asli untuk verifikasi ulang di loket.");
    parsed.catatan = finalCatatan;

    // Nomor WA dikirim wizard sejak langkah 1 (opsional; alur tanpa formulir tak punya).
    const scanPhone =
      typeof bodyFields?.phone === "string" && bodyFields.phone.trim()
        ? bodyFields.phone.trim()
        : typeof bodyFields?.no_hp === "string" && bodyFields.no_hp.trim()
          ? bodyFields.no_hp.trim()
          : "";

    const dbPayload: any = {
      kode_tiket: kodeTiket,
      nik: parsed.nik || "0000000000000000",
      nama: parsed.nama || "Tidak Terdeteksi",
      jenis_dokumen: parsed.jenis_dokumen || "LAINNYA",
      skor_kejelasan: typeof parsed.skor_kejelasan === "number" ? parsed.skor_kejelasan : 0,
      status_verifikasi: finalStatus,
      catatan: finalCatatan,
    };
    if (scanPhone) dbPayload.phone = scanPhone;

    let ticketData: any = dbPayload;
    let phoneSaved = false;
    const supabase = getSupabase();
    if (supabase) {
      try {
        let ins = await supabase.from("tickets").insert([dbPayload]).select();
        // Fallback bila kolom phone belum dimigrasi di database.
        if (ins.error && scanPhone && /phone/i.test(String(ins.error.message || ""))) {
          try {
            console.warn(`[ocr] kolom phone belum ada, nomor ${kodeTiket} tidak persist. Jalankan migrasi 20260928_tiket_phone.sql.`);
          } catch {}
          delete dbPayload.phone;
          ins = await supabase.from("tickets").insert([dbPayload]).select();
        }
        if (!ins.error && ins.data && ins.data.length > 0) {
          ticketData = ins.data[0];
          if (scanPhone && (ticketData as any).phone) phoneSaved = true;
        }
        // Sembuhkan baris lama NIK sama yang belum punya nomor — best-effort.
        if (scanPhone && parsed.nik) {
          try {
            await supabase
              .from("tickets")
              .update({ phone: scanPhone })
              .eq("nik", String(parsed.nik).replace(/\D/g, ""))
              .is("phone", null)
              .neq("kode_tiket", kodeTiket);
          } catch {}
          try {
            for (const t of memTickets) {
              if ((t as any).nik_raw === parsed.nik && !(t as any).phone) (t as any).phone = scanPhone;
            }
          } catch {}
        }
      } catch {}
    }

    const maskedNik = maskNik(parsed.nik || "");
    const inMemTicket: TicketRow = {
      id: String((ticketData as any).id || Date.now()),
      ticket_code: kodeTiket,
      nik_encrypted: maskedNik === "320101******0000" && parsed.nik ? `${parsed.nik.slice(0, 6)}******${parsed.nik.slice(-4)}` : maskedNik,
      nik_raw: parsed.nik || undefined,
      nama_warga: parsed.nama || "Warga",
      phone: scanPhone || "",
      jenis_dokumen: parsed.jenis_dokumen || "LAINNYA",
      status_verifikasi: isBerhasil ? "APPROVED" : "REVISI",
      skor_ai: typeof parsed.skor_kejelasan === "number" ? parsed.skor_kejelasan : 90,
      status_ai: isBerhasil ? "LULUS" : "GAGAL",
      catatan_ai: finalCatatan,
      created_at: new Date().toISOString().replace("T", " ").slice(0, 16),
      updated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
    };
    memTickets.unshift(inMemTicket);
    // Sembuhkan memori: baris NIK sama yang belum punya nomor ikut terisi.
    if (scanPhone && parsed.nik) {
      try {
        for (const t of memTickets) {
          if ((t as any).nik_raw === parsed.nik && !(t as any).phone) (t as any).phone = scanPhone;
        }
      } catch {}
    }

    // Arsip sementara foto terenkripsi (best-effort): petugas + warga pemilik
    // bisa lihat sampai tiket diputus; tiket tetap valid bila arsip gagal.
    if (fotoCopy && supabase) {
      try {
        const { simpanFotoTiket } = await import("./tiket-foto.js");
        const saved = await simpanFotoTiket(kodeTiket, fotoCopy, mimeType);
        if (saved.ok && saved.path) {
          inMemTicket.foto_path = saved.path;
          try {
            await supabase
              .from("tickets")
              .update({ foto_path: saved.path, foto_iv: saved.ivHex })
              .or(`kode_tiket.eq.${kodeTiket},id.eq.${(ticketData as any).id || ""}`);
          } catch {}
        }
      } catch {}
      try {
        fotoCopy.fill(0);
      } catch {}
      fotoCopy = null;
    }

    const completeTicketResponse = {
      ...ticketData,
      ...inMemTicket,
      kode_tiket: kodeTiket,
      ticket_code: kodeTiket,
      nama: parsed.nama || "Warga",
      nama_warga: parsed.nama || "Warga",
      skor_kejelasan: typeof parsed.skor_kejelasan === "number" ? parsed.skor_kejelasan : 90,
      catatan: finalCatatan,
    };

    await logOcrAttempt({ ipHash, fileHash, mime: mimeType, sizeBytes: fileBytes.length, skor: parsed.skor_kejelasan ?? null, status: finalStatus, source: aiSource || "ai", latencyMs: Date.now() - ocrStart });
    try {
      res.setHeader("X-Ocr-Source", aiSource || "ai");
      res.setHeader("X-RateLimit-Remaining", String(rl.remaining10));
    } catch {}
    return res.json({
      success: true,
      message: finalCatatan,
      needsRephoto: !isBerhasil,
      source: aiSource || "ai",
      phoneSaved,
      data: { ...parsed, ticket: completeTicketResponse },
      ticket: completeTicketResponse,
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
