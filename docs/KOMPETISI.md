# AIPEX VeriBot — Layanan Pra-Pemeriksaan Administrasi Kelurahan Berbasis AI

> **Tagline:** Cek & validasi berkas kependudukan dari rumah, sekali datang ke loket langsung beres tanpa antre bolak-balik.
>
> **Demo hidup:** https://aipexveribot.vercel.app | **Stack:** React 19 + Vite, Vercel Serverless Functions, Google Gemini + Nara Router AI, Supabase (Postgres + Storage), Upstash Redis
>
> *Materi display board kompetisi — Bahasa Indonesia, disusun untuk juri dan investor.*

---

## 1. Project Description

### Masalah
Warga kelurahan sering **ditolak di loket** karena berkas tidak memenuhi syarat: foto KTP buram, NIK tidak terbaca, dokumen salah jenis, atau syarat tidak lengkap. Akibatnya: antre ulang, formulir kertas diisi berkali-kali, petugas terbebani verifikasi manual, dan kepercayaan terhadap layanan digital menurun.

### Solusi
**AIPEX VeriBot** adalah portal layanan mandiri 24 jam untuk Kelurahan Sukamaju yang melakukan **pra-pemeriksaan berkas dengan AI Vision sebelum warga datang ke loket**:

1. Warga mengunggah foto e-KTP / KK / Akta dari HP — AI menilai kejelasan (skor 0–100), mengekstrak NIK 16 digit, dan menentukan status `BERHASIL / BURAM / TIDAK_VALID`.
2. Dokumen yang valid **otomatis menerbitkan Tiket QR Fast-Track** — di loket cukup pindai QR, tanpa antre manual dan tanpa isi formulir kertas ulang.
3. Dokumen buram tetap dapat tiket (status revisi) dengan instruksi foto ulang / bawa fisik — warga tidak pernah jalan buntu.
4. Asisten chat **VeriBot AI** menjawab syarat layanan 24 jam, dengan 4 lapis fallback sehingga tidak pernah menampilkan error ke warga.
5. Petugas memutus tiket di dashboard (setuju/tolak/perlu perbaikan) dengan notifikasi WhatsApp otomatis dan arsip foto terenkripsi yang ter-purge otomatis.

### Target Pengguna
| Pengguna | Manfaat |
|---|---|
| Warga | Tahu berkasnya lolos sebelum berangkat; antre prioritas via QR |
| Petugas loket | Verifikasi awal sudah dikerjakan AI; fokus memutus, bukan mengetik ulang |
| Kelurahan / investor | Layanan terreplikasi ke kelurahan lain; biaya AI terkendali (cache + rate-limit); patuh UU PDP |

### Kepatuhan Privasi (UU PDP No. 27/2022)
Foto dokumen **tidak pernah disimpan permanen**: diproses di memori, disalin terenkripsi AES-256-GCM per-tiket ke bucket privat hanya sementara, lalu **dihapus seketika tiket diputus** (atau maksimal 7 hari oleh sweeper cron). Yang tercatat permanen hanya jenis dokumen dan metadata rekap.

---

## 2. Key Features

### F1 — Scan OCR AI Vision (KTP / KK / Akta)
- **Manfaat:** vonis kualitas foto dalam hitungan detik, bukan di loket.
- **Cara kerja:** `POST /api/ocr` (utama) → fallback `/api/scan-document`; AI mengembalikan JSON `nik, nama, jenis_dokumen, skor_kejelasan, status_verifikasi, catatan`; backend menormalisasi silang (skor < 70 tidak boleh `BERHASIL`, `LAINNYA` selalu `TIDAK_VALID`).
- **Lokasi:** `api/_lib/ocr-handler.ts`, `src/components/DocumentScanner.tsx`, `src/components/OcrPreScreenCard.tsx`

