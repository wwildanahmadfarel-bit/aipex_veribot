// Cache hasil OCR per sha256(file) 24 jam — AIPEX VeriBot.
// File duplikat tidak memanggil AI lagi (hemat token utama).
// Yang di-cache: parsed AI (jenis/status/skor/nik/nama/catatan), BUKAN tiket
// (tiket tetap diterbitkan unik per request agar QR tidak dobel).

import { redisGet, redisSet } from "./rate-limit.js";

const MEM = new Map<string, { exp: number; value: any }>();
const MEM_CAP = 300;
export const OCR_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(fileHash: string): string {
  return `rl:ocr-cache:${fileHash}`;
}

export function isCacheableParsed(parsed: any): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  // Hanya cache hasil valid (BERHASIL/BURAM). TIDAK_VALID murah-ish tapi tetap
  // bermanfaat di-cache agar spam file sampah tidak memakan token.
  return true;
}

export async function getCachedOcr(fileHash: string): Promise<any | null> {
  if (!fileHash) return null;
  const hit = await redisGet(cacheKey(fileHash));
  if (hit) {
    try {
      const parsed = JSON.parse(hit);
      if (parsed && typeof parsed === "object") return { ...parsed, _cacheHit: true };
    } catch {}
  }
  const m = MEM.get(fileHash);
  if (m && m.exp > Date.now()) return { ...m.value, _cacheHit: true };
  if (m) MEM.delete(fileHash);
  return null;
}

export async function setCachedOcr(fileHash: string, parsed: any): Promise<void> {
  if (!fileHash || !isCacheableParsed(parsed)) return;
  try {
    const { _cacheHit, ...clean } = parsed || {};
    void _cacheHit;
    await redisSet(cacheKey(fileHash), JSON.stringify(clean), OCR_CACHE_TTL_MS);
  } catch {}
  MEM.set(fileHash, { exp: Date.now() + OCR_CACHE_TTL_MS, value: { ...parsed } });
  if (MEM.size > MEM_CAP) {
    const first = MEM.keys().next().value;
    if (first) MEM.delete(first);
  }
}
