import { FAQ_CATALOG, type FaqEntry } from "../data/faqData.js";

export interface FaqMatch {
  entry: FaqEntry;
  score: number;
  /** Diisi bila beberapa intent punya skor sama; pemanggil sebaiknya minta klarifikasi. */
  tied: FaqEntry[];
}

/**
 * Normalisasi teks pertanyaan: huruf kecil, buang aksen/tanda baca, rapikan spasi.
 * "KTP-el / E-KTP?" -> "ktp el e ktp"
 */
export function normalizeFaqText(text: unknown): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cocokkan kata/frasa sebagai kata utuh, bukan substring.
 * Ini mencegah "wa" cocok dengan "warga" atau "kk" cocok dengan "kakak".
 * Frasa (mengandung spasi) diberi bobot lebih tinggi daripada kata tunggal.
 */
function keywordScore(text: string, rawKeyword: string): number {
  const keyword = normalizeFaqText(rawKeyword);
  if (!keyword) return 0;
  const re = new RegExp(`(^|\\s)${escapeRegExp(keyword)}(?=\\s|$)`, "u");
  if (!re.test(text)) return 0;
  return keyword.includes(" ") ? 6 : 2;
}

function scoreEntry(text: string, entry: FaqEntry): number {
  let score = 0;
  for (const keyword of entry.keywords) {
    score += keywordScore(text, keyword);
  }
  // Pertanyaan yang dikirim chip/portal adalah pertanyaan lengkap dari katalog.
  // Bonus ini memastikan intent yang dimaksud menang meski ada kata kunci generik.
  if (text === normalizeFaqText(entry.question)) score += 20;
  return score;
}

/** Cari intent FAQ terbaik. Null bila tidak ada yang cukup yakin. */
export function matchFaqEntry(input: string): FaqMatch | null {
  const text = normalizeFaqText(input);
  if (!text) return null;

  const scored = FAQ_CATALOG.map((entry) => ({ entry, score: scoreEntry(text, entry) }))
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const top = scored[0];
  const tied = scored
    .filter((item) => item.score === top.score)
    .map((item) => item.entry);

  return {
    entry: top.entry,
    score: top.score,
    tied: tied.length > 1 ? tied : [],
  };
}
