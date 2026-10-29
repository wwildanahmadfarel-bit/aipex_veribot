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

// Cache daftar suara. Chrome mengisi getVoices() secara async; tanpa cache,
// speak() bisa menunggu 800 ms pada bacaan pertama. Cache juga menghindari
// pemanggilan getVoices() berulang di setiap utterance.
let cachedVoices: SpeechSynthesisVoice[] = [];
let cachedVoice: SpeechSynthesisVoice | null = null;

function refreshVoiceCache(): SpeechSynthesisVoice[] {
  if (!isSpeechSupported()) return cachedVoices;
  try {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      cachedVoices = voices;
      cachedVoice = pickIndonesianVoice(voices);
    }
  } catch {
    // Pertahankan cache lama bila browser melempar error.
  }
  return cachedVoices;
}

/**
 * Beberapa browser baru mengisi daftar suara setelah event `voiceschanged`.
 * Panggil saat komponen mount (bukan tepat sebelum bicara) agar speak() siap.
 * Mengembalikan fungsi pembersih listener.
 */
export function prepareVoices(onReady?: () => void): () => void {
  if (!isSpeechSupported()) return () => {};
  const synth = window.speechSynthesis;
  let notified = false;
  const notify = () => {
    if (notified) return;
    if (refreshVoiceCache().length === 0) return;
    notified = true;
    onReady?.();
  };

  if (refreshVoiceCache().length > 0) {
    notified = true;
    onReady?.();
    return () => {};
  }

  const handler = () => notify();
  let timer: number | undefined;
  try {
    synth.addEventListener("voiceschanged", handler);
    // Sebagian browser mengisi daftar setelah tick tanpa memicu event.
    timer = window.setTimeout(notify, 0);
    return () => {
      try {
        synth.removeEventListener("voiceschanged", handler);
      } catch {}
      if (timer !== undefined) {
        try {
          window.clearTimeout(timer);
        } catch {}
      }
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
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = "id-ID";
    utterance.rate = 0.92;
    utterance.pitch = 1;
    const voice = cachedVoice || pickIndonesianVoice(refreshVoiceCache());
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
 * Bacakan teks. Hanya cancel bila ada bacaan lama yang benar-benar aktif;
 * cancel() saat idle membuat Chrome/Edge menunda utterance berikutnya.
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

  // Jangan panggil cancel() saat tidak ada suara aktif. Pada Chrome/Edge,
  // cancel() yang langsung diikuti speak() dapat menunda suara 0,2–1 detik.
  const hadActiveSpeech = Boolean(synth.speaking || synth.pending || synth.paused);
  if (hadActiveSpeech) {
    try {
      synth.cancel();
    } catch {}
  }

  // onDone hanya boleh mengubah status tombol milik bacaan ini. Saat bacaan
  // baru dimulai, generation berubah dan callback bacaan lama diabaikan.
  const done = () => {
    if (myGen === speakGeneration) onDone?.();
  };
  const start = () => {
    // Sudah dihentikan / diganti bacaan lain → jangan bersuara.
    if (myGen !== speakGeneration) return;
    speakWithVoices(clean, done);
  };

  const voices = refreshVoiceCache();
  if (voices.length > 0) {
    // Beri engine waktu membersihkan antrean lama; bacaan pertama langsung.
    if (hadActiveSpeech) window.setTimeout(start, 100);
    else start();
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
  const finishWaiting = () => {
    if (settled) return;
    settled = true;
    cleanup();
    refreshVoiceCache();
    start();
  };
  const onVoices = () => {
    if (settled) return;
    // Event bisa terpicu sebelum daftar benar-benar terisi; tunggu event/timer
    // berikutnya agar bacaan pertama tetap memakai suara Indonesia.
    if (refreshVoiceCache().length === 0) return;
    finishWaiting();
  };
  const timer = window.setTimeout(finishWaiting, 800);
  try {
    synth.addEventListener("voiceschanged", onVoices);
  } catch {}
  return true;
}

export function stopSpeaking(): void {
  if (!isSpeechSupported()) return;
  speakGeneration++; // batalkan juga bacaan yang masih menunggu daftar suara
  try {
    const synth = window.speechSynthesis;
    // Hanya cancel bila ada suara aktif. cancel() saat idle membuat Chrome
    // menunda bacaan berikutnya (mis. auto-play setelah hasil muncul).
    if (synth.speaking || synth.pending || synth.paused) {
      synth.cancel();
    }
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
  const raw = String(jenis || "").trim();
  const upper = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (/^E?_?KTP/.test(upper)) return "KTP elektronik";
  if (upper === "KK" || upper.includes("KARTU_KELUARGA")) return "Kartu Keluarga";
  if (upper === "KIA" || upper.includes("KARTU_IDENTITAS_ANAK")) return "Kartu Identitas Anak";
  if (upper.includes("AKTA_KEMATIAN")) return "akta kematian";
  if (upper.includes("AKTA_PERKAWINAN")) return "akta perkawinan";
  if (upper.includes("AKTA")) return "akta kelahiran";
  if (upper.includes("SURAT_PINDAH") || upper.includes("SKPWNI")) return "surat pindah";
  if (upper.includes("LAINNYA")) return "dokumen lain";
  return raw
    .replace(/e-?KTP/gi, "KTP elektronik")
    .replace(/\s*\(SKPWNI\)/gi, "")
    .replace(/\s*\(KIA\)/gi, "")
    .replace(/_/g, " ");
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

/** Satu halaman ringkas yang dibacakan pada ringkasan PDF multi-halaman. */
export interface PreScreenSummarySpeechPage {
  pageNumber: number;
  jenis?: string;
  statusVerifikasi?: string;
  statusKelayakan?: string;
  skor?: number;
  isSystemError?: boolean;
}

export interface PreScreenSummarySpeechInput {
  pages: PreScreenSummarySpeechPage[];
  mainPageIndex?: number;
  identityConflict?: boolean;
}

function halamanDikenal(page: PreScreenSummarySpeechPage): boolean {
  if (page.isSystemError) return false;
  const status = String(page.statusVerifikasi || "").toUpperCase().trim();
  const jenis = String(page.jenis || "").toUpperCase().trim();
  return status !== "TIDAK_VALID" && jenis !== "LAINNYA";
}

function halamanLayak(page: PreScreenSummarySpeechPage): boolean {
  if (!halamanDikenal(page)) return false;
  const status = String(page.statusVerifikasi || "").toUpperCase().trim();
  if (status) return status === "BERHASIL";
  return String(page.statusKelayakan || "").toUpperCase().trim() === "LAYAK";
}

/** "tiga" → "Tiga" untuk awal kalimat. */
function kapitalAwal(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * Ringkasan bacaan untuk PDF multi-halaman: menyebut SEMUA halaman, bukan hanya
 * halaman yang sedang dilihat, lalu menegaskan dokumen utama dan konflik data.
 * NIK/nama lengkap tidak dibacakan demi privasi di ruang publik.
 */
export function buildPreScreenSummarySpeech(input: PreScreenSummarySpeechInput): string {
  const pages = Array.isArray(input.pages) ? input.pages : [];
  if (!pages.length) return "";

  const total = pages.length;
  const layak = pages.filter(halamanLayak).length;
  const perluDiperiksa = total - layak;
  const ringkasanLayak =
    layak === total
      ? "semua layak"
      : layak === 0
        ? "belum ada yang layak"
        : `${angkaKeKataId(layak)} layak`;
  const bagian: string[] = [
    `Pemindaian selesai. ${kapitalAwal(angkaKeKataId(total))} halaman diproses: ${ringkasanLayak}${
      perluDiperiksa > 0 ? `, ${angkaKeKataId(perluDiperiksa)} perlu diperiksa` : ""
    }.`,
  ];

  for (const page of pages) {
    const nomor = angkaKeKataId(Math.max(1, Number(page.pageNumber) || 1));
    if (page.isSystemError) {
      bagian.push(`Halaman ${nomor} gagal dipindai karena gangguan sistem.`);
      continue;
    }
    if (!halamanDikenal(page)) {
      bagian.push(`Halaman ${nomor} bukan dokumen kependudukan yang didukung.`);
      continue;
    }
    const jenis = jenisSpoken(page.jenis) || "dokumen";
    const skor = angkaKeKataId(Number(page.skor));
    if (halamanLayak(page)) {
      bagian.push(
        `Halaman ${nomor}, ${jenis}, layak dan terbaca jelas, skor ${skor} dari seratus.`
      );
    } else {
      bagian.push(
        `Halaman ${nomor}, ${jenis}, terbaca tetapi perlu perbaikan, skor ${skor} dari seratus.`
      );
    }
  }

  const main =
    typeof input.mainPageIndex === "number" ? pages[input.mainPageIndex] : undefined;
  const mainValid = main ? halamanDikenal(main) : false;
  if (main && mainValid) {
    const nomor = angkaKeKataId(Math.max(1, Number(main.pageNumber) || 1));
    const jenis = jenisSpoken(main.jenis) || "dokumen";
    if (/akta\s*kematian|kematian/i.test(String(main.jenis || ""))) {
      bagian.push(
        `Dokumen utama halaman ${nomor}, ${jenis}. NIK dan nama almarhum tidak diisikan sebagai pemohon; lengkapi data pemohon secara manual.`
      );
    } else {
      bagian.push(
        `Dokumen utama halaman ${nomor}, ${jenis}. NIK dan nama pemohon diambil dari halaman ini.`
      );
      if (
        !/ktp|kartu tanda penduduk/i.test(String(main.jenis || "")) &&
        !input.identityConflict
      ) {
        bagian.push("Pastikan dokumen utama memang milik pemohon.");
      }
    }
  } else {
    bagian.push(
      "Belum ada dokumen utama yang valid. Anda tetap bisa melanjutkan dengan mengisi NIK dan nama secara manual."
    );
  }

  if (input.identityConflict) {
    bagian.push(
      "Perhatian, data pemilik dokumen berbeda. Pastikan dokumen utama memang milik pemohon."
    );
  }

  if (mainValid) {
    bagian.push("Silakan periksa pemetaan halaman, lalu lanjutkan ke formulir.");
  }

  return bagian.join(" ");
}