### F2 — Tiket QR Fast-Track Otomatis
- **Manfaat:** satu pindai valid = satu antrean prioritas; menghilangkan formulir kertas.
- **Cara kerja:** setiap dokumen valid (`BERHASIL` maupun `BURAM`) diterbitkan `TKT-xxxxxx`, disimpan ke Supabase, QR dirender dari teks tiket; pelacakan via `GET /api/tickets/:kode`.
- **Lokasi:** `api/_lib/ocr-handler.ts:454-592`, `api/tickets.ts`, `src/lib/ticketQr.ts`

### F3 — Chatbot VeriBot AI 24 Jam (Anti-Mati)
- **Manfaat:** warga bertanya syarat KTP/KK/KIA/Akta, jam loket, dan Fast-Track kapan pun.
- **Cara kerja:** rantai 4 lapis — Nara Router → Gemini (2 model) → knowledge-base offline → emergency fallback; selalu `HTTP 200 + jawaban`, tidak pernah error.
- **Lokasi:** `api/chat-faq.ts`, `src/components/FloatingVeriBot.tsx`

### F4 — Dashboard Petugas + Auth JWT + Notifikasi WA
- **Manfaat:** keputusan tercatat, warga otomatis diberi tahu via WhatsApp.
- **Cara kerja:** login **username + password** (scrypt) → access JWT HS256 8 jam + refresh cookie HttpOnly yang bisa dicabut; semua `/api/admin/*` wajib Bearer; `PATCH` status mengirim WA Fonnte — **gagal WA = status di-rollback** (mode ketat).
- **Lokasi:** `api/admin/auth.ts`, `api/_lib/officer-service.ts`, `api/_lib/officer-http.ts`, `api/_lib/officer-auth.ts`, `src/lib/officerAuth.ts`, `api/admin/tickets.ts`, `api/_lib/wa.ts`, `src/components/AdminDashboard.tsx`
- **Panduan:** [`docs/AUTH-PETUGAS.md`](./AUTH-PETUGAS.md)

### F5 — Anti-Spam Hemat Token AI
- **Manfaat:** tagihan AI tidak jebol diserang bot; warga jujur tidak kena getahnya.
- **Cara kerja (5 lapis, termurah dulu):** honeypot + dwell-time → captcha adaptif → rate-limit terpusat Upstash Redis (`20x/10 mnt/IP, 20x/hari/IP, 300x/hari global`) → validasi magic-bytes/dimensi → dedup hash SHA-256 + cache hasil 24 jam (file sama = nol token).
- **Lokasi:** `api/_lib/rate-limit.ts`, `api/_lib/file-guard.ts`, `api/_lib/ocr-cache.ts`, `src/lib/antiSpam.ts`

### F6 — Arsip Foto Sementara Terenkripsi + Sweeper
- **Manfaat:** petugas bisa melihat bukti foto saat memutus, lalu bukti lenyap otomatis.
- **Cara kerja:** kunci per-tiket `HMAC(master, kode_tiket)`, enkripsi AES-256-GCM + IV acak, upload ke bucket privat `tiket-fotos`; cron harian menghapus foto tiket terbengkalai.
- **Lokasi:** `api/_lib/tiket-foto.ts`, `api/cron/purge-tiket-foto.ts`, `api/tickets/foto.ts`

### F7 — Evaluasi Foto Asli + Transparansi Hibrida (batch ycwc-001)
- **Manfaat:** klaim akurasi berdasar 100 foto asli warga (bukan dummy) dengan privasi terjaga — bukti Research & Evidence untuk juri.
- **Cara kerja:** foto + label lokal di `eval/private/` + `eval/labels.csv` di-ingest via `scripts/evaluate-eval-bucket.py --ingest` (atau upload satuan via `POST /api/eval/upload` dengan JWT petugas) → enkripsi AES-256-GCM (`EVAL_MASTER_KEY` terpisah) → bucket privat `eval-fotos` (tanpa policy, hanya service_role); evaluasi memakai pipeline OCR yang sama dengan warga (NIK di-mask); `--publish` menulis agregat ke `eval_runs` + vonis per-file ke `eval_predictions`; publik hanya agregat di `GET /api/eval/results` → halaman `/transparansi` Tier-1; detail per-file tanpa foto di `GET /api/eval/detail` (JWT); purge hari ke-14 via `DELETE /api/eval/batch` + cron `purge-eval-fotos`.
- **Lokasi:** `supabase/migrations/20261015_eval_fotos.sql`, `supabase/migrations/20261026_eval_jenis_7.sql`, `api/_lib/eval-foto.ts`, `api/eval/*.ts`, `api/cron/purge-eval-fotos.ts`, `scripts/evaluate-eval-bucket.py`, `scripts/generate-demo-eval.py`, `src/components/TransparencyPage.tsx`, `docs/UJI-PENGGUNA.md`, `docs/METRIK-TRANSPARANSI.md`
- **Mode demo:** 6 gambar sintetis di batch `demo-001` (`scripts/generate-demo-eval.py`), dibuka di `/transparansi?batch=demo-001` dengan badge DEMO. Metrik demo terpisah dan tidak boleh diklaim sebagai hasil `ycwc-001`.

