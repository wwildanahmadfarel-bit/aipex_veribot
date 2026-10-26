// Sesi petugas di browser.
//
// Access JWT disimpan HANYA di memori modul ini (tidak di localStorage).
// Refresh token ada di cookie HttpOnly yang tidak bisa dibaca JavaScript.
// Profil (id/nama/role) boleh disimpan di localStorage; token TIDAK.
//
// Saat halaman reload, access token hilang -> panggil /api/admin/refresh
// memakai cookie HttpOnly untuk mendapatkan access token baru.

export interface OfficerProfile {
  id: string;
  nama: string;
  role: string;
}

const PROFILE_KEY = "aipex_officer";

let accessToken = "";
let currentOfficer: OfficerProfile | null = readStoredProfile();
let mustChangePassword = false;
let refreshInFlight: Promise<OfficerProfile | null> | null = null;

function readStoredProfile(): OfficerProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfficerProfile> & { token?: string };
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.token === "string" && parsed.token) {
      // Migrasi dari versi lama: buang access token dari localStorage.
      delete parsed.token;
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(parsed));
      } catch {}
    }
    if (!parsed.id || !parsed.nama || !parsed.role) return null;
    return { id: String(parsed.id), nama: String(parsed.nama), role: String(parsed.role) };
  } catch {
    return null;
  }
}

function persistProfile(profile: OfficerProfile | null): void {
  try {
    if (!profile) {
      localStorage.removeItem(PROFILE_KEY);
      return;
    }
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ id: profile.id, nama: profile.nama, role: profile.role })
    );
  } catch {}
}

function setSession(profile: OfficerProfile, token: string, changeRequired = false): void {
  currentOfficer = profile;
  accessToken = token;
  mustChangePassword = changeRequired;
  persistProfile(profile);
}

export function clearOfficerSession(): void {
  currentOfficer = null;
  accessToken = "";
  mustChangePassword = false;
  refreshInFlight = null;
  persistProfile(null);
}

export function getOfficerProfile(): OfficerProfile | null {
  return currentOfficer || readStoredProfile();
}

export function getOfficerName(): string {
  return getOfficerProfile()?.nama || "";
}

export function isPasswordChangeRequired(): boolean {
  return mustChangePassword;
}

export class OfficerAuthClientError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "AUTH_ERROR", status = 0) {
    super(message);
    this.name = "OfficerAuthClientError";
    this.code = code;
    this.status = status;
  }
}

async function parseJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function refreshOfficerSession(): Promise<OfficerProfile | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      // Dua tab bisa me-refresh hampir bersamaan. Tab yang kalah mendapat 401
      // karena cookie-nya sudah dirotasi tab lain; coba lagi dengan jeda +
      // jitter agar retry kedua tab tidak bertabrakan lagi.
      const retryDelays = [250, 750];
      for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        const res = await fetch("/api/admin/refresh", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
        });
        const body = await parseJson(res);
        if (res.ok && body?.success && body?.token && body?.officer) {
          const profile: OfficerProfile = {
            id: String(body.officer.id),
            nama: String(body.officer.nama),
            role: String(body.officer.role),
          };
          setSession(profile, String(body.token), Boolean(body.mustChangePassword));
          return profile;
        }
        if (res.status === 401 && attempt < retryDelays.length) {
          const delay = retryDelays[attempt] + Math.floor(Math.random() * 150);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        break;
      }
      clearOfficerSession();
      return null;
    } catch {
      clearOfficerSession();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Pastikan ada sesi yang bisa dipakai; refresh dari cookie bila perlu. */
export async function ensureOfficerSession(): Promise<OfficerProfile | null> {
  if (accessToken && currentOfficer) return currentOfficer;
  return refreshOfficerSession();
}

/** Token untuk header Authorization; kosong bila sesi tidak ada. */
export async function ensureOfficerToken(): Promise<string> {
  const profile = await ensureOfficerSession();
  if (!profile || mustChangePassword) return "";
  return accessToken;
}

export async function loginOfficer(
  username: string,
  password: string
): Promise<{ officer: OfficerProfile; mustChangePassword: boolean; message?: string }> {
  let res: Response;
  try {
    res = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new OfficerAuthClientError(
      "Tidak bisa terhubung ke server. Jalankan `npm run dev` lalu coba lagi.",
      "NETWORK_ERROR"
    );
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new OfficerAuthClientError(
      "Endpoint /api/admin/login tidak ditemukan. Jalankan server dengan `npm run dev` (bukan `vite preview` saja).",
      "BACKEND_NOT_FOUND",
      res.status
    );
  }

  const body = await parseJson(res);
  if (!res.ok || !body?.success || !body?.token || !body?.officer) {
    throw new OfficerAuthClientError(
      body?.message || "Username atau password salah.",
      body?.code || "LOGIN_FAILED",
      res.status
    );
  }

  const profile: OfficerProfile = {
    id: String(body.officer.id),
    nama: String(body.officer.nama),
    role: String(body.officer.role),
  };
  setSession(profile, String(body.token), Boolean(body.mustChangePassword));
  return {
    officer: profile,
    mustChangePassword: Boolean(body.mustChangePassword),
    message: body?.message,
  };
}

export async function logoutOfficer(): Promise<void> {
  try {
    await fetch("/api/admin/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // Tetap bersihkan sesi lokal.
  } finally {
    clearOfficerSession();
  }
}

export async function changeOfficerPassword(
  oldPassword: string,
  newPassword: string
): Promise<void> {
  const profile = await ensureOfficerSession();
  if (!profile || !accessToken) {
    throw new OfficerAuthClientError("Sesi petugas tidak ditemukan. Login ulang.", "NO_SESSION", 401);
  }

  const res = await fetch("/api/admin/change-password", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  const body = await parseJson(res);
  if (!res.ok || !body?.success) {
    if (res.status === 401) clearOfficerSession();
    throw new OfficerAuthClientError(
      body?.message || "Gagal mengganti password.",
      body?.code || "CHANGE_PASSWORD_FAILED",
      res.status
    );
  }
  clearOfficerSession();
}

/**
 * Fetch dengan Bearer. Bila 401, coba refresh sekali lalu ulangi request.
 * Return Response terakhir; pemanggil tetap memeriksa status.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const profile = await ensureOfficerSession();
  if (!profile || !accessToken) {
    return new Response(
      JSON.stringify({
        success: false,
        code: "NO_SESSION",
        message: "Sesi petugas tidak ditemukan. Login ulang.",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const doFetch = (token: string): Promise<Response> => {
    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, {
      ...init,
      credentials: init.credentials || "same-origin",
      headers,
    });
  };

  let res = await doFetch(accessToken);
  if (res.status === 401) {
    const refreshed = await refreshOfficerSession();
    if (refreshed && accessToken) {
      res = await doFetch(accessToken);
    }
  }
  return res;
}
