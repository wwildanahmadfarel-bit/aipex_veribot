# PRD — Anti-Spam Unggah Berkas AIPEX VeriBot (Tanpa Login User)

> Status: Disetujui untuk build | Hosting: Vercel Serverless | Batas: maks 5x scan | Tanpa login user

## 1. Latar Belakang & Masalah

Website AIPEX VeriBot Kelurahan Sukamaju sudah di-build dan berjalan di Vercel. Alur warga sepenuhnya terbuka (tanpa login) agar mudah diakses:

`PortalHome -> OcrPreScreenCard / DocumentScanner -> POST /api/ocr atau /api/scan-document -> AI Vision (Gemini / Nara Route) -> tiket QR`

Temuan dari audit kode (`api/_lib/ocr-handler.ts`, `api/_lib/http.ts`, `server.ts`, `src/components/OcrPreScreenCard.tsx`, `src/components/DocumentScanner.tsx`):

1. Setiap `POST /api/ocr` dan `POST /api/scan-document` langsung memanggil AI Vision berbayar (`gemini-2.5-flash`, `gemini-3.6-flash`, `visionViaNaraRoute`). Tidak ada gerbang murah sebelumnya.
2. Tidak ada rate-limit, captcha, throttling IP, maupun kuota harian. CORS `Access-Control-Allow-Origin: *`.
3. Validasi tipe/ukuran file hanya di frontend (`accept="image/*"`, cek 10 MB). Mudah di-bypass via `curl` dengan body `imageBase64` JSON.
4. `tickets[]` in-memory tidak persisten di Vercel Serverless, sehingga proteksi berbasis memori tidak akan jalan antar-invokasi.
5. Endpoint lain yang juga memakan token: `POST /api/chat-faq` (Gemini chat). Endpoint murah: `GET /api/tickets`, `GET /api/tickets/:kode`, `POST /api/tickets`, `PATCH /api/admin/tickets`.

Dampak: spammer/bot dapat melakukan loop upload ribuan kali, menghabiskan token Gemini/Nara Route, menaikkan tagihan, dan membuat layanan lambat/down untuk warga asli.

Batasan bisnis: **tidak boleh ada login user** agar warga tetap 1-klik. Login hanya untuk petugas (`OfficerLoginModal` dengan kode akses seperti `849201`, `LOKET-SUKAMAJU-01`).

## 2. Tujuan & Non-Tujuan

### Tujuan

1. Menahan spam upload tanpa menambah friction untuk warga normal (1–3x foto ulang tetap lolos mulus).
2. Memastikan tidak ada panggilan AI berbayar untuk request spam/duplikat/bot.
3. Tetap patuh UU PDP No. 27/2022: file hanya di RAM, auto-purge, tidak disimpan ke disk.
4. Berjalan di Vercel Serverless (stateless) dengan penyimpanan rate-limit terpusat.

### Non-Tujuan (tidak dikerjakan di PRD ini)

1. Membuat login/OTP user warga.
2. Mengubah logika OCR, skoring, atau penerbitan tiket QR.
3. Migrasi database Supabase `tickets`.

## 3. Keputusan Kunci (Locked)

| No | Keputusan | Nilai |
|----|-----------|-------|
| 1 | Batas scan per IP | **5x per 10 menit per IP**, 10x per hari per IP, 300x per hari global |
| 2 | Hosting | **Vercel** (Functions `api/ocr.ts`, `api/scan-document.ts`, `api/chat-faq.ts`) |
| 3 | Store rate-limit | Upstash Redis / Vercel KV (bukan memory) |
| 4 | Captcha | Cloudflare Turnstile invisible, mode adaptif |
| 5 | UX warga normal | Tetap tanpa login, tanpa centang gambar |

Rasional 3x: warga valid biasanya butuh 1x scan berhasil, atau 2–3x foto ulang jika buram/silau. Bot yang melakukan puluhan–ratusan request langsung terblokir di request ke-4 tanpa memakan token.

