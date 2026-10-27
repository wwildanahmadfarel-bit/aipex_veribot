# OCR PDF Multi-Halaman — AIPEX VeriBot

Dokumen ini menjelaskan cara kerja pra-pemeriksaan OCR untuk berkas PDF yang berisi beberapa dokumen (mis. KTP, KK, dan akta dalam satu PDF), pemetaan halaman ke syarat layanan, serta aturan pengisian NIK/nama.

## 1. Ringkasan

- PDF **dipecah 100% di browser** memakai `pdf-lib` (`src/lib/pdfSplitter.ts`). File utuh tidak dikirim ke server.
- Setiap halaman dikirim ke `POST /api/ocr` **satu per satu** dan dinilai sendiri-sendiri.
- Hasil tiap halaman disimpan sebagai `PreScreenPage` (`src/types.ts`): gambar halaman, jenis dokumen, skor, status, dan `VerificationResult`.
- Maksimal **5 halaman per pemindaian**. Satu halaman = satu panggilan AI = satu kuota OCR.
- Total PDF maksimal **10 MB**; setiap halaman hasil pecahan maksimal **4,2 MB** (batas server).
- Schema server `/api/ocr` tidak berubah: tetap satu dokumen per request. Penyusunan array halaman dilakukan di client (`src/lib/preScreenPages.ts`).

## 2. Alur OCR

1. Warga memilih JPG/PNG/WEBP/PDF di `OcrPreScreenCard.tsx`.
2. `prepareOcrPages(file)`:
   - PDF: cek ukuran total ≤ 10 MB dan jumlah halaman ≤ 5, lalu pecah per halaman dan cek tiap halaman ≤ 4,2 MB.
   - Gambar: satu halaman, cek ≤ 4,2 MB.
3. Untuk setiap halaman, client memanggil `/api/ocr` (fallback `/api/scan-document` bila 404) secara berurutan.
4. `parseOcrPageResponse` menormalisasi respons:
   - `TIDAK_VALID` / `LAINNYA` = vonis sah → `systemError: false`.
   - Gangguan AI/koneksi/kuota → `systemError: true`.
5. Semua halaman yang selesai ditampilkan sebagai kartu ringkasan. Halaman yang gagal tetap ditampilkan sebagai “Gagal dipindai”, bukan vonis “bukan dokumen”.
6. Dokumen utama dipilih otomatis:
   - KTP valid dengan skor tertinggi; bila tidak ada,
   - halaman valid pertama.
7. Warga dapat memilih halaman lain dan menekan **“Jadikan dokumen utama”**.
8. Tombol lanjut memakai status **dokumen utama**, bukan halaman yang sedang dilihat:
   - Dokumen utama layak → lanjut normal.
   - Dokumen utama valid tetapi buram → tetap lanjut, tiket terbit dengan catatan revisi.
   - Tidak ada halaman layak + ada gangguan sistem → “Coba Pindai Ulang” dan “Lanjut Isi Manual”.
   - Tidak ada halaman layak tanpa gangguan → unggah ulang.

## 3. Bacaan Otomatis (Web Speech API)

- Saat PDF multi-halaman selesai dipindai, aplikasi membacakan **ringkasan semua halaman sekaligus** — bukan hanya halaman yang sedang dilihat.
- Ringkasan menyebut jumlah halaman, jumlah layak/perlu diperiksa, jenis dokumen, status, skor tiap halaman, dokumen utama, serta peringatan bila NIK/nama antar dokumen berbeda.
- Auto-baca hanya dipicu **sekali** setelah pemindaian selesai. Mengganti halaman yang dilihat atau dokumen utama tidak memutar ulang audio; gunakan tombol **“Putar Ulang”** pada panel ringkasan.
- NIK/nama lengkap **tidak dibacakan** demi privasi di ruang publik. Detail lengkap tetap tersedia di banner dan modal “Lihat Detail”.
- Untuk satu halaman, perilaku lama dipertahankan: auto-baca saat dokumen layak, tombol manual untuk dokumen buram.
- Bila browser memblokir autoplay TTS, tombol **“Bacakan Ringkasan”** tetap berfungsi manual.