---

## 3. The Code — Kode Paling Inti + Lokasi Screenshot

> Semua path relatif dari root repo. Buka file → arahkan ke baris → screenshot untuk display board.

### 3.1 Otak OCR — System Prompt AI Vision
**Lokasi:** `api/_lib/ocr-handler.ts:36-69` — screenshot blok `OCR_SYSTEM`

```ts
const OCR_SYSTEM = `Anda adalah sistem AI Vision OCR profesional yang dikhususkan untuk menganalisis dan memverifikasi dokumen kependudukan resmi Indonesia (e-KTP, Kartu Keluarga / KK, dan Akta Kelahiran).

Tugas utama Anda:
1. Identifikasi Jenis Dokumen (wajib tepat):
   - "KTP": e-KTP ... ada tulisan "NIK" 16 digit ... "KARTU TANDA PENDUDUK" / "e-KTP".
   - "KK": Kartu Keluarga.  - "AKTA": Akta Kelahiran.
   - "LAINNYA": WAJIB dipakai jika gambar BUKAN salah satu dari ketiga dokumen di atas ...
2. Ekstraksi Data Utama: NIK 16 digit ... Nama pemilik dokumen ...
3. Evaluasi Kualitas Fisik: blur, silau/glare, sudut terpotong.
4. Skor Kejelasan (0-100): 80-100 tajam ... 0-25 bukan dokumen (wajib rendah).
5. Status Verifikasi: "BERHASIL" (>= 70) | "BURAM" (asli tapi < 70) | "TIDAK_VALID" (wajib bila "LAINNYA").
6. Catatan: BURAM = 1 kalimat saran konkret; TIDAK_VALID wajib diawali "File bukan Kartu Kependudukan Indonesia."

PENTING: Jawab HANYA dengan JSON valid memakai key: nik, nama, jenis_dokumen, skor_kejelasan, status_verifikasi, catatan.`;
```

**Kenapa inti:** satu prompt mengendalikan klasifikasi, ekstraksi NIK, penilaian kualitas, dan format output — fondasi seluruh vonis AI.

### 3.2 Alur `handleOcr` — AI Mahal Dipanggil Paling Akhir
**Lokasi:** `api/_lib/ocr-handler.ts:95-120` (tanda tangan + gerbang anti-spam) dan `api/_lib/ocr-handler.ts:252-308` (dual-AI)

```ts
export async function handleOcr(req: any, res: any) {
  const { fileBytes, mimeType, bodyFields } = await extractImage(req);
  // L1 honeypot + dwell-time → L2 captcha adaptif → L3 rate-limit
  //   → L4 file-guard (magic-bytes) → L5 dedup cache SHA-256
  // ...
  // Prioritas 1: Gemini (mendukung gambar + PDF)
  if (!responseText && client) {
    for (const modelName of ["gemini-2.5-flash", "gemini-3.6-flash"]) { ... }
  }
  // Prioritas 2 (cadangan): nara-route — hanya image
  if (!responseText && naraConfigured && !isPdf) {
    responseText = await visionViaNaraRoute({ apiKey: naraApiKey, systemPrompt: OCR_SYSTEM, ... });
  }
  if (!skipAi && !responseText) {
    const aiFail = classifyAiFailure(lastAiError);   // TIDAK PERNAH vonis "bukan KTP" saat AI gagal
    return res.status(502).json({ success: false, isSystemError: true, ... });
  }
```

