# Naskah Latihan Presentasi — AIPEX VeriBot (10 Menit, 1 Presenter)

> Rumus mengacu pada video referensi: **(1)** Start from the End — manfaat audiens, **(2)** alur pembahasan, **(3)** aturan main, **(4)** hook, **(5)** storytelling analogi + fakta mind-blowing.
>
> Pendamping: `docs/KOMPETISI.md` (materi display board). Demo hidup: https://aipexveribot.vercel.app
>
> Persiapan wajib sebelum naik panggung: 2 file foto (1 KTP tajam < 2 MB, 1 KTP buram/silau), 1 screenshot hasil scan `BERHASIL` sebagai cadangan, browser sudah login sebagai petugas di tab kedua, tab `/api/health` siap dibuka bila juri bertanya teknis.

---

## Segmen 1 — Start from the End: Manfaat Audiens (0:00–1:00)

> *Berdiri tenang, senyum, eye-contact ke juri. Slide: judul + tagline.*

"Selamat pagi/siang, dewan juri yang saya hormati. Perkenalkan, saya [NAMA] dari tim AIPEX VeriBot.

Setelah 10 menit ini, Bapak dan Ibu akan membawa pulang tiga hal konkret. **Pertama**, cara warga memastikan berkasnya lolos **sebelum berangkat ke loket**. **Kedua**, cara petugas memutus satu tiket dalam **kurang dari satu menit**. Dan **ketiga**, kenapa biaya AI kami **tidak akan jebol** walau dipakai ribuan warga.

Semuanya akan saya buktikan langsung lewat demo hidup — bukan slide."

## Segmen 2 — Alur Pembahasan (1:00–1:30)

> *Slide: 4 papan agenda. Tunjuk satu per satu dengan jari.*

"Alur kita jelas, empat papan saja. **Papan pertama**: demo warga — scan KTP jadi tiket QR. **Papan kedua**: demo petugas — putus tiket dan WhatsApp otomatis. **Papan ketiga**: dapur teknis, hanya 30 detik, satu potong kode. **Papan keempat**: kenapa ini layak didanai — lalu saya tutup dengan satu permintaan konkret."

## Segmen 3 — Aturan Main (1:30–1:50)

> *Ramah, singkat, jangan kaku.*

"Aturan mainnya sederhana. Pertanyaan Bapak/Ibu saya tampung dulu — ada sesi tanya jawab dua menit di akhir. Dan HP tidak perlu disimpan — justru silakan buka alamat demo kami dan ikuti alurnya bersama saya."

## Segmen 4 — Hook: Cerita + Data (1:50–2:40)

> *Turunkan tempo. Cerita dengan nada personal.*

"Bayangkan Ibu Siti. Pagi-pagi ia antre dua jam di loket kelurahan, sampai di depan petugas — **ditolak**. Foto KTP-nya silau, NIK-nya tidak terbaca. Besok ia harus antre lagi dari nol.

Ini bukan kasus langka. Setiap berkas yang gagal di loket berarti **satu antrean terbuang, satu formulir kertas diisi ulang, satu warga kecewa**. Janji kami hari ini: **satu kali pindai, nol kertas, nol antre ulang**. Begini caranya."

## Segmen 5A — Demo Warga + Analogi (2:40–6:00)

> *Buka portal. Upload file KTP TAJAM. Biarkan juri melihat skor muncul.*

"Inilah portal warga. Saya unggah foto e-KTP — dan bayangkan AI kami seperti **petugas super-teliti yang tidak pernah lelah**: dalam hitungan detik ia memberi skor kejelasan 0 sampai 100, membaca 16 digit NIK, lalu memberi vonis — `BERHASIL`, `BURAM`, atau `TIDAK_VALID`.

Lihat — skor [SEBUT ANGKA], status `BERHASIL`. Dan otomatis terbit ini: **Tiket QR Fast-Track**. Di kantor kelurahan, warga cukup memindai QR ini di loket prioritas. Tidak antre manual, tidak isi formulir kertas.

Sekarang file kedua — foto yang silau dan buram. *(Upload.)* Statusnya `BURAM` — tapi perhatikan: **tiket tetap terbit**, statusnya revisi, lengkap dengan instruksi foto ulang. Warga tidak pernah jalan buntu.

Lalu asisten chat kami — *(klik bubble VeriBot, kirim 'Syarat KTP hilang?')*. Menjawab syarat lengkap dalam sedetik. Dan yang istimewa: chatbot ini punya **empat lapis pengaman** — kalau satu AI mati, yang lain mengambil alih; kalau semua mati, pengetahuan offline yang menjawab. Ia tidak pernah menampilkan error ke warga."

## Segmen 5B — Sisi Petugas + Fakta Mind-Blowing (6:00–8:00)

