import { readJsonBody, setCors } from "../_lib/http";
import { findFallbackOfficer, getSupabase, normalizeAccessCode } from "../_lib/store";

// POST /api/admin/login — login petugas (Supabase officers → fallback resmi)
export default async function handler(req: any, res: any) {
  if (setCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method not allowed" });
  try {
    const body = await readJsonBody(req);
    const kodeAkses = body.kodeAkses || body.kode_akses || body.pin;
    if (!kodeAkses || typeof kodeAkses !== "string" || !kodeAkses.trim()) {
      return res.status(400).json({ success: false, message: "Kode akses wajib diisi" });
    }
    const trimmedCode = kodeAkses.trim();
    const normalizedCode = normalizeAccessCode(trimmedCode);
    if (!normalizedCode) {
      return res.status(400).json({ success: false, message: "Kode akses wajib diisi" });
    }
    if (/^(TKT|FT)-/i.test(normalizedCode)) {
      return res.status(401).json({
        success: false,
        message: "Itu kode tiket warga (TKT-...), bukan kode akses petugas. Gunakan kode akses petugas, contoh: 849201 atau LOKET-SUKAMAJU-01.",
        hint: "Kode tiket untuk lacak status, kode akses untuk login petugas.",
      });
    }

    let officer: { id: string; nama_petugas: string; role: string; kode_akses?: string } | null = null;
    let errorFromDb: any = null;
    const supabase = getSupabase();
    if (supabase) {
      try {
        const exact = await supabase
          .from("officers")
          .select("id, nama_petugas, role, kode_akses")
          .eq("kode_akses", trimmedCode)
          .maybeSingle();
        if (!exact.error && exact.data) {
          officer = exact.data;
        } else {
          if (exact.error && (exact.error as any).code !== "PGRST116") errorFromDb = exact.error;
          const insensitive = await supabase
            .from("officers")
            .select("id, nama_petugas, role, kode_akses")
            .ilike("kode_akses", normalizedCode)
            .maybeSingle();
          if (!insensitive.error && insensitive.data) {
            officer = insensitive.data;
          } else if (insensitive.error && (insensitive.error as any).code !== "PGRST116") {
            errorFromDb = insensitive.error;
          }
        }
      } catch (err) {
        errorFromDb = err;
      }
    }
    if (!officer) {
      const matched = findFallbackOfficer(normalizedCode);
      if (matched) officer = matched;
    }
    if (!officer) {
      return res.status(401).json({
        success: false,
        message: "Kode Akses Petugas tidak valid! Periksa kembali kode (contoh: 849201 atau LOKET-SUKAMAJU-01). Kode tiket TKT-... tidak bisa dipakai untuk login.",
        details: errorFromDb?.message,
      });
    }
    return res.json({
      success: true,
      message: "Login petugas berhasil",
      officer: { id: officer.id, nama: officer.nama_petugas, role: officer.role },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message || "Terjadi kesalahan sistem" });
  }
}
