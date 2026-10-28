/**
 * Uji katalog FAQ + matcher offline.
 *
 *   npm run test:faq
 *
 * Tidak memanggil AI, Redis, Supabase, atau jaringan. Semua pertanyaan uji
 * harus dijawab oleh knowledge base offline.
 */

import assert from "node:assert";
import {
  FAQ_CATALOG,
  FAQ_CHIP_IDS,
  FAQ_PORTAL_IDS,
  FAQ_SOURCE_NOTE,
  getFaqEntry,
} from "../src/data/faqData.ts";
import { matchFaqEntry, normalizeFaqText } from "../src/lib/faqMatch.ts";
import { answerFaq, getOfflineFaqAnswer } from "../api/_lib/faq.ts";

const paraphraseCases: Array<[string, string]> = [
  ["Jam buka loket?", "jam-layanan"],
  ["Di mana alamat kantor kelurahan?", "kontak-lokasi"],
  ["Biaya?", "biaya-layanan"],
  ["Berapa lama?", "lama-proses"],
  ["Syarat KTP hilang?", "ktp-hilang-rusak"],
  ["Bikin KK baru syaratnya apa?", "kk"],
  ["KIA anak 3 tahun", "kia"],
  ["Akta lahir butuh apa?", "akta-kelahiran"],
  ["Pindah domisili", "surat-pindah"],
  ["NIK tidak terbaca di BPJS", "sinkron-nik"],
  ["Foto maksimal berapa MB?", "foto-dokumen"],
  ["Cek tiket lupa kode", "cek-tiket"],
  ["Data saya aman?", "privasi-pdp"],
  ["Surat pengantar RT RW", "rt-rw"],
  ["Legalisir dokumen", "legalisasi"],
  ["SPTJM", "sptjm"],
  ["Dokumen apa yang dibawa?", "persyaratan-umum"],
];

function testCatalogIntegrity(): void {
  const ids = new Set<string>();
  for (const entry of FAQ_CATALOG) {
    assert.ok(entry.id, "id FAQ wajib");
    assert.equal(ids.has(entry.id), false, `id FAQ duplikat: ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.question.length > 5, `pertanyaan terlalu pendek: ${entry.id}`);
    assert.ok(entry.answer.length > 40, `jawaban terlalu pendek: ${entry.id}`);
    assert.ok(entry.keywords.length > 0, `keywords kosong: ${entry.id}`);
    assert.ok(entry.source.length > 0, `source kosong: ${entry.id}`);
    assert.match(entry.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
  }

  assert.equal(FAQ_PORTAL_IDS.length, 6, "portal harus menampilkan 6 FAQ");
  assert.equal(FAQ_CHIP_IDS.length, 8, "chatbot harus menampilkan 8 chip");

  for (const id of [...FAQ_PORTAL_IDS, ...FAQ_CHIP_IDS]) {
    assert.ok(getFaqEntry(id), `id FAQ tidak ditemukan: ${id}`);
  }

  for (const id of FAQ_CHIP_IDS) {
    assert.ok(getFaqEntry(id)?.chipLabel, `chip tanpa label: ${id}`);
  }

  assert.ok(FAQ_SOURCE_NOTE.includes("Meruya Selatan"), "catatan sumber wajib menyebut SOP acuan");
}

function testParaphrases(): void {
  for (const [question, expectedId] of paraphraseCases) {
    const match = matchFaqEntry(question);
    assert.ok(match, `tidak ada match untuk: "${question}"`);
    assert.equal(match.entry.id, expectedId, `"${question}" -> ${match.entry.id}, harusnya ${expectedId}`);
    assert.equal(match.tied.length, 0, `"${question}" ambigu: ${match.tied.map((e) => e.id).join(", ")}`);
  }
}

async function testChipsAndPortal(): Promise<void> {
  for (const id of [...FAQ_CHIP_IDS, ...FAQ_PORTAL_IDS]) {
    const entry = getFaqEntry(id);
    assert.ok(entry, `entry hilang: ${id}`);

    const match = matchFaqEntry(entry.question);
    assert.ok(match, `pertanyaan katalog tidak match: ${id}`);
    assert.equal(match.entry.id, id, `pertanyaan ${id} justru masuk ke ${match.entry.id}`);
    assert.equal(match.tied.length, 0, `pertanyaan ${id} ambigu`);

    const offline = getOfflineFaqAnswer(entry.question);
    assert.equal(offline, entry.answer, `jawaban offline berbeda untuk ${id}`);

    const answer = await answerFaq(entry.question);
    assert.equal(answer.source, "knowledge-base", `${id} tidak dijawab KB offline`);
    assert.equal(answer.reply, entry.answer, `jawaban API berbeda untuk ${id}`);
  }
}

function testGuardrails(): void {
  // Bug lama: "wa" cocok dengan "warga"/"jawab". Sekarang harus kata utuh.
  assert.equal(matchFaqEntry("Halo apa kabar warga?"), null);
  assert.equal(matchFaqEntry("Jawab dong"), null);
  assert.equal(matchFaqEntry("Saya mau tanya"), null);

  // Pertanyaan multi-topik harus meminta klarifikasi, bukan menebak.
  const ambiguous = matchFaqEntry("Syarat KTP dan KK?");
  assert.ok(ambiguous, "pertanyaan KTP+KK harus terdeteksi");
  assert.ok(ambiguous.tied.length >= 2, "KTP+KK harus dianggap ambigu");
  const reply = getOfflineFaqAnswer("Syarat KTP dan KK?");
  assert.ok(reply?.includes("beberapa topik"), "jawaban ambigu harus meminta klarifikasi");
}

async function main(): Promise<void> {
  testCatalogIntegrity();
  testParaphrases();
  await testChipsAndPortal();
  testGuardrails();

  const normalized = normalizeFaqText("KTP-el / E-KTP?");
  assert.equal(normalized, "ktp el e ktp");

  console.log(`✅ FAQ OK: ${FAQ_CATALOG.length} intent, ${FAQ_PORTAL_IDS.length} portal, ${FAQ_CHIP_IDS.length} chip`);
  console.log(`✅ ${paraphraseCases.length} parafrase + ${FAQ_CHIP_IDS.length + FAQ_PORTAL_IDS.length} pertanyaan katalog lolos`);
  console.log("✅ Guardrail kata utuh, klarifikasi ambigu, dan jalur answerFaq offline lolos");
}

main().catch((err) => {
  console.error("❌ Test FAQ gagal:", err);
  process.exitCode = 1;
});
