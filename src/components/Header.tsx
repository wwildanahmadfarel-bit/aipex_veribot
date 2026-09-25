import React, { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { AipexLogo } from "./AipexLogo";

interface HeaderProps {
  currentView: "portal" | "wizard" | "login" | "officer";
  onNavigate: (view: "portal" | "wizard" | "login" | "officer") => void;
  /** Navigasi terjaga: App menampilkan popup konfirmasi bila sedang mode officer. */
  onRequestNav?: (view: "portal" | "wizard" | "login" | "officer", targetId?: string, destLabel?: string) => void;
  pendingCount?: number;
}

interface NavItem {
  id: string;
  label: string;
  targetId: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "beranda", label: "Beranda / Katalog", targetId: "portalView" },
  { id: "tiket", label: "Cek Tiket QR", targetId: "lacakSection" },
  { id: "alur", label: "Alur Layanan", targetId: "alurLayanan" },
  { id: "faq", label: "Bantuan & FAQ", targetId: "faqSection" },
];

export const Header: React.FC<HeaderProps> = ({ currentView, onNavigate, onRequestNav, pendingCount = 0 }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("beranda");
  const menuRef = useRef<HTMLDivElement>(null);

  // Tanggal real-time (format Indonesia: "Rabu, 16 September 2026";
  // versi pendek "16 Sep 2026" untuk layar HP agar banner tidak terpotong)
  const formatToday = () =>
    new Intl.DateTimeFormat("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date());
  const formatTodayShort = () =>
    new Intl.DateTimeFormat("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date());
  const [today, setToday] = useState<string>(formatToday);
  const [todayShort, setTodayShort] = useState<string>(formatTodayShort);

  useEffect(() => {
    const timer = setInterval(() => {
      setToday(formatToday());
      setTodayShort(formatTodayShort());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  // Sync activeTab when user scrolls on the portal page
  useEffect(() => {
    if (currentView !== "portal") {
      // If we are on wizard or officer or login, we can keep or adjust
      return;
    }

    const handleScroll = () => {
      const scrollPos = window.scrollY + 220;
      const faqEl = document.getElementById("faqSection");
      const alurEl = document.getElementById("alurLayanan");
      const tiketEl = document.getElementById("lacakSection");

      if (faqEl && scrollPos >= faqEl.offsetTop) {
        setActiveTab("faq");
      } else if (alurEl && scrollPos >= alurEl.offsetTop) {
        setActiveTab("alur");
      } else if (tiketEl && scrollPos >= tiketEl.offsetTop) {
        setActiveTab("tiket");
      } else {
        setActiveTab("beranda");
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [currentView]);

  // When currentView changes back to portal, reset to beranda if at top
  useEffect(() => {
    if (currentView === "portal" && window.scrollY < 100) {
      setActiveTab("beranda");
    }
  }, [currentView]);

  const requestNav = (
    view: "portal" | "wizard" | "login" | "officer",
    targetId?: string,
    destLabel?: string
  ) => {
    if (onRequestNav) {
      onRequestNav(view, targetId, destLabel);
      return;
    }
    onNavigate(view);
  };

  const handleNavClick = (item: NavItem) => {
    setActiveTab(item.id);
    // Scroll ditangani App setelah konfirmasi (agar tidak jalan sebelum user tekan Ya).
    requestNav("portal", item.targetId, item.label);
    if (!onRequestNav) {
      if (currentView !== "portal") {
        setTimeout(() => {
          if (item.id === "beranda") {
            window.scrollTo({ top: 0, behavior: "smooth" });
          } else {
            document.getElementById(item.targetId)?.scrollIntoView({ behavior: "smooth" });
          }
        }, 120);
      } else {
        if (item.id === "beranda") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          document.getElementById(item.targetId)?.scrollIntoView({ behavior: "smooth" });
        }
      }
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-50 shadow-sm border-b border-[#1E293B]">
      {/* Top Banner Row */}
      <div className="w-full overflow-hidden px-4 py-1.5 bg-[#1E293B] border-b border-[#1E293B]">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between gap-2 w-full text-[11px]">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-[#10b981] animate-ping inline-block shrink-0"></span>
            <span className="text-xs font-medium text-slate-200 whitespace-nowrap truncate">
              Portal Resmi Kelurahan Sukamaju
            </span>
            <span className="text-slate-500 hidden min-[400px]:inline">•</span>
            <span className="font-code-num text-slate-300 bg-[#1E293B] px-2 py-0.5 rounded text-[10px] whitespace-nowrap hidden min-[400px]:inline">
              {today}
            </span>
            <span className="font-code-num text-slate-300 bg-[#1E293B] px-2 py-0.5 rounded text-[10px] whitespace-nowrap min-[400px]:hidden">
              {todayShort}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-slate-300 text-[11px] hidden sm:inline whitespace-nowrap">
              Dashboard Layanan Warga
            </span>
            <span className="font-code-num bg-[#2563eb] text-white font-bold text-[9px] px-2 py-0.5 rounded-full tracking-wider whitespace-nowrap shadow-xs hidden min-[400px]:inline">
              VERIBOT AI V1.0
            </span>
          </div>
        </div>
      </div>

      {/* Main Brand Bar */}
      <div className="bg-[#1E293B] border-b border-[#1E293B]/80 py-2.5 px-4">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between w-full">
          {/* Logo & Title */}
          <div
            className="flex items-center gap-3 cursor-pointer group select-none"
            onClick={() => {
              setActiveTab("beranda");
              requestNav("portal", "portalView", "Beranda / Katalog");
              if (!onRequestNav) window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            id="brandLogoBtn"
          >
            {/* 1. Kontainer Logo: rounded halus, bg-white, border border-slate-200 */}
            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 p-1.5 flex items-center justify-center shrink-0 shadow-xs transition-transform duration-200 group-hover:scale-105">
              <AipexLogo className="w-full h-full" size={28} />
            </div>

            {/* 2. Teks Branding: Baris 1 Judul UPPERCASE & Baris 2 Sub-judul text-xs */}
            <div className="flex flex-col justify-center leading-tight">
              <span className="text-white font-extrabold text-sm sm:text-base tracking-wider uppercase leading-tight font-heading">
                AIPEX VERIBOT
              </span>
              <span className="text-slate-400 text-xs font-normal sm:font-medium leading-tight">
                Sistem Verifikasi Otomatis
              </span>
            </div>
          </div>

          {/* Center Navigation for Desktop with Sliding Active Navbar Indicator */}
          <nav className="hidden lg:flex items-center gap-1 bg-[#1E293B]/60 p-1.5 rounded-xl border border-slate-700/50 backdrop-blur-xs relative">
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavClick(item)}
                  className={`relative px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer select-none ${
                    isActive ? "text-white" : "text-slate-300 hover:text-white"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-nav-pill"
                      className="absolute inset-0 bg-[#2563eb] rounded-lg shadow-sm"
                      transition={{
                        type: "spring",
                        stiffness: 380,
                        damping: 30,
                      }}
                    />
                  )}
                  <span className="relative z-10">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Action & Kebab Menu */}
          <div className="relative flex items-center gap-2 shrink-0" ref={menuRef}>
            {currentView === "officer" ? (
              <button
                onClick={() => {
                  setActiveTab("beranda");
                  requestNav("portal", "portalView", "Portal Warga (Keluar Loket)");
                }}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 text-xs font-semibold transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">logout</span>
                <span>Keluar Loket</span>
              </button>
            ) : (
              <button
                onClick={() => onNavigate("login")}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1E293B]/70 text-blue-300 border border-[#2563eb]/40 hover:bg-[#2563eb]/20 text-xs font-semibold transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px] text-[#2563eb]">shield</span>
                <span>Login Petugas</span>
                {pendingCount > 0 && (
                  <span className="w-5 h-5 rounded-full bg-[#2563eb] text-white text-[10px] font-bold flex items-center justify-center ml-1">
                    {pendingCount}
                  </span>
                )}
              </button>
            )}

            <button
              aria-label="Menu Opsi"
              id="kebab-menu-btn"
              onClick={() => setMenuOpen(!menuOpen)}
              type="button"
              className="w-9 h-9 rounded-lg bg-[#1E293B]/60 hover:bg-[#1E293B] text-white flex items-center justify-center border border-[#1E293B] transition-colors relative cursor-pointer"
            >
              <span className="material-symbols-outlined text-[20px]">more_vert</span>
            </button>

            {/* Dropdown Menu */}
            {menuOpen && (
              <div
                id="kebab-dropdown-menu"
                className="absolute right-0 top-11 w-64 bg-[#1E293B] border border-slate-700 rounded-xl shadow-2xl p-2 z-50 text-left animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3 py-1.5">
                  Menu Loket & Akun
                </div>
                <div className="border-b border-slate-700/80 my-1"></div>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onNavigate("login");
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-[#2563eb]/20 hover:text-blue-400 rounded-lg transition-colors cursor-pointer text-left"
                >
                  <span className="material-symbols-outlined text-[18px] text-[#2563eb]">shield</span>
                  <span>Login Petugas Loket</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setActiveTab("tiket");
                    requestNav("portal", "lacakSection", "Cek Tiket QR");
                    if (!onRequestNav) {
                      setTimeout(() => {
                        document.getElementById("lacakSection")?.scrollIntoView({ behavior: "smooth" });
                      }, 100);
                    }
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-medium text-slate-300 hover:bg-[#1E293B]/40 hover:text-white rounded-lg transition-colors cursor-pointer text-left"
                >
                  <span className="material-symbols-outlined text-[18px] text-slate-400">person</span>
                  <span>Lacak Berkas Mandiri</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setActiveTab("faq");
                    requestNav("portal", "faqSection", "Bantuan & FAQ");
                    if (!onRequestNav) {
                      setTimeout(() => {
                        document.getElementById("faqSection")?.scrollIntoView({ behavior: "smooth" });
                      }, 100);
                    }
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-medium text-slate-300 hover:bg-[#1E293B]/40 hover:text-white rounded-lg transition-colors cursor-pointer text-left"
                >
                  <span className="material-symbols-outlined text-[18px] text-slate-400">help</span>
                  <span>Bantuan & Panduan</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

