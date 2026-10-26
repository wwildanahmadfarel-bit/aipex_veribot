import { handleOfficerLogin } from "../_lib/officer-http.js";

// POST /api/admin/login — username + password petugas.
// Rate limit, scrypt, JWT access token, refresh cookie HttpOnly.
export default async function handler(req: any, res: any) {
  return handleOfficerLogin(req, res);
}