## 4. Persona & User Story

- **Warga Sari:** foto KTP sekali, langsung dapat QR Fast-Track. Tidak paham captcha. Harus tetap 1-klik.
- **Warga Budi (foto buram):** gagal 1x karena silau, foto ulang ke-2 berhasil. Maksimal 5x masih tanpa hambatan berarti.
- **Spammer/Bot:** script `while true; curl POST /api/ocr imageBase64=...`. Harus ditolak di request ke-4 dengan `429`, tanpa AI dipanggil.
- **Petugas Loket:** login dengan kode akses, tidak terdampak rate-limit warga. Butuh dashboard `ocr_logs` untuk melihat IP abusif.

## 5. Requirement Fungsional

### FR1 — Rate-limit terpusat (wajib sebelum AI)

- Lokasi: middleware baru `api/_lib/rate-limit.ts`, dipakai di `api/ocr.ts`, `api/scan-document.ts`, `api/chat-faq.ts`, `api/tickets.ts`.
- Key: `sha256(x-forwarded-for pertama + User-Agent)` agar tidak menyimpan IP mentah (hemat PDP).
- Aturan:
  - `ocr:5/10min/IP` → jika lewat, return `429` + `retryAfter` detik, **jangan panggil AI**.
  - `ocr:10/hari/IP` → `429` harian.
  - `ocr:300/hari/global` → circuit breaker, return `503` ramah + fallback offline FAQ.
  - `chat-faq:10/10min/IP` (lebih longgar karena teks murah, tapi tetap dibatasi).
  - `tickets POST:5/jam/IP` (cegah banjir tiket).
- Response standar:

```json
{
  "success": false,
  "isSystemError": true,
  "code": "RATE_LIMITED",
  "message": "Terlalu sering memindai. Sisa kuota 0/5 per 10 menit. Coba lagi dalam 7 menit.",
  "retryAfter": 420
}
```

- Frontend (`OcrPreScreenCard.tsx`, `DocumentScanner.tsx`, `InteractiveWizard.tsx`) wajib menampilkan countdown retry, bukan pesan "bukan KTP".

### FR2 — Filter murah sebelum AI (nol token untuk sampah)

Urutan di `handleOcr` harus menjadi: `rate-limit → validasi → dedup hash → captcha (jika perlu) → AI`.

1. Validasi magic-bytes server-side (bukan hanya `mimetype`): `FFD8FF`=JPG, `89504E47`=PNG, `52494646`=WEBP, `25504446`=PDF. Tolak selain itu dengan `400`.
2. Batas ukuran: tolak `>4.2 MB` (batas payload Vercel) dan `<20 KB` (blank/1px spam) tanpa AI.
3. Cek dimensi cepat: tolak jika lebar `<400px` (gunakan parser header ringan, tanpa sharp berat bila perlu).
4. Deduplikasi: hitung `sha256(fileBytes)`. Simpan `{hash → hasil OCR}` di Redis 24 jam. Jika hash sama masuk lagi, kembalikan cache tanpa panggil AI. Ini memotong spam duplikat secara drastis.
5. Tolak `imageBase64` kosong/invalid base64 dengan `400` sebelum decode penuh.

### FR3 — Captcha invisible adaptif (tanpa login) — NONAKTIF BY POLICY

> Keputusan produk: Turnstile **mati permanen** (bukan sementara). Bagian ini
> dipertahankan sebagai arsip desain bila suatu hari dibutuhkan. Proteksi resmi
> saat ini: honeypot + dwell-time + rate-limit + file-guard + cache.

- Pilihan: **Cloudflare Turnstile** (direkomendasikan: gratis, privasi, tanpa puzzle gambar).
- Alur:
  - Scan ke-1 dan ke-2 dalam 10 menit: tanpa captcha (mulus).
  - Scan ke-5 dalam 10 menit: frontend wajib melampirkan `turnstileToken`. Jika token absen/invalid → `403` tanpa AI.
  - Setelah 10 menit reset, kembali mulus.
