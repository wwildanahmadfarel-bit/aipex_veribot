// Handler OCR bersama untuk /api/ocr dan /api/scan-document (Vercel Serverless).
// Logic dipindah 1:1 dari server.ts agar perilaku identik.

import { GoogleGenAI } from "@google/genai";
import { visionViaNaraRoute } from "../../services/ai_providers";
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
} from "./store";
import { parseMultipartBuffer, readJsonBody, readRawBody } from "./http";

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

    // Batasi ukuran untuk limit Serverless Vercel (~4.5MB payload)
    if (fileBytes && fileBytes.length > 4_200_000) {
      return res.status(413).json({
        success: false,
        message: "Ukuran file melebihi 4MB (batas Vercel). Kompres/ambil ulang foto di bawah 4MB lalu coba lagi.",
        data: {
          nik: null,
          nama: null,
          jenis_dokumen: "LAINNYA",
          skor_kejelasan: 0,
          status_verifikasi: "TIDAK_VALID",
          status_kualitas: "TIDAK_LAYAK",
          catatan: "Ukuran file melebihi 4MB. Kompres foto lalu unggah ulang.",
        },
      });
    }

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

    const naraApiKey = extractNaraApiKey({ ...req, body: bodyFields });
    const naraConfigured = isNaraConfigured(naraApiKey);
    const client: GoogleGenAI | null = getGeminiClient();

    const ocrModels = ["gemini-2.5-flash", "gemini-3.6-flash"];
    let responseText = "";
    let lastAiError = "";
    const isPdf = /pdf/i.test(mimeType || "");

    if (naraConfigured && !responseText && !isPdf) {
      try {
        responseText = await visionViaNaraRoute({
          apiKey: naraApiKey,
          model: (bodyFields?.naraModel as string) || process.env.NARA_ROUTE_MODEL || undefined,
          systemPrompt: OCR_SYSTEM,
          userPrompt: OCR_USER_PROMPT,
          imageBase64: fileBytes.toString("base64"),
          mimeType,
        });
      } catch (naraErr: any) {
        lastAiError = `nara-route: ${naraErr?.message || naraErr}`;
      }
    }

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
            break;
          }
        } catch (modelErr: any) {
          lastAiError = `Gemini ${modelName}: ${modelErr?.message || modelErr}`;
        }
      }
    }

    if (!responseText && !client && !naraConfigured) {
      return res.status(503).json({
        success: false,
        isSystemError: true,
        message: "Layanan AI OCR belum dikonfigurasi (GEMINI_API_KEY / NARA_ROUTE_API_KEY kosong). Tidak dapat memverifikasi dokumen.",
        data: {
          nik: null, nama: null, jenis_dokumen: "LAINNYA", skor_kejelasan: 0,
          status_verifikasi: "TIDAK_VALID", status_kualitas: "TIDAK_LAYAK",
          isSystemError: true,
          catatan: "Layanan AI belum dikonfigurasi. Hubungi petugas untuk verifikasi manual.",
        },
      });
    }

    if (!responseText) {
      const detail = lastAiError ? ` Detail: ${lastAiError}`.slice(0, 500) : "";
      return res.status(502).json({
        success: false,
        isSystemError: true,
        message: `Layanan AI gagal memproses foto.${detail} Silakan foto ulang lebih jelas atau coba lagi sesaat.`,
        data: {
          nik: null, nama: null, jenis_dokumen: "LAINNYA", skor_kejelasan: 0,
          status_verifikasi: "TIDAK_VALID", status_kualitas: "TIDAK_LAYAK",
          isSystemError: true,
          catatan: "Layanan AI gagal memproses foto. Coba lagi dengan foto lebih jelas.",
        },
      });
    }

    let parsed: any;
    try {
      parsed = parseAiJsonResponse(responseText);
    } catch {
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

    if (isTidakValid) {
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

    const dbPayload = {
      kode_tiket: kodeTiket,
      nik: parsed.nik || "0000000000000000",
      nama: parsed.nama || "Tidak Terdeteksi",
      jenis_dokumen: parsed.jenis_dokumen || "LAINNYA",
      skor_kejelasan: typeof parsed.skor_kejelasan === "number" ? parsed.skor_kejelasan : 0,
      status_verifikasi: finalStatus,
      catatan: finalCatatan,
    };

    let ticketData: any = dbPayload;
    const supabase = getSupabase();
    if (supabase) {
      try {
        const { data, error } = await supabase.from("tickets").insert([dbPayload]).select();
        if (!error && data && data.length > 0) ticketData = data[0];
      } catch {}
    }

    const maskedNik = maskNik(parsed.nik || "");
    const inMemTicket: TicketRow = {
      id: String((ticketData as any).id || Date.now()),
      ticket_code: kodeTiket,
      nik_encrypted: maskedNik === "320101******0000" && parsed.nik ? `${parsed.nik.slice(0, 6)}******${parsed.nik.slice(-4)}` : maskedNik,
      nik_raw: parsed.nik || undefined,
      nama_warga: parsed.nama || "Warga",
      jenis_dokumen: parsed.jenis_dokumen || "LAINNYA",
      status_verifikasi: isBerhasil ? "APPROVED" : "REVISI",
      skor_ai: typeof parsed.skor_kejelasan === "number" ? parsed.skor_kejelasan : 90,
      status_ai: isBerhasil ? "LULUS" : "GAGAL",
      catatan_ai: finalCatatan,
      created_at: new Date().toISOString().replace("T", " ").slice(0, 16),
      updated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
    };
    memTickets.unshift(inMemTicket);

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

    return res.json({
      success: true,
      message: finalCatatan,
      needsRephoto: !isBerhasil,
      data: { ...parsed, ticket: completeTicketResponse },
      ticket: completeTicketResponse,
      ...parsed,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      isSystemError: true,
      message: error?.message || "Gagal memindai dokumen.",
      data: {
        nik: null, nama: null, jenis_dokumen: "LAINNYA", skor_kejelasan: 0,
        status_verifikasi: "TIDAK_VALID", status_kualitas: "TIDAK_LAYAK",
        isSystemError: true,
        catatan: "Terjadi gangguan sistem saat memindai. Coba lagi, atau hubungi petugas untuk verifikasi manual.",
      },
    });
  }
}
