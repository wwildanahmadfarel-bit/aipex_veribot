// Satu sumber logika auth petugas untuk Vercel Functions dan server.ts.
// - Login: username + password (scrypt)
// - Access token: JWT HS256 (default 8 jam, dibatasi umur sesi)
// - Refresh: token acak di cookie HttpOnly, disimpan sebagai hash di DB
//
// Tidak ada lagi fallback kode akses hardcoded. Bila database/schema belum
// siap, login gagal tertutup (fail-closed) dengan pesan yang jelas.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getSupabase } from "./store.js";
import { getClientIp, hashIp } from "./rate-limit.js";
import {
  OFFICER_ACCESS_TTL_MS,
  OFFICER_SESSION_TTL_MS,
  signOfficerToken,
} from "./officer-auth.js";
import {
  hashPassword,
  validatePasswordPolicy,
  verifyDummyPassword,
  verifyPassword,
} from "./password.js";

const OFFICER_AUTH_COLUMNS =
  "id,nama_petugas,role,username,password_hash,is_active,must_change_password,token_version,last_login_at";

export type OfficerProfile = {
  id: string;
  nama: string;
  role: string;
};

type OfficerRow = {
  id: string;
  nama_petugas: string;
  role: string;
  username: string | null;
  password_hash: string | null;
  is_active: boolean | null;
  must_change_password: boolean | null;
  token_version: number | null;
  last_login_at: string | null;
};

type SessionRow = {
  id: string;
  officer_id: string;
  refresh_hash: string;
  expires_at: string;
  revoked_at: string | null;
};

export class OfficerAuthError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "OfficerAuthError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeUsername(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(username);
}

function requireSupabase() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new OfficerAuthError(
      "AUTH_STORE_UNAVAILABLE",
      "Database petugas belum dikonfigurasi di server.",
      503
    );
  }
  return supabase;
}

function isMissingSchemaError(error: any): boolean {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return (
    code === "42703" ||
    code === "42P01" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    /does not exist|schema cache|could not find the table|column .* does not exist/i.test(message)
  );
}

function schemaError(): OfficerAuthError {
  return new OfficerAuthError(
    "AUTH_SCHEMA_NOT_MIGRATED",
    "Fitur login baru belum siap. Jalankan migrasi auth petugas terlebih dahulu (lihat docs/AUTH-PETUGAS.md).",
    503
  );
}

function internalError(message = "Terjadi kesalahan pada layanan login."): OfficerAuthError {
  return new OfficerAuthError("AUTH_INTERNAL", message, 500);
}

function asOfficerProfile(row: OfficerRow): OfficerProfile {
  return {
    id: String(row.id),
    nama: String(row.nama_petugas || "Petugas"),
    role: String(row.role || "PETUGAS"),
  };
}

function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(String(raw)).digest("hex");
}

function hashUsername(username: string): string {
  return createHash("sha256").update(String(username)).digest("hex");
}

function userAgent(req: any): string {
  return String(req?.headers?.["user-agent"] || "").slice(0, 300);
}

function requestIpHash(req: any): string {
  try {
    return hashIp(getClientIp(req), req?.headers?.["user-agent"]);
  } catch {
    return "";
  }
}

async function getOfficerByUsername(username: string): Promise<OfficerRow | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("officers")
    .select(OFFICER_AUTH_COLUMNS)
    .eq("username", username)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) throw schemaError();
    throw internalError();
  }
  return (data as OfficerRow | null) || null;
}

async function getOfficerById(id: string): Promise<OfficerRow | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("officers")
    .select(OFFICER_AUTH_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) throw schemaError();
    throw internalError();
  }
  return (data as OfficerRow | null) || null;
}

export async function logLoginAttempt(input: {
  req: any;
  username?: string;
  officerId?: string | null;
  success: boolean;
  reason: string;
}): Promise<void> {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from("officer_login_logs").insert([
      {
        officer_id: input.officerId || null,
        username_hash: input.username ? hashUsername(input.username) : null,
        success: Boolean(input.success),
        reason: String(input.reason || "").slice(0, 80),
        ip_hash: requestIpHash(input.req) || null,
        user_agent: userAgent(input.req) || null,
      },
    ]);
  } catch {
    // Audit bersifat best-effort; jangan menggagalkan login bila tabel belum ada.
  }
}

async function createSession(officerId: string, req: any) {
  const supabase = requireSupabase();
  const rawToken = randomBytes(32).toString("base64url");
  const refreshHash = hashRefreshToken(rawToken);
  const expiresAt = Date.now() + OFFICER_SESSION_TTL_MS;
  const sessionId = randomUUID();

  const { data, error } = await supabase
    .from("officer_sessions")
    .insert([
      {
        id: sessionId,
        officer_id: officerId,
        refresh_hash: refreshHash,
        expires_at: new Date(expiresAt).toISOString(),
        ip_hash: requestIpHash(req) || null,
        user_agent: userAgent(req) || null,
      },
    ])
    .select("id, expires_at")
    .single();

  if (error) {
    if (isMissingSchemaError(error)) throw schemaError();
    throw internalError("Gagal membuat sesi login.");
  }

  return {
    id: String((data as any)?.id || sessionId),
    token: rawToken,
    refreshHash,
    expiresAt: Date.parse(String((data as any)?.expires_at || "")) || expiresAt,
  };
}