- Implementasi:
  - Frontend: muat widget Turnstile invisible di `OcrPreScreenCard` dan `DocumentScanner`, kirim `turnstileToken` bersama `imageBase64/file`.
  - Backend: verifikasi ke `https://challenges.cloudflare.com/turnstile/v0/siteverify` dengan `TURNSTILE_SECRET_KEY` (env server-only). Cache hasil verifikasi per IP 10 menit agar tidak verifikasi berulang.
- Fallback: jika Turnstile down, fallback ke rate-limit ketat (tetap tolak ke-4), jangan bypass ke AI.

### FR4 — Honeypot + dwell-time (anti script kasar)

- Frontend kirim `startedAt` (timestamp saat halaman dibuka) dan field honeypot kosong `website_confirm` (hidden, manusia tidak isi, bot sering isi).
- Backend tolak tanpa AI jika: `now - startedAt < 3000ms` atau honeypot terisi. Return `400` ramah: "Terdeteksi aktivitas otomatis, coba lagi."

### FR5 — UX anti-spam yang tetap ramah

1. Disable tombol upload saat `loading`, cegah double-submit.
2. Cooldown lokal 30 detik antar-scan (localStorage) + teks countdown.
3. Bedakan pesan dengan tegas:
   - `429/403` → "Terlalu sering / perlu verifikasi manusia, coba lagi dalam X" (jangan vonis "bukan KTP").
   - `TIDAK_VALID` → tetap pesan baku `BUKAN_KTP_MESSAGE`.
   - `isSystemError:true` → "Gangguan sistem, bukan salah dokumen Anda."
4. Tampilkan sisa kuota: "Kesempatan scan: 2/3 tersisa (10 menit)".

### FR6 — Logging & observabilitas abuse

- Tabel Supabase baru `ocr_logs`: `id, created_at, ip_hash, file_hash, mime, size_bytes, skor, status, source (gemini/nara/cache/blocked), latency_ms`.
- Tulis log **untuk semua request**, termasuk yang diblokir (source=`blocked:rate|captcha|validasi`), agar bisa audit tanpa menyimpan foto/IP mentah.
- Dashboard petugas (tambah tab di `AdminDashboard.tsx`): top `ip_hash` per jam, top `file_hash` duplikat, rasio blocked vs AI-call.
- Alert: jika `AI-call/jam > threshold` atau `global 80% dari 300/hari`, kirim notifikasi (email/Telegram webhook, di luar scope kode tapi disiapkan env-nya).

## 6. Requirement Non-Fungsional

- Performa: overhead rate-limit + hash + validasi `<300ms` p95. Cache hit harus lebih cepat dari AI-call.
- Keamanan: `GEMINI_API_KEY`, `NARA_ROUTE_API_KEY`, `TURNSTILE_SECRET_KEY`, `UPSTASH_*` hanya di env server, tidak pernah ke frontend. `x-nara-route-api-key` dari user tetap didukung tapi tidak wajib.
- Privasi UU PDP: tidak menyimpan foto, tidak menyimpan IP mentah (hanya hash), `ocr_logs` tanpa NIK/nama.
- Ketersediaan: jika Redis down → fail-closed untuk OCR (tolak ramah dengan `503`), jangan fail-open ke AI tanpa batas.
- Kompatibilitas: tetap support `multipart/form-data (file)` dan `JSON imageBase64`, tetap support `server.ts` Express untuk dev lokal (`express-rate-limit` sebagai pengganti Redis saat `NODE_ENV=development`).

## 7. Desain Teknis Vercel

