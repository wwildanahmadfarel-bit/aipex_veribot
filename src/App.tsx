/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { PortalHome } from "./components/PortalHome";
import { InteractiveWizard } from "./components/InteractiveWizard";
import { OfficerDashboard } from "./components/OfficerDashboard";
import AdminDashboard from "./components/AdminDashboard";
import { RequirementModal } from "./components/RequirementModal";
import { TicketStatusModal } from "./components/TicketStatusModal";
import OfficerLoginModal from "./components/OfficerLoginModal";
import FloatingVeriBot from "./components/FloatingVeriBot";
import { Ticket, ServiceCatalogItem, PreScreenInitialData } from "./types";

export default function App() {
  const [currentView, setCurrentView] = useState<"portal" | "wizard" | "login" | "officer">("portal");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedService, setSelectedService] = useState<string>("Penerbitan KTP-EL Baru / Penggantian");
  const [selectedRequirementService, setSelectedRequirementService] = useState<ServiceCatalogItem | null>(null);
  const [statusModalTicket, setStatusModalTicket] = useState<Ticket | null>(null);
  const [preScreenData, setPreScreenData] = useState<PreScreenInitialData | null>(null);

  // Load initial tickets from backend
  const fetchTickets = async () => {
    try {
      const response = await fetch("/api/admin/tickets");
      const resJson = await response.json();
      if (resJson.success && Array.isArray(resJson.data) && resJson.data.length > 0) {
        const mapped = resJson.data.map((row: any) => {
          if (row.ticket_code && row.nik_encrypted) return row;
          const rawNik = row.nik || "";
          const masked = rawNik.length >= 12
            ? `${rawNik.slice(0, 6)}******${rawNik.slice(-4)}`
            : (rawNik ? `${rawNik.slice(0, 3)}***${rawNik.slice(-2)}` : "320101******0000");
          return {
            id: String(row.id || row.kode_tiket),
            ticket_code: row.kode_tiket || `TKT-${String(row.id).slice(0, 6)}`,
            nik_encrypted: masked,
            nik_raw: rawNik,
            nama_warga: row.nama || "Warga",
            jenis_dokumen: row.jenis_dokumen || "KTP",
            status_verifikasi:
              row.status_verifikasi === "BERHASIL"
                ? "APPROVED"
                : row.status_verifikasi === "BURAM" || row.status_verifikasi === "TIDAK_VALID"
                ? "REVISI"
                : row.status_verifikasi || "PENDING",
            skor_ai: row.skor_kejelasan || 88,
            status_ai:
              row.status_verifikasi === "BERHASIL" || (row.skor_kejelasan >= 70) ? "LULUS" : "GAGAL",
            catatan_ai: row.catatan || "",
            catatan_petugas: row.catatan_petugas || row.catatan || "",
            created_at: row.created_at
              ? new Date(row.created_at).toISOString().replace("T", " ").slice(0, 16)
              : new Date().toISOString().replace("T", " ").slice(0, 16),
            updated_at: row.created_at
              ? new Date(row.created_at).toISOString().replace("T", " ").slice(0, 16)
              : new Date().toISOString().replace("T", " ").slice(0, 16),
          };
        });
        setTickets(mapped);
        return;
      }
    } catch (err) {
      console.warn("Could not fetch tickets from /api/admin/tickets, trying fallback:", err);
    }

    try {
      const response = await fetch("/api/tickets");
      const resJson = await response.json();
      if (resJson.success && Array.isArray(resJson.data)) {
        setTickets(resJson.data);
      }
    } catch (err) {
      console.warn("Could not fetch tickets from backend, using fallback state:", err);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  // Open Wizard for a specific service
  const handleOpenWizard = (serviceName?: string) => {
    if (serviceName) {
      setSelectedService(serviceName);
    }
    setCurrentView("wizard");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Proceed to Wizard from OCR Pre-screening Preview Card
  const handleProceedFromPreScreen = (data: PreScreenInitialData) => {
    setPreScreenData(data);
    if (data.service) {
      setSelectedService(data.service);
    }
    setCurrentView("wizard");
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      } else {
        // Search in local state if network delay
        const found = tickets.find(
          (t) => t.ticket_code.toUpperCase() === code.trim().toUpperCase()
        );
        if (found) {
          setStatusModalTicket(found);
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
      } else {
        alert("Terjadi kesalahan saat memeriksa tiket. Silakan coba sesaat lagi.");
      }
    }
  };

  // Add newly generated ticket
  const handleTicketCreated = (newTicket: Ticket) => {
    setTickets((prev) => [newTicket, ...prev]);
  };


  // Update Ticket Status by Officer (1-Click Action via /api/admin/tickets)
  const handleUpdateTicketStatus = async (
    ticketId: string,
    status: "APPROVED" | "REJECTED" | "REVISI" | "PENDING",
    notes?: string,
    officerId: string = "off-001"
  ) => {
    try {
      const response = await fetch("/api/admin/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          officerId,
          status,
          catatan: notes,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setTickets((prev) =>
          prev.map((t) =>
            t.id === ticketId || t.ticket_code === ticketId
              ? {
                  ...t,
                  status_verifikasi: status,
                  catatan_petugas: notes || t.catatan_petugas,
                  updated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
                }
              : t
          )
        );
        return;
      }
    } catch (adminErr) {
      console.warn("Failed /api/admin/tickets patch, falling back:", adminErr);
    }

    try {
      const response = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status_verifikasi: status,
          catatan_petugas: notes,
        }),
      });
      const data = await response.json();
      if (data.success && data.data) {
        setTickets((prev) =>
          prev.map((t) => (t.id === ticketId || t.ticket_code === ticketId ? data.data : t))
        );
      }
    } catch (err) {
      console.error("Failed to update status on server, updating locally:", err);
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticketId || t.ticket_code === ticketId
            ? {
                ...t,
                status_verifikasi: status,
                catatan_petugas: notes || t.catatan_petugas,
                updated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
              }
            : t
        )
      );
    }
  };

  const pendingCount = tickets.filter((t) => t.status_verifikasi === "PENDING").length;

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col justify-between text-slate-800 antialiased selection:bg-blue-600 selection:text-white">
      {/* Official Header */}
      <Header
        currentView={currentView}
        onNavigate={(view) => {
          setCurrentView(view);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        pendingCount={pendingCount}
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
          />
        )}

        {currentView === "wizard" && (
          <InteractiveWizard
            initialService={selectedService}
            initialPreScreenData={preScreenData}
            onBackToPortal={() => {
              setPreScreenData(null);
              setCurrentView("portal");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onTicketCreated={handleTicketCreated}
          />
        )}

        {currentView === "officer" && (
          <AdminDashboard
            onLogout={() => {
              try {
                localStorage.removeItem("aipex_officer");
              } catch {}
              setCurrentView("portal");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}
      </main>

      {/* Official Footer */}
      <Footer
        onNavigateHome={() => {
          setCurrentView("portal");
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
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
    </div>
  );
}
