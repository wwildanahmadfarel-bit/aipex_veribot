// Mesin "Rekomendasi Perbaikan & Tindak Lanjut" — dihitung penuh di sisi klien
// dari sinyal hasil pra-pemeriksaan / scan yang sudah ada, sehingga tetap
// tampil walau AI sedang gangguan (tanpa panggilan API tambahan).

import type { BlurArea } from "../types";
import { blurAreaLabel } from "./blurAreas";
import { isNikWajib, normalizeJenis } from "./jenisDokumen";

export interface RecommendationItem {
  kind: "perbaikan" | "tindak_lanjut";
  severity: "high" | "medium" | "info" | "success";
  title: string;
  detail: string;
}

export interface ScanRecommendationInput {
  jenis_dokumen?: string | null;
  skor?: number | null;
  blur_areas?: BlurArea[] | null;
  /** Jumlah digit NIK yang terbaca (0-16). null/undefined = tidak dievaluasi. */
  nik_digits?: number | null;
  /** false = AI tidak menemukan nama pada dokumen. undefined = tidak dievaluasi. */
  nama_terdeteksi?: boolean;
  is_system_error?: boolean;
  is_offline_demo?: boolean;
  /** true = lolos uji kejelasan (BERHASIL/LULUS); false = buram (BURAM/GAGAL). */
  lulus?: boolean;
}

export interface ScanRecommendations {
  perbaikan: RecommendationItem[];
  tindakLanjut: RecommendationItem[];
}

/** Ambang resmi server (api/_lib/ocr-handler.ts: skor >= 70 = BERHASIL). */
export const SKOR_MIN = 70;
/** Di bawah 80 AI seharusnya menandai area buram; dipakai untuk peringatan UI. */
export const SKOR_TAJAM_MIN = 80;

/** Syarat pelengkap khas per jenis dokumen — untuk tindak lanjut di loket. */
const SYARAT_PELENGKAP: Record<string, string> = {
  AKTA_KEMATIAN:
    "Bawa surat keterangan kematian dari dokter/RS/kelurahan, KTP almarhum, KK, serta KTP pelapor dan 2 saksi.",
  AKTA_PERKAWINAN:
    "Bawa kutipan akta perkawinan/surat nikah, KTP & KK pasangan, dan akta kelahiran kedua mempelai.",
  SURAT_PINDAH:
    "Bawa KK asli, KTP pemohon, dan surat pengantar RT/RW tujuan pindah bila ada.",
  KIA: "Bawa KK, akta kelahiran anak, KTP kedua orang tua, dan pasfoto anak.",
  AKTA: "Bawa kutipan akta kelahiran, KK, KTP orang tua, dan surat keterangan lahir bila ada.",
  KK: "Bawa KK lama (bila ada), KTP seluruh anggota keluarga, dan buku nikah/akta perkawinan orang tua.",
  KTP: "Bawa KTP lama (bila penggantian) atau KK untuk perekaman pertama kali.",
};

/** Item tindak lanjut "syarat pelengkap di loket" sesuai jenis dokumen. */
function syaratPelengkapItem(jenis: string): RecommendationItem | null {
  const detail = SYARAT_PELENGKAP[jenis];
  if (!detail) return null;
  return {
    kind: "tindak_lanjut",
    severity: "info",
    title: "Siapkan syarat pelengkap di loket",
    detail,
  };
}

const AREA_TIPS: Record<string, string> = {
  nik: "Fokuskan kamera tepat pada blok 16 digit NIK dan tahan sejenak sebelum memotret — pastikan angka tidak tertutup pantulan atau jari.",
  nama: "Pastikan kolom nama terkena cahaya merata, tidak terhalang jari, dan tidak tertutup bayangan.",
  foto_wajah:
    "Foto wajah kurang tajam — foto ulang dengan cahaya merata dan hindari bayangan/silau di permukaan kartu.",
  tanggal_lahir: "Dekatkan kamera ke kolom tanggal lahir lalu fokuskan ulang sebelum memotret.",
  tempat_lahir: "Kolom tempat lahir kurang terbaca — pastikan bagian tersebut tidak terkena pantulan cahaya.",
  alamat: "Kolom alamat kurang terbaca — hindari pantulan cahaya dan pastikan tidak terpotong bingkai.",
  berlaku_hingga: "Kolom masa berlaku kurang jelas — foto ulang dengan pencahayaan lebih terang.",
  tanda_tangan: "Area tanda tangan kurang tajam — fokuskan ulang kamera pada bagian bawah kartu.",
};