> *Pindah ke tab dashboard petugas (sudah login). Putus 1 tiket.*

"Sekarang sisi petugas. Saya buka tiket yang baru terbit — bukti foto tampil, NIK dan nama sudah terekstrak. Saya klik **Setujui** — selesai. Warga otomatis menerima WhatsApp, dan inilah fakta yang paling saya banggakan:

**Fakta satu** — foto bukti itu langsung **lenyap otomatis** setelah diputus. Terhapus, bukan disembunyikan. Itu kepatuhan UU PDP by-design, bukan tempelan.

**Fakta dua** — dan ini yang disukai investor — **file yang sama tidak pernah membayar AI dua kali**. Sistem mengenali sidik digital file dan memakai cache 24 jam. Ditambah lima lapis anti-spam sebelum token AI terbakar. Tagihan kami terkendali walau dipakai ribuan warga.

Dapur teknisnya, 30 detik saja — *(tampilkan satu slide kode `api/chat-faq.ts:89-133`)* — inilah rantai empat lapis chatbot tadi: Nara, lalu Gemini, lalu pengetahuan offline, lalu darurat. Sederhana, tapi inilah kenapa layanan kami tidak pernah mati."

## Segmen 6 — Penutup + CTA (8:00–10:00)

> *Kembali ke slide penutup. Ulangi tiga manfaat pembuka sebagai sudah-terbukti. Akhiri dengan permintaan konkret.*

"Kembali ke tiga janji pembuka. **Satu** — warga kini tahu berkasnya lolos sebelum berangkat, sudah terbukti lewat demo. **Dua** — petugas memutus satu tiket kurang dari satu menit, baru saja Bapak/Ibu saksikan. **Tiga** — biaya AI terkendali lewat cache dan anti-spam, sudah saya tunjukkan kodenya.

Maka permintaan konkret kami: **beri kami kesempatan pilot di satu kelurahan** — atau pendanaan tahap awal untuk replikasi ke kelurahan berikutnya. Satu kelurahan membuktikan model, seratus kelurahan mengubah layanan publik.

Terima kasih. Saya siap menerima pertanyaan."

---

## Lampiran A — Cue Klik Demo (checklist panggung)

| Waktu | Aksi | Cadangan bila gagal |
|---|---|---|
| 2:40 | Upload KTP tajam (< 2 MB) | Tampilkan screenshot `BERHASIL` cadangan; lanjut narasi |
| 4:00 | Upload KTP buram | Siapkan hasil `BURAM`; jelaskan revisi + QR tetap terbit |
| 4:45 | Chat `Syarat KTP hilang?` | Ketik `Jam loket?` (jawaban knowledge-base selalu ada) |
| 6:00 | Dashboard → Setujui 1 tiket | Tampilkan screenshot status `APPROVED` + WA terkirim |
| 7:30 | Slide kode `chat-faq.ts` | Sebutkan 4 lapis secara lisan tanpa slide |

## Lampiran B — Prediksi Pertanyaan Juri + Jawaban (latihan Q&A)

1. **"Bagaimana kalau AI-nya salah menilai dokumen?"** — Backend menormalisasi silang: skor di bawah 70 tidak boleh `BERHASIL`, jenis `LAINNYA` selalu `TIDAK_VALID`; keputusan final tetap di tangan petugas ber-JWT.
2. **"Bagaimana privasi foto KTP warga?"** — Diproses di memori, arsip AES-256-GCM sementara, purge otomatis saat diputus (maksimal 7 hari via cron). Permanen hanya metadata rekap.
3. **"Bagaimana kalau kuota AI habis / internet lambat?"** — Rate-limit memberi pesan jujur + tombol isi manual; chatbot turun ke knowledge-base offline; demo tetap jalan.
4. **"Kenapa deploy di paket Hobby? Tidak lambat?"** — Batas 10 detik per fungsi kami kompensasi: file demo < 2 MB, cache 24 jam, fallback endpoint. Naik ke Pro tanpa ubah kode.
5. **"Apa bedanya dengan Google Lens / scan biasa?"** — Ini bukan sekadar OCR: ada vonis kualitas, penerbitan tiket QR, alur petugas, WA otomatis, dan kepatuhan privasi dalam satu sistem.

## Lampiran C — Latihan Mandiri (3 putaran)

- **Putaran 1 (hafal):** baca naskah keras-keras dengan timer 10 menit, tandai bagian yang molor.
- **Putaran 2 (demo):** praktikkan semua cue klik sesuai Lampiran A, termasuk simulasi 1 kegagalan (matikan Wi-Fi 10 detik saat chat).
- **Putaran 3 (tekanan):** minta teman bertanya acak dari Lampiran B di tengah demo; jawab maksimal 30 detik lalu kembali ke naskah.
