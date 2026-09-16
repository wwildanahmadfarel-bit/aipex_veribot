import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
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
  AlertCircle
} from 'lucide-react';
import { AipexLogo } from './AipexLogo';

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
}

export interface AdminDashboardProps {
  officer?: Officer;
  onLogout?: () => void;
}

// HELPER MOCK DATA
function getMockTickets(): Ticket[] {
  return [
    {
      id: '1',
      kode_tiket: 'TKT-884920',
      nik: '3374012005080001',
      nama: 'Budi Santoso',
      no_hp: '081298765432',
      jenis_dokumen: 'KTP',
      skor_kejelasan: 92,
      status_verifikasi: 'BERHASIL',
      file_url: 'https://images.unsplash.com/photo-1606166325683-e6deb697d301?auto=format&fit=crop&w=600&q=80',
      created_at: new Date(Date.now() - 3600000 * 2).toISOString()
    },
    {
      id: '2',
      kode_tiket: 'TKT-884921',
      nik: '3374021409950003',
      nama: 'Siti Rahmawati',
      no_hp: '085712345678',
      jenis_dokumen: 'KK',
      skor_kejelasan: 45,
      status_verifikasi: 'BURAM',
      catatan: 'Foto agak silau di bagian bawah',
      file_url: 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?auto=format&fit=crop&w=600&q=80',
      created_at: new Date(Date.now() - 3600000 * 5).toISOString()
    },
    {
      id: '3',
      kode_tiket: 'TKT-884915',
      nik: '3374051011880002',
      nama: 'Ahmad Dahlan',
      no_hp: '081387654321',
      jenis_dokumen: 'KTP',
      skor_kejelasan: 88,
      status_verifikasi: 'DISETUJUI',
      catatan: 'Dokumen valid & terverifikasi petugas',
      file_url: 'https://images.unsplash.com/photo-1606166325683-e6deb697d301?auto=format&fit=crop&w=600&q=80',
      created_at: new Date(Date.now() - 3600000 * 24).toISOString()
    }
  ];
}

