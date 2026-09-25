import { setCors } from "../_lib/http";
import { fotoRetentionDays } from "../_lib/tiket-foto";
import { getSupabase } from "../_lib/store";

// GET /api/cron/purge-tiket-foto — sweeper foto tiket terbengkalai.
// Guard: header x-cron-secret == CRON_SECRET (401 bila cocok tidak).
// Menghapus objek + null-kan kolom untuk tiket NON-FINAL berumur > retensi.
// Baris tiket, NIK, dan log TIDAK disentuh.
export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }
  const secret = String(process.env.CRON_SECRET || "").trim();
  const got = String(req.headers?.["x-cron-secret"] || "").trim();
  if (!secret || !got || got !== secret) {
    return res.status(401).json({ success: false, message: "Cron tidak diotorisasi." });
  }
  const supabase = getSupabase();
  if (!supabase) return res.json({ success: true, deleted: 0, note: "Database tidak terhubung." });
  try {
    const days = fotoRetentionDays();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from("tickets")
      .select("kode_tiket,foto_path")
      .not("foto_path", "is", null)
      .lt("created_at", cutoff);
    if (error) return res.status(500).json({ success: false, message: String(error.message || error).slice(0, 200) });
    let deleted = 0;
    for (const r of rows || []) {
      const kode = String((r as any)?.kode_tiket || "");
      const path = String((r as any)?.foto_path || "");
      if (!kode || !path) continue;
      // Tiket final seharusnya sudah purge saat PATCH; bila masih ada (mis. gagal
      // hapus), sweeper menutupnya di sini. Status tidak diubah.
      try {
        await supabase.storage.from("tiket-fotos").remove([path]);
        await supabase.from("tickets").update({ foto_path: null, foto_iv: null }).eq("kode_tiket", kode);
        deleted += 1;
      } catch {}
    }
    try {
      console.log(`[Foto] sweeper: ${deleted} foto terbengkalai dihapus (retensi ${days} hari)`);
    } catch {}
    return res.json({ success: true, deleted, retentionDays: days });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: String(err?.message || err).slice(0, 200) });
  }
}
