// Katalog FAQ bersama untuk portal, chatbot, dan chip pertanyaan.
// Satu sumber kebenaran agar copy tidak berbeda antar permukaan.
//
// Acuan isi:
// - Standar Pelayanan Kelurahan Meruya Selatan (Jakarta Barat)
// - Perpres No. 96 Tahun 2018
// - UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi
// - Katalog layanan internal AIPEX VeriBot (src/data/servicesData.ts)
//
// Catatan: "Kelurahan Sukamaju" adalah entitas demo AIPEX. Jawaban di bawah
// diadaptasi untuk alur demo, bukan salinan mentah SOP kelurahan mana pun.

export type FaqCategory =
  | "layanan"
  | "identitas"
  | "keluarga"
  | "sipil"
  | "perpindahan"
  | "usaha"
  | "aplikasi"
  | "privasi";

export interface FaqEntry {
  id: string;
  category: FaqCategory;
  /** Pertanyaan lengkap; dipakai sebagai teks yang dikirim chip. */
  question: string;
  /** Label pendek untuk chip chatbot. */
  chipLabel?: string;
  /** Jawaban Markdown ringan: **tebal**, bullet "•", dan daftar bernomor. */
  answer: string;
  /** Frasa/frasa kunci untuk matcher offline. */
  keywords: string[];
  source: string;
  updatedAt: string;
}

const SOP = "Keputusan Lurah Meruya Selatan No. 1 Tahun 2024 tentang Standar Pelayanan";
const PERPRES = "Perpres No. 96 Tahun 2018";
const PDP = "UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi";
const UPDATED = "2026-10-28";

export const FAQ_SOURCE_NOTE =
  "Acuan: Keputusan Lurah Meruya Selatan No. 1 Tahun 2024 tentang Standar Pelayanan, Perpres No. 96 Tahun 2018, dan UU No. 27 Tahun 2022. Jawaban disesuaikan dengan alur AIPEX VeriBot Kelurahan Sukamaju.";

