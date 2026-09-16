import { ServiceCatalogItem } from "../types";

export const catalogServices: ServiceCatalogItem[] = [
  {
    id: "ktp-el",
    title: "Penerbitan KTP-EL Baru / Penggantian",
    category: "identitas",
    badge: "PALING SERING",
    badgeType: "primary",
    iconName: "badge",
    description: "Penerbitan KTP Elektronik baru usia 17 tahun atau penggantian hilang/rusak.",
    requirements: [
      {
        title: "Foto KTP-EL Lama (Jika Rusak) / Surat Kehilangan",
        description: "Bawa fisik KTP asli lama atau surat kehilangan kepolisian bila hilang.",
        mandatory: true,
      },
      {
        title: "Kartu Keluarga (KK) Asli",
        description: "Barcode TTE Ditjen Dukcapil masih dapat terpindai jelas.",
        mandatory: true,
      },
      {
        title: "Surat Pengantar RT/RW",
        description: "Opsional jika sudah sinkron di Dukcapil (Perpres 96/2018).",
        mandatory: false,
      },
    ],
  },
  {
    id: "kia",
    title: "Kartu Identitas Anak (KIA)",
    category: "identitas",
    badge: "PALING SERING",
    badgeType: "primary",
    iconName: "child_care",
    description: "Penerbitan identitas resmi anak usia 0 hingga 17 tahun kurang satu hari.",
    requirements: [
      {
        title: "Kutipan Akta Kelahiran Anak",
        description: "Asli atau salinan legalisir resmi Dukcapil.",
        mandatory: true,
      },
      {
        title: "Kartu Keluarga Orang Tua",
        description: "Anak tercatat resmi dalam susunan keluarga.",
        mandatory: true,
      },
      {
        title: "Pasfoto Anak 3x4 (2 Lembar)",
        description: "Wajib untuk anak di atas 5 tahun (latar biru/merah sesuai tahun kelahiran).",
        mandatory: true,
      },
    ],
  },
  {
    id: "ikd",
    title: "Aktivasi Identitas Digital (IKD)",
    category: "identitas",
    badge: "RESMI",
    badgeType: "tertiary",
    iconName: "fingerprint",
    description: "Pendaftaran dan aktivasi KTP Digital pada smartphone warga Sukamaju.",
    requirements: [
      {
        title: "Sudah Melakukan Perekaman KTP-EL Fisik",
        description: "Data biometrik telah aktif di pusat data Dukcapil.",
        mandatory: true,
      },
      {
        title: "Smartphone Android / iOS & Email Aktif",
        description: "Untuk instalasi aplikasi resmi IKD Kemendagri.",
        mandatory: true,
      },
      {
        title: "Verifikasi Wajah / Pindai QR Petugas",
        description: "Dilakukan langsung di hadapan verifikator loket kelurahan.",
        mandatory: true,
      },
    ],
  },
  {
    id: "akta-kematian",
    title: "Akta Kematian",
    category: "sipil",
    badge: "DUKA CITA",
    badgeType: "error",
    iconName: "nature_people",
    description: "Pencatatan dan penerbitan akta kematian bagi warga yang telah berpulang.",
    requirements: [
      {
        title: "Surat Kematian dari RS / Puskesmas / Kelurahan",
        description: "Ditandatangani dokter pemeriksa atau pejabat lingkungan.",
        mandatory: true,
      },
      {
        title: "KTP-EL & KK Asli Almarhum/Almarhumah",
        description: "Untuk penghapusan data penduduk dan penerbitan KK baru.",
        mandatory: true,
      },
      {
        title: "KTP Dua Orang Saksi",
        description: "Saksi yang mengetahui peristiwa kematian.",
        mandatory: true,
      },
    ],
  },
  {
    id: "akta-perkawinan",
    title: "Akta Perkawinan",
    category: "sipil",
    badge: "PERNIKAHAN",
    badgeType: "secondary",
    iconName: "favorite",
    description: "Pencatatan sipil perkawinan untuk non-Muslim pasca pemberkahan.",
    requirements: [
      {
        title: "Surat Pemberkatan Nikah dari Pemuka Agama",
        description: "Gereja, Wihara, Pura, atau Klenteng yang sah.",
        mandatory: true,
      },
      {
        title: "KTP-EL & KK Kedua Mempelai",
        description: "Disertai KTP-EL kedua orang tua masing-masing.",
        mandatory: true,
      },
      {
        title: "Pasfoto Berdampingan 4x6 (4 Lembar)",
        description: "Latar belakang merah atau biru.",
        mandatory: true,
      },
    ],
  },
  {
    id: "skpwni",
    title: "Surat Pindah (SKPWNI)",
    category: "perpindahan",
    badge: "PINDAH",
    badgeType: "primary",
    iconName: "local_shipping",
    description: "Surat keterangan pindah WNI antar kelurahan, kecamatan, atau luar kota.",
    requirements: [
      {
        title: "Kartu Keluarga (KK) Asli",
        description: "Dokumen asli diserahkan saat proses pencabutan data domisili.",
        mandatory: true,
      },
      {
        title: "KTP-EL Anggota Keluarga yang Pindah",
        description: "Seluruh anggota yang turut berpindah alamat.",
        mandatory: true,
      },
      {
        title: "Formulir Permohonan Pindah (F-1.08)",
        description: "Dilengkapi alamat tujuan lengkap dengan kode pos.",
        mandatory: true,
      },
    ],
  },
  {
    id: "sinkron-nik",
    title: "Konsolidasi / Sinkronisasi NIK",
    category: "perpindahan",
    badge: "DUKCAPIL",
    badgeType: "tertiary",
    iconName: "sync_alt",
    description: "Mengatasi NIK tidak terdeteksi di BPJS, perbankan, atau layanan publik.",
    requirements: [
      {
        title: "Foto Fisik KTP-EL & Kartu Keluarga",
        description: "Pastikan nomor 16 digit NIK dan No. KK terlihat jelas.",
        mandatory: true,
      },
      {
        title: "Tangkapan Layar Kendala (Screenshot)",
        description: "Bukti pesan 'NIK Tidak Ditemukan' dari aplikasi perbankan/BPJS.",
        mandatory: true,
      },
      {
        title: "Nomor WhatsApp Pemohon",
        description: "Untuk konfirmasi status update server pusat Ditjen Dukcapil (1x24 Jam).",
        mandatory: true,
      },
    ],
  },
  {
    id: "sku",
    title: "Surat Keterangan Usaha (SKU)",
    category: "perpindahan",
    badge: "USAHA",
    badgeType: "secondary",
    iconName: "store",
    description: "Surat keterangan pengantar usaha warga untuk legalitas & pinjaman perbankan.",
    requirements: [
      {
        title: "KTP-EL & Kartu Keluarga Pemohon",
        description: "Warga berdomisili di Kelurahan Sukamaju.",
        mandatory: true,
      },
      {
        title: "Surat Pengantar RT & RW Setempat",
        description: "Menyatakan keberadaan fisik tempat usaha di wilayah terkait.",
        mandatory: true,
      },
      {
        title: "Foto Dokumentasi Lokasi Usaha",
        description: "Foto tampak depan tempat usaha / aktivitas produksi.",
        mandatory: true,
      },
    ],
  },
];