**Kenapa inti:** menunjukkan disiplin biaya (5 gerbang murah sebelum token terbakar) dan kejujuran kegagalan (AI down = `502` sistem, bukan vonis dokumen).

### 3.3 Penerbitan Tiket + QR
**Lokasi:** `api/_lib/ocr-handler.ts:454-592` — screenshot `kodeTiket` → `supabase.insert` → `completeTicketResponse`

```ts
const kodeTiket = `TKT-${Date.now().toString().slice(-6)}`;
const finalStatus = isBerhasil ? "BERHASIL" : "BURAM";
const dbPayload = { kode_tiket: kodeTiket, nik: parsed.nik || "0000000000000000",
  nama: parsed.nama || "Tidak Terdeteksi", jenis_dokumen, skor_kejelasan, status_verifikasi: finalStatus, catatan: finalCatatan };
if (supabase) { /* insert + fallback kolom phone + sembuhkan baris lama NIK sama */ }
// ... arsip foto terenkripsi (best-effort, tiket tetap valid bila gagal) ...
return res.json({ success: true, needsRephoto: !isBerhasil, ticket: completeTicketResponse, ... });
```

### 3.4 Chatbot 4 Lapis Fallback
**Lokasi:** `api/chat-faq.ts:89-133` — screenshot rantai fallback (paling menarik untuk investor)

```ts
if (isNaraConfigured(naraApiKey)) {           // lapis 1: Nara Router
  try { const reply = await chatCompletionViaNaraRoute({...});
    if (reply) return res.json({ success: true, reply, source: "nara-route" });
  } catch { /* lanjut */ }
}
if (client) {                                  // lapis 2: Gemini (2 model)
  for (const modelName of ["gemini-3.6-flash", "gemini-2.5-flash"]) { ... }
}
return res.json({ success: true, reply: getOfflineFaqAnswer(message), source: "knowledge-base" }); // lapis 3
} catch { return res.json({ ..., reply: "...loket buka Senin-Kamis...", source: "emergency-fallback" }); } // lapis 4
```

### 3.5 Frontend — Satu Klik, Fallback Cerdas
**Lokasi:** `src/components/DocumentScanner.tsx:128-148` dan `src/components/FloatingVeriBot.tsx:42-46`

```ts
const postOnce = (url: string) => fetch(url, { method: "POST", body: formData });
res = await postOnce("/api/ocr");                                    // utama
if (res.status === 404 || res.status >= 500)                         // cadangan HANYA untuk 404/5xx
  res = await postOnce("/api/scan-document");                        // (4xx tidak diulang: hemat kuota)
```

### 3.6 Fondasi Operasional (slide kecil, 3 screenshot mini)
| Screenshot | Lokasi | Isi |
|---|---|---|
| Rate-limit | `api/_lib/rate-limit.ts:14-21` | `OCR 20/10 mnt, 20/hari/IP, 300 global` + Redis terpusat |
| Enkripsi foto | `api/_lib/tiket-foto.ts:47-78` | `HMAC(master, kode)` → AES-256-GCM + IV acak → bucket privat |
| Config deploy | `vercel.json:1-19` + `api/health.ts:1-4` | functions, rewrites, cron; import `.js` (fix `ERR_MODULE_NOT_FOUND` ESM Vercel) |

