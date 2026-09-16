import React, { useState, useEffect } from "react";
import { Ticket } from "../types";

interface OfficerDashboardProps {
  onBackToPortal: () => void;
  tickets: Ticket[];
  initialLoginView?: boolean;
  onUpdateTicketStatus: (
    id: string,
    status: "APPROVED" | "REJECTED" | "REVISI" | "PENDING",
    notes?: string,
    officerId?: string
  ) => void;
}

export const OfficerDashboard: React.FC<OfficerDashboardProps> = ({
  onBackToPortal,
  tickets,
  initialLoginView = false,
  onUpdateTicketStatus,
}) => {
  // Login State
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!initialLoginView);
  const [nip, setNip] = useState<string>("19850312 201001 1 002");
  const [pin, setPin] = useState<string>("849201");
  const [selectedDesk, setSelectedDesk] = useState<string>("Loket 1 - e-KTP & Identitas");
  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [officerData, setOfficerData] = useState<{ id?: string; nama?: string; role?: string } | null>(() => {
    try {
      const saved = localStorage.getItem("aipex_officer");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      id: "off-001",
      nama: "Bambang Sudiro, S.STP",
      role: "Kepala Seksi Pelayanan Kependudukan",
    };
  });

  // Filter & Search
  const [activeTab, setActiveTab] = useState<"ALL" | "PENDING" | "APPROVED" | "REVISI" | "REJECTED">("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Inspect Modal
  const [inspectingTicket, setInspectingTicket] = useState<Ticket | null>(null);
  const [officerNotes, setOfficerNotes] = useState<string>("");

  // QR Scan Modal
  const [isQrModalOpen, setIsQrModalOpen] = useState<boolean>(false);
  const [manualTicketCode, setManualTicketCode] = useState<string>("");

  const normalizeAccessCode = (raw: string): string =>
    (raw || '').trim().toUpperCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/SUKAMAZU/g, 'SUKAMAJU');

  const OFFLINE_OFFICERS: Record<string, { id: string; nama: string; role: string }> = {
    'ADM-SUKAMAJU-2026': { id: 'off-001', nama: 'Bambang Sudiro, S.STP', role: 'Kepala Seksi Pelayanan Kependudukan' },
    '849201': { id: 'off-002', nama: 'Siti Rahmawati, S.AP', role: 'Petugas Loket 1 - e-KTP & Identitas' },
    'VERIBOT-ADMIN': { id: 'off-003', nama: 'Ahmad Fauzi, S.Kom', role: 'Supervisor VeriBot AI Kependudukan' },
    'LOKET-SUKAMAJU-01': { id: 'off-004', nama: 'Hendra Setiawan, S.IP', role: 'Petugas Loket Fast-Track VeriBot AIPEX' },
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const accessCode = normalizeAccessCode(pin);
    if (!accessCode) {
      setLoginError("Kode akses / PIN petugas wajib diisi");
      return;
    }

    if (/^(TKT|FT)-/.test(accessCode)) {
      setLoginError("Itu kode tiket warga (TKT-...), bukan kode akses petugas. Gunakan kode akses seperti 849201.");
      return;
    }

    setLoginLoading(true);

    const tryOffline = (): boolean => {
      const offline = OFFLINE_OFFICERS[accessCode];
      if (offline) {
        setOfficerData(offline);
        try { localStorage.setItem("aipex_officer", JSON.stringify(offline)); } catch {}
        setIsAuthenticated(true);
        return true;
      }
      return false;
    };

    try {
      let res: Response;
      try {
        res = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kodeAkses: accessCode }),
        });
      } catch {
        if (!tryOffline()) {
          setLoginError("Gagal memverifikasi ke server. Jalankan `npm run dev` atau gunakan kode offline: 849201 / LOKET-SUKAMAJU-01.");
        }
        return;
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        if (!tryOffline()) {
          setLoginError("Endpoint /api/admin/login tidak ditemukan. Jalankan server dengan `npm run dev` (port 3000).");
        }
        return;
      }

      const data = await res.json().catch(() => null);
      if (!data) {
        if (!tryOffline()) setLoginError("Respons server tidak valid. Coba restart server.");
        return;
      }

      if (res.ok && data.success) {
        if (data.officer) {
          setOfficerData(data.officer);
          try { localStorage.setItem("aipex_officer", JSON.stringify(data.officer)); } catch {}
        } else if (!tryOffline()) {
          setLoginError("Data profil petugas tidak ditemukan");
          return;
        }
        setIsAuthenticated(true);
      } else {
        // Toleran: jika server menolak tapi kode ada di fallback, tetap izinkan
        if (!tryOffline()) {
          setLoginError(data.message || "Kode Akses Petugas tidak valid! Contoh: 849201 atau LOKET-SUKAMAJU-01.");
        }
      }
    } catch {
      if (!tryOffline()) {
        setLoginError("Gagal memverifikasi ke server. Pastikan jaringan terhubung.");
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handleOpenInspect = (ticket: Ticket) => {
    setInspectingTicket(ticket);
    setOfficerNotes(ticket.catatan_petugas || "");
  };

  const handleApprove = (ticketId: string) => {
    onUpdateTicketStatus(
      ticketId,
      "APPROVED",
      officerNotes || "Disetujui. Berkas lengkap dan memenuhi standar pelayanan kependudukan.",
      officerData?.id || "off-001"
    );
    setInspectingTicket(null);
  };

  const handleRequestRevision = (ticketId: string) => {
    onUpdateTicketStatus(
      ticketId,
      "REVISI",
      officerNotes || "Mohon unggah kembali foto KTP di tempat terang tanpa pantulan lampu kilat.",
      officerData?.id || "off-001"
    );
    setInspectingTicket(null);
  };

  const handleReject = (ticketId: string) => {
    onUpdateTicketStatus(
      ticketId,
      "REJECTED",
      officerNotes || "Pengajuan ditolak karena ketidaksesuaian data NIK dengan basis data kependudukan.",
      officerData?.id || "off-001"
    );
    setInspectingTicket(null);
  };

  // Filtered Tickets
  const filteredTickets = tickets.filter((t) => {
    const matchTab = activeTab === "ALL" || t.status_verifikasi === activeTab;
    const matchSearch =
      searchQuery === "" ||
      t.ticket_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.nama_warga.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.jenis_dokumen.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.nik_encrypted.toLowerCase().includes(searchQuery.toLowerCase());
    return matchTab && matchSearch;
  });

  // Stats calculation
  const totalCount = tickets.length;
  const pendingCount = tickets.filter((t) => t.status_verifikasi === "PENDING").length;
  const approvedCount = tickets.filter((t) => t.status_verifikasi === "APPROVED").length;
  const revisionCount = tickets.filter(
    (t) => t.status_verifikasi === "REVISI" || t.status_verifikasi === "REJECTED"
  ).length;

  // If not logged in, show Login Gate
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] p-4">
        <div className="bg-white max-w-md w-full rounded-2xl shadow-xl border border-slate-200 p-6 sm:p-8 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#2563eb] flex items-center justify-center mb-3 shadow-xs border border-blue-100">
              <span className="material-symbols-outlined text-[32px]">shield</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 font-heading">
              Login Petugas Loket Kependudukan
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Kelurahan Sukamaju • Kecamatan Maju Sejahtera
            </p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            {loginError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-red-500">error</span>
                <span>{loginError}</span>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase">
                NOMOR INDUK PEGAWAI (NIP)
              </label>
              <input
                type="text"
                value={nip}
                onChange={(e) => setNip(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-300 font-code-num text-sm text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase">
                KODE AKSES KHUSUS / PIN PETUGAS
              </label>
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Masukkan kode akses (cth: 849201)"
                className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-300 font-code-num text-sm text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase">MEJA LOKET TUGAS</label>
              <select
                value={selectedDesk}
                onChange={(e) => setSelectedDesk(e.target.value)}
                className="w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-300 text-xs sm:text-sm text-slate-900 focus:bg-white focus:border-blue-600 outline-none cursor-pointer"
              >
                <option value="Loket 1 - e-KTP & Identitas">Loket 1 - e-KTP & Identitas</option>
                <option value="Loket 2 - KIA & Kartu Keluarga">Loket 2 - KIA & Kartu Keluarga</option>
                <option value="Loket 3 - Akta & Perpindahan">Loket 3 - Akta & Perpindahan</option>
              </select>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-500">
              💡 <strong>Kredensial Resmi Petugas:</strong> Masukkan kode akses terdaftar (misal: <code>849201</code>, <code>ADM-SUKAMAJU-2026</code>, atau kode dari database Supabase).
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-3 rounded-xl bg-[#2563eb] hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              {loginLoading ? (
                <>
                  <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                  <span>Memverifikasi Kode Akses...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">login</span>
                  <span>Masuk ke Dashboard Loket</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onBackToPortal}
              className="w-full text-xs text-slate-500 hover:text-slate-800 text-center pt-2 cursor-pointer"
            >
              ← Kembali ke Portal Warga
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Logged-in Dashboard
  const initials = (officerData?.nama || "Bambang Sudiro")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex flex-col w-full space-y-6" id="officerDashboard">
      {/* Top Officer Bar */}
      <div className="bg-[#213145] text-white p-4 sm:p-5 rounded-2xl shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-[#2563eb] text-white flex items-center justify-center shrink-0 font-bold text-lg shadow-sm">
            {initials}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold font-heading">
                {officerData?.nama || "Bambang Sudiro, S.STP"}
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold">
                Aktif
              </span>
            </div>
            <p className="text-xs text-slate-300">
              {officerData?.role || "Kepala Seksi Pelayanan Kependudukan"} • NIP: {nip}
            </p>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1">
              <span>{selectedDesk}</span>
              <span>•</span>
              <span className="text-blue-300">AIPEX VeriBot Engine (Terverifikasi)</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-stretch sm:self-auto">
          <button
            type="button"
            onClick={() => setIsQrModalOpen(true)}
            className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-[#2563eb] hover:bg-blue-600 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">qr_code_scanner</span>
            <span>Pindai QR Tiket Warga</span>
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.removeItem("aipex_officer");
              } catch {}
              setIsAuthenticated(false);
              onBackToPortal();
            }}
            className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-slate-700"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            <span>Keluar</span>
          </button>
        </div>
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">Total Pengajuan</span>
            <span className="w-8 h-8 rounded-lg bg-blue-50 text-[#2563eb] flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">folder</span>
            </span>
          </div>
          <div className="mt-3">
            <span className="font-code-num text-2xl sm:text-3xl font-extrabold text-slate-900">
              {totalCount}
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">Sesi Pelayanan Hari Ini</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-700 font-medium">Lulus Fast-Track</span>
            <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">verified</span>
            </span>
          </div>
          <div className="mt-3">
            <span className="font-code-num text-2xl sm:text-3xl font-extrabold text-emerald-600">
              {approvedCount}
            </span>
            <span className="text-[11px] text-emerald-600/80 block mt-0.5">Siap Cetak / Ambil</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-700 font-medium">Antrean Menunggu</span>
            <span className="w-8 h-8 rounded-lg bg-blue-50 text-[#2563eb] flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">hourglass_top</span>
            </span>
          </div>
          <div className="mt-3">
            <span className="font-code-num text-2xl sm:text-3xl font-extrabold text-[#2563eb]">
              {pendingCount}
            </span>
            <span className="text-[11px] text-blue-600/80 block mt-0.5">Menunggu Verifikasi Meja</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-amber-700 font-medium">Butuh Revisi Berkas</span>
            <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">error</span>
            </span>
          </div>
          <div className="mt-3">
            <span className="font-code-num text-2xl sm:text-3xl font-extrabold text-amber-600">
              {revisionCount}
            </span>
            <span className="text-[11px] text-amber-600/80 block mt-0.5">Foto Buram / Kurang</span>
          </div>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Table Top Controls */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex overflow-x-auto whitespace-nowrap gap-1.5 pb-1 md:pb-0">
            <button
              onClick={() => setActiveTab("ALL")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === "ALL"
                  ? "bg-[#2563eb] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Semua ({totalCount})
            </button>
            <button
              onClick={() => setActiveTab("PENDING")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === "PENDING"
                  ? "bg-[#2563eb] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Menunggu Verifikasi ({pendingCount})
            </button>
            <button
              onClick={() => setActiveTab("APPROVED")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === "APPROVED"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Disetujui ({approvedCount})
            </button>
            <button
              onClick={() => setActiveTab("REVISI")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === "REVISI"
                  ? "bg-amber-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Perlu Revisi ({revisionCount})
            </button>
          </div>

          <div className="relative flex items-center w-full md:w-64">
            <span className="material-symbols-outlined absolute left-3 text-slate-400 text-[18px] pointer-events-none">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari warga, NIK, atau tiket..."
              className="w-full h-9 text-xs bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-500"
            />
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold border-b border-slate-200">
              <tr>
                <th className="py-3 px-4">KODE TIKET</th>
                <th className="py-3 px-4">WARGA & NIK</th>
                <th className="py-3 px-4">URUSAN</th>
                <th className="py-3 px-4">SKOR PRE-SCREENING AI</th>
                <th className="py-3 px-4">STATUS VERIFIKASI</th>
                <th className="py-3 px-4">WAKTU</th>
                <th className="py-3 px-4 text-right">AKSI LOKET</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTickets.map((ticket) => {
                const isAppr = ticket.status_verifikasi === "APPROVED";
                const isPend = ticket.status_verifikasi === "PENDING";
                const isRev = ticket.status_verifikasi === "REVISI";
                const isRej = ticket.status_verifikasi === "REJECTED";

                return (
                  <tr key={ticket.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="py-3.5 px-4">
                      <span className="font-code-num font-bold text-[#2563eb]">
                        {ticket.ticket_code}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900">{ticket.nama_warga}</span>
                        <span className="font-code-num text-slate-500 text-[11px]">
                          {ticket.nik_encrypted}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-slate-700 max-w-[200px] truncate block">
                        {ticket.jenis_dokumen}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-code-num font-bold ${
                            ticket.skor_ai >= 75 ? "text-emerald-600" : "text-amber-600"
                          }`}
                        >
                          {ticket.skor_ai}%
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            ticket.skor_ai >= 75
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}
                        >
                          {ticket.skor_ai >= 75 ? "Lulus AI" : "Butuh Perbaikan"}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          isAppr
                            ? "bg-emerald-100 text-emerald-800"
                            : isPend
                            ? "bg-blue-100 text-blue-800"
                            : isRev
                            ? "bg-amber-100 text-amber-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {isAppr ? "Disetujui" : isPend ? "Menunggu" : isRev ? "Revisi" : "Ditolak"}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-code-num text-slate-500 text-[11px]">
                      {ticket.created_at}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenInspect(ticket)}
                        className="px-3 py-1.5 rounded-lg bg-blue-50 text-[#2563eb] hover:bg-[#2563eb] hover:text-white font-semibold text-xs transition-colors cursor-pointer shadow-2xs inline-flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[15px]">visibility</span>
                        <span>Periksa Berkas</span>
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredTickets.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    Tidak ada tiket pengajuan yang sesuai dengan kriteria filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* INSPECT MODAL & 1-CLICK APPROVAL */}
      {inspectingTicket && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1c30]/75 backdrop-blur-xs p-4 animate-in fade-in duration-200"
          onClick={() => setInspectingTicket(null)}
        >
          <div
            className="bg-white max-w-2xl w-full rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-100 text-[#2563eb] flex items-center justify-center font-bold">
                  <span className="material-symbols-outlined text-[22px]">assignment_turned_in</span>
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 font-heading">
                    Pemeriksaan Berkas Fisik & Rekomendasi AI
                  </h3>
                  <p className="font-code-num text-xs text-[#2563eb] font-semibold">
                    {inspectingTicket.ticket_code} • {inspectingTicket.jenis_dokumen}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setInspectingTicket(null)}
                className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              {/* Citizen Information Card */}
              <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <span className="text-slate-400 block text-[11px]">Nama Pemohon:</span>
                  <strong className="text-slate-900 text-sm">{inspectingTicket.nama_warga}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">NIK:</span>
                  <span className="font-code-num text-slate-900 font-semibold">
                    {inspectingTicket.nik_raw || inspectingTicket.nik_encrypted}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Nomor WhatsApp:</span>
                  <a
                    href={`https://wa.me/${inspectingTicket.phone?.replace(/\D/g, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-700 font-semibold hover:underline inline-flex items-center gap-1"
                  >
                    <span>{inspectingTicket.phone || "08122516355"}</span>
                    <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                  </a>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Alamat Domisili:</span>
                  <span className="text-slate-700">{inspectingTicket.alamat || "Kelurahan Sukamaju"}</span>
                </div>
              </div>

              {/* AI Verification Analysis Box */}
              <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-blue-900 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[18px] text-[#2563eb]">
                      psychology
                    </span>
                    <span>Analisis Cognitive AI VeriBot</span>
                  </span>
                  <span className="font-code-num px-2 py-0.5 rounded bg-blue-600 text-white font-bold text-[11px]">
                    Skor: {inspectingTicket.skor_ai}% ({inspectingTicket.status_ai})
                  </span>
                </div>
                <p className="text-slate-700 leading-relaxed">
                  {inspectingTicket.catatan_ai}
                </p>
              </div>

              {/* Officer Notes Input */}
              <div className="flex flex-col gap-1.5">
                <label className="font-bold text-slate-700 uppercase tracking-wide">
                  CATATAN DISPOSISI PETUGAS LOKET:
                </label>
                <textarea
                  rows={3}
                  value={officerNotes}
                  onChange={(e) => setOfficerNotes(e.target.value)}
                  placeholder="Contoh: Berkas fisik e-KTP telah dicocokkan dengan master data Dukcapil. Siap cetak di Loket 1."
                  className="w-full p-3 rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                ></textarea>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleReject(inspectingTicket.id)}
                className="px-4 py-2 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 font-semibold cursor-pointer"
              >
                Tolak
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleRequestRevision(inspectingTicket.id)}
                  className="px-4 py-2 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200 font-semibold cursor-pointer"
                >
                  Minta Revisi Foto
                </button>

                <button
                  type="button"
                  onClick={() => handleApprove(inspectingTicket.id)}
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span>Setujui (1-Click Fast-Track)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR SCAN MODAL */}
      {isQrModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1c30]/75 backdrop-blur-xs p-4 animate-in fade-in duration-200"
          onClick={() => setIsQrModalOpen(false)}
        >
          <div
            className="bg-white max-w-md w-full rounded-2xl shadow-2xl p-6 border border-slate-200 flex flex-col gap-4 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 font-heading">
                Pindai QR Tiket Fast-Track
              </h3>
              <button
                onClick={() => setIsQrModalOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 hover:text-slate-900 flex items-center justify-center cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            <div className="relative overflow-hidden bg-slate-900 rounded-xl h-52 flex flex-col items-center justify-center text-white">
              <div className="pointer-events-none absolute inset-x-0 h-10 animate-scan-beam z-10">
                <div className="w-full h-1 bg-cyan-400 shadow-[0_0_15px_#38bdf8]"></div>
                <div className="w-full h-8 bg-gradient-to-b from-cyan-400/20 to-transparent"></div>
              </div>
              <span className="material-symbols-outlined text-[42px] text-cyan-300 mb-2">
                qr_code_scanner
              </span>
              <p className="text-xs text-slate-300">Arahkan kamera ke QR Code Tiket Warga</p>
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
              <span className="text-xs font-semibold text-slate-700">
                Atau Masukkan Kode Tiket Manual:
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={manualTicketCode}
                  onChange={(e) => setManualTicketCode(e.target.value)}
                  placeholder="Contoh: TKT-202609-8410"
                  className="flex-1 h-10 px-3 rounded-xl border border-slate-300 font-code-num text-xs uppercase"
                />
                <button
                  type="button"
                  onClick={() => {
                    const found = tickets.find(
                      (t) => t.ticket_code.toUpperCase() === manualTicketCode.trim().toUpperCase()
                    );
                    if (found) {
                      setIsQrModalOpen(false);
                      handleOpenInspect(found);
                    } else {
                      alert("Kode tiket tidak ditemukan.");
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-[#2563eb] text-white font-semibold text-xs cursor-pointer shadow-xs"
                >
                  Buka
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
