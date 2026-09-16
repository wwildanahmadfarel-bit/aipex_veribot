import json
import re
from google import genai
from google.genai import types

# Teks System Prompt untuk ditaruh di services/gemini_service.py
BUKAN_KTP_MESSAGE = "File bukan Kartu Kependudukan Indonesia. Silakan unggah foto e-KTP asli yang jelas dan tidak terpotong."

SYSTEM_PROMPT_OCR = """Anda adalah sistem AI Vision OCR profesional yang dikhususkan untuk menganalisis dan memverifikasi dokumen kependudukan resmi Indonesia (e-KTP, Kartu Keluarga / KK, dan Akta Kelahiran).

Tugas utama Anda:
1. Identifikasi Jenis Dokumen (wajib tepat):
   - "KTP": e-KTP Republik Indonesia. Ciri wajib: tulisan "NIK" 16 digit, header provinsi/kabupaten, foto wajah. Varian "e-KTP", "KTP-EL" tetap "KTP".
   - "KK": Kartu Keluarga.
   - "AKTA": Akta Kelahiran.
   - "LAINNYA": WAJIB jika gambar BUKAN ketiganya (SIM, paspor, selfie, screenshot, dokumen asing, kertas kosong).

2. Ekstraksi Data Utama:
   - NIK: Cari 16-digit Nomor Induk Kependudukan. Bersihkan dari spasi atau simbol. Jika tidak ditemukan, kabur, atau tidak bernilai 16 digit, set ke null.
   - Nama: Ambil nama lengkap pemilik dokumen sesuai teks resmi. Jika bukan Dukcapil, set ke null.

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
   - "TIDAK_VALID": WAJIB jika jenis LAINNYA (gambar bukan dokumen kependudukan resmi Indonesia).

6. Catatan Perbaikan (Saran Singkat):
   - Jika BURAM: 1 kalimat saran konkret.
   - Jika TIDAK_VALID: WAJIB awali dengan persis "File bukan Kartu Kependudukan Indonesia." lalu saran unggah e-KTP asli.
"""

USER_PROMPT_EXECUTION = "Analisis foto dokumen kependudukan ini. Periksa kejelasan teks, ekstrak NIK 16 digit jika ada, dan tentukan apakah foto layak untuk verifikasi."

async def analyze_document_ocr(file_bytes: bytes, mime_type: str, client: genai.Client) -> dict:
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
                USER_PROMPT_EXECUTION
            ],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT_OCR,
                response_mime_type="application/json",
                temperature=0.0
            )
        )
        
        result = json.loads(response.text)

        # NORMALISASI otoritatif backend
        raw_jenis = str(result.get("jenis_dokumen") or "").upper().strip()
        if "KTP" in raw_jenis or "TANDA PENDUDUK" in raw_jenis:
            result["jenis_dokumen"] = "KTP"
        elif raw_jenis == "KK" or "KARTU KELUARGA" in raw_jenis:
            result["jenis_dokumen"] = "KK"
        elif "AKTA" in raw_jenis or "AKTE" in raw_jenis:
            result["jenis_dokumen"] = "AKTA"
        else:
            result["jenis_dokumen"] = "LAINNYA"

        raw_status = str(result.get("status_verifikasi") or "").upper().strip().replace(" ", "_").replace("-", "_")
        if raw_status in ("BERHASIL", "VALID", "LULUS", "LAYAK", "SUCCESS"):
            result["status_verifikasi"] = "BERHASIL"
        elif raw_status in ("TIDAK_VALID", "TIDAKVALID", "INVALID", "LAINNYA", "REJECTED", "DITOLAK") or "BUKAN" in raw_status:
            result["status_verifikasi"] = "TIDAK_VALID"
        else:
            result["status_verifikasi"] = "BURAM"

        try:
            skor = int(result.get("skor_kejelasan") or 0)
        except Exception:
            skor = 0
        result["skor_kejelasan"] = max(0, min(100, skor))

        # POST-PROCESSING: Validasi Panjang NIK 16 Digit
        if result.get("nik"):
            clean_nik = re.sub(r"\D", "", str(result["nik"]))
            if len(clean_nik) != 16:
                result["nik"] = None
                if result.get("status_verifikasi") == "BERHASIL":
                    result["status_verifikasi"] = "BURAM"
                    result["catatan"] = "NIK terdeteksi namun tidak berjumlah 16 digit. Foto ulang e-KTP dengan fokus tajam."
            else:
                result["nik"] = clean_nik

        if result.get("jenis_dokumen") == "LAINNYA":
            result["status_verifikasi"] = "TIDAK_VALID"
        if result.get("status_verifikasi") == "BERHASIL" and int(result.get("skor_kejelasan") or 0) < 70:
            result["status_verifikasi"] = "BURAM"
        if result.get("status_verifikasi") == "TIDAK_VALID":
            result["jenis_dokumen"] = "LAINNYA"
            result["nik"] = None
            try:
                s = int(result.get("skor_kejelasan") or 0)
            except Exception:
                s = 0
            result["skor_kejelasan"] = min(s, 20) if s else 0
            if not result.get("catatan") or "bukan kartu kependudukan" not in str(result.get("catatan")).lower():
                result["catatan"] = BUKAN_KTP_MESSAGE

        result["status_kualitas"] = "LAYAK" if result.get("status_verifikasi") == "BERHASIL" else "TIDAK_LAYAK"
        return result

    except Exception as e:
        return {
            "status_verifikasi": "TIDAK_VALID",
            "status_kualitas": "TIDAK_LAYAK",
            "skor_kejelasan": 0,
            "jenis_dokumen": "LAINNYA",
            "nik": None,
            "nama": None,
            "catatan": f"Gagal memproses dokumen: {str(e)}"
        }
