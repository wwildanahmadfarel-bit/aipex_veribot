import React, { useEffect, useRef, useState } from "react";
import { RotateCw, Square, Volume2 } from "lucide-react";
import { isSpeechSupported, prepareVoices, speak, stopSpeaking } from "../lib/speech";

interface SpeakResultButtonProps {
  /** Kalimat yang dibacakan — rakit dengan buildPreScreenSpeech(...). */
  text: string;
  /**
   * Auto-bacakan sekali saat autoPlayKey berubah (dipakai khusus state
   * "Dokumen Layak & Terbaca Jelas"). Browser bisa memblokir autoplay TTS;
   * dalam hal itu tombol tetap berfungsi manual tanpa error.
   */
  autoPlay?: boolean;
  /** Penanda hasil baru (identitas objek hasil pindai) untuk memicu auto-baca. */
  autoPlayKey?: unknown;
  /** Kelas tambahan (opsional) agar tombol menyatu dengan banner. */
  className?: string;
  /** Label saat tombol belum pernah diputar (mis. "Bacakan Ringkasan"). */
  idleLabel?: string;
}

/**
 * Tombol 🔊 bacakan hasil pra-pemeriksaan (Web Speech API, suara id-ID bila ada).
 * Tidak dirender bila browser tidak mendukung. Audio selalu dipicu klik user
 * atau auto-play yang diizinkan browser setelah interaksi (unggah/pindai).
 */
export function SpeakResultButton({
  text,
  autoPlay = false,
  autoPlayKey,
  className = "",
  idleLabel = "Bacakan",
}: SpeakResultButtonProps) {
  const [speaking, setSpeaking] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const supported = isSpeechSupported();
  const lastAutoKey = useRef<unknown>(null);
  const mountedRef = useRef(true);

  // Catat status mount agar timer auto-baca tidak berbunyi setelah komponen hilang.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Siapkan daftar suara lebih awal (voiceschanged) + hentikan audio saat unmount.
  useEffect(() => {
    if (!supported) return;
    const cleanup = prepareVoices();
    return () => {
      cleanup();
      stopSpeaking();
    };
  }, [supported]);

  // Teks berganti (hasil pindai baru) = hentikan bacaan lama agar tidak tumpang tindih.
  useEffect(() => {
    if (!supported) return;
    stopSpeaking();
    setSpeaking(false);
  }, [text, supported]);

  // Auto-baca satu kali per hasil baru. Timer 0 ms membuat React StrictMode
  // (dev: effect dijalankan dua kali) hanya menghasilkan satu bacaan; penanda
  // key sengaja TIDAK di-reset saat cleanup agar ganti halaman utama tidak
  // memicu auto-baca ulang.
  useEffect(() => {
    if (!supported || !autoPlay || !autoPlayKey) return;
    if (lastAutoKey.current === autoPlayKey) return;
    lastAutoKey.current = autoPlayKey;
    window.setTimeout(() => {
      if (!mountedRef.current) return;
      if (speak(text, () => setSpeaking(false))) {
        setSpeaking(true);
        setHasPlayed(true);
      }
    }, 0);
  }, [supported, autoPlay, autoPlayKey, text]);

  if (!supported) return null;

  const toggle = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    if (speak(text, () => setSpeaking(false))) {
      setSpeaking(true);
      setHasPlayed(true);
    }
  };

  const label = speaking ? "Hentikan" : hasPlayed ? "Putar Ulang" : idleLabel;

  return (
    <button
      type="button"
      onClick={toggle}
      title={speaking ? "Hentikan bacaan" : "Bacakan hasil dengan suara"}
      aria-label={speaking ? "Hentikan bacaan hasil" : "Bacakan hasil dengan suara"}
      className={`text-xs font-semibold bg-white min-h-9 px-3.5 py-2 rounded-lg transition flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap shadow-xs cursor-pointer border ${
        speaking
          ? "text-blue-800 border-blue-300 hover:bg-blue-50"
          : "text-slate-700 border-slate-300 hover:bg-slate-100/60"
      } ${className}`}
    >
      {speaking ? (
        <Square className="w-3.5 h-3.5" />
      ) : hasPlayed ? (
        <RotateCw className="w-3.5 h-3.5" />
      ) : (
        <Volume2 className="w-3.5 h-3.5" />
      )}
      {label}
    </button>
  );
}