async function findSessionByRefreshToken(rawToken: string): Promise<SessionRow | null> {
  const supabase = requireSupabase();
  const refreshHash = hashRefreshToken(rawToken);
  const { data, error } = await supabase
    .from("officer_sessions")
    .select("id,officer_id,refresh_hash,expires_at,revoked_at")
    .eq("refresh_hash", refreshHash)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) throw schemaError();
    throw internalError();
  }
  return (data as SessionRow | null) || null;
}

async function revokeSession(sessionId: string): Promise<void> {
  try {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase
      .from("officer_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", sessionId)
      .is("revoked_at", null);
  } catch {
    // best-effort
  }
}

export async function revokeAllOfficerSessions(officerId: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    if (!supabase) return false;
    const { error } = await supabase
      .from("officer_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("officer_id", officerId)
      .is("revoked_at", null);
    return !error;
  } catch {
    return false;
  }
}

async function rotateSession(session: SessionRow, req: any) {
  const supabase = requireSupabase();
  const nextToken = randomBytes(32).toString("base64url");
  const nextTokenHash = hashRefreshToken(nextToken);

  const { data, error } = await supabase
    .from("officer_sessions")
    .update({
      refresh_hash: nextTokenHash,
      last_used_at: new Date().toISOString(),
      ip_hash: requestIpHash(req) || null,
      user_agent: userAgent(req) || null,
    })
    .eq("id", session.id)
    .eq("refresh_hash", session.refresh_hash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id, expires_at")
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error)) throw schemaError();
    throw internalError("Gagal memperbarui sesi login.");
  }
  if (!data) {
    // Bisa karena sesi kedaluwarsa/dicabut, atau kalah balapan dengan refresh
    // lain (dua tab). Jangan cabut sesi: tab yang menang harus tetap hidup.
    throw new OfficerAuthError(
      "SESSION_INVALID",
      "Sesi petugas tidak valid/kedaluwarsa. Login ulang.",
      401
    );
  }

  const expiresAt = Date.parse(String((data as any).expires_at)) || Date.parse(session.expires_at);
  return { token: nextToken, expiresAt };
}

export interface LoginResult {
  officer: OfficerProfile;
  token: string;
  refreshToken: string;
  /** Sisa umur access token (sudah dibatasi umur sesi). */
  expiresInMs: number;
  /** Sisa umur absolut sesi refresh. */
  sessionExpiresInMs: number;
  sessionExpiresAt: number;
  mustChangePassword: boolean;
}

export async function loginOfficer(input: {
  username: unknown;
  password: unknown;
  req: any;
}): Promise<LoginResult> {
  const username = normalizeUsername(input.username);
  const password = String(input.password ?? "");

  if (!isValidUsername(username) || !password) {
    await verifyDummyPassword(password || "dummy-password");
    await logLoginAttempt({
      req: input.req,
      username,
      success: false,
      reason: "INVALID_INPUT",
    });
    throw new OfficerAuthError("INVALID_CREDENTIALS", "Username atau password salah.", 401);
  }

  const officer = await getOfficerByUsername(username);
  if (!officer || officer.is_active === false || !officer.password_hash) {
    await verifyDummyPassword(password);
    await logLoginAttempt({
      req: input.req,
      username,
      officerId: officer?.id || null,
      success: false,
      reason: officer?.is_active === false ? "INACTIVE" : "INVALID_CREDENTIALS",
    });
    throw new OfficerAuthError("INVALID_CREDENTIALS", "Username atau password salah.", 401);
  }

  const passwordOk = await verifyPassword(password, officer.password_hash);
  if (!passwordOk) {
    await logLoginAttempt({
      req: input.req,
      username,
      officerId: officer.id,
      success: false,
      reason: "INVALID_CREDENTIALS",
    });
    throw new OfficerAuthError("INVALID_CREDENTIALS", "Username atau password salah.", 401);
  }

  const session = await createSession(String(officer.id), input.req);
  const profile = asOfficerProfile(officer);
  const token = signOfficerToken(profile, {
    sessionId: session.id,
    tokenVersion: Number(officer.token_version || 0),
    expiresAt: session.expiresAt,
  });

  try {
    const supabase = requireSupabase();
    await supabase
      .from("officers")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", officer.id);
  } catch {
    // best-effort
  }

  await logLoginAttempt({
    req: input.req,
    username,
    officerId: officer.id,
    success: true,
    reason: "OK",
  });

  const now = Date.now();
  const sessionExpiresInMs = Math.max(0, session.expiresAt - now);
  return {
    officer: profile,
    token,
    refreshToken: session.token,
    expiresInMs: Math.max(0, Math.min(OFFICER_ACCESS_TTL_MS, sessionExpiresInMs)),
    sessionExpiresInMs,
    sessionExpiresAt: session.expiresAt,
    mustChangePassword: Boolean(officer.must_change_password),
  };
}

