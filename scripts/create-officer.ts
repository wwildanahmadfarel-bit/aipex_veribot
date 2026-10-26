/**
 * Buat / reset akun petugas dengan password sementara.
 *
 * Pemakaian:
 *   npx tsx scripts/create-officer.ts --username petugas1 --nama "Nama Petugas" --role PETUGAS
 *
 * Password TIDAK dimasukkan lewat command line. Script membuat password acak
 * dan menampilkannya SEKALI di terminal. Petugas wajib menggantinya saat login
 * pertama (must_change_password=true).
 *
 * Env yang dibaca dari .env.local / .env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY (disarankan) atau SUPABASE_KEY
 *
 * Jangan pernah menempelkan service role key ke command line, chat, atau commit.
 */

import dotenv from "dotenv";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  generateTemporaryPassword,
  hashPassword,
  validatePasswordPolicy,
} from "../api/_lib/password.js";

for (const envFile of [".env.local", ".env"]) {
  try {
    dotenv.config({ path: path.join(process.cwd(), envFile), override: false, quiet: true });
  } catch {}
}

function cleanUrl(raw: string): string {
  return raw.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
}

function argValue(name: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

function usage(): void {
  console.log(
    [
      "Pemakaian:",
      '  npx tsx scripts/create-officer.ts --username petugas1 --nama "Nama Petugas" [--role PETUGAS|SUPER_ADMIN]',
      "",
      "Password sementara dibuat otomatis dan ditampilkan sekali.",
    ].join("\n")
  );
}

async function main(): Promise<void> {
  const username = argValue("username").trim().toLowerCase();
  const nama = argValue("nama").trim();
  const role = (argValue("role") || "PETUGAS").trim().toUpperCase();

  if (!username || !nama || process.argv.includes("--help")) {
    usage();
    process.exitCode = username && nama ? 0 : 1;
    return;
  }
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
    throw new Error(
      "Username tidak valid. Gunakan 3-64 karakter: huruf kecil, angka, titik, garis bawah, atau strip."
    );
  }
  if (!["PETUGAS", "SUPER_ADMIN"].includes(role)) {
    throw new Error("Role harus PETUGAS atau SUPER_ADMIN (mengikuti CHECK constraint database).");
  }

  const url = cleanUrl(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
  if (!url || !key) {
    throw new Error("SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY/SUPABASE_KEY belum diisi di .env.local.");
  }

  const password = generateTemporaryPassword(16);
  const policy = validatePasswordPolicy(password, username);
  if (policy.ok === false) throw new Error(`Password acak gagal validasi: ${policy.message}`);
  const passwordHash = await hashPassword(password);

  const supabase = createClient(url, key);
  const { data: existing, error: lookupError } = await supabase
    .from("officers")
    .select("id,token_version")
    .eq("username", username)
    .maybeSingle();

  if (lookupError) {
    if (String(lookupError.code) === "42703" || /username.*does not exist/i.test(lookupError.message)) {
      throw new Error("Kolom username belum ada. Jalankan migrasi 20261026_officer_auth_hardening.sql dulu.");
    }
    if (String(lookupError.code) === "PGRST205") {
      throw new Error(
        "Tabel/kolom auth belum ada. Jalankan migrasi 20261026_officer_auth_hardening.sql dulu."
      );
    }
    throw new Error(`Gagal membaca officers: ${lookupError.message}`);
  }

  if (existing?.id) {
    const nextVersion = Number(existing.token_version || 0) + 1;

    // Cabut sesi lama lebih dulu agar reset password tidak meninggalkan sesi
    // refresh yang masih hidup bila update akun gagal.
    const { error: revokeError } = await supabase
      .from("officer_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("officer_id", String(existing.id))
      .is("revoked_at", null);
    if (revokeError) {
      throw new Error(`Gagal mencabut sesi lama: ${revokeError.message}`);
    }

    const { error } = await supabase
      .from("officers")
      .update({
        nama_petugas: nama,
        role,
        password_hash: passwordHash,
        must_change_password: true,
        is_active: true,
        token_version: nextVersion,
        password_changed_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(`Gagal reset akun: ${error.message}`);

    console.log("Akun petugas di-reset.");
  } else {
    const { error } = await supabase.from("officers").insert([
      {
        id: randomUUID(),
        username,
        nama_petugas: nama,
        role,
        password_hash: passwordHash,
        must_change_password: true,
        is_active: true,
        token_version: 0,
      },
    ]);
    if (error) throw new Error(`Gagal membuat akun: ${error.message}`);
    console.log("Akun petugas dibuat.");
  }

  console.log("");
  console.log(`Username : ${username}`);
  console.log(`Nama     : ${nama}`);
  console.log(`Role     : ${role}`);
  console.log(`Password : ${password}`);
  console.log("");
  console.log("Password sementara ini hanya ditampilkan SEKALI. Serahkan secara aman.");
  console.log("Petugas wajib mengganti password saat login pertama.");
}

main().catch((err) => {
  console.error(`[create-officer] ${err?.message || err}`);
  process.exitCode = 1;
});
