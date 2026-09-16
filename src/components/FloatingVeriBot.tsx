import React, { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, Sparkles, Loader2 } from 'lucide-react';
import { AipexLogo } from './AipexLogo';

export default function FloatingVeriBot() {
  const TESTIMONI_URL = "https://forms.gle/RT12pHjuLkLnePEz9";
  // State untuk mengontrol apakah modal chat terbuka atau tertutup
  // Default: false (hanya menampilkan ikon lingkaran 1:1 di pojok kanan bawah)
  const [isOpen, setIsOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    { id: 1, sender: 'bot', text: 'Halo! Ada yang bisa VeriBot bantu terkait layanan kependudukan Kelurahan Sukamaju?' },
    { id: 2, sender: 'bot', text: `Puas dengan layanan kami? Mohon luangkan 1 menit untuk isi testimoni di sini: ${TESTIMONI_URL} 🙏` }
  ]);

  // Render teks chat + otomatis jadikan URL sebagai link klik (target _blank)
  const renderMessageText = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) =>
      urlRegex.test(part) ? (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline break-all hover:text-blue-800"
        >
          {part}
        </a>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, isOpen]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim();
    if (!text || loading) return;

    // Tambah pesan user
    const userMsg = { id: Date.now(), sender: 'user', text };
    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputMessage('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat-faq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      const replyText = data.reply || data.text || 'Terima kasih! Pertanyaan Anda telah diterima. Silakan pilih menu di bawah atau unggah berkas untuk verifikasi.';
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, sender: 'bot', text: replyText }
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, sender: 'bot', text: 'Maaf, terjadi gangguan koneksi ke server. Silakan coba kembali sesaat lagi.' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside aria-label="Asisten Chat VeriBot" className="fixed bottom-5 right-5 z-50 font-sans flex flex-col items-end">
      
      {/* 1. JENDELA CHAT (Hanya dirender jika isOpen === true) */}
      {isOpen && (
        <div className="w-[340px] sm:w-[380px] h-[480px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden mb-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
          
          {/* HEADER CHAT */}
          <div className="bg-[#0f172a] text-white p-3.5 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white border border-slate-200 p-1 flex items-center justify-center shrink-0 shadow-xs">
                <AipexLogo className="w-full h-full" size={24} />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-bold text-xs text-white">VeriBot AI Sukamaju</h3>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                </div>
                <p className="text-[10px] text-slate-400">Online 24 Jam • Layanan Cepat</p>
              </div>
            </div>

            {/* Tombol Close */}
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
              title="Tutup Chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* AREA PESAN / CHAT BODY */}
          <div className="flex-1 p-3.5 space-y-3 overflow-y-auto bg-slate-50/50">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-sm ${
                    msg.sender === 'user'
                      ? 'bg-blue-600 text-white rounded-tr-none'
                      : 'bg-white text-slate-800 border border-slate-200/80 rounded-tl-none'
                  }`}
                >
                  {msg.sender === 'bot' ? renderMessageText(msg.text) : msg.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 text-slate-600 text-xs px-3.5 py-2 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                  <span className="text-[11px]">VeriBot sedang berpikir...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* QUICK CHIPS / REKLAMASI CEPAT */}
          <div className="px-3 py-2 bg-white border-t border-slate-100 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button 
              onClick={() => handleSendMessage('Jam Operasional Loket?')}
              className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-600 rounded-full text-[11px] font-medium whitespace-nowrap transition border border-slate-200/60"
            >
              ⏰ Jam Loket?
            </button>
            <button 
              onClick={() => handleSendMessage('Syarat KTP Hilang?')}
              className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-600 rounded-full text-[11px] font-medium whitespace-nowrap transition border border-slate-200/60"
            >
              📄 Syarat KTP Hilang?
            </button>
            <button 
              onClick={() => handleSendMessage('Bagaimana cara dapat tiket Fast-Track?')}
              className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-600 rounded-full text-[11px] font-medium whitespace-nowrap transition border border-slate-200/60"
            >
              ⚡ Fast-Track?
            </button>
            <a
              href="https://forms.gle/RT12pHjuLkLnePEz9"
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 hover:text-amber-800 rounded-full text-[11px] font-medium whitespace-nowrap transition border border-amber-200"
            >
              ⭐ Testimoni
            </a>
          </div>

          {/* INPUT FORM */}
          <div className="p-3 bg-white border-t border-slate-200 flex items-center gap-2">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ketik pertanyaan..."
              className="flex-1 bg-slate-100 text-xs text-slate-800 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 border border-transparent focus:bg-white transition"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={!inputMessage.trim() || loading}
              className="w-9 h-9 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white rounded-xl flex items-center justify-center shrink-0 transition shadow-sm"
              title="Kirim Pesan"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

        </div>
      )}

      {/* 2. TOMBOL FLOATING POP-UP BUBBLE (Ukuran Presisi 1:1 / Square aspect ratio) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 bg-[#0f172a] hover:bg-slate-800 active:scale-95 text-white rounded-full flex items-center justify-center shadow-xl border border-slate-700 relative transition-transform duration-200 group"
        title={isOpen ? 'Tutup Chat' : 'Tanya VeriBot AI'}
        aria-label="Tanya VeriBot AI"
      >
        {/* Indikator Online (Titik Hijau dengan Aksen Pulse) */}
        <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-[#0f172a] rounded-full"></span>
        <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-emerald-400 rounded-full animate-ping opacity-75 pointer-events-none"></span>

        {/* Dynamic Icon */}
        {isOpen ? (
          <X className="w-6 h-6 text-slate-300 group-hover:rotate-90 transition-transform duration-200" />
        ) : (
          <div className="relative w-8 h-8 rounded-full bg-white border border-slate-200 p-1 flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
            <AipexLogo className="w-full h-full" size={24} />
            <Sparkles className="w-3.5 h-3.5 text-amber-400 absolute -top-1.5 -right-1.5 animate-pulse" />
          </div>
        )}
      </button>

    </aside>
  );
}