export interface RefreshResult {
  officer: OfficerProfile;
  token: string;
  refreshToken: string;
  /** Sisa umur access token (sudah dibatasi umur sesi). */
  expiresInMs: number;
  /** Sisa umur absolut sesi refresh. */
  sessionExpiresInMs: number;
  sessionExpiresAt: number;
  mustChangePassword: boolean;
}

export async function refreshOfficer(input: {
  refreshToken: string;
  req: any;
}): Promise<RefreshResult> {
  const rawToken = String(input.refreshToken || "");
  if (!rawToken) {
    throw new OfficerAuthError("SESSION_INVALID", "Sesi petugas tidak valid/kedaluwarsa. Login ulang.", 401);
  }

  const session = await findSessionByRefreshToken(rawToken);
  const expiresAt = session ? Date.parse(session.expires_at) : 0;
  if (!session || session.revoked_at || !expiresAt || Date.now() >= expiresAt) {
    throw new OfficerAuthError("SESSION_INVALID", "Sesi petugas tidak valid/kedaluwarsa. Login ulang.", 401);
  }

  const officer = await getOfficerById(String(session.officer_id));
  if (!officer || officer.is_active === false || !officer.password_hash) {
    await revokeSession(session.id);
    throw new OfficerAuthError("SESSION_INVALID", "Sesi petugas tidak valid/kedaluwarsa. Login ulang.", 401);
  }

  const rotated = await rotateSession(session, input.req);
  const profile = asOfficerProfile(officer);
  const token = signOfficerToken(profile, {
    sessionId: session.id,
    tokenVersion: Number(officer.token_version || 0),
    expiresAt: rotated.expiresAt,
  });

  const now = Date.now();
  const sessionExpiresInMs = Math.max(0, rotated.expiresAt - now);
  return {
    officer: profile,
    token,
    refreshToken: rotated.token,
    expiresInMs: Math.max(0, Math.min(OFFICER_ACCESS_TTL_MS, sessionExpiresInMs)),
    sessionExpiresInMs,
    sessionExpiresAt: rotated.expiresAt,
    mustChangePassword: Boolean(officer.must_change_password),
  };
}

export async function logoutOfficer(refreshToken: string): Promise<void> {
  try {
    if (!refreshToken) return;
    const session = await findSessionByRefreshToken(refreshToken);
    if (session) await revokeSession(session.id);
  } catch {
    // Logout harus tetap berhasil dari sisi klien.
  }
}

export async function changeOfficerPassword(input: {
  officerId: string;
  oldPassword: unknown;
  newPassword: unknown;
  req: any;
}): Promise<void> {
  const officer = await getOfficerById(String(input.officerId));
  if (!officer || !officer.password_hash) {
    throw new OfficerAuthError("INVALID_OLD_PASSWORD", "Password lama salah.", 401);
  }

  const oldPassword = String(input.oldPassword ?? "");
  const newPassword = String(input.newPassword ?? "");
  const oldOk = await verifyPassword(oldPassword, officer.password_hash);
  if (!oldOk) {
    await logLoginAttempt({
      req: input.req,
      username: officer.username || undefined,
      officerId: officer.id,
      success: false,
      reason: "CHANGE_PASSWORD_OLD_INVALID",
    });
    throw new OfficerAuthError("INVALID_OLD_PASSWORD", "Password lama salah.", 400);
  }
  if (oldPassword === newPassword) {
    throw new OfficerAuthError("PASSWORD_SAME", "Password baru harus berbeda dari password lama.", 400);
  }

  const policy = validatePasswordPolicy(newPassword, officer.username || undefined);
  if (policy.ok === false) {
    throw new OfficerAuthError("PASSWORD_POLICY", policy.message, 400);
  }

  const supabase = requireSupabase();
  const nextVersion = Number(officer.token_version || 0) + 1;

  // Cabut sesi lama LEBIH DULU. Bila pencabutan gagal, jangan ubah password:
  // sesi refresh yang dicuri tidak boleh tetap hidup setelah password berubah.
  const revoked = await revokeAllOfficerSessions(String(officer.id));
  if (!revoked) {
    throw new OfficerAuthError(
      "AUTH_INTERNAL",
      "Gagal mencabut sesi lama. Password belum diubah; coba lagi.",
      500
    );
  }

  const { error } = await supabase
    .from("officers")
    .update({
      password_hash: await hashPassword(newPassword),
      must_change_password: false,
      password_changed_at: new Date().toISOString(),
      token_version: nextVersion,
    })
    .eq("id", officer.id);

  if (error) {
    if (isMissingSchemaError(error)) throw schemaError();
    throw internalError("Gagal menyimpan password baru.");
  }

  await logLoginAttempt({
    req: input.req,
    username: officer.username || undefined,
    officerId: officer.id,
    success: true,
    reason: "PASSWORD_CHANGED",
  });
}

export function isOfficerAuthStoreConfigured(): boolean {
  return Boolean(getSupabase());
}
