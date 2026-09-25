import React from "react";

interface FooterProps {
  onNavigateHome: () => void;
  /** Navigasi terjaga ke section portal (melewati popup konfirmasi saat mode officer). */
  onRequestNav?: (targetId: string, destLabel: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigateHome, onRequestNav }) => {
  const goSection = (targetId: string, destLabel: string) => {
    if (onRequestNav) {
      onRequestNav(targetId, destLabel);
      return;
    }
    onNavigateHome();
    setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth" });
    }, 150);
  };
  return (
    <footer className="w-full bg-[#1E293B] text-slate-300 py-12 px-4 lg:px-8 mt-16 border-t border-slate-700/60">
      <div className="max-w-[1200px] mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 pb-12 border-b border-slate-700/60">
        {/* Brand Col */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={onNavigateHome}>
            <span className="material-symbols-outlined text-blue-400 text-[28px]">
              account_balance
            </span>
            <span className="text-xl font-bold text-white font-heading">
              AIPEX VeriBot
            </span>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">
            Platform kecerdasan kognitif pra-verifikasi identitas dan layanan kependudukan terpadu,
            mendukung efisiensi birokrasi berkecepatan tinggi dengan validasi dokumen otomatis.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1E293B] text-[11px] font-semibold text-emerald-400 border border-emerald-500/30">
              <span className="material-symbols-outlined text-[14px]">verified_user</span>
              UU PDP Compliant
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1E293B] text-[11px] font-semibold text-blue-300 border border-blue-500/30">
              <span className="material-symbols-outlined text-[14px]">psychology</span>
              Cognitive AI Powered
            </span>
          </div>
        </div>

        {/* Akses Warga */}
        <div className="flex flex-col gap-3">
          <span className="text-base text-white font-semibold font-heading">
            Akses Warga
          </span>
          <div className="flex flex-col gap-2 text-sm text-slate-400">
            <button
              onClick={() => goSection("portalView", "Katalog Layanan")}
              className="text-left hover:text-white transition-colors cursor-pointer"
            >
              Katalog Layanan Online
            </button>
            <button
              onClick={() => goSection("lacakSection", "Pelacakan Tiket QR")}
              className="text-left hover:text-white transition-colors cursor-pointer"
            >
              Pelacakan Tiket QR
            </button>
            <button
              onClick={() => goSection("alurLayanan", "Panduan Prosedur Warga")}
              className="text-left hover:text-white transition-colors cursor-pointer"
            >
              Panduan Prosedur Warga
            </button>
            <button
              onClick={() => goSection("faqSection", "Pusat Bantuan & Regulasi")}
              className="text-left hover:text-white transition-colors cursor-pointer"
            >
              Pusat Bantuan & Regulasi
            </button>
          </div>
        </div>

        {/* Layanan Administrasi */}
        <div className="flex flex-col gap-3">
          <span className="text-base text-white font-semibold font-heading">
            Layanan Administrasi
          </span>
          <div className="flex flex-col gap-2 text-sm text-slate-400">
            <span>Penerbitan Surat Pengantar KTP</span>
            <span>Perubahan Data Kartu Keluarga</span>
            <span>Surat Keterangan Pindah (SKPWNI)</span>
            <span>Sinkronisasi NIK & Dukcapil</span>
            <span>Penerbitan Kartu Identitas Anak</span>
          </div>
        </div>

        {/* Lokasi Pelayanan */}
        <div className="flex flex-col gap-3">
          <span className="text-base text-white font-semibold font-heading">
            Lokasi Pelayanan
          </span>
          <p className="text-sm text-slate-400 leading-relaxed">
            Kantor Kelurahan Sukamaju<br />
            Jl. Praja Abdi No. 45, Kecamatan Maju Sejahtera
          </p>
          <div className="flex flex-col gap-1 text-xs text-slate-400">
            <span>Jam Operasional: Senin - Jumat (08.00 - 15.30 WIB)</span>
            <span>Call Center / WhatsApp: +62 811-2345-6789</span>
            <span>Email: layanan@sukamaju.desa.id</span>
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
        <p>© 2026 Pemerintah Kelurahan Sukamaju & Ditjen Dukcapil. Hak Cipta Dilindungi.</p>
        <div className="flex items-center gap-4">
          <span className="text-slate-400 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
            Sistem Terhubung Ditjen Dukcapil Kemendagri
          </span>
        </div>
      </div>
    </footer>
  );
};