export const FAQ_CATALOG: FaqEntry[] = [
  {
    id: "jam-layanan",
    category: "layanan",
    question: "Jam berapa loket kelurahan buka?",
    chipLabel: "⏰ Jam loket",
    answer:
      "🕒 **Jam Operasional Loket Kelurahan Sukamaju:**\n" +
      "• **Senin - Kamis:** 08.00 - 15.30 WIB\n" +
      "• **Jumat:** 08.00 - 14.30 WIB\n" +
      "• **Sabtu, Minggu, dan libur nasional:** loket fisik tutup.\n\n" +
      "Layanan mandiri **AIPEX VeriBot** tetap aktif 24 jam untuk pra-pemeriksaan berkas dan Tiket QR Antrean.",
    keywords: ["jam", "buka", "tutup", "operasional", "jadwal", "libur", "jam layanan", "jam loket", "loket"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "kontak-lokasi",
    category: "layanan",
    question: "Di mana alamat kantor kelurahan dan bagaimana kontaknya?",
    answer:
      "📍 **Kantor Kelurahan Sukamaju:**\n" +
      "• **Alamat:** Jl. Praja Abdi No. 45, Kecamatan Maju Sejahtera\n" +
      "• **WhatsApp / Call Center:** +62 811-2345-6789\n" +
      "• **Email:** layanan@sukamaju.desa.id\n" +
      "• **Layanan online:** AIPEX VeriBot aktif 24 jam.\n\n" +
      "Untuk pengaduan, sertakan kode tiket dan ringkasan masalah. Jangan mengirim foto dokumen melalui chat umum.",
    keywords: ["alamat", "lokasi", "kantor", "kontak", "telepon", "whatsapp", "email", "dimana", "di mana"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "biaya-layanan",
    category: "layanan",
    question: "Berapa biaya dan lama proses layanan?",
    chipLabel: "💸 Biaya",
    answer:
      "💸 **Biaya Layanan:**\n" +
      "Penerbitan KTP-el, KK, KIA, akta kelahiran/kematian/perkawinan, surat pindah, dan legalisasi **tidak dipungut biaya**.\n\n" +
      "⏱️ **Perkiraan waktu proses:**\n" +
      "• KK, akta, dan surat pindah: umumnya **1 - 3 hari kerja** bila berkas lengkap.\n" +
      "• KTP-el: perekaman di loket; penerbitan bisa **1 - 14 hari kerja** tergantung konsolidasi data dan blanko.\n" +
      "• Sinkronisasi NIK: konfirmasi pusat sekitar **1 x 24 jam**.\n\n" +
      "Jika ada permintaan pembayaran tidak resmi, laporkan ke petugas atau pimpinan kelurahan.",
    keywords: [
      "biaya",
      "bayar",
      "gratis",
      "tarif",
      "pungutan",
      "retribusi",
      "harga",
      "biaya dan lama",
      "biaya layanan",
      "berapa biaya",
    ],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "lama-proses",
    category: "layanan",
    question: "Berapa lama proses penerbitan dokumen?",
    answer:
      "⏱️ **Perkiraan Waktu Proses:**\n" +
      "• **KK, akta kelahiran/kematian, surat pindah:** umumnya **1 - 3 hari kerja** bila berkas lengkap.\n" +
      "• **KTP-el:** perekaman dilakukan di loket; penerbitan bisa **1 - 14 hari kerja** tergantung konsolidasi data dan ketersediaan blanko.\n" +
      "• **Sinkronisasi NIK:** konfirmasi update pusat Dukcapil sekitar **1 x 24 jam**.\n\n" +
      "Waktu pasti diberikan petugas saat verifikasi. Pastikan nomor WhatsApp aktif agar status dapat diinformasikan.",
    keywords: ["lama", "berapa lama", "waktu", "proses", "selesai", "hari kerja", "estimasi", "durasi"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "ktp-baru",
    category: "identitas",
    question: "Apa syarat membuat KTP-el baru untuk pemula?",
    answer:
      "🪪 **Syarat KTP-el Baru (Pemula 17 Tahun / Sudah Menikah):**\n" +
      "1. Fotokopi Kartu Keluarga (KK).\n" +
      "2. Fotokopi Akta Kelahiran atau Ijazah.\n" +
      "3. Formulir F1.02 (disediakan di kelurahan).\n" +
      "4. Perekaman foto dan sidik jari dilakukan langsung di loket.\n\n" +
      "• Tidak perlu surat pengantar RT/RW sesuai Perpres No. 96 Tahun 2018.\n" +
      "• Tidak dipungut biaya.",
    keywords: ["ktp baru", "ktp pemula", "buat ktp", "e-ktp baru", "ktp-el baru", "17 tahun", "perekaman", "ktp"],
    source: `${SOP}; ${PERPRES}`,
    updatedAt: UPDATED,
  },
  {
    id: "ktp-hilang-rusak",
    category: "identitas",
    question: "Apa syarat mengurus KTP hilang atau rusak?",
    chipLabel: "🪪 KTP hilang",
    answer:
      "🪪 **KTP-el Hilang:**\n" +
      "1. Surat Keterangan Kehilangan dari Polsek setempat.\n" +
      "2. Fotokopi Kartu Keluarga (KK).\n" +
      "3. Formulir F1.02.\n\n" +
      "🪪 **KTP-el Rusak:**\n" +
      "1. Bawa fisik KTP-el lama yang rusak.\n" +
      "2. Fotokopi Kartu Keluarga (KK).\n" +
      "3. Formulir F1.02.\n\n" +
      "• Tidak dipungut biaya.\n" +
      "• Perekaman ulang dilakukan bila data atau chip tidak terbaca.\n" +
      "• Tanpa surat pengantar RT/RW sesuai Perpres No. 96 Tahun 2018.",
    keywords: [
      "ktp hilang",
      "kehilangan ktp",
      "e-ktp hilang",
      "ktp-el hilang",
      "surat kehilangan ktp",
      "ktp rusak",
      "e-ktp rusak",
      "ktp-el rusak",
      "ganti ktp",
      "penggantian ktp",
      "ktp",
    ],
    source: `${SOP}; ${PERPRES}`,
    updatedAt: UPDATED,
  },
  {
    id: "ikd",
    category: "identitas",
    question: "Bagaimana cara mengaktifkan KTP digital (IKD)?",
    answer:
      "📱 **Aktivasi Identitas Kependudukan Digital (IKD):**\n" +
      "1. Pastikan sudah pernah melakukan perekaman KTP-el fisik.\n" +
      "2. Siapkan smartphone Android/iOS dan email aktif.\n" +
      "3. Unduh aplikasi resmi IKD Kemendagri.\n" +
      "4. Datang ke loket untuk verifikasi wajah atau pindai QR petugas.\n\n" +
      "• Layanan tidak dipungut biaya.\n" +
      "• IKD bukan pengganti KTP-el fisik untuk semua transaksi; bawa KTP fisik bila diminta.",
    keywords: ["ikd", "ktp digital", "identitas digital", "aplikasi ikd", "aktivasi ikd"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "kk",
    category: "keluarga",
    question: "Apa syarat KK baru, perubahan, atau hilang?",
    chipLabel: "👨‍👩‍👧 KK baru",
    answer:
      "👨‍👩‍👧‍👦 **Layanan Kartu Keluarga (KK):**\n" +
      "• **KK baru (keluarga baru):** Buku Nikah/Akta Perkawinan, KK asal suami dan istri, KTP-el pasangan.\n" +
      "• **Penambahan anggota (kelahiran):** KK lama, Akta/Surat Keterangan Lahir, KTP orang tua.\n" +
      "• **Perubahan data:** KK lama dan dokumen pendukung (akta nikah, ijazah, akta cerai, surat pindah).\n" +
      "• **KK hilang:** Surat Keterangan Kehilangan dari Polsek, KTP-el/KK lama bila ada.\n" +
      "• **KK rusak:** KK lama yang rusak dan KTP-el.\n\n" +
      "• Tidak dipungut biaya.\n" +
      "• Proses umumnya 1 - 3 hari kerja bila berkas lengkap.",
    keywords: [
      "kk",
      "kartu keluarga",
      "kk baru",
      "kk hilang",
      "kk rusak",
      "perubahan kk",
      "ubah kk",
      "tambah anggota kk",
      "kartu keluarga baru",
    ],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "kia",
    category: "keluarga",
    question: "Apa syarat membuat atau mengganti Kartu Identitas Anak (KIA)?",
    chipLabel: "👶 KIA",
    answer:
      "👶 **Layanan Kartu Identitas Anak (KIA):**\n" +
      "• **KIA baru:** Fotokopi Akta Kelahiran, KK orang tua, KTP-el orang tua, dan pasfoto 3x4 sebanyak 2 lembar untuk anak di atas 5 tahun.\n" +
      "• **KIA hilang:** Surat kehilangan dari Polsek, KK, dan pasfoto.\n" +
      "• **KIA rusak:** KIA lama yang rusak, KK, dan pasfoto.\n\n" +
      "• Tidak dipungut biaya.\n" +
      "• KIA berlaku untuk anak usia 0 - 17 tahun kurang satu hari.",
    keywords: ["kia", "kartu identitas anak", "kia hilang", "kia rusak", "identitas anak"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "akta-kelahiran",
    category: "sipil",
    question: "Apa syarat membuat akta kelahiran?",
    chipLabel: "📜 Akta lahir",
    answer:
      "📜 **Syarat Akta Kelahiran:**\n" +
      "1. Surat Keterangan Lahir dari RS, bidan, atau penolong kelahiran.\n" +
      "2. Fotokopi Buku Nikah/Akta Perkawinan orang tua.\n" +
      "3. Fotokopi KK dan KTP-el orang tua.\n" +
      "4. Fotokopi KTP-el 2 orang saksi.\n" +
      "5. Formulir F2.01 (disediakan di loket).\n\n" +
      "• Tidak dipungut biaya.\n" +
      "• Formulir SPTJM kelahiran dapat diunduh dari menu Syarat layanan di website.\n" +
      "• Jika surat lahir tidak ada, dapat dilengkapi SPTJM Kelahiran sesuai ketentuan.\n" +
      "• Proses umumnya 1 - 3 hari kerja bila berkas lengkap.",
    keywords: ["akta kelahiran", "akta lahir", "kelahiran", "surat lahir", "sptjm kelahiran"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "akta-kematian",
    category: "sipil",
    question: "Apa syarat mengurus akta kematian?",
    answer:
      "📜 **Syarat Akta Kematian:**\n" +
      "1. Surat Keterangan Kematian dari RS, Puskesmas, atau kelurahan.\n" +
      "2. KTP-el dan KK almarhum/almarhumah.\n" +
      "3. KTP-el pelapor.\n" +
      "4. KTP-el 2 orang saksi.\n" +
      "5. Formulir F2.01 (disediakan di loket).\n\n" +
      "• Tidak dipungut biaya.\n" +
      "• Formulir SPTJM kematian dapat diunduh dari menu Syarat layanan di website.\n" +
      "• Jika surat kematian tidak ada, dapat dilengkapi SPTJM Kematian sesuai ketentuan.\n" +
      "• Proses umumnya 1 - 3 hari kerja bila berkas lengkap.",
    keywords: ["akta kematian", "kematian", "surat kematian", "orang meninggal", "sptjm kematian"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "akta-perkawinan",
    category: "sipil",
    question: "Apa syarat pencatatan akta perkawinan?",
    answer:
      "📜 **Syarat Akta Perkawinan (Non-Muslim):**\n" +
      "1. Surat Pemberkatan dari pemuka agama.\n" +
      "2. KTP-el dan KK kedua mempelai.\n" +
      "3. KTP-el kedua orang tua.\n" +
      "4. Pasfoto berdampingan 4x6 sebanyak 4 lembar.\n" +
      "5. Formulir pencatatan dari kelurahan.\n\n" +
      "• Tidak dipungut biaya.\n" +
      "• Persyaratan tambahan mengikuti ketentuan pencatatan sipil setempat.",
    keywords: ["akta perkawinan", "akta nikah", "perkawinan", "nikah", "pemberkatan", "menikah"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "surat-pindah",
    category: "perpindahan",
    question: "Apa syarat mengurus surat pindah (SKPWNI)?",
    chipLabel: "🚚 Pindah",
    answer:
      "🚚 **Syarat Surat Pindah (SKPWNI):**\n" +
      "1. Kartu Keluarga (KK) asli.\n" +
      "2. KTP-el seluruh anggota keluarga yang pindah.\n" +
      "3. Formulir permohonan pindah F1.08.\n" +
      "4. Alamat tujuan lengkap dengan kode pos.\n\n" +
      "• Tidak dipungut biaya.\n" +
      "• Proses umumnya 1 - 3 hari kerja bila berkas lengkap.\n" +
      "• Untuk pindah datang, lampirkan surat pindah dari daerah asal.",
    keywords: ["pindah", "skpwni", "surat pindah", "pindah domisili", "pindah alamat", "pindah datang"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "sinkron-nik",
    category: "perpindahan",
    question: "Bagaimana cara memperbaiki NIK yang tidak terbaca di BPJS atau bank?",
    answer:
      "🔄 **Sinkronisasi NIK:**\n" +
      "1. Bawa/fotokopi KTP-el dan KK.\n" +
      "2. Sertakan tangkapan layar pesan \"NIK tidak ditemukan\" dari aplikasi terkait.\n" +
      "3. Sertakan nomor WhatsApp aktif.\n" +
      "4. Petugas akan mengajukan konsolidasi ke pusat Dukcapil.\n\n" +
      "• Layanan tidak dipungut biaya.\n" +
      "• Konfirmasi update pusat umumnya 1 x 24 jam, tergantung antrean Dukcapil.",
    keywords: ["sinkronisasi nik", "sinkron nik", "nik tidak ditemukan", "nik tidak terbaca", "bpjs", "bank", "konsolidasi nik"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "sku",
    category: "usaha",
    question: "Apa syarat membuat Surat Keterangan Usaha (SKU)?",
    answer:
      "🏪 **Syarat Surat Keterangan Usaha (SKU):**\n" +
      "1. KTP-el dan KK pemohon.\n" +
      "2. Surat pengantar RT/RW setempat.\n" +
      "3. Foto lokasi atau tempat usaha.\n" +
      "4. Formulir permohonan SKU.\n\n" +
      "• Layanan tidak dipungut biaya.\n" +
      "• SKU adalah surat keterangan kelurahan, bukan izin usaha resmi.",
    keywords: ["sku", "surat keterangan usaha", "usaha", "izin usaha", "umkm"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "rt-rw",
    category: "layanan",
    question: "Apakah surat pengantar RT/RW masih diwajibkan?",
    answer:
      "📜 **Sesuai Perpres No. 96 Tahun 2018**, pengurusan dokumen kependudukan dasar seperti KTP-el baru/rusak/hilang, akta kelahiran, dan pembaruan KK **tidak lagi memerlukan surat pengantar RT/RW** sepanjang NIK sudah aktif di Ditjen Dukcapil.\n\n" +
      "• Untuk **pindah domisili**, verifikasi lingkungan RT/RW masih dianjurkan.\n" +
      "• Untuk **SKU**, surat pengantar RT/RW tetap diperlukan.\n" +
      "• Jika petugas meminta surat tambahan, tanyakan dasar hukumnya di loket.",
    keywords: ["rt", "rw", "pengantar rt", "surat pengantar", "pengantar rw", "perpres 96", "surat rt rw"],
    source: PERPRES,
    updatedAt: UPDATED,
  },
  {
    id: "foto-dokumen",
    category: "aplikasi",
    question: "Mengapa foto KTP sering ditolak?",
    answer:
      "📷 **Tips Foto Dokumen:**\n" +
      "• Gunakan cahaya cukup, hindari silau dan bayangan.\n" +
      "• Pastikan seluruh dokumen masuk frame dan tidak terpotong.\n" +
      "• NIK 16 digit dan barcode harus terbaca jelas.\n" +
      "• Format JPG, PNG, WEBP, atau PDF, maksimal **4 MB**.\n" +
      "• Jangan gunakan filter, crop berlebihan, atau foto miring.\n\n" +
      "VeriBot memberi label **Diterima - Lolos Pra-Pemeriksaan** jika skor kejelasan minimal 70. Jika di bawah 70, dokumen tetap diterima dengan label **Diterima - Verifikasi Loket**.",
    keywords: [
      "foto",
      "upload",
      "unggah",
      "dokumen buram",
      "silau",
      "format file",
      "ukuran file",
      "foto ditolak",
      "sering ditolak",
      "kejelasan",
      "foto ktp",
    ],
    source: "SOP AIPEX VeriBot",
    updatedAt: UPDATED,
  },
  {
    id: "tiket-qr",
    category: "aplikasi",
    question: "Bagaimana cara kerja Tiket QR Antrean VeriBot?",
    chipLabel: "🎫 Tiket QR",
    answer:
      "🎫 **Tiket QR Antrean VeriBot:**\n" +
      "• Dokumen kependudukan valid (KTP, KK, KIA, akta, surat pindah) memperoleh tiket QR.\n" +
      "• Skor kejelasan **minimal 70**: label **Diterima - Lolos Pra-Pemeriksaan**.\n" +
      "• Skor **di bawah 70** atau foto buram: label **Diterima - Verifikasi Loket**; QR tetap terbit, dokumen asli tetap diperiksa petugas.\n" +
      "• Bukan dokumen kependudukan: QR tidak diterbitkan.\n\n" +
      "QR ini tiket antrean, bukan bukti dokumen sah. Simpan kode tiket untuk melacak status.",
    keywords: [
      "tiket qr",
      "qr",
      "antre",
      "antrian",
      "fast track",
      "tiket antrean",
      "lolos pra-pemeriksaan",
      "verifikasi loket",
    ],
    source: "SOP AIPEX VeriBot",
    updatedAt: UPDATED,
  },
  {
    id: "cek-tiket",
    category: "aplikasi",
    question: "Bagaimana cara cek status tiket atau kalau lupa kode tiket?",
    answer:
      "🔎 **Cek Status Tiket:**\n" +
      "1. Buka halaman utama AIPEX VeriBot.\n" +
      "2. Masukkan kode tiket pada kolom **Lacak Tiket**, atau pindai QR tiket.\n" +
      "3. Status dan riwayat verifikasi akan tampil.\n\n" +
      "• Jika lupa kode, buka **Riwayat Tiket** di perangkat yang sama (maksimal 5 tiket, tersimpan 30 hari).\n" +
      "• Jika riwayat tidak ada, hubungi loket dengan membawa identitas; petugas tidak akan meminta kata sandi atau kode OTP.",
    keywords: ["cek tiket", "status tiket", "lacak tiket", "lupa kode", "kode tiket", "riwayat tiket", "qr tiket"],
    source: "SOP AIPEX VeriBot",
    updatedAt: UPDATED,
  },
  {
    id: "privasi-pdp",
    category: "privasi",
    question: "Apakah data dan foto saya aman?",
    answer:
      "🛡️ **Perlindungan Data (UU PDP No. 27/2022):**\n" +
      "• Foto KTP/KK disimpan sementara dan terenkripsi di penyimpanan privat.\n" +
      "• Hanya petugas berwenang dan pemilik tiket yang dapat mengakses.\n" +
      "• Foto dihapus otomatis setelah tiket disetujui/ditolak; tiket terbengkalai dihapus maksimal 7 hari.\n" +
      "• Yang tercatat permanen hanya jenis dokumen untuk rekap.\n" +
      "• Jangan pernah mengirim NIK/foto melalui chat yang tidak resmi.",
    keywords: ["privasi", "pdp", "data aman", "data saya aman", "foto saya aman", "hapus data", "keamanan data", "uu pdp"],
    source: PDP,
    updatedAt: UPDATED,
  },
  {
    id: "pengaduan-prioritas",
    category: "layanan",
    question: "Bagaimana cara menyampaikan pengaduan atau mendapat prioritas layanan?",
    answer:
      "📣 **Pengaduan & Prioritas:**\n" +
      "• Sampaikan pengaduan di loket atau melalui kanal resmi kelurahan.\n" +
      "• Sertakan kode tiket, tanggal, dan ringkasan masalah; jangan kirim foto dokumen di chat umum.\n" +
      "• Lansia, penyandang disabilitas, dan ibu hamil dapat meminta prioritas layanan di loket.\n" +
      "• Jika ada permintaan pembayaran tidak resmi, laporkan segera kepada petugas atau pimpinan kelurahan.",
    keywords: ["pengaduan", "komplain", "keluhan", "lapor", "prioritas", "lansia", "disabilitas", "ibu hamil"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "layanan-online",
    category: "layanan",
    question: "Apakah semua layanan bisa dilakukan online atau diwakilkan?",
    answer:
      "💻 **Layanan Online vs Loket:**\n" +
      "• **Online:** pra-pemeriksaan dokumen, OCR, Tiket QR, lacak status, dan informasi persyaratan.\n" +
      "• **Loket:** perekaman biometrik KTP, verifikasi dokumen asli, pengambilan dokumen, dan layanan yang memerlukan tanda tangan.\n" +
      "• Beberapa layanan dapat diwakilkan dengan surat kuasa, kecuali perekaman KTP yang harus dilakukan pemohon sendiri.\n\n" +
      "Mulai dari wizard online; petugas akan menginformasikan jika Anda harus datang.",
    keywords: ["online", "daring", "tanpa datang", "harus datang", "diwakilkan", "bisa diwakilkan", "surat kuasa", "layanan online"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "legalisasi",
    category: "layanan",
    question: "Apakah kelurahan melayani legalisasi dokumen?",
    answer:
      "📑 **Legalisasi Dokumen:**\n" +
      "1. Fotokopi KTP-el dan KK pemohon.\n" +
      "2. Produk layanan asli yang akan dilegalisasi.\n" +
      "3. Maksimal 10 lembar per permohonan.\n\n" +
      "• Tidak dipungut biaya.\n" +
      "• Proses sekitar 2 jam bila berkas lengkap.\n" +
      "• Legalisasi hanya untuk produk layanan kelurahan, bukan semua jenis dokumen.",
    keywords: ["legalisasi", "legalisir", "cap basah", "pengesahan dokumen"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "sptjm",
    category: "sipil",
    question: "Apa itu SPTJM dan kapan diperlukan?",
    answer:
      "📄 **SPTJM (Surat Pernyataan Tanggung Jawab Mutlak):**\n" +
      "• Digunakan ketika dokumen pendukung pencatatan sipil tidak lengkap, misalnya surat kelahiran atau surat kematian tidak tersedia.\n" +
      "• Ditandatangani pemohon dan diketahui petugas; isinya pernyataan kebenaran data.\n" +
      "• Bukan pengganti dokumen palsu dan tidak menghapus kewajiban membawa dokumen yang masih ada.\n\n" +
      "Tanyakan format dan persyaratannya di loket agar tidak salah mengisi.",
    keywords: ["sptjm", "surat pernyataan tanggung jawab mutlak", "dokumen tidak lengkap", "surat lahir tidak ada", "surat kematian tidak ada"],
    source: SOP,
    updatedAt: UPDATED,
  },
  {
    id: "persyaratan-umum",
    category: "layanan",
    question: "Dokumen apa yang sebaiknya disiapkan sebelum ke loket?",
    answer:
      "📋 **Persiapan Sebelum ke Loket:**\n" +
      "1. KTP-el dan Kartu Keluarga (KK).\n" +
      "2. Dokumen pendukung sesuai layanan (akta, buku nikah, ijazah, surat pindah, atau surat kehilangan).\n" +
      "3. Fotokopi dokumen yang diminta.\n" +
      "4. Formulir kelurahan yang sudah diisi bila tersedia.\n\n" +
      "• Bawa dokumen asli untuk verifikasi petugas.\n" +
      "• Cek katalog layanan di beranda untuk daftar yang lebih spesifik.\n" +
      "• Tidak dipungut biaya untuk layanan dasar.",
    keywords: ["persyaratan umum", "dokumen apa", "bawa apa", "sebelum ke loket", "berkas", "persiapan"],
    source: SOP,
    updatedAt: UPDATED,
  },
];

/** Enam FAQ yang tampil sebagai accordion di portal. */
export const FAQ_PORTAL_IDS: readonly string[] = [
  "foto-dokumen",
  "rt-rw",
  "tiket-qr",
  "biaya-layanan",
  "ktp-hilang-rusak",
  "kk",
];

/** Delapan chip pertanyaan cepat di chatbot. */
export const FAQ_CHIP_IDS: readonly string[] = [
  "jam-layanan",
  "ktp-hilang-rusak",
  "kk",
  "kia",
  "akta-kelahiran",
  "surat-pindah",
  "biaya-layanan",
  "tiket-qr",
];

export function getFaqEntry(id: string): FaqEntry | undefined {
  return FAQ_CATALOG.find((entry) => entry.id === id);
}

export function getFaqEntries(ids: readonly string[]): FaqEntry[] {
  return ids.flatMap((id) => {
    const entry = getFaqEntry(id);
    return entry ? [entry] : [];
  });
}
