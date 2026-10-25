// Pesan baku lintas komponen klien — satu sumber agar tidak drift.
// Frasa "bukan Kartu Kependudukan" WAJIB dipertahankan: dipakai deteksi
// regex di banyak tempat (mis. /bukan kartu kependudukan/i di klien & server).
export const BUKAN_KTP_MESSAGE =
  "File bukan Kartu Kependudukan Indonesia. Verifikasi AI mendukung e-KTP, Kartu Keluarga (KK), Kartu Identitas Anak (KIA), Akta Kelahiran/Kematian/Perkawinan, dan Surat Pindah (SKPWNI) asli — silakan unggah ulang foto dokumen yang jelas dan tidak terpotong.";
