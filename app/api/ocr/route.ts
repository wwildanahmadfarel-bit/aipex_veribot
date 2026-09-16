import { NextResponse } from 'next/server';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// Init Supabase (sanitized to remove any trailing /rest/v1 or slashes causing PGRST125)
const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseUrl = rawSupabaseUrl.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Init Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const BUKAN_KTP_MESSAGE =
  "File bukan Kartu Kependudukan Indonesia. Silakan unggah foto e-KTP asli yang jelas dan tidak terpotong.";

function normalizeJenisDokumen(raw: unknown): "KTP" | "KK" | "AKTA" | "LAINNYA" {
  const upper = String(raw ?? "").toUpperCase().trim();
  if (!upper) return "LAINNYA";
  if (upper.includes("KTP") || upper.includes("TANDA PENDUDUK")) return "KTP";
  if (
    upper === "KK" ||
    upper.startsWith("KK ") ||
    upper.startsWith("KK-") ||
    upper.includes("KARTU KELUARGA") ||
    upper.includes("FAMILY CARD")
  )
    return "KK";
  if (upper.includes("AKTA") || upper.includes("AKTE") || upper.includes("KELAHIRAN"))
    return "AKTA";
  return "LAINNYA";
}

function normalizeStatusVerifikasi(raw: unknown): "BERHASIL" | "BURAM" | "TIDAK_VALID" {
  const upper = String(raw ?? "").toUpperCase().trim().replace(/[\s-]+/g, "_");
  if (upper === "BERHASIL" || upper === "VALID" || upper === "LULUS" || upper === "LAYAK" || upper === "SUCCESS")
    return "BERHASIL";
  if (
    upper === "TIDAK_VALID" ||
    upper === "TIDAKVALID" ||
    upper === "INVALID" ||
    upper === "LAINNYA" ||
    upper === "REJECTED" ||
    upper === "DITOLAK" ||
    upper.includes("BUKAN")
  )
    return "TIDAK_VALID";
  return "BURAM";
}

