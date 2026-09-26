import handler from "../admin/login.js";

// POST /api/officer/login — alias dari /api/admin/login
export default function (req: any, res: any) {
  return (handler as any)(req, res);
}