## 4. Batas dan Kuota

| Aturan | Nilai |
|---|---|
| Halaman maksimal per PDF | 5 |
| Ukuran total PDF | 10 MB |
| Ukuran satu halaman / gambar | 4,2 MB |
| Kuota per halaman | 1 panggilan OCR |
| Contoh 3 halaman | 3 panggilan / 3 kuota |

Kuota OCR tidak berubah: client `QUOTA_MAX=100` (advisory), server default `OCR_10MIN=20/10 menit` dan `OCR_DAY_GLOBAL=300/hari`, dapat dioverride environment. Bila kuota habis di tengah PDF, halaman yang sudah selesai tetap ditampilkan; halaman berikutnya ditandai gagal.

## 5. Pemetaan Halaman ke Wizard

Helper di `src/lib/preScreenPages.ts`:

- `buildDefaultAssignments(pages, requirements, preferredMainIndex?)`
  - Prioritas dokumen utama: halaman pilihan pengguna (mis. tombol “Jadikan dokumen utama”) → halaman yang cocok syarat utama → KTP valid skor tertinggi → halaman valid pertama.
  - Pemetaan ulang otomatis saat ganti layanan tidak mengirim `preferredMainIndex`, sehingga urutan di atas mulai dari syarat layanan baru.
  - Lampiran dipetakan ke `requirements[1..N]` berdasarkan jenis dokumen.
- `assignmentsToUploads(pages, requirements, assignments)`
  - `main` → `docImageBase64` + `docImageName`.
  - `support slot 1..N` → `supportFiles[slot - 1]` (slot wizard 0-based).
  - Slot lampiran yang tidak terisi tetap kosong agar urutan syarat tidak bergeser.

Di `InteractiveWizard.tsx`:

- Panel **“Pemetaan N halaman dokumen”** muncul di Langkah 2 bila ada lebih dari satu halaman.
- Setiap halaman bisa diubah menjadi:
  - Dokumen utama,
  - Lampiran 1..N sesuai judul syarat layanan,
  - Tidak dipakai.
- Halaman `TIDAK_VALID`/gangguan sistem tidak bisa dipetakan; hanya “Tidak dipakai”.
- Mengganti layanan di Langkah 1 akan **memetakan ulang tanpa memindai ulang**.
- Mengganti berkas secara manual (upload/ganti/hapus) melepas pemetaan otomatis agar tidak ada slot basi.

## 6. Aturan NIK/Nama Pemohon

- NIK/nama diisi dari **dokumen utama** yang dipilih.
- Nilai yang sudah diketik manual tidak ditimpa saat pemetaan berubah, kecuali masih sama dengan identitas dokumen utama sebelumnya.
- Peringatan konteks ditampilkan untuk:
  - **KK:** NIK bisa milik kepala keluarga, bukan pemohon.
  - **Akta kelahiran/KIA:** data milik anak; pemohon bisa orang tua.
  - **Akta perkawinan:** ada dua pasangan; pastikan data pemohon.
  - **Akta kematian:** data milik almarhum/almarhumah.
- **Akta kematian tidak pernah mengisi NIK/nama pemohon secara otomatis**, baik dari akta maupun dari KTP almarhum yang ikut dipindai. Petugas/warga mengisi data pemohon (keluarga) secara manual.
- NIK parsial tidak diteruskan ke wizard; wizard hanya menerima NIK 16 digit utuh atau kosong.
- Jenis layanan Akta Kematian / Akta Perkawinan / Surat Pindah membuat NIK opsional di Langkah 1.

## 7. Penanganan Gangguan