const SYSTEM_INSTRUCTION = `Anda adalah sistem AI Vision OCR profesional yang dikhususkan untuk menganalisis dan memverifikasi dokumen kependudukan resmi Indonesia (e-KTP, Kartu Keluarga / KK, dan Akta Kelahiran).

Tugas utama Anda:
1. Identifikasi Jenis Dokumen (wajib tepat):
   - "KTP": e-KTP Republik Indonesia. Ciri wajib: ada tulisan "NIK" 16 digit, header provinsi/kabupaten, foto wajah, tulisan "KARTU TANDA PENDUDUK" / "e-KTP". Varian "e-KTP", "KTP-EL" semuanya tetap "KTP".
   - "KK": Kartu Keluarga.
   - "AKTA": Akta Kelahiran.
   - "LAINNYA": WAJIB dipakai jika gambar BUKAN salah satu dari ketiga dokumen di atas (misal SIM, paspor, selfie, screenshot, dokumen asing, kertas kosong).

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

5. Penentuan Status Verifikasi (wajib konsisten):
   - "BERHASIL": Dokumen valid (KTP/KK/AKTA) dan skor kejelasan >= 70.
   - "BURAM": Dokumen kependudukan asli, namun skor kejelasan < 70 (memerlukan foto ulang).
   - "TIDAK_VALID": WAJIB jika jenis_dokumen "LAINNYA" (gambar bukan dokumen kependudukan resmi Indonesia).

6. Catatan Perbaikan (Saran Singkat):
   - Jika BURAM: 1 kalimat saran konkret (contoh: "Foto KTP terlalu silau di area NIK, harap matikan lampu flash dan ambil ulang foto di tempat terang").
   - Jika TIDAK_VALID: WAJIB awali dengan persis "File bukan Kartu Kependudukan Indonesia." lalu saran unggah e-KTP asli.`;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 400 });
    }

    // Convert file ke Base64
    const bytes = await file.arrayBuffer();
    const base64Image = Buffer.from(bytes).toString('base64');

    // Schema Output JSON Terstruktur dari Gemini
    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        nik: { type: Type.STRING, description: "16 digit NIK jika terdeteksi, null jika tidak" },
        nama: { type: Type.STRING, description: "Nama lengkap pada dokumen" },
        jenis_dokumen: { type: Type.STRING, description: "KTP, KK, AKTA, atau LAINNYA" },
        skor_kejelasan: { type: Type.INTEGER, description: "Skor kejelasan 0 - 100" },
        status_verifikasi: { type: Type.STRING, description: "BERHASIL, BURAM, atau TIDAK_VALID" },
        catatan: { type: Type.STRING, description: "Alasan jika dokumen kurang tajam atau terpotong" }
      },
      required: ["jenis_dokumen", "skor_kejelasan", "status_verifikasi"]
    };

    // Panggil Gemini Vision Model
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          inlineData: {
            mimeType: file.type || 'image/jpeg',
            data: base64Image
          }
        },
        "Analisis foto dokumen kependudukan ini. Periksa kejelasan teks, ekstrak NIK 16 digit jika ada, dan tentukan apakah foto layak untuk verifikasi."
      ],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    let ocrResult: any;
    try {
      const rawText = String(response.text || "").trim();
      try {
        ocrResult = JSON.parse(rawText);
      } catch {
        const fenced = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
        try {
          ocrResult = JSON.parse(fenced.trim());
        } catch {
          const start = rawText.indexOf("{");
          const end = rawText.lastIndexOf("}");
          ocrResult = JSON.parse(rawText.slice(start, end + 1));
        }
      }
    } catch {
      return NextResponse.json(
        {
          success: false,
          isSystemError: true,
          message: "AI mengembalikan jawaban tak valid. Silakan ulangi pindaian dengan foto lebih jelas.",
          data: {
            nik: null,
            nama: null,
            jenis_dokumen: "LAINNYA",
            skor_kejelasan: 0,
            status_verifikasi: "TIDAK_VALID",
            status_kualitas: "TIDAK_LAYAK",
            isSystemError: true,
            catatan: "AI mengembalikan jawaban tak valid. Silakan ulangi pindaian.",
          },
        },
        { status: 502 }
      );
    }

    // Normalisasi otoritatif + validasi silang
    ocrResult.jenis_dokumen = normalizeJenisDokumen(ocrResult.jenis_dokumen);
    ocrResult.status_verifikasi = normalizeStatusVerifikasi(ocrResult.status_verifikasi);
    if (typeof ocrResult.skor_kejelasan !== "number") {
      const asNum = Number(ocrResult.skor_kejelasan);
      ocrResult.skor_kejelasan = Number.isFinite(asNum) ? Math.round(asNum) : 0;
    }
    ocrResult.skor_kejelasan = Math.max(0, Math.min(100, Math.round(ocrResult.skor_kejelasan)));

    // Validasi NIK 16 digit (parsial disimpan untuk umpan balik)
    if (ocrResult.nik) {
      const cleanNik = String(ocrResult.nik).replace(/\D/g, '');
      if (cleanNik.length !== 16) {
        if (cleanNik.length >= 8) ocrResult.nik_partial = cleanNik;
        ocrResult.nik = null;
        if (ocrResult.status_verifikasi === 'BERHASIL') {
          ocrResult.status_verifikasi = 'BURAM';
          ocrResult.catatan = `NIK terbaca sebagian (${cleanNik.length || 0}/16 digit). Foto ulang e-KTP dengan fokus tajam tanpa silau.`;
        }
      } else {
        ocrResult.nik = cleanNik;
      }
    }
    if (ocrResult.jenis_dokumen === "LAINNYA") {
      ocrResult.status_verifikasi = "TIDAK_VALID";
    }
    if (ocrResult.status_verifikasi === "BERHASIL" && ocrResult.skor_kejelasan < 70) {
      ocrResult.status_verifikasi = "BURAM";
      if (!ocrResult.catatan) {
        ocrResult.catatan = "Dokumen terdeteksi namun skor kejelasan di bawah 70. Foto ulang di tempat terang tanpa flash.";
      }
    }
    if (ocrResult.status_verifikasi === "TIDAK_VALID") {
      ocrResult.jenis_dokumen = "LAINNYA";
      ocrResult.nik = null;
      if (!ocrResult.nama || typeof ocrResult.nama !== "string") ocrResult.nama = null;
      if (typeof ocrResult.skor_kejelasan !== "number" || ocrResult.skor_kejelasan > 25) {
        ocrResult.skor_kejelasan = typeof ocrResult.skor_kejelasan === "number" ? Math.min(ocrResult.skor_kejelasan, 20) : 0;
      }
      if (!ocrResult.catatan || !/bukan kartu kependudukan/i.test(String(ocrResult.catatan))) {
        ocrResult.catatan = BUKAN_KTP_MESSAGE;
      }
    }

    const isTidakValid =
      ocrResult.status_verifikasi === "TIDAK_VALID" || ocrResult.jenis_dokumen === "LAINNYA";
    const isBerhasil = ocrResult.status_verifikasi === "BERHASIL" && !isTidakValid;
    const isBuramValid =
      ocrResult.status_verifikasi === "BURAM" &&
      !isTidakValid &&
      ["KTP", "KK", "AKTA"].includes(ocrResult.jenis_dokumen);
    ocrResult.status_kualitas = isBerhasil ? "LAYAK" : "TIDAK_LAYAK";

    // File BUKAN dokumen kependudukan → JANGAN simpan tiket
    if (isTidakValid) {
      return NextResponse.json({
        success: false,
        message: BUKAN_KTP_MESSAGE,
        data: ocrResult,
        ...ocrResult,
      });
    }

    // Dokumen valid (BERHASIL maupun BURAM) → SELALU buat tiket + QR
    const isValidDoc = isBerhasil || isBuramValid;
    if (!isValidDoc) {
      return NextResponse.json({
        success: false,
        message: ocrResult.catatan || "Dokumen buram, silakan foto ulang.",
        data: ocrResult,
        ...ocrResult,
      });
    }
    const finalStatus = isBerhasil ? "BERHASIL" : "BURAM";
    ocrResult.status_verifikasi = finalStatus;
    ocrResult.catatan =
      ocrResult.catatan ||
      (isBerhasil
        ? "Dokumen kependudukan valid dan terbaca jelas. QR Fast-Track terbit."
        : "Dokumen kependudukan asli terdeteksi namun buram. QR tetap terbit — bawa fisik dokumen asli untuk verifikasi ulang di loket.");

    // Simpan Otomatis ke Tabel Supabase 'tickets' (BERHASIL + BURAM valid)
    const kodeTiket = `TKT-${Date.now().toString().slice(-6)}`;
    let ticket: any = {
      kode_tiket: kodeTiket,
      nik: ocrResult.nik || '0000000000000000',
      nama: ocrResult.nama || 'Tidak Terdeteksi',
      jenis_dokumen: ocrResult.jenis_dokumen,
      skor_kejelasan: ocrResult.skor_kejelasan,
      status_verifikasi: ocrResult.status_verifikasi,
      catatan: ocrResult.catatan,
      created_at: new Date().toISOString()
    };

    if (supabase) {
      try {
        const { data: dbTicket, error: dbError } = await supabase
          .from('tickets')
          .insert([
            {
              kode_tiket: kodeTiket,
              nik: ocrResult.nik || '0000000000000000',
              nama: ocrResult.nama || 'Tidak Terdeteksi',
              jenis_dokumen: ocrResult.jenis_dokumen,
              skor_kejelasan: ocrResult.skor_kejelasan,
              status_verifikasi: ocrResult.status_verifikasi,
              catatan: ocrResult.catatan
            }
          ])
          .select()
          .single();

        if (dbError) {
          console.error("Supabase insert error in route.ts:", dbError);
        } else if (dbTicket) {
          ticket = dbTicket;
        }
      } catch (insertErr) {
        console.error("Supabase insert exception in route.ts:", insertErr);
      }
    }

    // Kembalikan Hasil ke Frontend (BERHASIL + BURAM valid + tiket QR)
    return NextResponse.json({
      success: true,
      message: ocrResult.catatan,
      needsRephoto: !isBerhasil,
      data: {
        ...ocrResult,
        ticket,
      },
      ticket,
      ...ocrResult,
    });

  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        message: err.message,
        data: {
          nik: null,
          nama: null,
          jenis_dokumen: "LAINNYA",
          skor_kejelasan: 0,
          status_verifikasi: "TIDAK_VALID",
          status_kualitas: "TIDAK_LAYAK",
          catatan: BUKAN_KTP_MESSAGE,
        },
      },
      { status: 500 }
    );
  }
}