### 3.7 Peta Endpoint (arsitektur 1 slide)
| Endpoint | File | Fungsi |
|---|---|---|
| `POST /api/ocr`, `POST /api/scan-document` | `api/ocr.ts`, `api/scan-document.ts` → `api/_lib/ocr-handler.ts` | Scan Vision + tiket otomatis |
| `POST /api/chat-faq` | `api/chat-faq.ts` | Chatbot FAQ 4 lapis |
| `POST /api/tickets`, `GET /api/tickets/:kode` | `api/tickets.ts`, `api/tickets/[id].ts` | Tiket publik (pelacakan per kode; daftar massal ditutup) |
| `POST /api/admin/login`, `GET/PATCH /api/admin/tickets` | `api/admin/*.ts` | Login JWT + putusan + WA |
| `GET /api/tickets/foto` | `api/tickets/foto.ts` | Proksi foto terdekripsi (no-store) |
| `GET /api/health`, `GET /api/providers` | `api/health.ts`, `api/providers.ts` | Diagnosis + status AI |
| `GET /api/cron/purge-tiket-foto` | `api/cron/purge-tiket-foto.ts` | Sweeper harian (cron) |
| Dev lokal | `server.ts` | Express + multer (paritas Vercel) |

---

## 4. User Guide — Skenario Demo 5 Menit

### Jalur A — Warga: Scan → QR (2 menit)
1. Buka portal → bagian **Pra-Pemeriksaan & Uji Fisik Dokumen (OCR)**.
2. Seret foto e-KTP asli (< 4 MB, terang, tanpa flash) → **Pindai**.
3. Hasil `BERHASIL`: catat **kode tiket** + screenshot **QR Fast-Track**; hasil `BURAM`: ikuti saran foto ulang (QR tetap terbit, status revisi); hasil `TIDAK_VALID`: ganti file dengan e-KTP asli.
4. Lacak via kolom **Lacak Status Resi** → masukkan kode tiket.

### Jalur B — Petugas: Putus Tiket (2 menit)
1. Lihat **Login Petugas** (username + password resmi) → ganti password bila diminta → Dashboard → pilih tiket `PENDING`.
2. foto bukti (terdekripsi sementara) → klik **Setujui / Tolak / Perlu Perbaikan** + catatan.
3. Status berubah, foto ter-purge otomatis, warga menerima notifikasi WA (bila WA aktif).

### Jalur C — Chatbot (1 menit)
1. Klik bubble **VeriBot AI** kanan bawah → kirim: `Jam Operasional Loket?`, `Syarat KTP Hilang?`, `Bagaimana cara dapat tiket Fast-Track?`
2. Tunjukkan jawaban terstruktur + balasan tetap ada walau AI provider dimatikan (fallback knowledge-base).

### Troubleshooting 1 Menit (di depan juri)
| Gejala | Diagnosis | Perbaikan |
|---|---|---|
| `HTTP 500 / FUNCTION_INVOCATION_FAILED` | Buka `GET /api/health`; cek Logs `ERR_MODULE_NOT_FOUND` | Pastikan import relatif berekstensi `.js`; redeploy bersih |
| `ocrReady:false` / `503` | Kunci AI kosong | Isi `GEMINI_API_KEY` / `NARA_ROUTE_API_KEY` di env Production + redeploy |
| `429 kuota` | Rate-limit bekerja (bukan bug) | Tunggu jendela reset / lanjut isi manual |
| Scan lambat di Hobby | Limit 10 dtk/fungsi | Pakai JPG < 2 MB untuk demo |

---

## 5. Nilai Investasi (penutup board)

- **Biaya AI terkendali:** 5 gerbang murah + cache 24 jam + rate-limit global — file sama tidak pernah membayar dua kali.
- **Operasional murah:** 1 repo → deploy Vercel Hobby untuk demo, naik ke Pro tanpa ubah kode untuk produksi.
- **Skalabel:** tambah kelurahan = tambah baris konfigurasi + tabel Supabase, bukan aplikasi baru.
- **Patuh regulasi:** UU PDP by-design (enkripsi, minimisasi, purge) — mengurangi risiko hukum adopsi.
- **Terbukti terukur:** evaluasi 100 foto asli batch `ycwc-001` (F1/LAINNYA/BURAM + latency) di halaman `/transparansi` Tier-1 publik + Tier-2 audit petugas — lihat F7.
- **Roadmap:** verifikasi NIK ke Dukcapil, antrean real-time, analitik beban loket, multi-bahasa daerah.

*Disusun dari kode sumber AIPEX VeriBot — seluruh klaim di atas dapat diverifikasi pada file dan baris yang dirujuk.*
