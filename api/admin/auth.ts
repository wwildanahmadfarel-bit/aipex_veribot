import {
  handleOfficerChangePassword,
  handleOfficerLogin,
  handleOfficerLogout,
  handleOfficerRefresh,
} from "../_lib/officer-http.js";

type OfficerHandler = (req: any, res: any) => Promise<void>;

const ACTIONS: Record<string, OfficerHandler> = {
  login: handleOfficerLogin,
  refresh: handleOfficerRefresh,
  logout: handleOfficerLogout,
  "change-password": handleOfficerChangePassword,
};

// Satu Serverless Function untuk empat route auth petugas. URL publik tidak
// berubah: /api/admin/login, /api/admin/refresh, /api/admin/logout, dan
// /api/admin/change-password di-rewrite oleh vercel.json ke sini. Ini menjaga
// jumlah fungsi tetap <= 12 pada paket Hobby Vercel.
export default async function handler(req: any, res: any) {
  const action = String(req.query?.action || "").toLowerCase();
  const route = ACTIONS[action];
  if (!route) {
    res.status(404).json({ error: "Aksi auth tidak dikenal." });
    return;
  }
  return route(req, res);
}
