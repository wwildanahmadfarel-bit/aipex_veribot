import React, { useState } from 'react';
import { KeyRound, ShieldCheck, AlertCircle, ArrowRight, X } from 'lucide-react';

interface OfficerLoginProps {
  onLoginSuccess: (officerData: { id: string; nama: string; role: string }) => void;
  onClose?: () => void;
}

function normalizeAccessCode(raw: string): string {
  return (raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/SUKAMAZU/g, 'SUKAMAJU');
}

// Fallback client-side agar login tetap bisa saat API mati / dijalankan via `vite preview`
// (disamakan dengan server.ts). Kunci dinormalisasi.
const OFFLINE_OFFICERS: Record<string, { id: string; nama: string; role: string }> = {
  'ADM-SUKAMAJU-2026': { id: 'off-001', nama: 'Bambang Sudiro, S.STP', role: 'Kepala Seksi Pelayanan Kependudukan' },
  '849201': { id: 'off-002', nama: 'Siti Rahmawati, S.AP', role: 'Petugas Loket 1 - e-KTP & Identitas' },
  'VERIBOT-ADMIN': { id: 'off-003', nama: 'Ahmad Fauzi, S.Kom', role: 'Supervisor VeriBot AI Kependudukan' },
  'LOKET-SUKAMAJU-01': { id: 'off-004', nama: 'Hendra Setiawan, S.IP', role: 'Petugas Loket Fast-Track VeriBot AIPEX' },
};

export default function OfficerLoginModal({ onLoginSuccess, onClose }: OfficerLoginProps) {
  const [kodeAkses, setKodeAkses] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    const normalized = normalizeAccessCode(kodeAkses);
    if (!normalized) {
      setErrorMsg('Kode akses wajib diisi');
      setLoading(false);
      return;
    }

    // Cegah kesalahan umum: kode tiket warga dipakai untuk login petugas
    if (/^(TKT|FT)-/.test(normalized)) {
      setErrorMsg('Itu kode tiket warga (TKT-...), bukan kode akses petugas. Kode tiket dipakai di menu "Lacak Status", sedangkan login petugas memakai kode akses seperti 849201.');
      setLoading(false);
      return;
    }

    try {
      let res: Response;
      try {
        res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kodeAkses: normalized })
        });
      } catch (networkErr: any) {
        // Server tidak terjangkau -> coba fallback offline
        const offline = OFFLINE_OFFICERS[normalized];
        if (offline) {
          try { localStorage.setItem('aipex_officer', JSON.stringify(offline)); } catch {}
          onLoginSuccess(offline);
          return;
        }
        throw new Error('Tidak bisa terhubung ke server (fetch gagal). Jalankan dengan `npm run dev` lalu coba lagi, atau gunakan kode offline: 849201.');
      }

      // Tangani 404 HTML (mis. dijalankan via `vite preview` tanpa backend Express)
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const offline = OFFLINE_OFFICERS[normalized];
        if (offline) {
          try { localStorage.setItem('aipex_officer', JSON.stringify(offline)); } catch {}
          onLoginSuccess(offline);
          return;
        }
        throw new Error('Endpoint /api/admin/login tidak ditemukan (dapat HTML, bukan JSON). Jalankan server dengan `npm run dev` (tsx server.ts port 3000), jangan `vite preview` saja.');
      }

      const result = await res.json().catch(() => null);
      if (!result) {
        throw new Error('Respons server tidak valid (bukan JSON). Coba restart server dengan `npm run dev`.');
      }

      if (!res.ok || !result.success) {
        // Jika server menolak tapi kode ada di fallback offline, tetap izinkan (mode toleran)
        const offline = OFFLINE_OFFICERS[normalized];
        if (offline && (res.status === 401 || res.status === 500)) {
          try { localStorage.setItem('aipex_officer', JSON.stringify(offline)); } catch {}
          onLoginSuccess(offline);
          return;
        }
        throw new Error(result.message || 'Kode akses tidak valid. Contoh valid: 849201 atau LOKET-SUKAMAJU-01.');
      }

      // Simpan session petugas ke localStorage
      if (result.officer) {
        try { localStorage.setItem('aipex_officer', JSON.stringify(result.officer)); } catch {}
        onLoginSuccess(result.officer);
      } else {
        throw new Error('Data profil petugas tidak ditemukan');
      }

    } catch (err: any) {
      setErrorMsg(err.message || 'Terjadi kesalahan saat memverifikasi');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickCode = (code: string) => {
    setKodeAkses(code);
    setErrorMsg('');
  };

  return (
    <div
      id="officerLoginModalBackdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div
        id="officerLoginModalCard"
        className="bg-white border border-slate-200 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5 relative"
      >
        {/* Close Button if onClose provided */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal"
            className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* HEADER */}
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4 pr-6">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-800">Login Petugas Kelurahan</h3>
            <p className="text-xs text-slate-500">Masukkan Kode Akses Khusus Petugas AIPEX</p>
          </div>
        </div>

        {/* ERROR ALERT */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-xs text-rose-700 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* FORM */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
              Kode Akses / PASSCODE PETUGAS
            </label>
            <div className="relative">
              <input
                id="officerPasscodeInput"
                type="password"
                value={kodeAkses}
                onChange={(e) => setKodeAkses(e.target.value)}
                placeholder="Contoh: LOKET-SUKAMAJU-01"
                required
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 text-slate-800 text-sm font-mono border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition uppercase"
              />
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            </div>
          </div>

          <button
            id="officerSubmitLoginBtn"
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-xl shadow-sm transition flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <span>Memverifikasi Kode...</span>
            ) : (
              <>
                <span>Masuk Dashboard Petugas</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="pt-2 border-t border-slate-100 flex flex-col items-center gap-1.5 text-center">
          <p className="text-[11px] text-slate-400">
            Uji Coba Kode:{" "}
            <button
              type="button"
              onClick={() => handleQuickCode('LOKET-SUKAMAJU-01')}
              className="bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded text-slate-700 font-mono text-[11px] underline cursor-pointer transition"
              title="Klik untuk mengisi otomatis"
            >
              LOKET-SUKAMAJU-01
            </button>
            {" atau "}
            <button
              type="button"
              onClick={() => handleQuickCode('849201')}
              className="bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded text-slate-700 font-mono text-[11px] underline cursor-pointer transition"
              title="Klik untuk mengisi otomatis"
            >
              849201
            </button>
          </p>
          <p className="text-[10px] text-slate-400">
            Kode tiket warga (TKT-...) dipakai di menu Lacak Status, bukan di sini.
          </p>
        </div>

      </div>
    </div>
  );
}
export { OfficerLoginModal };
