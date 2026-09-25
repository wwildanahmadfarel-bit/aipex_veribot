import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  FileText, 
  Clock, 
  Eye, 
  LogOut, 
  AlertTriangle,
  RefreshCw,
  User,
  AlertCircle,
  Calendar,
  Download,
  Printer,
  Camera
} from 'lucide-react';
import { AipexLogo } from './AipexLogo';
import { downloadTicketQrPng } from '../lib/ticketQr';

// Pemindai QR dimuat malas agar lib kamera (~350KB) tidak memberatkan bundle awal.
const QrScanModal = React.lazy(() => import('./QrScanModal'));

export interface Ticket {
  id: string;
  kode_tiket: string;
  nik: string;
  nama: string;
  no_hp?: string;
  jenis_dokumen: string;
  skor_kejelasan: number;
  status_verifikasi: 'BERHASIL' | 'BURAM' | 'TIDAK_VALID' | 'DISETUJUI' | 'DITOLAK' | 'PERLU_PERBAIKAN';
  catatan?: string;
  created_at: string;
  file_url?: string;
}

export interface Officer {
  id: string;
  nama: string;
  role: string;
  token?: string;
}

export interface AdminDashboardProps {
  officer?: Officer;
  onLogout?: () => void;
}

// Empty-state jujur: jangan tampilkan tiket palsu bila backend kosong/offline.
// Sebelumnya getMockTickets() menutupi data kosong dengan 3 tiket + foto Unsplash.
function getEmptyTickets(): Ticket[] {
  return [];
}

/** Viewer foto sementara tiket (didekripsi server per-request, no-store).
 *  Kosong bila foto tak tersimpan / sudah di-purge pasca-keputusan. */