| Kondisi | Perilaku |
|---|---|
| PDF > 5 halaman | Ditolak sebelum OCR dengan pesan jumlah halaman |
| PDF > 10 MB | Ditolak sebelum dipecah |
| Satu halaman > 4,2 MB | Halaman ditolak dengan pesan kompres |
| Satu halaman gagal AI setelah retry | Halaman ditandai “Gagal dipindai”; pindaian berhenti agar tidak membuang kuota, sisa halaman ditandai belum dipindai |
| Respons satu halaman tidak valid | Halaman ditandai gagal; halaman lain tetap diproses |
| Kuota/rate limit | Pindaian berhenti; halaman selesai tetap tampil; sisa halaman ditandai belum dipindai |
| AI gangguan total (1 halaman) | Opsi pindai ulang + isi manual |
| Halaman invalid | Tidak memblokir selama dokumen utama valid |
| Tidak ada halaman valid | Unggah ulang; tidak ada tombol lanjut |

## 8. Batasan yang Disengaja

- Satu halaman berisi **beberapa dokumen** tidak dipisah otomatis. Pemetaan hanya per halaman.
- Wizard “Satu PDF Gabungan” (mode upload terpisah) belum memakai OCR multi-halaman; alur ini khusus pra-pemeriksaan di beranda.
- Tiket hanya menyimpan **nama** lampiran (`lampiranNames`), bukan isi file KK/akta. Isi file diproses di memori dan tidak disimpan permanen.
- Tidak ada penyimpanan hasil OCR ke database; hasil hanya hidup di state browser sampai wizard/tiket selesai.

## 9. File Terkait

| File | Peran |
|---|---|
| `src/lib/preScreenPages.ts` | Pemecahan halaman, normalisasi OCR, pemilihan utama, pemetaan slot |
| `src/lib/pdfSplitter.ts` | Pecah PDF di browser + batas halaman |
| `src/components/OcrPreScreenCard.tsx` | UI scan, kartu per halaman, pilih dokumen utama |
| `src/components/InteractiveWizard.tsx` | Panel koreksi pemetaan, isi `docImageBase64`/`supportFiles`, aturan NIK/nama |
| `src/types.ts` | `PreScreenPage`, `PreScreenInitialData.pages`, `mainPageIndex` |
| `api/_lib/ocr-handler.ts` | Handler OCR satu dokumen (tidak diubah) |

## 10. Uji Manual

Gunakan `Untitled design (5).pdf` (3 halaman: KTP, akta kelahiran, KK).

1. Unggah PDF → muncul 3 kartu halaman; KTP menjadi dokumen utama. Auto-baca harus menyebut **KTP, Akta Kelahiran, dan Kartu Keluarga**, bukan hanya halaman yang sedang dilihat.
2. Klik halaman KK → tombol “Jadikan dokumen utama” → ringkasan berubah; audio **tidak** otomatis diputar ulang. Tekan “Putar Ulang” untuk mendengar dokumen utama yang baru.
3. Lanjut ke wizard → pilih layanan KTP → mapping KTP/KK/Akta benar.
4. Ganti layanan ke KIA → mapping otomatis berubah tanpa scan ulang.
5. Ubah satu halaman menjadi “Tidak dipakai” → slot lampiran kosong, urutan slot lain tetap.
6. Uji halaman invalid di tengah PDF → halaman lain tetap bisa lanjut.
7. Uji PDF 6 halaman → ditolak sebelum OCR.
8. Uji kuota habis di halaman ke-2 → halaman 1 tetap tampil; halaman 2 ditandai gagal.
9. Uji “Pindai Ulang” → state halaman dan pilihan utama kembali kosong.
10. Uji akta kematian → NIK/nama tidak terisi otomatis.

## 11. Uji Responsif Mobile

- Viewport yang diuji: 320, 360, 390, 414, dan 768px.
- Tidak boleh ada overflow horizontal (`document.documentElement.scrollWidth === window.innerWidth`).
- Label stepper wizard tidak boleh terpotong; gunakan label pendek tanpa nomor karena nomor sudah ada di badge.
- Select pemetaan minimal 40px, tombol aksi pemetaan minimal 36–40px.
- Uji di build produksi lokal (`npm run build` + `npm run preview`) dan preview Vercel setelah deploy.
