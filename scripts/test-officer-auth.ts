/**
 * Uji unit auth petugas tanpa database dan tanpa menyentuh akun asli.
 *
 *   npm run test:auth
 *
 * Yang diuji:
 * - hash/verify scrypt + kebijakan password
 * - JWT: klaim sid/ver, batas TTL access, token kedaluwarsa
 * - token lama tanpa sid ditolak requireOfficer
 * - atribut cookie refresh (HttpOnly, Path, SameSite, Max-Age)
 *
 * Script ini memakai secret uji sementara; TIDAK membaca/menulis .env.local
 * dan TIDAK menghubungi Supabase.
 */

import assert from "node:assert";
import { randomBytes } from "node:crypto";

const testSecret = randomBytes(32).toString("hex");
process.env.OFFICER_JWT_SECRET = testSecret;
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy,
  generateTemporaryPassword,
} = await import("../api/_lib/password.ts");
const {
  signOfficerToken,
  verifyOfficerToken,
  requireOfficer,
  OFFICER_ACCESS_TTL_MS,
  OFFICER_SESSION_TTL_MS,
} = await import("../api/_lib/officer-auth.ts");
const {
  setOfficerRefreshCookie,
  clearOfficerRefreshCookie,
  readCookie,
} = await import("../api/_lib/officer-cookie.ts");
const {
  getOfficerLoginRateLimitConfig,
  getOfficerLoginRateLimitPreset,
  OFFICER_LOGIN_DEFAULT_MAX,
  OFFICER_LOGIN_DEFAULT_WINDOW_MS,
} = await import("../api/_lib/officer-rate-limit.ts");

async function testPassword(): Promise<void> {
  const password = "RahasiaPetugas123";
  const hash = await hashPassword(password);
  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("password-salah", hash), false);
  assert.equal(await verifyPassword(password, "format-rusak"), false);
  assert.notEqual(await hashPassword(password), hash, "salt harus berbeda tiap hash");

  assert.equal(validatePasswordPolicy("pendek").ok, false);
  assert.equal(validatePasswordPolicy("hanyaHurufTanpaAngka").ok, false);
  assert.equal(validatePasswordPolicy("HanyaAngka12345678").ok, true);
  assert.equal(validatePasswordPolicy("RahasiaLoket12345", "petugas").ok, true);
  assert.equal(validatePasswordPolicy("RahasiaPetugas123", "petugas").ok, false);

  const temporary = generateTemporaryPassword(16);
  assert.equal(temporary.length, 16);
  assert.match(temporary, /[A-Za-z]/);
  assert.match(temporary, /\d/);
}

