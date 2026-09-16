import React, { useState } from "react";
import { ServiceCatalogItem, Ticket, PreScreenInitialData } from "../types";
import { catalogServices } from "../data/servicesData";
import { OcrPreScreenCard } from "./OcrPreScreenCard";

interface PortalHomeProps {
  onOpenWizard: (serviceName?: string) => void;
  onOpenRequirements: (service: ServiceCatalogItem) => void;
  onCheckTicket: (code: string) => void;
  onProceedFromPreScreen: (data: PreScreenInitialData) => void;
}

export const PortalHome: React.FC<PortalHomeProps> = ({
  onOpenWizard,
  onOpenRequirements,
  onCheckTicket,
  onProceedFromPreScreen,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [ticketSearchInput, setTicketSearchInput] = useState<string>("");

  const filteredServices = catalogServices.filter((service) => {
    const matchCategory = activeCategory === "all" || service.category === activeCategory;
    const matchSearch =
      searchQuery === "" ||
      service.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      service.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCategory && matchSearch;
  });

  const handleTicketSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketSearchInput.trim()) {
      alert("Silakan masukkan kode tiket Anda (contoh: TKT-202609-8410)");
      return;
    }
    onCheckTicket(ticketSearchInput.trim());
  };

  return (
    <div className="flex flex-col w-full space-y-8" id="portalView">
      {/* HERO & LACAK TIKET BANNER */}
      <section className="relative overflow-hidden bg-[#2563eb] text-white p-4 sm:p-6 md:p-8 shadow-xl mt-4 rounded-2xl">
        <div className="absolute -right-16 -top-16 w-48 h-48 sm:w-80 sm:h-80 rounded-full bg-white/15 blur-3xl pointer-events-none"></div>
        <div className="absolute right-[-10px] sm:right-4 bottom-2 sm:bottom-4 opacity-15 sm:opacity-25 pointer-events-none">
          <span className="material-symbols-outlined text-[100px] sm:text-[140px] md:text-[180px] leading-none text-white">
            smart_toy
          </span>
        </div>

        <div className="relative z-10 max-w-3xl flex flex-col gap-3 sm:gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-white/15 font-semibold text-[11px] sm:text-xs text-white backdrop-blur-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
              INOVASI LAYANAN PUBLIK DIGITAL KELURAHAN 2026
            </span>
          </div>

          <h1 className="font-bold text-2xl sm:text-3xl md:text-4xl text-white tracking-tight leading-tight font-heading">
            Layanan Pre-Screening Administrasi Kelurahan Berbasis AI
          </h1>

          <p className="text-sm sm:text-base text-blue-100 max-w-2xl leading-relaxed">
            Cek & Validasi Berkas Kependudukan dari Rumah. Sekali Datang ke Loket, Langsung Beres tanpa
            antre bolak-balik.
          </p>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pt-1">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 text-xs text-white backdrop-blur-xs">
              <span className="material-symbols-outlined text-[16px] text-emerald-300">security</span>
              reCAPTCHA v3 Protected
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 text-xs text-white backdrop-blur-xs">
              <span className="material-symbols-outlined text-[16px] text-blue-200">badge</span>
              IKD Integrated
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 text-xs text-white backdrop-blur-xs">
              <span className="material-symbols-outlined text-[16px] text-emerald-300">dns</span>
              Anti-DDoS Rate Limited
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-4 pt-2 sm:pt-1 w-full sm:w-auto">
            <button
              onClick={() => onOpenWizard("Penerbitan KTP-EL Baru / Penggantian")}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl bg-white text-[#2563eb] font-bold text-xs sm:text-sm shadow-md hover:bg-blue-50 transition-all cursor-pointer"
              type="button"
            >
              <span>Mulai Cek Dokumen Mandiri</span>
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
            <a
              href="#lacakSection"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl bg-white/10 text-white font-semibold text-xs sm:text-sm hover:bg-white/20 transition-all backdrop-blur-sm"
            >
              <span className="material-symbols-outlined text-[18px]">search</span>
              <span>Lacak Status Resi</span>
            </a>
          </div>
        </div>
      </section>

      {/* SEARCH & TRACKING BAR */}
      <section
        id="lacakSection"
        className="bg-white p-4 lg:p-6 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
      >
        <div className="flex items-start gap-3 max-w-md">
          <span className="material-symbols-outlined text-[#2563eb] text-[26px] mt-0.5 shrink-0">
            verified
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-900 font-heading">
              Lacak Berkas Mandiri Anda
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Masukkan kode tiket (contoh:{" "}
              <button
                type="button"
                onClick={() => {
                  setTicketSearchInput("TKT-202609-8410");
                  onCheckTicket("TKT-202609-8410");
                }}
                className="font-code-num text-red-600 hover:underline font-semibold cursor-pointer"
              >
                TKT-202609-8410
              </button>{" "}
              atau{" "}
              <button
                type="button"
                onClick={() => {
                  setTicketSearchInput("TKT-202508-001");
                  onCheckTicket("TKT-202508-001");
                }}
                className="font-code-num text-[#2563eb] hover:underline font-semibold cursor-pointer"
              >
                TKT-202508-001
              </button>
              ) untuk memeriksa status validasi AI atau catatan petugas loket.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleTicketSearch}
          className="w-full md:w-auto flex-1 max-w-lg flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-500 transition-all"
        >
          <span className="material-symbols-outlined text-slate-400 text-[20px] mr-2 shrink-0">
            search
          </span>
          <input
            type="text"
            value={ticketSearchInput}
            onChange={(e) => setTicketSearchInput(e.target.value)}
            placeholder="Ketik kode tiket Anda di sini..."
            className="w-full bg-transparent text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="submit"
            className="ml-2 px-4 py-2 rounded-lg bg-[#2563eb] text-white font-semibold text-xs hover:bg-blue-700 transition-colors shrink-0 cursor-pointer shadow-xs"
          >
            Periksa
          </button>
        </form>
      </section>

      {/* SIMULASI INTERAKTIF PRA-PEMERIKSAAN DOKUMEN (OCR AI) */}
      <section className="flex flex-col gap-3" id="simulasiSection">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] sm:text-xs uppercase font-bold text-[#2563eb] bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse"></span>
              SIMULASI INTERAKTIF
            </span>
            <h2 className="text-base sm:text-lg md:text-xl font-bold text-slate-900 font-heading">
              Pra-Pemeriksaan & Uji Fisik Dokumen (OCR)
            </h2>
          </div>
          <div className="text-[11px] sm:text-xs text-slate-500 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-emerald-600">verified_user</span>
            <span>Uji Coba Cepat Tanpa Perlu Berkas Asli</span>
          </div>
        </div>

        <OcrPreScreenCard onProceedToWizard={onProceedFromPreScreen} />
      </section>


      {/* 4 LANGKAH MUDAH PRE-SCREENING */}
      <section className="flex flex-col gap-3" id="alurLayanan">
        <div className="flex flex-wrap items-center justify-between gap-1.5 px-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-[#2563eb] bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-full">
              ALUR MANDIRI
            </span>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 font-heading inline-block">
              4 Langkah Pre-Screening Berkas
            </h2>
          </div>
          <p className="text-[11px] text-slate-500">Proses kilat sebelum ke loket kelurahan.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200/80 flex flex-col justify-between shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <span className="w-6 h-6 rounded-full bg-[#2563eb] text-white text-[11px] font-bold flex items-center justify-center">
                1
              </span>
              <span className="material-symbols-outlined text-[#2563eb] text-[18px]">assignment</span>
            </div>
            <div>
              <h3 className="font-bold text-xs sm:text-sm text-slate-900 leading-snug font-heading">
                Pilih Urusan
              </h3>
              <p className="text-[11px] text-slate-500 leading-snug line-clamp-1 mt-0.5">
                Tentukan jenis dokumen kependudukan.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-white border border-slate-200 flex flex-col justify-between shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <span className="w-6 h-6 rounded-full bg-blue-50 text-[#2563eb] text-[11px] font-bold flex items-center justify-center border border-blue-200">
                2
              </span>
              <span className="material-symbols-outlined text-[#2563eb] text-[18px]">cloud_upload</span>
            </div>
            <div>
              <h3 className="font-bold text-xs sm:text-sm text-slate-900 leading-snug font-heading">
                Upload Berkas
              </h3>
              <p className="text-[11px] text-slate-500 leading-snug line-clamp-1 mt-0.5">
                Unggah foto KTP, KK, atau berkas RT/RW.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-white border border-slate-200 flex flex-col justify-between shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <span className="w-6 h-6 rounded-full bg-blue-50 text-[#2563eb] text-[11px] font-bold flex items-center justify-center border border-blue-200">
                3
              </span>
              <span className="material-symbols-outlined text-[#2563eb] text-[18px]">psychology</span>
            </div>
            <div>
              <h3 className="font-bold text-xs sm:text-sm text-slate-900 leading-snug font-heading">
                Pemeriksaan AI
              </h3>
              <p className="text-[11px] text-slate-500 leading-snug line-clamp-1 mt-0.5">
                Sistem AI memvalidasi kejelasan dokumen.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 flex flex-col justify-between shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center">
                4
              </span>
              <span className="material-symbols-outlined text-emerald-600 text-[18px]">qr_code_2</span>
            </div>
            <div>
              <h3 className="font-bold text-xs sm:text-sm text-slate-900 leading-snug font-heading">
                Terbit Tiket QR
              </h3>
              <p className="text-[11px] text-slate-500 leading-snug line-clamp-1 mt-0.5">
                Dapatkan tiket antrean Fast-Track.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* KATALOG LAYANAN ADMINISTRASI KEPENDUDUKAN */}
      <section className="w-full flex flex-col gap-5 pt-2" id="katalogSection">
        <div className="text-center max-w-[720px] mx-auto flex flex-col items-center gap-2 px-2">
          <span className="text-[11px] font-bold text-[#2563eb] bg-blue-50 border border-blue-200 px-3.5 py-1 rounded-full uppercase tracking-wider">
            KATALOG LAYANAN ADMINISTRASI
          </span>
          <h2 className="text-xl sm:text-2xl md:text-3xl text-slate-900 font-bold text-center tracking-tight leading-tight font-heading">
            Pilih Urusan Kependudukan Anda
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 text-center max-w-[640px] leading-relaxed">
            Seluruh layanan pre-screening ini diverifikasi dengan standar Ditjen Dukcapil untuk
            memastikan berkas fisik dan digital Anda 100% lengkap sebelum berkunjung ke kelurahan.
          </p>
        </div>

        {/* Search & Filter Bar - Fully Responsive */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full bg-slate-50/80 p-2 sm:p-3 rounded-2xl border border-slate-200/80">
          {/* Search Input Box */}
          <div className="relative flex items-center w-full md:max-w-[340px] lg:max-w-[380px]">
            <span className="material-symbols-outlined absolute left-3.5 text-slate-400 text-[20px] pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari layanan... contoh: KTP, Akta, Pindah"
              className="w-full h-10 sm:h-11 text-xs sm:text-sm bg-white border border-slate-200 rounded-xl py-2 pl-10 pr-9 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-[#2563eb] shadow-2xs transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer transition-colors"
                title="Hapus pencarian"
              >
                <span className="material-symbols-outlined text-[15px]">close</span>
              </button>
            )}
          </div>

          {/* Category Filter Pills (Touch-scrollable on mobile, flex-wrap on tablet/desktop) */}
          <div className="overflow-x-auto flex items-center gap-2 no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden py-1 px-0.5 sm:flex-wrap">
            <button
              type="button"
              onClick={() => setActiveCategory("all")}
              className={`text-xs px-3.5 py-2 rounded-xl font-medium transition-all shadow-2xs cursor-pointer whitespace-nowrap flex items-center gap-1.5 shrink-0 ${
                activeCategory === "all"
                  ? "bg-[#2563eb] text-white font-semibold border border-[#2563eb] shadow-sm"
                  : "bg-white text-slate-700 hover:text-[#2563eb] hover:bg-blue-50/60 border border-slate-200 hover:border-blue-200"
              }`}
            >
              <span>Semua Layanan</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${activeCategory === "all" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
                8
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory("identitas")}
              className={`text-xs px-3.5 py-2 rounded-xl font-medium transition-all shadow-2xs cursor-pointer whitespace-nowrap flex items-center gap-1.5 shrink-0 ${
                activeCategory === "identitas"
                  ? "bg-[#2563eb] text-white font-semibold border border-[#2563eb] shadow-sm"
                  : "bg-white text-slate-700 hover:text-[#2563eb] hover:bg-blue-50/60 border border-slate-200 hover:border-blue-200"
              }`}
            >
              <span>Dokumen Identitas</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${activeCategory === "identitas" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
                3
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory("sipil")}
              className={`text-xs px-3.5 py-2 rounded-xl font-medium transition-all shadow-2xs cursor-pointer whitespace-nowrap flex items-center gap-1.5 shrink-0 ${
                activeCategory === "sipil"
                  ? "bg-[#2563eb] text-white font-semibold border border-[#2563eb] shadow-sm"
                  : "bg-white text-slate-700 hover:text-[#2563eb] hover:bg-blue-50/60 border border-slate-200 hover:border-blue-200"
              }`}
            >
              <span>Pencatatan Sipil</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${activeCategory === "sipil" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
                2
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveCategory("perpindahan")}
              className={`text-xs px-3.5 py-2 rounded-xl font-medium transition-all shadow-2xs cursor-pointer whitespace-nowrap flex items-center gap-1.5 shrink-0 ${
                activeCategory === "perpindahan"
                  ? "bg-[#2563eb] text-white font-semibold border border-[#2563eb] shadow-sm"
                  : "bg-white text-slate-700 hover:text-[#2563eb] hover:bg-blue-50/60 border border-slate-200 hover:border-blue-200"
              }`}
            >
              <span>Perpindahan & NIK</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${activeCategory === "perpindahan" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
                3
              </span>
            </button>
          </div>
        </div>

        {/* Catalog Cards Grid (Responsive 1/2/3/4 column with uniform height) */}
        {filteredServices.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 w-full items-stretch">
            {filteredServices.map((service) => (
              <div
                key={service.id}
                className="catalog-card flex flex-col justify-between h-full p-4 sm:p-5 rounded-2xl border border-blue-100/80 bg-white shadow-xs hover:shadow-md hover:border-blue-300 transition-all duration-200 group"
              >
                {/* Top: Icon & Badge */}
                <div className="flex items-center justify-between w-full gap-2 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#2563eb] border border-blue-100 flex items-center justify-center shrink-0 shadow-2xs group-hover:bg-[#2563eb] group-hover:text-white transition-all">
                    <span className="material-symbols-outlined text-[20px]">{service.iconName}</span>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider shrink-0 whitespace-nowrap ${
                      service.badgeType === "error"
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : service.badgeType === "tertiary"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-blue-50 text-[#2563eb] border border-blue-200"
                    }`}
                  >
                    {service.badge}
                  </span>
                </div>

                {/* Middle: Title & Description (Flex-1 ensures uniform spacing) */}
                <div className="flex flex-col gap-1.5 mb-4 flex-1">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 line-clamp-2 leading-snug font-heading group-hover:text-[#2563eb] transition-colors">
                    {service.title}
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed line-clamp-3">
                    {service.description}
                  </p>
                </div>

                {/* Bottom: Action Buttons (Always Bottom Aligned) */}
                <div className="flex items-center gap-2 pt-3 w-full border-t border-slate-100 mt-auto">
                  <button
                    type="button"
                    onClick={() => onOpenRequirements(service)}
                    className="px-3 py-2 text-xs font-semibold rounded-xl text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer transition-colors"
                  >
                    <span className="material-symbols-outlined text-[15px] text-slate-500">description</span>
                    <span>Syarat</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenWizard(service.title)}
                    className="flex-1 py-2 px-3.5 text-xs font-bold rounded-xl bg-[#2563eb] hover:bg-blue-700 text-white flex items-center justify-center gap-1.5 whitespace-nowrap transition-all cursor-pointer shadow-xs"
                  >
                    <span>Pilih Layanan</span>
                    <span className="material-symbols-outlined text-[15px] transition-transform group-hover:translate-x-0.5">arrow_forward</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="w-full py-12 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-200 flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">search_off</span>
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-slate-800">Layanan Tidak Ditemukan</h4>
              <p className="text-xs text-slate-500 max-w-sm">
                Tidak ada layanan yang cocok dengan kata kunci &quot;{searchQuery}&quot;. Silakan coba kata kunci lain seperti KTP, Akta, atau KIA.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setActiveCategory("all");
              }}
              className="mt-1 px-4 py-1.5 text-xs font-semibold bg-[#2563eb] text-white rounded-xl hover:bg-blue-700 transition-colors cursor-pointer"
            >
              Reset Filter Pencarian
            </button>
          </div>
        )}
      </section>

      {/* FAQ ACCORDION & JAM PELAYANAN */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4" id="faqSection">
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-3">
            <span className="px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-[#2563eb] font-bold text-[10px] uppercase self-start">
              TANYA JAWAB WARGA (FAQ)
            </span>
            <h3 className="text-lg font-bold text-slate-900 font-heading">
              Informasi Penting Administrasi RT/RW & Kelurahan
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Punya kendala pada berkas identitas atau proses verifikasi AI? Temukan panduan praktis dan
              regulasi kependudukan terbaru di sini.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200/80 p-4 rounded-xl flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-[#2563eb] font-bold text-xs">
              <span className="material-symbols-outlined text-[20px]">schedule</span>
              <span>Jam Operasional Loket Fisik</span>
            </div>
            <div className="text-xs text-slate-600 space-y-1">
              <p>
                <strong className="text-slate-800">Senin - Kamis:</strong> 08.00 - 15.30 WIB
              </p>
              <p>
                <strong className="text-slate-800">Jumat:</strong> 08.00 - 14.30 WIB
              </p>
              <p className="text-[10px] text-slate-400 pt-1">
                *VeriBot AI Layanan Mandiri aktif 24 Jam Non-Stop
              </p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 flex flex-col gap-3">
          <details className="group bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200" open>
            <summary className="flex items-center justify-between cursor-pointer text-xs sm:text-sm font-bold text-slate-900 list-none">
              <span>Mengapa foto KTP sering ditolak saat pengajuan di loket kelurahan?</span>
              <span className="material-symbols-outlined transition-transform group-open:rotate-180 text-[#2563eb]">
                expand_more
              </span>
            </summary>
            <p className="text-xs text-slate-600 mt-3 leading-relaxed border-t border-slate-100 pt-3">
              Sebagian besar penolakan disebabkan oleh pantulan lampu (silau) yang menutupi 16 digit NIK,
              sudut pengambilan terlalu miring, atau resolusi kamera yang buram. VeriBot AI secara otomatis
              mendeteksi masalah ini dan meminta warga mengambil ulang foto yang presisi sebelum ke loket.
            </p>
          </details>

          <details className="group bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200">
            <summary className="flex items-center justify-between cursor-pointer text-xs sm:text-sm font-bold text-slate-900 list-none">
              <span>Apakah surat pengantar dari RT/RW masih diwajibkan?</span>
              <span className="material-symbols-outlined transition-transform group-open:rotate-180 text-[#2563eb]">
                expand_more
              </span>
            </summary>
            <p className="text-xs text-slate-600 mt-3 leading-relaxed border-t border-slate-100 pt-3">
              Berdasarkan Perpres No. 96 Tahun 2018, pengurusan KTP-EL baru atau penggantian rusak/hilang
              tidak lagi memerlukan pengantar RT/RW asalkan data NIK sudah sinkron. Namun untuk perpindahan
              alamat domisili baru, verifikasi lingkungan RT/RW tetap dianjurkan.
            </p>
          </details>

          <details className="group bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200">
            <summary className="flex items-center justify-between cursor-pointer text-xs sm:text-sm font-bold text-slate-900 list-none">
              <span>Bagaimana cara kerja Jalur Khusus (Fast-Track) Tiket VeriBot?</span>
              <span className="material-symbols-outlined transition-transform group-open:rotate-180 text-[#2563eb]">
                expand_more
              </span>
            </summary>
            <p className="text-xs text-slate-600 mt-3 leading-relaxed border-t border-slate-100 pt-3">
              Warga yang berkasnya mencapai skor validasi AI minimal 75% akan mendapatkan QR Tiket Prioritas.
              Di loket fisik kantor kelurahan, pemegang tiket ini langsung dipanggil ke meja verifikator
              tanpa mengisi formulir kertas tambahan.
            </p>
          </details>
        </div>
      </section>
    </div>
  );
};