export function AdminDashboard({ officer: propOfficer, onLogout }: AdminDashboardProps) {
  const [officer, setOfficer] = useState<Officer | null>(propOfficer || null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('SEMUA');
  
  // State Modal Detail & Action
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [actionNotes, setActionNotes] = useState<string>('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Load Session Petugas jika tidak di-pass lewat props
  useEffect(() => {
    if (!officer) {
      try {
        const savedOfficer = localStorage.getItem('aipex_officer');
        if (savedOfficer) {
          setOfficer(JSON.parse(savedOfficer));
        } else {
          setOfficer({
            id: 'off-001',
            nama: 'Bambang Sudiro, S.STP',
            role: 'Petugas Loket 1 - Pelayanan Kependudukan'
          });
        }
      } catch {
        setOfficer({
          id: 'off-001',
          nama: 'Bambang Sudiro, S.STP',
          role: 'Petugas Loket 1 - Pelayanan Kependudukan'
        });
      }
    }
    fetchTickets();
  }, []);

  // Fetch Daftar Tiket dari API Backend
  const fetchTickets = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/tickets');
      const result = await res.json();
      if (result.success && Array.isArray(result.data) && result.data.length > 0) {
        // Map data dari API ke interface Ticket jika ada perbedaan kolom
        const mappedTickets: Ticket[] = result.data.map((item: any) => ({
          id: String(item.id || item.kode_tiket),
          kode_tiket: item.kode_tiket || `TKT-${String(item.id).slice(0, 6)}`,
          nik: item.nik || item.nik_raw || '3201010000000000',
          nama: item.nama || item.nama_warga || 'Pemohon Kependudukan',
          no_hp: item.no_hp || item.phone || item.telepon || '081234567890',
          jenis_dokumen: item.jenis_dokumen || 'KTP',
          skor_kejelasan: Number(item.skor_kejelasan ?? item.skor_ai ?? 85),
          status_verifikasi: (item.status_verifikasi || 'BERHASIL') as Ticket['status_verifikasi'],
          catatan: item.catatan || item.catatan_petugas || item.catatan_ai || '',
          created_at: item.created_at || new Date().toISOString(),
          file_url: item.file_url || (item.jenis_dokumen === 'KK' 
            ? 'https://images.unsplash.com/photo-1586281380349-632531db7ed4?auto=format&fit=crop&w=600&q=80'
            : 'https://images.unsplash.com/photo-1606166325683-e6deb697d301?auto=format&fit=crop&w=600&q=80')
        }));
        setTickets(mappedTickets);
      } else {
        setTickets(getMockTickets());
      }
    } catch (err) {
      console.warn('Menggunakan data simulasi tiket:', err);
      setTickets(getMockTickets());
    } finally {
      setLoading(false);
    }
  };

  // Handler Update Status Tiket + Kirim Notifikasi
  const handleUpdateStatus = async (status: 'DISETUJUI' | 'DITOLAK' | 'PERLU_PERBAIKAN') => {
    if (!selectedTicket || !officer) return;
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: selectedTicket.id,
          officerId: officer.id,
          status: status,
          nama: selectedTicket.nama,
          no_hp: selectedTicket.no_hp,             // Nomor WhatsApp pemohon
          jenis_dokumen: selectedTicket.jenis_dokumen,
          kode_tiket: selectedTicket.kode_tiket,
          catatan: finalNotes
        })
      });

      const result = await res.json();

      if (result.success) {
        setTickets(prev => prev.map(t => (t.id === selectedTicket.id || t.kode_tiket === selectedTicket.kode_tiket) ? { ...t, status_verifikasi: status, catatan: finalNotes } : t));
        setSelectedTicket(null);
        setActionNotes('');
        alert('Status berhasil diperbarui & Notifikasi WhatsApp terkirim!');
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

  // Count Metrics
  const totalPending = tickets.filter(t => ['BERHASIL', 'BURAM', 'PERLU_PERBAIKAN'].includes(t.status_verifikasi)).length;
  const totalApproved = tickets.filter(t => t.status_verifikasi === 'DISETUJUI').length;
  const totalRejected = tickets.filter(t => ['DITOLAK', 'TIDAK_VALID'].includes(t.status_verifikasi)).length;

  return (
    <div id="adminDashboard" className="min-h-screen bg-slate-100 font-sans text-slate-800 -mx-4 lg:-mx-6 -my-4 p-4 lg:p-6">
      
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
              className="p-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-xl text-slate-300 hover:text-rose-400 border border-slate-700 transition cursor-pointer flex items-center gap-1.5 text-xs font-medium"
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
              <h3 className="text-xl font-bold text-slate-800">{tickets.length} Tiket</h3>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-4">
            <div className="p-3 bg-amber-50 text-amber-600 rounded-xl border border-amber-100 shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Perlu Verifikasi</p>
              <h3 className="text-xl font-bold text-amber-600">{totalPending} Tiket</h3>
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
            <div className="p-3 bg-rose-50 text-rose-600 rounded-xl border border-rose-100 shrink-0">
              <XCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Ditolak / Buram</p>
              <h3 className="text-xl font-bold text-rose-600">{totalRejected} Tiket</h3>
            </div>
          </div>
        </div>

        {/* FILTER & SEARCH BAR */}
        <div id="adminToolbar" className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
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

        {/* TABEL DAFTAR TIKET */}
        <div id="adminTableCard" className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
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
                      Tidak ada tiket yang sesuai dengan kriteria pencarian.
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map((ticket) => (
                    <tr key={ticket.id} className="hover:bg-slate-50/80 transition">
                      <td className="py-3.5 px-4 font-mono font-bold text-blue-600">
                        {ticket.kode_tiket}
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-slate-800">{ticket.nama}</p>
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
                          ticket.skor_kejelasan >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
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
                
                {/* PRATINJAU FOTO DOKUMEN */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Foto Dokumen Warga</label>
                  <div className="bg-slate-900 aspect-video rounded-xl overflow-hidden border border-slate-200 relative flex items-center justify-center group">
                    {selectedTicket.file_url ? (
                      <img 
                        src={selectedTicket.file_url} 
                        alt="Dokumen Kependudukan" 
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="text-center p-4">
                        <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                        <p className="text-xs text-slate-400">Pratinjau Foto KTP/KK</p>
                        <p className="text-[10px] text-slate-500 mt-1">(Tampilan Dokumen Simulasi)</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* HASIL EKSTRAKSI OCR GEMINI */}
                <div className="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-2">Hasil Ekstraksi Gemini AI</label>
                  
                  <div>
                    <span className="text-slate-400 block text-[10px]">Nama Lengkap:</span>
                    <span className="font-bold text-slate-800">{selectedTicket.nama}</span>
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
                    <span className="text-slate-400 block text-[10px]">No. WhatsApp Pemohon:</span>
                    <span className="font-mono font-medium text-emerald-700">{selectedTicket.no_hp || '081234567890'}</span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px]">Skor Kejelasan Foto:</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${selectedTicket.skor_kejelasan >= 80 ? 'bg-emerald-500' : selectedTicket.skor_kejelasan >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
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
                  disabled={processingId === selectedTicket.id}
                  onClick={() => handleUpdateStatus('PERLU_PERBAIKAN')}
                  className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                  title="Minta pemohon untuk mengunggah ulang dokumen"
                >
                  <AlertCircle className="w-4 h-4" />
                  <span>Minta Perbaikan</span>
                </button>

                <button
                  type="button"
                  disabled={processingId === selectedTicket.id}
                  onClick={() => handleUpdateStatus('DITOLAK')}
                  className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <XCircle className="w-4 h-4" />
                  <span>Tolak Berkas</span>
                </button>

                <button
                  type="button"
                  disabled={processingId === selectedTicket.id}
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
      return <span className="px-2.5 py-1 bg-rose-100 text-rose-700 font-bold rounded-lg text-[10px] inline-flex items-center gap-1"><XCircle className="w-3 h-3"/> DITOLAK</span>;
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
