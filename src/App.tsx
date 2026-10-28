/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { PortalHome } from "./components/PortalHome";
import { InteractiveWizard } from "./components/InteractiveWizard";
import AdminDashboard from "./components/AdminDashboard";
import { RequirementModal } from "./components/RequirementModal";
import { TicketStatusModal } from "./components/TicketStatusModal";
import { TransparencyPage } from "./components/TransparencyPage";
import OfficerLoginModal from "./components/OfficerLoginModal";
import FloatingVeriBot from "./components/FloatingVeriBot";
import { ExitDashboardConfirmModal } from "./components/ExitDashboardConfirmModal";
import { Ticket, ServiceCatalogItem, PreScreenInitialData } from "./types";
import { clearOfficerSession, getOfficerName } from "./lib/officerAuth";
import {
  clearTicketHistory,
  loadTicketHistory,
  rememberTicket,
  type TicketHistoryItem,
} from "./lib/ticketHistory";

type AppView = "portal" | "wizard" | "login" | "officer" | "transparansi";

interface PendingNav {
  view: AppView;
  targetId?: string;
  destLabel?: string;
}

interface HistoryState {
  aipexView: AppView;
  targetId?: string;
}

function scrollToTarget(targetId?: string) {
  if (!targetId || targetId === "portalView") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  // Portal butuh 1 frame render sebelum scroll ke section.
  setTimeout(() => {
    document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth" });
  }, 150);
}

function buildState(view: AppView, targetId?: string): HistoryState {
  return { aipexView: view, targetId };
}

/**
 * Izinkan tautan langsung ke halaman transparansi, misalnya:
 *   /transparansi?batch=demo-001
 *   /?view=transparansi&batch=demo-001
 *   /#transparansi?batch=demo-001
 * Tanpa URL khusus, aplikasi tetap mulai dari portal.
 */
function getInitialView(): AppView {
  if (typeof window === "undefined") return "portal";
  try {
    const path = window.location.pathname.replace(/\/+$/, "").toLowerCase();
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash.toLowerCase();
    if (
      path.endsWith("/transparansi") ||
      params.get("view") === "transparansi" ||
      params.has("batch") ||
      hash.includes("transparansi")
    ) {
      return "transparansi";
    }
  } catch {}
  return "portal";
}

const INITIAL_VIEW: AppView = getInitialView();