function TicketFotoViewer({ kodeTiket, getHeaders }: { kodeTiket: string; getHeaders: () => Record<string, string> }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    let objUrl: string | null = null;
    setState("loading");
    setUrl(null);
    (async () => {
      try {
        const res = await fetch(`/api/tickets/foto?kode=${encodeURIComponent(kodeTiket)}`, {
          headers: { ...getHeaders() },
        });
        if (!alive) return;
        if (res.status === 404) {
          setState("empty");
          return;
        }
        if (!res.ok) {
          setState("error");
          return;
        }
        const blob = await res.blob();
        if (!alive) return;
        objUrl = URL.createObjectURL(blob);
        setUrl(objUrl);
        setState("ready");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [kodeTiket, reloadKey]);

  return (
    <div className="bg-slate-900 aspect-video rounded-xl overflow-hidden border border-slate-200 relative flex items-center justify-center group">
      {state === "ready" && url ? (
        <img src={url} alt="Dokumen Kependudukan (arsip sementara)" className="w-full h-full object-contain" />
      ) : state === "loading" ? (
        <div className="text-center p-4">
          <RefreshCw className="w-8 h-8 text-slate-500 mx-auto mb-2 animate-spin" />
          <p className="text-xs text-slate-400">Memuat foto arsip...</p>
        </div>
      ) : (
        <div className="text-center p-4">
          <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-400">
            {state === "empty"
              ? "Foto sudah di-purge / tak tersimpan (arsip sementara hingga diputus)"
              : "Gagal memuat foto"}
          </p>
          <p className="text-[10px] text-slate-500 mt-1">Minta warga tunjukkan fisik dokumen di loket</p>
          {state === "error" && (
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="mt-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold cursor-pointer"
            >
              Muat ulang
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function AdminDashboard({ officer: propOfficer, onLogout }: AdminDashboardProps) {  const [officer, setOfficer] = useState<Officer | null>(propOfficer || null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('SEMUA');
  
  // State Modal Detail & Action
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [actionNotes, setActionNotes] = useState<string>('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  // Modal kamera pemindai QR tiket.
  const [scanOpen, setScanOpen] = useState<boolean>(false);
  const handleScanDetected = (kode: string) => {
    setScanOpen(false);
    setSearchQuery(kode);
    setFilterStatus('SEMUA');
    const found = tickets.find(
      (t) => String(t.kode_tiket || '').toUpperCase() === kode.toUpperCase()
    );
    if (found) {
      setSelectedTicket(found);
      setActionNotes(found.catatan || '');
    } else {
      alert(`QR terbaca (${kode}) tetapi tiket tidak ada di daftar ini. Coba Refresh atau periksa kode manual.`);
    }
  };
  // Nomor WA bisa dikoreksi petugas (tiket lama tidak punya nomor tersimpan).
  const [actionPhone, setActionPhone] = useState<string>('');
  // Sudah disentuh/diketik? Hint merah hanya setelah ada interaksi (bukan saat kosong awal).
  const [actionPhoneTouched, setActionPhoneTouched] = useState<boolean>(false);
  useEffect(() => {
    if (selectedTicket) {
      const cur = String(selectedTicket.no_hp || '');
      if (cur && cur !== '—') {
        setActionPhone(cur);
      } else {
        // Tiket lama tanpa nomor: pinjam dari tiket NIK sama (NIK unik per orang).
        const nikKey = String(selectedTicket.nik || '').replace(/\D/g, '');
        const sibling = nikKey
          ? tickets.find((t) => t.id !== selectedTicket.id && String(t.nik || '').replace(/\D/g, '') === nikKey && String(t.no_hp || '') !== '' && String(t.no_hp) !== '—')
          : undefined;
        setActionPhone(sibling ? String(sibling.no_hp) : '');
      }
      setActionPhoneTouched(false);
    } else {
      setActionPhone('');
      setActionPhoneTouched(false);
    }
  }, [selectedTicket?.id]);
  const isActionPhoneEmpty = actionPhone.trim() === '';
  const isActionPhoneValid = (() => {
    const d = actionPhone.replace(/[\s\-().]/g, '').replace(/^\+/, '');
    return /^08\d{8,12}$/.test(d) || /^628\d{8,12}$/.test(d);
  })();

  // Load Session Petugas jika tidak di-pass lewat props.
  // JANGAN auto-login diam-diam: bila tidak ada session, biarkan null agar
  // App dapat mengarahkan kembali ke login petugas.
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  useEffect(() => {
    if (!officer) {
      try {
        const savedOfficer = localStorage.getItem('aipex_officer');
        if (savedOfficer) {
          setOfficer(JSON.parse(savedOfficer));
        } else {
          setOfficer(null);
        }
      } catch {
        setOfficer(null);
      } finally {
        setAuthChecked(true);
      }
    } else {
      setAuthChecked(true);
    }
    fetchTickets();
  }, []);

  // Token JWT sesi petugas (disimpan bersama profil di localStorage saat login).
  const officerToken = (): string => {
    try {
      const raw = localStorage.getItem('aipex_officer');
      if (!raw) return "";
      const o = JSON.parse(raw) as { token?: string };
      return typeof o?.token === "string" ? o.token : "";
    } catch {
      return "";
    }
  };

  const authHeaders = (): Record<string, string> => {
    const t = officer?.token || officerToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const handleUnauthorized = () => {
    try {
      localStorage.removeItem('aipex_officer');
    } catch {}
    setOfficer(null);
  };

  // Fetch Daftar Tiket dari API Backend (tanpa mock agar data jujur)
  const [fetchError, setFetchError] = useState<string>("");
  const fetchTickets = async () => {
    setLoading(true);
    setFetchError("");
    try {
      const res = await fetch('/api/admin/tickets', { headers: { ...authHeaders() } });
      if (res.status === 401) {
        handleUnauthorized();
        setFetchError("Sesi petugas kedaluwarsa. Login ulang.");
        return;
      }
      const result = await res.json();
      if (result.success && Array.isArray(result.data) && result.data.length > 0) {
        // Map data dari API ke interface Ticket jika ada perbedaan kolom.
        // Nomor: ambil varian key apa pun yang tak kosong (no_hp/noHp/phone/telepon).
        const pickPhone = (item: any): string => {
          for (const k of ["no_hp", "noHp", "phone", "telepon"]) {
            const v = String(item?.[k] ?? "").trim();
            if (v && v !== "—" && v !== "-") return v;
          }
          return "—";
        };
        const mappedTickets: Ticket[] = result.data.map((item: any) => ({
          id: String(item.id || item.kode_tiket),
          kode_tiket: item.kode_tiket || `TKT-${String(item.id).slice(0, 6)}`,
          nik: item.nik || item.nik_raw || '—',
          nama: item.nama || item.nama_warga || 'Pemohon Kependudukan',
          no_hp: pickPhone(item),
          jenis_dokumen: item.jenis_dokumen || 'KTP',
          skor_kejelasan: Number(item.skor_kejelasan ?? item.skor_ai ?? 0),
          status_verifikasi: (item.status_verifikasi || 'BERHASIL') as Ticket['status_verifikasi'],
          catatan: item.catatan || item.catatan_petugas || item.catatan_ai || '',
          created_at: item.created_at || new Date().toISOString(),
          // UU PDP: backend tidak menyimpan foto; jangan tampilkan foto palsu.
          file_url: item.file_url || undefined
        }));
        setTickets(mappedTickets);
      } else if (result.success && Array.isArray(result.data)) {
        setTickets(getEmptyTickets());
      } else {
        setTickets(getEmptyTickets());
        setFetchError(result?.message || "Gagal memuat tiket dari server.");
      }
    } catch (err) {
      console.warn('Gagal fetch tiket admin:', err);
      setTickets(getEmptyTickets());
      setFetchError("Tidak terhubung ke server. Jalankan `npm run dev` lalu tekan Refresh.");
    } finally {
      setLoading(false);
    }
  };

  // Handler Update Status Tiket + Notifikasi WA Fonnte (mode ketat:
  // WA gagal -> status DIBATALKAN server + rollback, UI refresh dari server).
  const handleUpdateStatus = async (status: 'DISETUJUI' | 'DITOLAK' | 'PERLU_PERBAIKAN') => {
    if (!selectedTicket || !officer) return;
    if (!isActionPhoneValid) {
      alert('Nomor WhatsApp belum valid (format 08xxxxxxxxxx). Perbaiki dulu sebelum memutus.');
      return;
    }
    setProcessingId(selectedTicket.id);

    const defaultNotes = {
      DISETUJUI: 'Dokumen valid & terverifikasi petugas',
      DITOLAK: 'Dokumen tidak sesuai persyaratan',
      PERLU_PERBAIKAN: 'Mohon unggah ulang foto dokumen yang lebih jelas'
    };

    const finalNotes = actionNotes || defaultNotes[status];

    try {
      const res = await fetch('/api/admin/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          ticketId: selectedTicket.id,
          officerId: officer.id,
          status: status,
          nama: selectedTicket.nama,
          no_hp: actionPhone.trim(),             // Nomor WA koreksi petugas (wajib valid)
          jenis_dokumen: selectedTicket.jenis_dokumen,
          kode_tiket: selectedTicket.kode_tiket,
          catatan: finalNotes
        })
      });

      const result = await res.json();

      if (res.status === 401 || result.code === 'OFFICER_UNAUTHORIZED') {
        handleUnauthorized();
        alert('Sesi petugas kedaluwarsa. Login ulang.');
        return;
      }
      if (result.success && result.waSent) {
        const fixedPhone = actionPhone.trim();
        setTickets(prev => prev.map(t => (t.id === selectedTicket.id || t.kode_tiket === selectedTicket.kode_tiket) ? { ...t, status_verifikasi: status, catatan: finalNotes, no_hp: fixedPhone } : t));
        setSelectedTicket(null);
        setActionNotes('');
        alert(`Status ${status} tersimpan & notifikasi WA terkirim ke ${fixedPhone}.`);
      } else if (!result.success && (result.code === 'WA_FAILED' || result.code === 'WA_DISABLED' || result.code === 'WA_INVALID_NUMBER')) {
        // Mode ketat: server sudah rollback — refresh agar UI tampil status lama.
        await fetchTickets();
        setSelectedTicket(null);
        setActionNotes('');
        alert(result.message || 'WA gagal — status DIBATALKAN (rollback).');
      } else if (result.success) {
        setTickets(prev => prev.map(t => (t.id === selectedTicket.id || t.kode_tiket === selectedTicket.kode_tiket) ? { ...t, status_verifikasi: status, catatan: finalNotes } : t));
        setSelectedTicket(null);
        setActionNotes('');
        alert('Status berhasil diperbarui.');
      } else {
        alert(result.message || 'Gagal memperbarui status tiket');
      }
    } catch (err) {
      console.error('Error saat update status:', err);
      alert('Gagal terhubung ke server backend.');
    } finally {
      setProcessingId(null);
    }
  };

  // Filter Tiket berdasarkan Pencarian & Tab Status
  const filteredTickets = tickets.filter(t => {
    const matchSearch = (t.kode_tiket || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (t.nama || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (t.nik || '').includes(searchQuery);
    const matchFilter = filterStatus === 'SEMUA' ? true : t.status_verifikasi === filterStatus;
    return matchSearch && matchFilter;
  });

  // Count Metrics — sinkron dengan Header/App: PENDING juga dihitung perlu verifikasi.
  const totalPending = tickets.filter(t => ['PENDING', 'BERHASIL', 'BURAM', 'REVISI', 'PERLU_PERBAIKAN'].includes(String(t.status_verifikasi || '').toUpperCase())).length;
  const totalApproved = tickets.filter(t => ['DISETUJUI', 'APPROVED'].includes(String(t.status_verifikasi || '').toUpperCase())).length;
  const totalRejected = tickets.filter(t => ['DITOLAK', 'REJECTED', 'TIDAK_VALID'].includes(String(t.status_verifikasi || '').toUpperCase())).length;

  // --- Rekap bulanan tiket masuk (dihitung client-side dari tickets yang termuat) ---
  const BULAN_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const nowRef = new Date();
  const [rekapBulan, setRekapBulan] = useState<number>(nowRef.getMonth());
  const [rekapTahun, setRekapTahun] = useState<number>(nowRef.getFullYear());

  const parseTicketMonth = (raw: unknown): { y: number; m: number } | null => {
    if (!raw) return null;
    const s = String(raw).trim();
    // Format campuran: ISO ("2026-09-08T07:23") dan "YYYY-MM-DD HH:mm".
    const d = new Date(s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s);
    if (!isNaN(d.getTime())) return { y: d.getFullYear(), m: d.getMonth() };
    const m = /(\d{4})-(\d{2})/.exec(s);
    if (m) {
      const mm = Number(m[2]);
      if (mm >= 1 && mm <= 12) return { y: Number(m[1]), m: mm - 1 };
    }
    return null;
  };
  const isAppr = (s: unknown) => ['DISETUJUI', 'APPROVED'].includes(String(s || '').toUpperCase());
  const isRej = (s: unknown) => ['DITOLAK', 'REJECTED', 'TIDAK_VALID'].includes(String(s || '').toUpperCase());

  const tahunList = useMemo(() => {
    const set = new Set<number>();
    tickets.forEach((t) => {
      const p = parseTicketMonth(t.created_at);
      if (p) set.add(p.y);
    });
    const arr = [...set].sort((a, b) => b - a);
    if (!arr.includes(nowRef.getFullYear())) arr.unshift(nowRef.getFullYear());
    return arr;
  }, [tickets]);

  const { monthly, rekapInvalid } = useMemo(() => {
    const rows = Array.from({ length: 12 }, () => ({ masuk: 0, disetujui: 0, ditolak: 0, sisa: 0 }));
    let invalid = 0;
    tickets.forEach((t) => {
      const p = parseTicketMonth(t.created_at);
      if (!p) {
        invalid += 1;
        return;
      }
      if (p.y !== rekapTahun) return;
      const b = rows[p.m];
      b.masuk += 1;
      if (isAppr(t.status_verifikasi)) b.disetujui += 1;
      else if (isRej(t.status_verifikasi)) b.ditolak += 1;
      else b.sisa += 1;
    });
    return { monthly: rows, rekapInvalid: invalid };
  }, [tickets, rekapTahun]);

  const bulanIni = monthly[rekapBulan];
  const maxBulanan = Math.max(1, ...monthly.map((r) => r.masuk));
  const totalTahun = monthly.reduce((acc, r) => acc + r.masuk, 0);

  const downloadRekapCsv = () => {
    const header = 'Bulan;Masuk;Disetujui;Ditolak;Perlu Verifikasi/Sisa\n';
    const lines = monthly.map((r, i) => `${BULAN_PANJANG[i]} ${rekapTahun};${r.masuk};${r.disetujui};${r.ditolak};${r.sisa}`).join('\n');
    const total = monthly.reduce(
      (acc, r) => ({ masuk: acc.masuk + r.masuk, disetujui: acc.disetujui + r.disetujui, ditolak: acc.ditolak + r.ditolak, sisa: acc.sisa + r.sisa }),
      { masuk: 0, disetujui: 0, ditolak: 0, sisa: 0 }
    );
    const csv = '\uFEFF' + header + lines + `\nTOTAL ${rekapTahun};${total.masuk};${total.disetujui};${total.ditolak};${total.sisa}\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rekap-tiket-${rekapTahun}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (authChecked && !officer) {
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 text-center p-8 bg-white rounded-2xl border border-slate-200">
        <AlertTriangle className="w-8 h-8 text-amber-500" />
        <h3 className="font-bold text-[#0F172A]">Sesi petugas tidak ditemukan</h3>
        <p className="text-xs text-slate-500 max-w-sm">Silakan login ulang dengan kode akses petugas untuk membuka dashboard.</p>
        <button
          type="button"
          onClick={() => { try { localStorage.removeItem('aipex_officer'); } catch {} if (onLogout) onLogout(); else window.location.reload(); }}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 cursor-pointer"
        >
          Kembali ke Login Petugas
        </button>
      </div>
    );
  }

  return (
    <div id="adminDashboard" className="min-h-screen bg-slate-100 font-sans text-[#0F172A] -mx-4 lg:-mx-6 -my-4 p-4 lg:p-6 overflow-x-clip">

      {/* TOPBAR HEADER */}
      <header id="adminHeader" className="bg-slate-900 text-white rounded-2xl shadow-md mb-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 p-1.5 flex items-center justify-center shrink-0 shadow-xs">
              <AipexLogo className="w-full h-full" size={28} />
            </div>
            <div className="flex flex-col justify-center leading-tight">
              <h1 className="font-extrabold text-sm sm:text-base tracking-wider uppercase flex items-center gap-2 font-heading leading-tight">
                AIPEX VERIBOT <span className="text-[10px] bg-blue-500/30 text-blue-300 border border-blue-400/30 px-2 py-0.5 rounded-full font-normal">Panel Petugas</span>
              </h1>
              <p className="text-xs text-slate-400 font-normal leading-tight mt-0.5">Sistem Verifikasi Otomatis</p>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            <div className="hidden sm:flex items-center gap-2.5 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700">
              <User className="w-4 h-4 text-blue-400" />
              <div className="text-right">
                <p className="text-xs font-semibold text-slate-200">{officer?.nama || 'Petugas Loket'}</p>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">{officer?.role || 'PETUGAS'}</p>
              </div>
            </div>

            <button
              id="adminLogoutBtn"
              type="button"
              onClick={() => {
                try {
                  localStorage.removeItem('aipex_officer');
                } catch {}
                if (onLogout) onLogout();
                else window.location.reload();
              }}
              className="p-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-xl text-slate-300 hover:text-red-400 border border-slate-700 transition cursor-pointer flex items-center gap-1.5 text-xs font-medium"
              title="Keluar / Logout"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden md:inline">Keluar</span>
            </button>
          </div>
        </div>
      </header>

      {/* CONTAINER UTAMA */}
      <main className="max-w-7xl mx-auto space-y-6">
        
        {/* METRICS SUMMARY */}
        <div id="adminMetricsGrid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 shrink-0">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Total Masuk</p>
              <h3 className="text-xl font-bold text-[#0F172A]">{tickets.length} Tiket</h3>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
            <div className="p-3 bg-amber-50 text-amber-500 rounded-xl border border-amber-100 shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Perlu Verifikasi</p>
              <h3 className="text-xl font-bold text-amber-500">{totalPending} Tiket</h3>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100 shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Disetujui</p>
              <h3 className="text-xl font-bold text-emerald-600">{totalApproved} Tiket</h3>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
            <div className="p-3 bg-red-50 text-red-500 rounded-xl border border-red-100 shrink-0">
              <XCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Ditolak / Buram</p>
              <h3 className="text-xl font-bold text-red-500">{totalRejected} Tiket</h3>
            </div>
          </div>
        </div>

        {/* REKAP BULANAN TIKET MASUK */}
        <div id="adminRekap" className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <style>{`@media print { body * { visibility: hidden; } #adminRekap, #adminRekap * { visibility: visible; } #adminRekap { position: absolute; left: 0; top: 0; width: 100%; border: none; } #adminRekap .no-print { display: none !important; } }`}</style>
          <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl border border-blue-100 shrink-0">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#0F172A]">Rekap Bulanan Tiket Masuk</h3>
                <p className="text-[11px] text-slate-500">
                  {BULAN_PANJANG[rekapBulan]} {rekapTahun}: {bulanIni.masuk} masuk • {bulanIni.disetujui} disetujui • {bulanIni.ditolak} ditolak • {bulanIni.sisa} perlu verifikasi
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 no-print">
              <select
                aria-label="Pilih bulan rekap"
                value={rekapBulan}
                onChange={(e) => setRekapBulan(Number(e.target.value))}
                className="h-9 px-2.5 rounded-xl bg-slate-50 border border-slate-300 text-xs font-semibold text-slate-700 outline-none cursor-pointer"
              >
                {BULAN_PANJANG.map((b, i) => (
                  <option key={b} value={i}>{b}</option>
                ))}
              </select>
              <select
                aria-label="Pilih tahun rekap"
                value={rekapTahun}
                onChange={(e) => setRekapTahun(Number(e.target.value))}
                className="h-9 px-2.5 rounded-xl bg-slate-50 border border-slate-300 text-xs font-semibold text-slate-700 outline-none cursor-pointer"
              >
                {tahunList.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={downloadRekapCsv}
                className="h-9 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
                title="Unduh rekap tahun berjalan sebagai CSV"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="h-9 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
                title="Cetak rekap bulanan"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Cetak</span>
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Grafik batang 12 bulan */}
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Grafik {rekapTahun} (total {totalTahun})</p>
              <div className="flex items-end gap-1.5 h-40 bg-slate-50 border border-slate-200/60 rounded-xl p-3">
                {monthly.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setRekapBulan(i)}
                    aria-label={`Rekap ${BULAN_PANJANG[i]}: ${r.masuk} masuk`}
                    title={`${BULAN_PANJANG[i]}: ${r.masuk} masuk (${r.disetujui} setuju, ${r.ditolak} tolak, ${r.sisa} sisa)`}
                    className={`flex-1 flex flex-col items-center justify-end gap-1 h-full rounded-lg transition cursor-pointer py-3 -my-3 ${i === rekapBulan ? 'bg-blue-50/60' : 'hover:bg-slate-100'}`}
                  >
                    <span className="text-[10px] font-bold text-slate-600">{r.masuk > 0 ? r.masuk : ''}</span>
                    <div className="w-full max-w-[28px] flex flex-col-reverse rounded-md overflow-hidden border border-slate-200 bg-white" style={{ height: `${Math.max(4, Math.round((r.masuk / maxBulanan) * 100))}%` }}>
                      {r.disetujui > 0 && <div className="bg-emerald-500" style={{ height: `${Math.round((r.disetujui / Math.max(1, r.masuk)) * 100)}%` }} />}
                      {r.ditolak > 0 && <div className="bg-red-500" style={{ height: `${Math.round((r.ditolak / Math.max(1, r.masuk)) * 100)}%` }} />}
                      {r.sisa > 0 && <div className="bg-amber-400" style={{ height: `${Math.round((r.sisa / Math.max(1, r.masuk)) * 100)}%` }} />}
                    </div>
                    <span className={`text-[10px] font-semibold ${i === rekapBulan ? 'text-blue-700' : 'text-slate-400'}`}>{BULAN_LABEL[i]}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500">
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Disetujui</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" /> Ditolak</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" /> Perlu verifikasi</span>
              </div>
            </div>

            {/* Tabel 12 bulan */}
            <div>
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Tabel {rekapTahun}</p>
              <div className="overflow-x-auto border border-slate-200/60 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="py-2 px-3">Bulan</th>
                      <th className="py-2 px-3 text-center">Masuk</th>
                      <th className="py-2 px-3 text-center">Setuju</th>
                      <th className="py-2 px-3 text-center">Tolak</th>
                      <th className="py-2 px-3 text-center">Sisa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monthly.map((r, i) => (
                      <tr
                        key={i}
                        onClick={() => setRekapBulan(i)}
                        className={`cursor-pointer transition ${i === rekapBulan ? 'bg-blue-50/70' : 'hover:bg-slate-50/80'}`}
                      >
                        <td className="py-2 px-3 font-semibold text-slate-700">{BULAN_PANJANG[i]}</td>
                        <td className="py-2 px-3 text-center font-bold text-[#0F172A]">{r.masuk}</td>
                        <td className="py-2 px-3 text-center text-emerald-600 font-semibold">{r.disetujui}</td>
                        <td className="py-2 px-3 text-center text-red-500 font-semibold">{r.ditolak}</td>
                        <td className="py-2 px-3 text-center text-amber-500 font-semibold">{r.sisa}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rekapInvalid > 0 && (
                <p className="text-[10px] text-slate-400 mt-1.5">{rekapInvalid} tiket tanggal tak terbaca — tidak masuk rekap.</p>
              )}
            </div>
          </div>
        </div>

        {/* FILTER & SEARCH BAR */}
        <div id="adminToolbar" className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                id="adminSearchInput"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari NIK, Nama Warga, atau Kode Tiket..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 text-xs sm:text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              />
            </div>
            <button
              id="adminScanBtn"
              type="button"
              onClick={() => setScanOpen(true)}
              aria-label="Pindai QR tiket dengan kamera"
              title="Pindai QR tiket dengan kamera"
              className="min-w-[44px] min-h-[44px] px-3 rounded-xl bg-[#2563EB] hover:bg-blue-700 active:bg-blue-800 text-white inline-flex items-center justify-center gap-1.5 shadow-xs transition cursor-pointer shrink-0"
            >
              <Camera className="w-5 h-5" />
              <span className="hidden sm:inline text-xs font-semibold">Scan</span>
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
            <Filter className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
            {(['SEMUA', 'BERHASIL', 'DISETUJUI', 'DITOLAK', 'BURAM', 'PERLU_PERBAIKAN'] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setFilterStatus(status)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  filterStatus === status
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {status}
              </button>
            ))}

            <button
              id="adminRefreshBtn"
              type="button"
              onClick={fetchTickets}
              className="p-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-600 rounded-xl transition ml-2 cursor-pointer"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* TABEL DAFTAR TIKET (desktop) + KARTU (mobile) */}
        <div id="adminTableCard" className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden hidden md:block">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Kode Tiket</th>
                  <th className="py-3.5 px-4">Pemohon & NIK</th>
                  <th className="py-3.5 px-4">Jenis Dokumen</th>
                  <th className="py-3.5 px-4 text-center">Skor OCR AI</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Tanggal Masuk</th>
                  <th className="py-3.5 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                        <span>Memuat daftar pengajuan berkas...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredTickets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      {fetchError || "Belum ada tiket masuk / tidak ada yang cocok dengan pencarian."}
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map((ticket) => (
                    <tr key={ticket.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3.5 px-4 font-mono font-bold text-blue-600">
                        {ticket.kode_tiket}
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-[#0F172A]">{ticket.nama}</p>
                        <p className="text-[11px] text-slate-400 font-mono">NIK: {ticket.nik}</p>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-700">
                          {ticket.jenis_dokumen}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <span className={`font-bold px-2.5 py-0.5 rounded-full text-[11px] ${
                          ticket.skor_kejelasan >= 80 ? 'bg-emerald-100 text-emerald-700' :
                          ticket.skor_kejelasan >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {ticket.skor_kejelasan}%
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={ticket.status_verifikasi} />
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                        {new Date(ticket.created_at).toLocaleDateString('id-ID', {
                          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTicket(ticket);
                            setActionNotes(ticket.catatan || '');
                          }}
                          className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-600 font-semibold rounded-xl text-xs transition border border-blue-200 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Periksa</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* KARTU DAFTAR TIKET (mobile <md, tanpa scroll horizontal) */}
        <div id="adminTicketCards" className="md:hidden space-y-3">
          {loading ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-400">
              Memuat daftar pengajuan berkas...
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-400">
              {fetchError || "Belum ada tiket masuk / tidak ada yang cocok dengan pencarian."}
            </div>
          ) : (
            filteredTickets.map((ticket) => (
              <article key={ticket.id} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-blue-600 text-xs break-all">{ticket.kode_tiket}</span>
                  <StatusBadge status={ticket.status_verifikasi} />
                </div>
                <div>
                  <p className="font-semibold text-[#0F172A] text-sm">{ticket.nama}</p>
                  <p className="text-[11px] text-slate-400 font-mono">NIK: {ticket.nik}</p>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded-lg font-medium text-slate-700">
                    {ticket.jenis_dokumen}
                  </span>
                  <span>
                    Skor <strong className="text-[#0F172A]">{ticket.skor_kejelasan}%</strong> • {new Date(ticket.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTicket(ticket);
                    setActionNotes(ticket.catatan || '');
                  }}
                  className="w-full min-h-[44px] px-3 py-2.5 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-600 font-semibold rounded-xl text-xs transition border border-blue-200 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Eye className="w-4 h-4" />
                  <span>Periksa</span>
                </button>
              </article>
            ))
          )}
        </div>

      </main>

      {/* MODAL DETAIL & VERIFIKASI PETUGAS */}
      {selectedTicket && (
        <div id="adminInspectModal" className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8">
            
            {/* MODAL HEADER */}
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm sm:text-base flex items-center gap-2">
                  <span>Verifikasi Berkas #{selectedTicket.kode_tiket}</span>
                </h3>
                <p className="text-xs text-slate-400">Diunggah pada {new Date(selectedTicket.created_at).toLocaleString('id-ID')}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTicket(null)}
                aria-label="Tutup detail tiket"
                className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* MODAL BODY */}
            <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
              
              {/* LAYOUT 2 KOLOM: FOTO DOKUMEN & HASIL OCR */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* PRATINJAU FOTO DOKUMEN (arsip sementara terenkripsi, purge saat diputus) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Foto Dokumen Warga</label>
                    <button
                      type="button"
                      onClick={() => {
                        downloadTicketQrPng({
                          kode_tiket: selectedTicket.kode_tiket,
                          nama: selectedTicket.nama,
                          nik: selectedTicket.nik,
                          jenis_dokumen: selectedTicket.jenis_dokumen,
                          skor_kejelasan: selectedTicket.skor_kejelasan,
                          status_verifikasi: selectedTicket.status_verifikasi,
                          created_at: selectedTicket.created_at,
                        }).catch(() => alert('Gagal mengunduh QR PNG.'));
                      }}
                      className="min-h-[44px] px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      title="Unduh QR tiket sebagai PNG"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>QR PNG</span>
                    </button>
                  </div>
                  <TicketFotoViewer kodeTiket={selectedTicket.kode_tiket} getHeaders={authHeaders} />
                </div>

                {/* HASIL EKSTRAKSI OCR GEMINI */}
                <div className="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">Hasil Ekstraksi Gemini AI</label>
                  
                  <div>
                    <span className="text-slate-400 block text-[10px]">Nama Lengkap:</span>
                    <span className="font-bold text-[#0F172A]">{selectedTicket.nama}</span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px]">NIK (16 Digit):</span>
                    <span className="font-mono font-bold text-blue-600">{selectedTicket.nik}</span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px]">Jenis Dokumen:</span>
                    <span className="font-semibold text-slate-700">{selectedTicket.jenis_dokumen}</span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px]">No. WhatsApp Pemohon (wajib, untuk notifikasi):</span>
                    <input
                      type="tel"
                      value={actionPhone}
                      onChange={(e) => { setActionPhone(e.target.value); setActionPhoneTouched(true); }}
                      placeholder="08xxxxxxxxxx"
                      inputMode="tel"
                      className={`mt-1 w-full p-2 bg-white border rounded-xl font-mono text-xs focus:outline-none focus:ring-2 transition ${isActionPhoneValid ? 'border-slate-200 focus:ring-blue-500' : actionPhoneTouched && !isActionPhoneEmpty ? 'border-red-300 focus:ring-red-200' : 'border-slate-200 focus:ring-blue-500'}`}
                    />
                    {isActionPhoneEmpty ? (
                      <p className="text-[10px] text-slate-400 mt-1">Belum ada nomor tersimpan (tiket lama) — ketik nomor asli warga di sini. Contoh di atas hanya format, bukan isi.</p>
                    ) : !isActionPhoneValid ? (
                      <p className="text-[10px] text-red-600 mt-1">Nomor belum valid — tombol putus aktif setelah format 08xxxxxxxxxx benar. Nomor tersimpan setelah putus berhasil.</p>
                    ) : null}
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px]">Skor Kejelasan Foto:</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${selectedTicket.skor_kejelasan >= 80 ? 'bg-emerald-500' : selectedTicket.skor_kejelasan >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: `${selectedTicket.skor_kejelasan}%` }}
                        ></div>
                      </div>
                      <span className="font-bold text-slate-700">{selectedTicket.skor_kejelasan}%</span>
                    </div>
                  </div>
                </div>

              </div>

              {/* INPUT CATATAN PETUGAS */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Catatan Petugas / Alasan Penolakan</label>
                <textarea
                  rows={3}
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  placeholder="Masukkan instruksi tambahan, alasan penolakan, atau pesan unggah ulang..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                ></textarea>
              </div>

            </div>

            {/* MODAL FOOTER / TOMBOL AKSI */}
            <div className="bg-slate-50 p-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setSelectedTicket(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Batal
              </button>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={processingId === selectedTicket.id || !isActionPhoneValid}
                  onClick={() => handleUpdateStatus('PERLU_PERBAIKAN')}
                  className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                  title={isActionPhoneValid ? "Minta pemohon untuk mengunggah ulang dokumen" : "Isi nomor WA valid dulu"}
                >
                  <AlertCircle className="w-4 h-4" />
                  <span>Minta Perbaikan</span>
                </button>

                <button
                  type="button"
                  disabled={processingId === selectedTicket.id || !isActionPhoneValid}
                  onClick={() => handleUpdateStatus('DITOLAK')}
                  className="px-3.5 py-2 bg-red-500 hover:bg-red-600 active:bg-red-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <XCircle className="w-4 h-4" />
                  <span>Tolak Berkas</span>
                </button>

                <button
                  type="button"
                  disabled={processingId === selectedTicket.id || !isActionPhoneValid}
                  onClick={() => handleUpdateStatus('DISETUJUI')}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Setujui & Pengesahan</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* MODAL KAMERA PEMINDAI QR */}
      {scanOpen && (
        <React.Suspense
          fallback={
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#1E293B]/80 p-4">
              <p className="text-xs text-white">Memuat pemindai kamera…</p>
            </div>
          }
        >
          <QrScanModal
            isOpen={scanOpen}
            onDetected={handleScanDetected}
            onClose={() => setScanOpen(false)}
          />
        </React.Suspense>
      )}

    </div>
  );
}

export default AdminDashboard;

// HELPER STATUS BADGE
export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'DISETUJUI':
      return <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 font-bold rounded-lg text-[10px] inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> DISETUJUI</span>;
    case 'DITOLAK':
    case 'TIDAK_VALID':
      return <span className="px-2.5 py-1 bg-red-100 text-red-700 font-bold rounded-lg text-[10px] inline-flex items-center gap-1"><XCircle className="w-3 h-3"/> DITOLAK</span>;
    case 'PERLU_PERBAIKAN':
      return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 font-bold rounded-lg text-[10px] inline-flex items-center gap-1"><AlertCircle className="w-3 h-3"/> PERLU PERBAIKAN</span>;
    case 'BERHASIL':
      return <span className="px-2.5 py-1 bg-blue-100 text-blue-700 font-bold rounded-lg text-[10px] inline-flex items-center gap-1"><Clock className="w-3 h-3"/> SIAP VERIFIKASI</span>;
    case 'BURAM':
      return <span className="px-2.5 py-1 bg-amber-100 text-amber-700 font-bold rounded-lg text-[10px] inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> BURAM</span>;
    default:
      return <span className="px-2.5 py-1 bg-slate-100 text-slate-600 font-bold rounded-lg text-[10px]">{status}</span>;
  }
}
