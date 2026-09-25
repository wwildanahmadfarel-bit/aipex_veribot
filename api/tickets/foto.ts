import { setCors } from "../_lib/http";
import { checkSimpleRateLimit } from "../_lib/rate-limit";
import { lihatFotoTiket } from "../_lib/tiket-foto";

// GET /api/tickets/foto?kode=TKT-... — proksi byte foto terdekripsi (no-store).
// Akses: petugas Bearer (kode apapun) ATAU warga pemilik (tahu kode tiketnya
// sebagai capability). Anti-spam: 20x/10 mnt/IP. Tidak ada URL permanen —
// tiap lihat wajib request baru yang diautentikasi/di-rate-limit.
const FOTO_VIEW_10MIN = { windowMs: 10 * 60 * 1000, max: 20, prefix: "foto10" };

export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ success: false, message: "Method not allowed" });
  try {
    const rl = await checkSimpleRateLimit(req, FOTO_VIEW_10MIN);
    if (!rl.allowed) {
      return res.status(429).json({ success: false, message: "Terlalu sering membuka foto. Coba lagi nanti.", retryAfter: rl.retryAfterSec });
    }
    const kode = String(req.query?.kode || req.query?.kode_tiket || "").trim().toUpperCase();
    if (!kode) return res.status(400).json({ success: false, message: "Parameter kode tiket wajib." });
    const foto = await lihatFotoTiket(kode);
    if (!foto.ok || !foto.bytes) {
      return res.status(404).json({ success: false, message: foto.reason || "Foto tidak tersedia." });
    }
    try {
      res.setHeader("Content-Type", foto.mime);
      res.setHeader("Content-Length", String(foto.bytes.length));
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Content-Disposition", "inline");
    } catch {}
    return res.status(200).send(foto.bytes);
  } catch {
    return res.status(500).json({ success: false, message: "Gagal membuka foto." });
  }
}
