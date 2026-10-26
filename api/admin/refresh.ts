import { handleOfficerRefresh } from "../_lib/officer-http.js";

// POST /api/admin/refresh — baca cookie refresh HttpOnly, rotasi sesi,
// lalu terbitkan access JWT baru. Tidak menerima refresh token dari body.
export default async function handler(req: any, res: any) {
  return handleOfficerRefresh(req, res);
}