function testJwt(): void {
  const now = Date.now();
  const officer = { id: "off-test", nama: "Petugas Uji", role: "PETUGAS" };

  const token = signOfficerToken(officer, {
    sessionId: "sid-test",
    tokenVersion: 3,
    expiresAt: now + 60_000,
  });
  const claims = verifyOfficerToken(token);
  assert.ok(claims);
  assert.equal(claims?.sub, "off-test");
  assert.equal(claims?.sid, "sid-test");
  assert.equal(claims?.ver, 3);
  assert.ok((claims?.exp || 0) > now);
  assert.ok((claims?.exp || 0) - now <= 60_500, "exp harus dibatasi expiresAt sesi");
  assert.ok((claims?.exp || 0) - now <= OFFICER_ACCESS_TTL_MS + 1_000);

  const fullToken = signOfficerToken(officer, { sessionId: "sid-full" });
  const fullClaims = verifyOfficerToken(fullToken);
  assert.ok(fullClaims);
  assert.equal(
    (fullClaims?.exp || 0) - (fullClaims?.iat || 0),
    OFFICER_ACCESS_TTL_MS,
    "tanpa expiresAt, access token memakai TTL default"
  );

  const expired = signOfficerToken(officer, { sessionId: "sid-exp", expiresAt: now - 1 });
  assert.equal(verifyOfficerToken(expired), null);

  const legacy = signOfficerToken(officer); // tanpa sid = token versi lama
  assert.ok(verifyOfficerToken(legacy), "tanda tangan tetap valid secara kriptografis");
  const legacyAuth = requireOfficer({
    headers: { authorization: `Bearer ${legacy}` },
  });
  assert.equal(legacyAuth.ok, false, "token tanpa sid harus ditolak");

  const auth = requireOfficer({
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(auth.ok, true);
  assert.equal(auth.officerId, "off-test");
  assert.equal(auth.sessionId, "sid-test");
}

function testLoginRateLimit(): void {
  const originalMax = process.env.OFFICER_LOGIN_MAX;
  const originalWindow = process.env.OFFICER_LOGIN_WINDOW_MS;
  const restore = () => {
    if (originalMax === undefined) delete process.env.OFFICER_LOGIN_MAX;
    else process.env.OFFICER_LOGIN_MAX = originalMax;
    if (originalWindow === undefined) delete process.env.OFFICER_LOGIN_WINDOW_MS;
    else process.env.OFFICER_LOGIN_WINDOW_MS = originalWindow;
  };

  try {
    delete process.env.OFFICER_LOGIN_MAX;
    delete process.env.OFFICER_LOGIN_WINDOW_MS;
    assert.deepStrictEqual(getOfficerLoginRateLimitConfig(), {
      max: 10,
      windowMs: 600_000,
      custom: false,
    });
    assert.equal(OFFICER_LOGIN_DEFAULT_MAX, 10);
    assert.equal(OFFICER_LOGIN_DEFAULT_WINDOW_MS, 600_000);

    const defaultPreset = getOfficerLoginRateLimitPreset();
    assert.equal(defaultPreset.max, 10);
    assert.equal(defaultPreset.windowMs, 600_000);
    assert.equal(defaultPreset.ipOnly, true);
    assert.equal(defaultPreset.prefix, "officerLogin:10:600000");

    process.env.OFFICER_LOGIN_MAX = "30";
    process.env.OFFICER_LOGIN_WINDOW_MS = "10000";
    assert.deepStrictEqual(getOfficerLoginRateLimitConfig(), {
      max: 30,
      windowMs: 10_000,
      custom: true,
    });
    assert.equal(getOfficerLoginRateLimitPreset().prefix, "officerLogin:30:10000");

    // Nilai rusak/keluar batas kembali ke default produksi, bukan membuka limit.
    process.env.OFFICER_LOGIN_MAX = "0";
    process.env.OFFICER_LOGIN_WINDOW_MS = "999";
    assert.deepStrictEqual(getOfficerLoginRateLimitConfig(), {
      max: 10,
      windowMs: 600_000,
      custom: false,
    });

    process.env.OFFICER_LOGIN_MAX = "1001";
    process.env.OFFICER_LOGIN_WINDOW_MS = "86400001";
    assert.deepStrictEqual(getOfficerLoginRateLimitConfig(), {
      max: 10,
      windowMs: 600_000,
      custom: false,
    });

    process.env.OFFICER_LOGIN_MAX = "abc";
    process.env.OFFICER_LOGIN_WINDOW_MS = "";
    assert.deepStrictEqual(getOfficerLoginRateLimitConfig(), {
      max: 10,
      windowMs: 600_000,
      custom: false,
    });

    process.env.OFFICER_LOGIN_MAX = "37.9";
    process.env.OFFICER_LOGIN_WINDOW_MS = "1000";
    assert.deepStrictEqual(getOfficerLoginRateLimitConfig(), {
      max: 37,
      windowMs: 1_000,
      custom: true,
    });

    // Batas atas yang masih sah.
    process.env.OFFICER_LOGIN_MAX = "1000";
    process.env.OFFICER_LOGIN_WINDOW_MS = "86400000";
    assert.deepStrictEqual(getOfficerLoginRateLimitConfig(), {
      max: 1000,
      windowMs: 86_400_000,
      custom: true,
    });
  } finally {
    restore();
  }
}

function testCookie(): void {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
  };

  setOfficerRefreshCookie(res as any, "token-uji", 28_800);
  const setCookie = headers["set-cookie"] || "";
  assert.match(setCookie, /^aipex_refresh=token-uji/);
  assert.match(setCookie, /Path=\/api\/admin/);
  assert.match(setCookie, /Max-Age=28800/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.doesNotMatch(setCookie, /token-uji.*token-uji/, "cookie tidak boleh duplikat");

  assert.equal(
    readCookie({ headers: { cookie: "a=b; aipex_refresh=token-uji; c=d" } }, "aipex_refresh"),
    "token-uji"
  );
  assert.equal(readCookie({ headers: { cookie: "aipex_refresh=abc%20def" } }, "aipex_refresh"), "abc def");

  clearOfficerRefreshCookie(res as any);
  assert.match(headers["set-cookie"] || "", /Max-Age=0/);
  assert.match(headers["set-cookie"] || "", /Expires=Thu, 01 Jan 1970/);
}

await testPassword();
testJwt();
testLoginRateLimit();
testCookie();

const loginLimit = getOfficerLoginRateLimitConfig();
console.log(
  JSON.stringify({
    ok: true,
    accessTtlHours: OFFICER_ACCESS_TTL_MS / 3_600_000,
    sessionTtlHours: OFFICER_SESSION_TTL_MS / 3_600_000,
    loginRateLimit: {
      max: loginLimit.max,
      windowMs: loginLimit.windowMs,
      custom: loginLimit.custom,
    },
    note: "Unit test tanpa database. Uji login/refresh end-to-end butuh migrasi + akun petugas.",
  })
);
