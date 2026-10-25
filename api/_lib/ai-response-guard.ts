// Guard respons AI OCR — AIPEX VeriBot.
// Tujuan: jangan pernah menerima/cache JSON "setengah jadi" atau halusinasi
// (mis. NIK berisi "Drafting note") sebagai hasil valid.

const DEGENERATE_MARKERS =
  /drafting note|strictly only|only respond with|json strictly|as an ai (language )?model|jawaban hanya json/i;

const VALID_STATUS = new Set([
  "BERHASIL",
  "BURAM",
  "TIDAK_VALID",
  "VALID",
  "LULUS",
  "LAYAK",
  "SUCCESS",
  "INVALID",
  "REJECTED",
  "DITOLAK",
]);

/**
 * Validasi bentuk & kewajaran parsed OCR sebelum dipakai/di-cache.
 * - Field wajib ada dan bertipe benar.
 * - Status dikenal.
 * - NIK tidak mengandung kata alfabet (indikasi model menulis catatan di field NIK).
 * - Status BERHASIL wajib punya NIK 16 digit + nama.
 */
export function isUsableAiParsed(parsed: any): boolean {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;

  const jenis = String(parsed.jenis_dokumen ?? "").trim();
  const status = String(parsed.status_verifikasi ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (!jenis || !status) return false;
  if (!VALID_STATUS.has(status)) return false;

  const skor = Number(parsed.skor_kejelasan);
  if (!Number.isFinite(skor)) return false;

  const raw = JSON.stringify(parsed);
  if (DEGENERATE_MARKERS.test(raw)) return false;

  if (parsed.nik != null && String(parsed.nik).trim() !== "") {
    const nikRaw = String(parsed.nik)
      .trim()
      .replace(/^NIK\b[:\s]*/i, "")
      .replace(/[\s.\-:/]/g, "");
    // NIK hanya boleh digit / masker. Kata alfabet 3+ huruf = halusinasi.
    // Untuk status BURAM, teks seperti "Tidak Terdeteksi" wajar → biarkan
    // handler yang mengosongkan NIK (agar tidak memicu 502 keempat model).
    // Idem untuk dokumen non-kartu (akta kematian/perkawinan & surat pindah)
    // yang memang boleh tanpa NIK → handler yang membersihkan.
    const nikOptionalJenis = /KEMATIAN|PERKAWINAN|KAWIN|NIKAH|PINDAH|SKPWNI|DEATH|MARRIAGE/i.test(
      String(parsed.jenis_dokumen ?? "")
    );
    if (status !== "BURAM" && !nikOptionalJenis && /[A-Za-z]{3,}/.test(nikRaw)) return false;
  }

  if (status === "BERHASIL") {
    if (!parsed.nama || String(parsed.nama).trim().length < 3) return false;
    const nik = String(parsed.nik ?? "")
      .trim()
      .replace(/^NIK\b[:\s]*/i, "")
      .replace(/[\s.\-:/]/g, "");
    // Dokumen non-kartu (akta kematian/perkawinan lama, surat pindah) boleh
    // tidak mencantumkan NIK 16 digit. Teks di field NIK (mis. "Tidak
    // Terdeteksi") cukup dibersihkan handler tanpa menurunkan vonis; dokumen
    // berkartu tetap wajib NIK 16 digit.
    const nikOptional = /KEMATIAN|PERKAWINAN|KAWIN|NIKAH|PINDAH|SKPWNI|DEATH|MARRIAGE/i.test(
      String(parsed.jenis_dokumen ?? "")
    );
    if (!nikOptional && !/^\d{16}$/.test(nik)) return false;
  }

  return true;
}
