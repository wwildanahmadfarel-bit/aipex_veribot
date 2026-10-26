// Password petugas — scrypt bawaan Node.js, tanpa dependency native tambahan.
// Format hash sengaja berversi agar parameter bisa dinaikkan tanpa memutus
// hash lama: scrypt$N$r$p$salt$hash (salt/hash = base64url).
//
// Catatan efisiensi: scrypt hanya dipanggil saat login / ganti password.
// Verifikasi JWT per-request tetap HMAC cepat dan tidak menyentuh database.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

// Hash dummy untuk menyamakan waktu respons saat username tidak ditemukan.
// Nilainya BUKAN password siapa pun; hanya agar alur verifikasi tetap scrypt.
const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$1$skqP2YlX_r26MWC1Y08gYg$bZNpIAMTbJWx0GnaOOiXJFnAmJ6649n4ocHiXHiVpDNCSvho-OP2JTJNPOc7NgOSxJx9TeWhEyqho2HqSmyl-g";

export type PasswordPolicyResult = { ok: true } | { ok: false; message: string };

function deriveKey(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Buffer {
  const s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

export function validatePasswordPolicy(
  password: string,
  username?: string
): PasswordPolicyResult {
  const pw = String(password ?? "");
  if (pw.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Password minimal ${PASSWORD_MIN_LENGTH} karakter.` };
  }
  if (pw.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: `Password maksimal ${PASSWORD_MAX_LENGTH} karakter.` };
  }
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    return { ok: false, message: "Password harus mengandung huruf dan angka." };
  }
  if (username && username.trim() && pw.toLowerCase().includes(username.trim().toLowerCase())) {
    return { ok: false, message: "Password tidak boleh mengandung username." };
  }
  return { ok: true };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await deriveKey(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    toBase64Url(salt),
    toBase64Url(derived),
  ].join("$");
}

/**
 * Verifikasi password terhadap hash tersimpan.
 * Return false untuk format hash rusak/tidak dikenal — jangan throw ke handler.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const pw = String(password ?? "");
    // Tolak input raksasa sebelum scrypt agar tidak bisa dipakai untuk DoS.
    if (!pw || pw.length > PASSWORD_MAX_LENGTH) return false;
    const parts = String(storedHash || "").split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    if (N < 16384 || N > 262144 || r < 1 || r > 32 || p < 1 || p > 16) return false;
    const salt = fromBase64Url(parts[4]);
    const expected = fromBase64Url(parts[5]);
    if (salt.length < 8 || expected.length < 32) return false;
    const derived = await deriveKey(pw, salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Dipakai saat username tidak ada: tetap jalankan scrypt agar timing mirip. */
export async function verifyDummyPassword(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_PASSWORD_HASH);
}

/** Password sementara acak untuk akun baru / reset oleh admin. */
export function generateTemporaryPassword(length = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(Math.max(12, length));
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  // Pastikan selalu ada huruf dan angka.
  if (!/[A-Za-z]/.test(out)) out = `A${out.slice(1)}`;
  if (!/\d/.test(out)) out = `${out.slice(0, -1)}7`;
  return out;
}
