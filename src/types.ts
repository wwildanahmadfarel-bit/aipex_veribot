/** Satu langkah riwayat status tiket yang aman ditampilkan ke publik. */
export interface TicketTimelineItem {
  status: string;
  catatan?: string;
  created_at: string;
}

export interface Ticket {
  id: string;
  ticket_code: string;
  nik_encrypted: string;
  nik_raw?: string;
  nama_warga: string;
  phone?: string;
  alamat?: string;
  jenis_dokumen: string;
  status_verifikasi: "PENDING" | "APPROVED" | "REJECTED" | "REVISI";
  skor_ai: number;
  status_ai: "LULUS" | "GAGAL";
  catatan_ai: string;
  catatan_petugas?: string;
  created_at: string;
  updated_at: string;
  /** Riwayat status dari verification_logs (opsional; tiket lama bisa kosong). */
  riwayat?: TicketTimelineItem[];
}

export interface ServiceDownload {
  /** Kode dokumen SIDNOK Kota Semarang. */
  code: string;
  title: string;
  /** Kapan formulir ini perlu diunduh/dipakai. */
  condition: string;
  /** Ukuran file untuk tampilan. */
  size: string;
  /** Path file statis di public/ (same-origin, agar bisa diunduh langsung). */
  file: string;
  /** Nama file saat diunduh. */
  fileName: string;
}

export interface ServiceCatalogItem {
  id: string;
  title: string;
  category: "identitas" | "sipil" | "perpindahan";
  badge: string;
  badgeType: "primary" | "tertiary" | "error" | "secondary";
  iconName: string;
  description: string;
  requirements: {
    title: string;
    description: string;
    mandatory: boolean;
  }[];
  /** Formulir resmi yang perlu diunduh (kondisional, bukan slot upload). */
  downloads?: ServiceDownload[];
}

export interface VerificationResult {
  nik: string;
  nama: string;
  jenis_dokumen: string;
  status_kualitas: "LULUS" | "GAGAL";
  skor: number;
  catatan: string;
  source?: string;
  /** Area dokumen yang terdeteksi kurang jelas (hasil Gemini Vision). */
  blur_areas?: BlurArea[];
}

/** Kotak area kurang jelas pada foto dokumen. bbox dalam persen 0-100. */
export interface BlurArea {
  area: string;
  severity: "high" | "medium" | "low";
  bbox: [number, number, number, number];
  description: string;
  /** True bila kotak berasal dari perkiraan analisis lokal, bukan vonis AI. */
  estimated?: boolean;
}

export interface PrescreeningResult {
  status_kualitas: "LAYAK" | "TIDAK_LAYAK";
  skor_kejelasan: number;
  nik: string | null;
  nama: string | null;
  jenis_dokumen: "e-KTP" | "KK" | "KIA" | "AKTA" | "AKTA_KEMATIAN" | "AKTA_PERKAWINAN" | "SURAT_PINDAH" | "TIDAK_DIKETAHUI" | string;
  catatan: string;
}

export interface OcrPreScreenResult {
  imageBase64: string;
  imageName?: string;
  status_kelayakan: "LAYAK" | "TIDAK_LAYAK";
  skor_kejelasan: number;
  status_kejelasan: "LULUS" | "KURANG_TAJAM" | "DITOLAK";
  nik_terdeteksi: boolean;
  nik_value?: string;
  nama_terdeteksi?: string;
  pencahayaan_status: "SESUAI_STANDAR" | "KURANG_TERANG" | "PANTULAN_SILAU";
  catatan: string;
  jenis_dokumen?: "KTP" | "KK" | "AKTA" | "AKTA_KEMATIAN" | "AKTA_PERKAWINAN" | "SURAT_PINDAH" | "KIA" | "LAINNYA" | string;
  status_verifikasi?: "BERHASIL" | "BURAM" | "TIDAK_VALID" | string;
  isSystemError?: boolean;
  /** Area dokumen yang terdeteksi kurang jelas (untuk overlay pada pratinjau). */
  blur_areas?: BlurArea[];
  /** True bila hasil berasal dari penilaian offline lokal (AI gangguan) — bukan vonis AI. */
  isOfflineDemo?: boolean;
}

/** Satu halaman PDF/foto yang sudah dipindai OCR pra-pemeriksaan. */
export interface PreScreenPage {
  /** 0-based, urutan halaman di berkas asli. */
  pageIndex: number;
  /** 1-based, untuk label "Halaman 1". */
  pageNumber: number;
  /** Data URL halaman (PDF satu halaman atau gambar asli). */
  imageBase64: string;
  imageName: string;
  mimeType: string;
  result: OcrPreScreenResult;
  verification: VerificationResult;
}

export interface PreScreenInitialData {
  nik?: string;
  nama?: string;
  imageBase64?: string;
  imageName?: string;
  service?: string;
  preScreenScore?: number;
  /** Jenis dokumen hasil pra-pemeriksaan: KTP | KK | AKTA | AKTA_KEMATIAN | AKTA_PERKAWINAN | SURAT_PINDAH | KIA | LAINNYA */
  jenisDokumen?: string;
  /** Full verification result from pre-screen OCR */
  verificationResult?: VerificationResult;
  /** Semua halaman yang berhasil/dikenali dari PDF multi-halaman. */
  pages?: PreScreenPage[];
  /** Indeks halaman yang dipilih sebagai dokumen utama (0-based). */
  mainPageIndex?: number;
}

