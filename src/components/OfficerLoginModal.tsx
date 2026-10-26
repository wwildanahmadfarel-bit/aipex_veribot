import React, { useState } from 'react';
import { KeyRound, ShieldCheck, AlertCircle, ArrowRight, X, UserRound, LockKeyhole } from 'lucide-react';
import {
  changeOfficerPassword,
  loginOfficer,
  logoutOfficer,
  OfficerProfile,
} from '../lib/officerAuth';

interface OfficerLoginProps {
  onLoginSuccess: (officerData: OfficerProfile) => void;
  onClose?: () => void;
}

type Step = 'login' | 'change-password';

export default function OfficerLoginModal({ onLoginSuccess, onClose }: OfficerLoginProps) {
  const [step, setStep] = useState<Step>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setInfoMsg('');

    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername || !password) {
      setErrorMsg('Username dan password wajib diisi.');
      setLoading(false);
      return;
    }

    try {
      const result = await loginOfficer(normalizedUsername, password);
      if (result.mustChangePassword) {
        setInfoMsg(
          'Password sementara diterima. Buat password baru sebelum membuka dashboard.'
        );
        setStep('change-password');
        return;
      }
      onLoginSuccess(result.officer);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Username atau password salah.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');

    if (newPassword.length < 12) {
      setErrorMsg('Password baru minimal 12 karakter.');
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setErrorMsg('Password baru harus mengandung huruf dan angka.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Konfirmasi password baru tidak sama.');
      return;
    }
    if (newPassword === password) {
      setErrorMsg('Password baru harus berbeda dari password sementara.');
      return;
    }

    setLoading(true);
    try {
      await changeOfficerPassword(password, newPassword);
      // Semua sesi lama sudah dicabut. Login ulang dengan password baru.
      const result = await loginOfficer(username.trim().toLowerCase(), newPassword);
      if (result.mustChangePassword) {
        throw new Error('Password belum tersimpan sebagai password permanen. Hubungi admin.');
      }
      onLoginSuccess(result.officer);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal mengganti password.');
      // Kesalahan input tetap di form ganti password. Kembali ke login hanya
      // bila sesi/token sudah tidak berlaku atau login otomatis gagal.
      const code = String(err?.code || '');
      const stayHere = ['PASSWORD_POLICY', 'PASSWORD_SAME', 'INVALID_OLD_PASSWORD'].includes(code);
      if (!stayHere) {
        setStep('login');
        setPassword('');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (step === 'change-password') {
      void logoutOfficer();
    }
    if (onClose) onClose();
  };

  return (
    <div
      id="officerLoginModalBackdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div
        id="officerLoginModalCard"
        className="bg-white border border-slate-200 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5 relative"
      >
        {onClose && (
          <button
            type="button"
            onClick={handleClose}
            aria-label="Tutup modal"
            className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        <div className="flex items-center gap-3 border-b border-slate-100 pb-4 pr-6">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl border border-blue-100">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-base text-[#0F172A]">
              {step === 'login' ? 'Login Petugas Kelurahan' : 'Ganti Password Wajib'}
            </h3>
            <p className="text-xs text-slate-500">
              {step === 'login'
                ? 'Masukkan username dan password petugas AIPEX'
                : 'Password sementara tidak boleh dipakai untuk seterusnya'}
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 font-medium leading-relaxed">
            {infoMsg}
          </div>
        )}

        {step === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                htmlFor="officerUsernameInput"
                className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide"
              >
                Username Petugas
              </label>
              <div className="relative">
                <input
                  id="officerUsernameInput"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="contoh: petugas.loket1"
                  required
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 text-[#0F172A] text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                />
                <UserRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              </div>
            </div>

            <div>
              <label
                htmlFor="officerPasswordInput"
                className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="officerPasswordInput"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password petugas"
                  required
                  autoComplete="current-password"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 text-[#0F172A] text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
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
                <span>Memverifikasi...</span>
              ) : (
                <>
                  <span>Masuk Dashboard Petugas</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label
                htmlFor="officerNewPasswordInput"
                className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide"
              >
                Password Baru
              </label>
              <div className="relative">
                <input
                  id="officerNewPasswordInput"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimal 12 karakter, huruf + angka"
                  required
                  autoFocus
                  autoComplete="new-password"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 text-[#0F172A] text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                />
                <LockKeyhole className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              </div>
            </div>

            <div>
              <label
                htmlFor="officerConfirmPasswordInput"
                className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide"
              >
                Ulangi Password Baru
              </label>
              <div className="relative">
                <input
                  id="officerConfirmPasswordInput"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ulangi password baru"
                  required
                  autoComplete="new-password"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 text-[#0F172A] text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                />
                <LockKeyhole className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-xl shadow-sm transition flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <span>Menyimpan password...</span>
              ) : (
                <>
                  <span>Simpan &amp; Masuk Dashboard</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        <div className="pt-2 border-t border-slate-100 flex flex-col items-center gap-1.5 text-center">
          <p className="text-[11px] text-slate-400">
            Gunakan akun petugas yang diberikan admin kelurahan. Kode tiket warga (TKT-...) dipakai di menu Lacak Status, bukan di sini.
          </p>
          <p className="text-[10px] text-slate-400">
            Sesi berlaku 8 jam. Jangan gunakan komputer bersama tanpa logout.
          </p>
        </div>
      </div>
    </div>
  );
}
export { OfficerLoginModal };