function tipForArea(rawArea: string): string {
  const key = String(rawArea || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return (
    AREA_TIPS[key] ||
    `${blurAreaLabel(key)} terdeteksi kurang jelas — dekatkan kamera dan fokuskan ulang pada bagian tersebut.`
  );
}

/** Susun daftar rekomendasi dari hasil scan / pra-pemeriksaan dokumen. */
export function buildScanRecommendations(input: ScanRecommendationInput): ScanRecommendations {
  const perbaikan: RecommendationItem[] = [];
  const tindakLanjut: RecommendationItem[] = [];
  const jenis = normalizeJenis(input.jenis_dokumen);
  const skor = Number(input.skor ?? 0) || 0;
  const blurAreas = Array.isArray(input.blur_areas) ? input.blur_areas : [];

  // 0) Penilaian offline (AI gangguan) — beri tahu keterbatasannya lebih dulu.
  if (input.is_offline_demo && !input.is_system_error) {
    perbaikan.push({
      kind: "perbaikan",
      severity: "info",
      title: "Penilaian offline (AI sedang gangguan)",
      detail:
        "Hasil ini berasal dari penilaian cadangan tanpa AI sehingga akurasinya terbatas. Pindai ulang saat layanan AI normal untuk verifikasi penuh.",
    });
  }

  // 1) Gangguan sistem — bukan vonis dokumen.
  if (input.is_system_error) {
    perbaikan.push({
      kind: "perbaikan",
      severity: "info",
      title: "Coba pindai ulang sebentar lagi",
      detail:
        "AI sedang gangguan sementara — tunggu 1–2 menit lalu unggah ulang foto dokumen. Berkas tetap aman dan dapat diverifikasi petugas di loket bila layanan AI belum normal.",
    });
    tindakLanjut.push({
      kind: "tindak_lanjut",
      severity: "info",
      title: "Lanjut isi manual atau pindai ulang",
      detail:
        "NIK & nama dapat diketik manual dari fisik dokumen, atau tunggu lalu pindai ulang. Tiket tetap bisa diterbitkan tanpa vonis dokumen.",
    });
    return { perbaikan, tindakLanjut };
  }

  // 2) Bukan dokumen kependudukan — arahkan unggah ulang atau jalur manual loket.
  if (jenis === "LAINNYA") {
    perbaikan.push({
      kind: "perbaikan",
      severity: "high",
      title: "Unggah dokumen yang didukung verifikasi AI",
      detail:
        "Verifikasi AI menerima e-KTP, Kartu Keluarga (KK), KIA, akta kelahiran/kematian/perkawinan, dan Surat Pindah (SKPWNI) — bukan SIM, paspor, swafoto, atau tangkapan layar. Pastikan seluruh bingkai dokumen masuk dan tidak silau.",
    });
    tindakLanjut.push({
      kind: "tindak_lanjut",
      severity: "info",
      title: "Dokumen lain (surat keterangan, dsb.)? Lanjut verifikasi manual di loket",
      detail:
        "Berkas seperti surat keterangan tetap dapat diproses petugas. Bawa dokumen asli beserta pendukungnya ke loket kelurahan pada jam layanan.",
    });
    return { perbaikan, tindakLanjut };
  }

  // 3) Area kurang jelas — tips spesifik per area (prioritas keparahan, maks 3).
  //    Dedupe per jenis area: fallback lokal bisa menghasilkan beberapa kotak
  //    "lainnya" yang sama; satu rekomendasi per area sudah cukup.
  const urutanSeverity: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const seenAreas = new Set<string>();
  const areaPrioritas = [...blurAreas]
    .sort((a, b) => (urutanSeverity[a.severity] ?? 1) - (urutanSeverity[b.severity] ?? 1))
    .filter((a) => {
      const key = String(a.area || "lainnya").trim().toLowerCase();
      if (seenAreas.has(key)) return false;
      seenAreas.add(key);
      return true;
    })
    .slice(0, 3);
  for (const area of areaPrioritas) {
    perbaikan.push({
      kind: "perbaikan",
      severity: area.severity === "high" ? "high" : "medium",
      title: `Perbaiki bagian ${blurAreaLabel(area.area)}${area.estimated ? " (perkiraan)" : ""}`,
      detail:
        tipForArea(area.area) +
        (area.estimated
          ? " Area ini diperkirakan dari analisis ketajaman lokal; periksa juga seluruh permukaan dokumen."
          : ""),
    });
  }

  // 4) Skor kejelasan di bawah standar tajam. Ini juga menangkap kasus
  //    skor 70–79 yang statusnya BERHASIL tetapi areanya tidak terpetakan AI.
  if (
    areaPrioritas.length === 0 &&
    (skor > 0 && skor < SKOR_TAJAM_MIN || input.lulus === false)
  ) {
    const diBawahAmbangLulus = skor > 0 && skor < SKOR_MIN;
    perbaikan.push({
      kind: "perbaikan",
      severity: diBawahAmbangLulus ? "high" : "medium",
      title: diBawahAmbangLulus
        ? `Kejelasan foto ${skor}/100 (minimal ${SKOR_MIN})`
        : skor > 0
          ? `Kejelasan foto ${skor}/100 — di bawah standar tajam ${SKOR_TAJAM_MIN}`
          : "Kejelasan dokumen perlu diperiksa",
      detail: diBawahAmbangLulus
        ? "Foto ulang di tempat terang dengan cahaya alami tanpa flash, letakkan dokumen di permukaan datar, dan pastikan seluruh bingkai kartu masuk frame."
        : "AI menilai dokumen masih kurang tajam, tetapi area buram tidak berhasil dipetakan otomatis. Periksa seluruh teks, foto wajah, dan tepi dokumen; foto ulang di tempat terang tanpa flash bila perlu.",
    });
  }

  // 5) Kelengkapan NIK & nama (opsional — hanya bila dievaluasi).
  //    Untuk akta kematian/perkawinan & surat pindah, NIK memang sering tidak
  //    tercantum → jangan tampilkan sebagai masalah.
  const nikDigits = input.nik_digits == null ? null : Number(input.nik_digits);
  if (nikDigits != null && nikDigits < 16 && isNikWajib(jenis)) {
    perbaikan.push({
      kind: "perbaikan",
      severity: "medium",
      title: nikDigits > 0 ? `NIK baru terbaca ${nikDigits}/16 digit` : "NIK belum terbaca",
      detail:
        "Lengkapi 16 digit NIK manual di formulir dari fisik dokumen, atau pindai ulang dengan fokus pada blok NIK.",
    });
  }
  if (input.nama_terdeteksi === false) {
    perbaikan.push({
      kind: "perbaikan",
      severity: "info",
      title: "Nama belum terbaca AI",
      detail: "Lengkapi nama sesuai dokumen pada formulir — petugas akan mencocokkan dengan berkas asli.",
    });
  }

  // 6) Tindak lanjut sesuai kondisi akhir dokumen.
  if (input.lulus) {
    if (perbaikan.filter((p) => p.severity !== "info").length === 0) {
      perbaikan.unshift({
        kind: "perbaikan",
        severity: "success",
        title: "Tidak ada perbaikan wajib — berkas terbaca baik",
        detail: "Skor kejelasan memenuhi ambang dan tidak ada area bermasalah yang terdeteksi.",
      });
    }
    tindakLanjut.push({
      kind: "tindak_lanjut",
      severity: "success",
      title: "Lanjutkan untuk menerbitkan tiket QR",
      detail:
        "Lengkapi formulir, lalu tunjukkan QR tiket dan bawa dokumen asli ke loket untuk verifikasi petugas.",
    });
    const syarat = syaratPelengkapItem(jenis);
    if (syarat) tindakLanjut.push(syarat);
  } else {
    tindakLanjut.push({
      kind: "tindak_lanjut",
      severity: "medium",
      title: "Tetap bisa lanjut — tiket terbit dengan catatan revisi",
      detail:
        "Tiket tetap dapat diterbitkan. Bawa fisik dokumen asli; petugas akan memverifikasi ulang di loket.",
    });
    const syarat = syaratPelengkapItem(jenis);
    if (syarat) tindakLanjut.push(syarat);
  }

  return { perbaikan: perbaikan.slice(0, 4), tindakLanjut };
}

/** Tindak lanjut singkat untuk modal status tiket (berdasarkan status petugas). */
export function buildTicketFollowUp(statusRaw: unknown): RecommendationItem | null {
  const s = String(statusRaw || "").toUpperCase().trim();
  if (["DISETUJUI", "APPROVED"].includes(s))
    return {
      kind: "tindak_lanjut",
      severity: "success",
      title: "Berkas disetujui — siap cetak / pengambilan",
      detail:
        "Datang ke loket pada jam layanan dengan membawa dokumen asli. Notifikasi juga dikirim ke nomor WhatsApp terdaftar.",
    };
  if (["DITOLAK", "REJECTED", "TIDAK_VALID"].includes(s))
    return {
      kind: "tindak_lanjut",
      severity: "high",
      title: "Berkas belum dapat diproses",
      detail:
        "Baca catatan petugas di atas, perbaiki sesuai catatan, lalu ajukan ulang atau konsultasikan ke loket kelurahan.",
    };
  if (["PERLU_PERBAIKAN", "REVISI", "BURAM"].includes(s))
    return {
      kind: "tindak_lanjut",
      severity: "medium",
      title: "Perlu perbaikan / verifikasi ulang",
      detail:
        "Siapkan dokumen asli dan lakukan foto ulang bila diminta. Tiket tetap berlaku untuk verifikasi ulang di loket.",
    };
  if (["PENDING", "MENUNGGU", "BERHASIL"].includes(s))
    return {
      kind: "tindak_lanjut",
      severity: "info",
      title: "Menunggu verifikasi petugas",
      detail:
        "Tunjukkan QR tiket di loket pada jam layanan sambil membawa dokumen asli + berkas pendukung. Perubahan status dikirim via WhatsApp.",
    };
  return null;
}
