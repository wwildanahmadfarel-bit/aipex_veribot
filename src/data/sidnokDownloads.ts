import type { ServiceDownload } from "../types";

/**
 * Formulir resmi SIDNOK yang disalin ke public/berkas/sidnok agar dapat
 * diunduh langsung dari website. Semua formulir bersifat kondisional —
 * bukan slot upload wajib.
 */
export const sidnokForms = {
  sptjmKelahiran: {
    code: "1656900691",
    title: "SPTJM Kebenaran Data Kelahiran",
    condition: "Unduh jika tidak memiliki surat keterangan kelahiran.",
    size: "410,47 KB",
    file: "/berkas/sidnok/sptjm-data-kelahiran.pdf",
    fileName: "SPTJM-Kebenaran-Data-Kelahiran.pdf",
  },
  spAnakIbu: {
    code: "1656899722",
    title: "SP Anak Ibu",
    condition: "Unduh jika anak lahir di luar nikah.",
    size: "238,90 KB",
    file: "/berkas/sidnok/sp-anak-ibu.pdf",
    fileName: "SP-Anak-Ibu.pdf",
  },
  sptjmPasanganSuamiIstri: {
    code: "1656902490",
    title: "SPTJM Kebenaran sebagai Pasangan Suami Istri",
    condition: "Unduh khusus untuk kelahiran sebelum tahun 1975.",
    size: "25,19 KB",
    file: "/berkas/sidnok/sptjm-pasangan-suami-istri.pdf",
    fileName: "SPTJM-Pasangan-Suami-Istri.pdf",
  },
  sptjmKematian: {
    code: "1720769569",
    title: "SPTJM Kebenaran Data Kematian",
    condition: "Unduh jika kematian belum tercatat atau tidak ada surat keterangan kematian.",
    size: "72,17 KB",
    file: "/berkas/sidnok/sptjm-data-kematian.pdf",
    fileName: "SPTJM-Kebenaran-Data-Kematian.pdf",
  },
  sptjmPerkawinanPerceraian: {
    code: "1656904002",
    title: "SPTJM Perkawinan/Perceraian Belum Tercatat",
    condition: "Unduh jika tidak dapat melampirkan akta perkawinan/perceraian.",
    size: "722,35 KB",
    file: "/berkas/sidnok/sptjm-perkawinan-perceraian-belum-tercatat.pdf",
    fileName: "SPTJM-Perkawinan-Perceraian-Belum-Tercatat.pdf",
  },
  spAktaKawinDikuasaiPihakLain: {
    code: "1770885383",
    title: "SP Akta Kawin Dikuasai Pihak Lain",
    condition: "Unduh jika akta kawin dikuasai oleh pihak lain.",
    size: "184,92 KB",
    file: "/berkas/sidnok/sp-akta-kawin-dikuasai-pihak-lain.pdf",
    fileName: "SP-Akta-Kawin-Dikuasai-Pihak-Lain.pdf",
  },
  spAlamatAdminduk: {
    code: "1740727423",
    title: "SP Alamat Digunakan dalam Adminduk",
    condition: "Unduh jika alamat tujuan menggunakan alamat kontrak.",
    size: "19,66 KB",
    file: "/berkas/sidnok/sp-alamat-adminduk.pdf",
    fileName: "SP-Alamat-Digunakan-dalam-Adminduk.pdf",
  },
  spTidakKeberatanNumpangKk: {
    code: "1740727518",
    title: "SP Tidak Keberatan Numpang KK",
    condition: "Unduh jika masuk ke KK induk pemilik rumah.",
    size: "132,64 KB",
    file: "/berkas/sidnok/sp-tidak-keberatan-numpang-kk.pdf",
    fileName: "SP-Tidak-Keberatan-Numpang-KK.pdf",
  },
  spAlamatRumahSendiri: {
    code: "1740727896",
    title: "SP Alamat Menggunakan Alamat Rumah Sendiri",
    condition: "Unduh jika alamat tujuan adalah rumah sendiri.",
    size: "198,95 KB",
    file: "/berkas/sidnok/sp-alamat-rumah-sendiri.pdf",
    fileName: "SP-Alamat-Menggunakan-Alamat-Rumah-Sendiri.pdf",
  },
} satisfies Record<string, ServiceDownload>;