export default function App() {
  const [currentView, setCurrentView] = useState<"portal" | "wizard" | "login" | "officer" | "transparansi">(INITIAL_VIEW);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketHistory, setTicketHistory] = useState<TicketHistoryItem[]>(() => loadTicketHistory());
  const [selectedService, setSelectedService] = useState<string>("Penerbitan KTP-EL Baru / Penggantian");
  const [selectedRequirementService, setSelectedRequirementService] = useState<ServiceCatalogItem | null>(null);
  const [statusModalTicket, setStatusModalTicket] = useState<Ticket | null>(null);
  const [preScreenData, setPreScreenData] = useState<PreScreenInitialData | null>(null);
  // Guard keluar dashboard: semua navigasi portal/wizard saat mode officer
  // wajib lewat requestNavigate agar muncul popup konfirmasi (sesi tetap disimpan).
  const [exitConfirm, setExitConfirm] = useState<PendingNav | null>(null);
  // Ref untuk menghindari loop popstate <-> setCurrentView
  const isPopstateRef = useRef(false);

  const doNavigate = (view: AppView, targetId?: string, pushHistory = true) => {
    setCurrentView(view);
    if (view === "portal" || view === "wizard" || view === "transparansi") scrollToTarget(targetId);
    else window.scrollTo({ top: 0, behavior: "smooth" });
    if (pushHistory && !isPopstateRef.current) {
      try {
        history.pushState(buildState(view, targetId), "", "");
      } catch {}
    }
  };

  const requestNavigate = (view: AppView, targetId?: string, destLabel?: string) => {
    if (currentView === "officer" && view !== "officer") {
      setExitConfirm({ view, targetId, destLabel: destLabel || "Portal Warga" });
      return;
    }
    doNavigate(view, targetId);
  };

  // Browser Back/Forward → sinkronkan view dari history.state
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      const state = e.state as HistoryState | null;
      if (!state?.aipexView) return;
      isPopstateRef.current = true;
      // Guard wizard: Back jangan langsung membuang data. App menahan view,
      // lalu wizard membuka modal "Lanjutkan mengisi / Keluar (draft tersimpan)".
      if (currentView === "wizard" && state.aipexView !== "wizard") {
        isPopstateRef.current = false;
        window.dispatchEvent(new Event("aipex:wizard-back"));
        return;
      }
      // Guard officer: Back dari dashboard tetap minta konfirmasi
      if (currentView === "officer" && state.aipexView !== "officer") {
        setExitConfirm({ view: state.aipexView, targetId: state.targetId, destLabel: "Portal Warga" });
        // Kembalikan history agar tidak keluar dari dashboard
        history.pushState(buildState("officer"), "");
        isPopstateRef.current = false;
        return;
      }
      doNavigate(state.aipexView, state.targetId, false);
      isPopstateRef.current = false;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [currentView]);

  // Inisialisasi history entry awal — hanya sekali. Jangan dijalankan setiap
  // currentView berubah, karena akan menimpa state entri wizard yang baru di-push.
  useEffect(() => {
    try {
      history.replaceState(buildState(INITIAL_VIEW), "");
    } catch {}
  }, []);

  // Daftar tiket publik tidak lagi dimuat: GET /api/tickets kini menolak
  // permintaan tanpa kode (privasi UU PDP). Pelacakan memakai /api/tickets/:kode.

  // Open Wizard for a specific service. Selalu mulai sesi baru: buang hasil
  // pra-pemeriksaan lama agar tidak ter-prefill tanpa sadar. (Jalur dari kartu
  // pre-screen memakai handleProceedFromPreScreen yang MENYETEL data ini.)
  const handleOpenWizard = (serviceName?: string) => {
    setPreScreenData(null);
    if (serviceName) {
      setSelectedService(serviceName);
    }
    doNavigate("wizard");
  };

  // Proceed to Wizard from OCR Pre-screening Preview Card
  const handleProceedFromPreScreen = (data: PreScreenInitialData) => {
    setPreScreenData(data);
    if (data.service) {
      setSelectedService(data.service);
    }
    doNavigate("wizard");
  };

  // Open Requirement modal
  const handleOpenRequirements = (service: ServiceCatalogItem) => {
    setSelectedRequirementService(service);
  };

  // Check ticket status from lookup bar
  const handleCheckTicket = async (code: string) => {
    try {
      const response = await fetch(`/api/tickets/${encodeURIComponent(code.trim())}`);
      const data = await response.json();
      if (data.success && data.data) {
        setStatusModalTicket(data.data);
        setTicketHistory(rememberTicket(data.data));
      } else {
        // Search in local state if network delay
        const found = tickets.find(
          (t) => t.ticket_code.toUpperCase() === code.trim().toUpperCase()
        );
        if (found) {
          setStatusModalTicket(found);
          setTicketHistory(rememberTicket(found));
        } else {
          alert(`Nomor tiket "${code}" tidak ditemukan dalam sistem Kelurahan Sukamaju. Silakan periksa kembali kode tiket Anda.`);
        }
      }
    } catch (err) {
      console.error(err);
      const found = tickets.find(
        (t) => t.ticket_code.toUpperCase() === code.trim().toUpperCase()
      );
      if (found) {
        setStatusModalTicket(found);
        setTicketHistory(rememberTicket(found));
      } else {
        alert("Terjadi kesalahan saat memeriksa tiket. Silakan coba sesaat lagi.");
      }
    }
  };

  // Add newly generated ticket + simpan metadata aman ke riwayat perangkat.
  const handleTicketCreated = (newTicket: Ticket) => {
    setTickets((prev) => [newTicket, ...prev]);
    setTicketHistory(rememberTicket(newTicket));
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col justify-between text-[#0F172A] antialiased selection:bg-blue-600 selection:text-white">
      {/* Official Header */}
      <Header
        currentView={currentView}
        onNavigate={(view) => {
          requestNavigate(view);
        }}
        onRequestNav={(view, targetId, destLabel) => {
          requestNavigate(view, targetId, destLabel);
        }}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-6 py-4">
        {(currentView === "portal" || currentView === "login") && (
          <PortalHome
            onOpenWizard={(serviceName) => {
              setPreScreenData(null);
              handleOpenWizard(serviceName);
            }}
            onOpenRequirements={handleOpenRequirements}
            onCheckTicket={handleCheckTicket}
            onProceedFromPreScreen={handleProceedFromPreScreen}
            ticketHistory={ticketHistory}
            onClearTicketHistory={() => {
              clearTicketHistory();
              setTicketHistory([]);
            }}
          />
        )}

        {currentView === "wizard" && (
          <InteractiveWizard
            initialService={selectedService}
            initialPreScreenData={preScreenData}
            onBackToPortal={() => {
              setPreScreenData(null);
              doNavigate("portal");
            }}
            onTicketCreated={handleTicketCreated}
          />
        )}

        {currentView === "transparansi" && (
          <TransparencyPage onLogin={() => doNavigate("login")} />
        )}

        {currentView === "officer" && (
          <AdminDashboard
            onLogout={() => {
              clearOfficerSession();
              setCurrentView("portal");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}
      </main>

      {/* Official Footer */}
      <Footer
        onNavigateHome={() => {
          requestNavigate("portal", "portalView", "Katalog Layanan");
        }}
        onRequestNav={(targetId, destLabel) => {
          requestNavigate("portal", targetId, destLabel);
        }}
        onOpenTransparansi={() => requestNavigate("transparansi")}
      />

      {/* Modals & Floating Components */}
      {currentView === "login" && (
        <OfficerLoginModal
          onLoginSuccess={(_officer) => {
            setCurrentView("officer");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onClose={() => {
            setCurrentView("portal");
          }}
        />
      )}

      <RequirementModal
        service={selectedRequirementService}
        isOpen={Boolean(selectedRequirementService)}
        onClose={() => setSelectedRequirementService(null)}
        onStartService={(srvName) => {
          setSelectedRequirementService(null);
          handleOpenWizard(srvName);
        }}
      />

      <TicketStatusModal
        ticket={statusModalTicket}
        isOpen={Boolean(statusModalTicket)}
        onClose={() => setStatusModalTicket(null)}
      />

      {/* Floating 24/7 AI Chatbot Popup (Default: Minimized, 1:1 Circle Floating Bubble) */}
      <FloatingVeriBot />

      <ExitDashboardConfirmModal
        isOpen={Boolean(exitConfirm)}
        officerName={getOfficerName()}
        destLabel={exitConfirm?.destLabel || "Portal Warga"}
        onCancel={() => setExitConfirm(null)}
        onConfirm={() => {
          if (exitConfirm) doNavigate(exitConfirm.view, exitConfirm.targetId);
          setExitConfirm(null);
        }}
      />
    </div>
  );
}
