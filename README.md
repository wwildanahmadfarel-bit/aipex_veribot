<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# AIPEX VeriBot — Kelurahan Sukamaju

Portal pra-pemeriksaan dokumen kependudukan (OCR + verifikasi petugas + transparansi
metrik). Frontend React/Vite, API Vercel Functions, server lokal Express, database
Supabase.

## Dokumentasi

- [Autentikasi petugas (username/password, JWT 8 jam, refresh cookie)](./docs/AUTH-PETUGAS.md)
- [Alur website](./docs/ALUR-WEBSITE-AIPEX-VERIBOT.md)
- [Metrik transparansi](./docs/METRIK-TRANSPARANSI.md)
- [Panduan uji pengguna](./docs/UJI-PENGGUNA.md)

## Menjalankan Lokal

**Prasyarat:** Node.js 20+ dan akun Supabase.

1. Install dependencies: `npm install`
2. Salin `.env.example` ke `.env.local`, lalu isi minimal:
   - `GEMINI_API_KEY` (atau provider AI lain yang didukung)
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   - `OFFICER_JWT_SECRET` (minimal 32 karakter)
3. Jalankan migrasi Supabase, termasuk
   [`20261026_officer_auth_hardening.sql`](./supabase/migrations/20261026_officer_auth_hardening.sql).
4. Buat akun petugas: `npm run officer:create -- --username petugas.loket1 --nama "Nama Petugas"`.
5. Jalankan: `npm run dev` (bukan `vite preview`, karena API butuh Express).

## Perintah Penting

```bash
npm run dev          # server lokal (frontend + API)
npm run build        # build frontend ke dist/
npx tsc --noEmit     # typecheck
npm run test:auth    # unit test auth tanpa database
npm run officer:create -- --username <username> --nama "<nama>" --role PETUGAS
```

Jangan commit `.env.local`. Jangan menempelkan secret, service role key, atau
password petugas ke chat/issue.

View your app in AI Studio: https://ai.studio/apps/d62e12c5-187d-444e-b538-18b068efe1b3
