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
}

export interface ChatMessage {
  id: string;
  sender: "bot" | "user";
  text: string;
  timestamp: string;
}

export interface VerificationResult {
  nik: string;
  nama: string;
  jenis_dokumen: string;
  status_kualitas: "LULUS" | "GAGAL";
  skor: number;
  catatan: string;
  source?: string;
}

export interface PrescreeningResult {
  status_kualitas: "LAYAK" | "TIDAK_LAYAK";
  skor_kejelasan: number;
  nik: string | null;
  nama: string | null;
  jenis_dokumen: "e-KTP" | "KK" | "TIDAK_DIKETAHUI" | string;
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
  jenis_dokumen?: "KTP" | "KK" | "AKTA" | "LAINNYA" | string;
  status_verifikasi?: "BERHASIL" | "BURAM" | "TIDAK_VALID" | string;
  isSystemError?: boolean;
  /** True bila hasil berasal dari penilaian offline lokal (AI gangguan) — bukan vonis AI. */
  isOfflineDemo?: boolean;
}

export interface PreScreenInitialData {
  nik?: string;
  nama?: string;
  imageBase64?: string;
  imageName?: string;
  service?: string;
  preScreenScore?: number;
  /** Jenis dokumen hasil pra-pemeriksaan: KTP | KK | AKTA */
  jenisDokumen?: string;
}

