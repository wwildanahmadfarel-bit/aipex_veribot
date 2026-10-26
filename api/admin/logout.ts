import { handleOfficerLogout } from "../_lib/officer-http.js";

// POST /api/admin/logout — cabut sesi refresh + hapus cookie.
export default async function handler(req: any, res: any) {
  return handleOfficerLogout(req, res);
}
