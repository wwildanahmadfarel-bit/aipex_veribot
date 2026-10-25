// Pembacaan hasil pra-pemeriksaan via Web Speech API — nol dependensi/biaya.
// Kebijakan autoplay browser: auto-baca hanya dipicu setelah interaksi user
// (alur pindai selalu diawali klik unggah), dengan fallback tombol manual.
// Suara id-ID diprioritaskan (preferensi perempuan: Gadis/Damayanti/Google
// id-ID); angka ditulis sebagai kata dan "AI" dieja "a i" agar artikulasi
// jelas walau perangkat hanya punya suara bawaan (English).

export function isSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

function voiceScore(v: SpeechSynthesisVoice): number {
  const lang = String(v.lang || "").replace("_", "-").toLowerCase();
  const name = String(v.name || "");
  let score = 0;
  if (lang.startsWith("id")) score += 10;
  else if (lang.startsWith("ms")) score += 2; // Melayu: paling dekat fonetisnya
  if (/indonesia/i.test(name)) score += 3;
  if (/natural|online|neural/i.test(name)) score += 2; // Edge natural: jauh lebih manusiawi
  if (v.localService) score += 1;
  // Suara PEREMPUAN diprioritaskan: Gadis (Microsoft id-ID) & Damayanti (Apple
  // id-ID) perempuan; suara Google id-ID ("Google Bahasa Indonesia") juga
  // perempuan. Ardi (Microsoft id-ID) laki-laki → diturunkan.
  if (/gadis|damayanti|female|wanita|perempuan/i.test(name)) score += 6;
  else if (/google/i.test(name) && lang.startsWith("id")) score += 5;
  if (/ardi|pria|\bmale\b/i.test(name)) score -= 8;
  return score;
}

/** Pilih suara terbaik: prioritas id-ID > id-* > Melayu; null bila tak ada. */
export function pickIndonesianVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = 0;
  for (const v of voices) {
    const s = voiceScore(v);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return bestScore >= 10 ? best : null;
}

/**
 * Beberapa browser baru mengisi daftar suara setelah event `voiceschanged`.
 * Panggil saat komponen mount (bukan tepat sebelum bicara) agar speak() siap.
 * Mengembalikan fungsi pembersih listener.
 */
export function prepareVoices(onReady?: () => void): () => void {
  if (!isSpeechSupported()) return () => {};
  const synth = window.speechSynthesis;
  try {
    if (typeof synth.getVoices === "function" && synth.getVoices().length > 0) {
      onReady?.();
      return () => {};
    }
    const handler = () => onReady?.();
    synth.addEventListener("voiceschanged", handler);
    return () => {
      try {
        synth.removeEventListener("voiceschanged", handler);
      } catch {}
    };
  } catch {
    return () => {};
  }
}

// Token generasi: dinaikkan saat bacaan baru dimulai / dihentikan, sehingga
// bacaan yang masih menunggu daftar suara ikut batal (tidak dobel bersuara).
let speakGeneration = 0;

/** Bicara dengan suara terpilih — syaratnya daftar suara browser sudah siap. */
function speakWithVoices(clean: string, onDone?: () => void): void {
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = "id-ID";
    utterance.rate = 0.92;
    utterance.pitch = 1;
    const voice = pickIndonesianVoice(synth.getVoices());
    if (voice) utterance.voice = voice;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      onDone?.();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    synth.speak(utterance);
  } catch {
    // Jangan biarkan tombol nyangkut di status "Hentikan" bila gagal total.
    try {
      window.setTimeout(() => onDone?.(), 0);
    } catch {}
  }
}

/**
 * Bacakan teks. Selalu cancel dulu agar tidak tumpang tindih.
 * Bila daftar suara browser belum termuat (Chrome mengisinya async), tunggu
 * `voiceschanged` maks ±0,8 dtk agar bacaan PERTAMA sudah memakai suara
 * Indonesia perempuan pilihan — bukan suara default sistem (bisa laki-laki).
 * onDone dipanggil sekali saat selesai/gagal (termasuk saat diblokir autoplay).
 * Return false bila tak didukung/kosong.
 */
