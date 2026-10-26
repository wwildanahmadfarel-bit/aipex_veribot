import { handleOfficerChangePassword } from "../_lib/officer-http.js";

// POST /api/admin/change-password — wajib Bearer access token.
// Setelah berhasil, semua sesi refresh dicabut dan petugas login ulang.
export default async function handler(req: any, res: any) {
  return handleOfficerChangePassword(req, res);
}
