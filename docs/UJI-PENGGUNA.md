# Uji Pengguna AIPEX VeriBot — Batch ycwc-001

> Dokumen evidence untuk kompetisi internasional (YCWC 2026 — AI For Daily Life).
> Prinsip: kutipan mentah → perubahan UI konkret → keterbatasan jujur.

## 1. Tujuan
Memastikan warga (termasuk lansia) bisa menyelesaikan pra-pemeriksaan dokumen tanpa bantuan petugas, dan memvalidasi klaim akurasi OCR dengan foto asli.

## 2. Profil Partisipan (inisial saja, tanpa NIK — UU PDP)
| ID | Profil | Device | Tanggal | Durasi wizard |
|----|--------|--------|---------|---------------|
| P01 | Lansia 62th, HP entry-level | Android RAM 3GB | - | - |
| P02 | Kader RT | Android mid | - | - |
| P03 | Ibu rumah tangga | Laptop | - | - |
| P04 | ... | ... | - | - |
| P05 | ... | ... | - | - |

## 3. Skenario Tugas
1. Upload KTP tajam → catat skor + waktu hingga QR terbit.
2. Upload KTP buram/silau → apakah mengerti instruksi foto ulang?
3. Lacak tiket via kode → apakah timeline jelas?
4. Tanya chatbot "Syarat KTP hilang?" → apakah jawaban membantu?

## 4. Temuan Mentah → Perubahan UI (wajib diisi, minimal 3)
| Kutipan warga | Skor sulit (1-5) | Perubahan UI | File yang diubah |
|---------------|------------------|--------------|------------------|
| "Tombol Lanjut kekecilan" (P01) | 4 | Tombol diperbesar 14→18px, target sentuh 44px | `InteractiveWizard.tsx` |
| ... | ... | ... | ... |

## 5. Keterbatasan (jujur — nilai juri)
- Belum uji tunanetra total / pembaca layar penuh.
- Belum uji formal bersama GERKATIN (baru warga sekitar + surat RT).
- Dataset 100 foto dari 1 kelurahan, belum mewakili variasi nasional.

## 6. Lampiran (fisik, tidak di repo)
- `private/consent/P01..P07.pdf` — lembar persetujuan (tujuan: uji akurasi YCWC, simpan terenkripsi 14 hari di bucket privat `eval-fotos`, boleh tarik kapan pun).
- `private/consent/surat-RT.pdf` — stempel saksi RT/RW.
- Foto proses (tangan + HP, wajah blur) — maksimal 5, tanpa NIK terbaca.

## 7. Jejak Audit
- Batch: `ycwc-001` | Retensi eval: 14 hari | Tanggal purge terjadwal: ____
- Operator ber-JWT: ____ (inisial saja)
- Hasil agregat: lihat `docs/METRIK-TRANSPARANSI.md` + halaman `/transparansi` (Tier-1 publik).