export function speak(text: string, onDone?: () => void): boolean {
  if (!isSpeechSupported()) return false;
  const clean = String(text || "")
    .replace(/[*_`#>]+/g, " ") // buang markdown agar tidak dibaca sebagai simbol
    .replace(/\bAI\b/g, "A I") // dibaca per huruf: "a i", bukan "ai"
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return false;

  const myGen = ++speakGeneration;
  const synth = window.speechSynthesis;
  const start = () => {
    // Sudah dihentikan / diganti bacaan lain → jangan bersuara.
    if (myGen !== speakGeneration) return;
    speakWithVoices(clean, onDone);
  };

  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = synth.getVoices();
  } catch {
    voices = [];
  }
  if (voices.length > 0) {
    start();
    return true;
  }

  // Daftar suara belum siap → tunggu sebentar sebelum bicara.
  let settled = false;
  const cleanup = () => {
    try {
      synth.removeEventListener("voiceschanged", onVoices);
    } catch {}
    try {
      window.clearTimeout(timer);
    } catch {}
  };
  const onVoices = () => {
    if (settled) return;
    settled = true;
    cleanup();
    start();
  };
  const timer = window.setTimeout(onVoices, 800);
  try {
    synth.addEventListener("voiceschanged", onVoices);
  } catch {}
  return true;
}

export function stopSpeaking(): void {
  if (!isSpeechSupported()) return;
  speakGeneration++; // batalkan juga bacaan yang masih menunggu daftar suara
  try {
    window.speechSynthesis.cancel();
  } catch {}
}

// --- Angka → kata (Bahasa Indonesia) ----------------------------------------
// Digit mentah sering dibaca gaya Inggris ("seventy-five") oleh suara default,
// sehingga kalimat terdengar kaku. Kata penuh terbaca jelas di hampir semua suara.

const SATUAN_ID = [
  "nol",
  "satu",
  "dua",
  "tiga",
  "empat",
  "lima",
  "enam",
  "tujuh",
  "delapan",
  "sembilan",
  "sepuluh",
  "sebelas",
];

/** 0–100 dibaca kata: 75 → "tujuh puluh lima", 100 → "seratus". */
export function angkaKeKataId(n: number): string {
  const num = Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  if (num < 12) return SATUAN_ID[num];
  if (num < 20) return `${SATUAN_ID[num - 10]} belas`;
  if (num === 100) return "seratus";
  const puluh = Math.floor(num / 10);
  const sisa = num % 10;
  return sisa === 0 ? `${SATUAN_ID[puluh]} puluh` : `${SATUAN_ID[puluh]} puluh ${SATUAN_ID[sisa]}`;
}

/** "e-KTP Indonesia" → "KTP elektronik Indonesia" agar ejaan TTS natural. */
function jenisSpoken(jenis?: string): string {
  return String(jenis || "")
    .replace(/e-?KTP/gi, "KTP elektronik")
    .replace(/\s*\(SKPWNI\)/gi, "")
    .replace(/\s*\(KIA\)/gi, "");
}

export interface PreScreenSpeechInput {
  isSystemError?: boolean;
  isQuotaBlocked?: boolean;
  isTidakValid?: boolean;
  isLayak?: boolean;
  skor?: number;
  jenis?: string;
  catatan?: string;
}

/** Rakit kalimat bacaan dari status banner hasil (layak/buram/error/kuota habis). */
export function buildPreScreenSpeech(input: PreScreenSpeechInput): string {
  const skor = angkaKeKataId(Number(input.skor));
  if (input.isQuotaBlocked) {
    return "Kuota pindaian habis, jadi AI belum memeriksa berkas. Anda tetap bisa melanjutkan dengan mengetik NIK dan nama dari dokumen asli, lalu tunjukkan dokumennya di loket.";
  }
  if (input.isSystemError) {
    return "Terjadi gangguan sistem saat memindai, ini bukan kesalahan foto Anda. Anda tetap bisa melanjutkan dengan mengisi NIK dan nama secara manual dari dokumen fisik.";
  }
  if (input.isTidakValid) {
    return "File yang diunggah bukan dokumen kependudukan Indonesia. Silakan unggah foto e-KTP, Kartu Keluarga, Kartu Identitas Anak, akta kelahiran, akta kematian, akta perkawinan, atau surat pindah asli.";
  }
  const jenis = input.jenis ? ` Jenis dokumen: ${jenisSpoken(input.jenis)}.` : "";
  if (input.isLayak) {
    return `Dokumen layak dan terbaca jelas. Skor AI: ${skor} dari seratus.${jenis} Silakan lanjutkan ke formulir untuk menerbitkan tiket antrean cepat.`;
  }
  const catatan = input.catatan ? ` Catatan AI: ${input.catatan}` : "";
  return `Dokumen terbaca, tetapi masih perlu perbaikan. Skor AI: ${skor} dari seratus.${jenis}${catatan} Anda tetap bisa melanjutkan; tiket terbit dengan catatan revisi. Bawa dokumen asli ke loket.`;
}
