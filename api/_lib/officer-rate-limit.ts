// Rate limit login petugas yang bisa dilonggarkan untuk demo.
//
// Default produksi: 10 percobaan / 10 menit / IP.
// Demo publik yang disarankan: 30 percobaan / 10 detik / IP lewat env.
//
// Nilai di luar batas aman akan diabaikan dan kembali ke default produksi,
// sehingga salah ketik env tidak membuat login terbuka tanpa batas.

import type { RateLimitPreset } from "./rate-limit.js";

export const OFFICER_LOGIN_DEFAULT_MAX = 10;
export const OFFICER_LOGIN_DEFAULT_WINDOW_MS = 10 * 60 * 1000;

const MIN_WINDOW_MS = 1_000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_MAX = 1;
const MAX_MAX = 1_000;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const value = Math.floor(n);
  if (value < min || value > max) return fallback;
  return value;
}

export interface OfficerLoginRateLimitConfig {
  /** Jumlah percobaan maksimum dalam satu jendela. */
  max: number;
  /** Panjang jendela dalam milidetik (juga menjadi jeda Retry-After maksimum). */
  windowMs: number;
  /** true bila env mengubah nilai default produksi. */
  custom: boolean;
}

export function getOfficerLoginRateLimitConfig(): OfficerLoginRateLimitConfig {
  const max = envInt(
    "OFFICER_LOGIN_MAX",
    OFFICER_LOGIN_DEFAULT_MAX,
    MIN_MAX,
    MAX_MAX
  );
  const windowMs = envInt(
    "OFFICER_LOGIN_WINDOW_MS",
    OFFICER_LOGIN_DEFAULT_WINDOW_MS,
    MIN_WINDOW_MS,
    MAX_WINDOW_MS
  );
  return {
    max,
    windowMs,
    custom:
      max !== OFFICER_LOGIN_DEFAULT_MAX ||
      windowMs !== OFFICER_LOGIN_DEFAULT_WINDOW_MS,
  };
}

/**
 * Preset siap pakai untuk `checkSimpleRateLimit`.
 *
 * Prefix memuat `max` dan `windowMs` supaya perubahan env (mis. dari 10/10 menit
 * ke 30/10 detik saat demo) tidak mewarisi counter lama yang masih dalam jendela
 * panjang. Counter lama akan kedaluwarsa sendiri tanpa mengunci pengguna.
 */
export function getOfficerLoginRateLimitPreset(): RateLimitPreset {
  const config = getOfficerLoginRateLimitConfig();
  return {
    max: config.max,
    windowMs: config.windowMs,
    prefix: `officerLogin:${config.max}:${config.windowMs}`,
    ipOnly: true,
  };
}