```text
Browser (OcrPreScreenCard / DocumentScanner / Wizard)
  → POST /api/ocr atau /api/scan-document { imageBase64/file, turnstileToken?, startedAt, honeypot }
  → api/_lib/http.ts (CORS, parse body)
  → api/_lib/rate-limit.ts (Redis: cek 5/10min, 10/hari, 300 global)
  → validasi magic-bytes + size + dimensi
  → dedup sha256 → jika hit, return cache
  → verifikasi Turnstile (jika hitungan ke-5)
  → baru panggil visionViaNaraRoute / Gemini
  → Supabase tickets insert + ocr_logs insert
  → return { success, data:{ jenis_dokumen, status_verifikasi, skor_kejelasan, ticket } }
```

File yang diubah/ditambah:

- Baru: `api/_lib/rate-limit.ts`, `api/_lib/turnstile.ts`, `api/_lib/file-guard.ts`, `api/_lib/ocr-cache.ts`, `supabase/migrations/xxx_ocr_logs.sql`
- Ubah: `api/_lib/ocr-handler.ts`, `api/_lib/http.ts`, `api/ocr.ts`, `api/scan-document.ts`, `api/chat-faq.ts`, `api/tickets.ts`, `src/components/OcrPreScreenCard.tsx`, `src/components/DocumentScanner.tsx`, `src/components/InteractiveWizard.tsx`, `src/components/AdminDashboard.tsx`, `.env.example`, `vercel.json` (tambah env, tidak perlu ubah functions selain dokumentasi)
- Tidak diubah: prompt OCR, skema tiket, login petugas.

Env baru (Vercel Project Settings):

```text
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
TURNSTILE_SITE_KEY= (publik, ke frontend)
TURNSTILE_SECRET_KEY= (server-only)
OCR_MAX_PER_10MIN=5
OCR_MAX_PER_DAY_IP=10
OCR_MAX_PER_DAY_GLOBAL=300
```

## 8. Acceptance Criteria (QA)

1. Warga normal: 1x upload KTP valid → sukses + QR, tanpa captcha, AI-call tercatat 1x di `ocr_logs`.
2. Foto ulang: 3x upload dalam 10 menit dari IP sama → semua diproses (ke-3 dengan Turnstile invisible), ke-4 ditolak `429` tanpa AI-call baru.
3. Spam loop: script 20x `curl POST /api/ocr` dalam 2 menit → hanya 3 AI-call, 17 diblokir. Tagihan tidak bertambah setelah blokir.
4. Duplikat: upload file byte-identik 5x → 1 AI-call + 4 cache-hit.
5. File sampah (`exe`, `txt`, gambar 1px, PDF >4.2MB) → `400` tanpa AI-call.
6. Bot cepat (`startedAt <3 detik` atau honeypot terisi) → ditolak tanpa AI-call.
7. Pesan UX: `429` tidak pernah menampilkan "File bukan KTP". Menampilkan countdown yang benar.
8. Redis mati → OCR return `503` ramah, tidak ada AI-call liar.
9. Chat spam: 15x `/api/chat-faq` dalam 10 menit → dibatasi, fallback knowledge-base tetap jalan.

## 9. Rollout & Risiko

1. Tahap 1 (tanpa downtime): tambah Redis + rate-limit + filter + cache. Monitor 3 hari.
2. Tahap 2: aktifkan Turnstile adaptif. Monitor rasio blokir vs komplain warga.
3. Tahap 3: dashboard abuse + alert budget Gemini/Nara.
4. Rollback: feature-flag `ANTI_SPAM_ENABLED=false` untuk bypass sementara ke perilaku lama (hanya darurat, dengan risiko token).
5. Risiko: NAT kampus/kantor (1 IP banyak warga) bisa kena limit bersama → mitigasi: naikkan global limit jam kerja + izinkan bypass via Turnstile valid + tampilkan pesan hubungi petugas loket.

## 10. Estimasi Penghematan

Jika spam 1000 request/hari dengan file duplikat/acak: sebelum PRD = 1000 AI-call. Sesudah = maks ~5/IP/10min + cache-hit duplikat → typically <50 AI-call/hari untuk pola spam yang sama (estimasi hemat >90% token pada serangan duplikat, >70% pada serangan acak berkat rate-limit).
