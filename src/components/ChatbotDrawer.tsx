import React, { useState, useRef, useEffect } from "react";
import { ChatMessage } from "../types";

export const ChatbotDrawer: React.FC = () => {
  const TESTIMONI_URL = "https://forms.gle/RT12pHjuLkLnePEz9";
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "m1",
      sender: "bot",
      text: "Halo Warga Sukamaju! 👋 Saya VeriBot, asisten cerdas pelayanan administrasi kelurahan. Ada yang bisa saya bantu terkait syarat KTP, KIA, atau tiket antrean Fast-Track?",
      timestamp: "Baru saja",
    },
    {
      id: "m2",
      sender: "bot",
      text: `Puas dengan layanan kami? Mohon luangkan 1 menit untuk isi testimoni di sini: ${TESTIMONI_URL} 🙏`,
      timestamp: "Baru saja",
    },
  ]);

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
  const [inputVal, setInputVal] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputVal).trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      sender: "user",
      text,
      timestamp: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputVal("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat-faq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await response.json();

      const botMsg: ChatMessage = {
        id: String(Date.now() + 1),
        sender: "bot",
        text: data.reply || "Terima kasih atas pertanyaan Anda. Silakan hubungi loket kelurahan bila membutuhkan informasi lebih lanjut.",
        timestamp: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now() + 1),
          sender: "bot",
          text: "Mohon maaf, terjadi kendala saat menghubungkan ke asisten cerdas. Silakan periksa jam buka loket atau coba tanyakan kembali.",
          timestamp: "Sekarang",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end">
      {/* Floating Mascot Button */}
      {!isOpen && (
        <div className="flex items-center gap-2 group">
          <div className="bg-white border border-slate-200/80 text-slate-800 text-xs px-3 py-1.5 rounded-xl shadow-lg animate-bounce hidden sm:flex items-center gap-1.5 pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-semibold">Hai! Tanya VeriBot AI</span>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="w-14 h-14 rounded-2xl bg-[#2563eb] hover:bg-blue-700 text-white shadow-xl flex items-center justify-center border-2 border-white relative transition-transform group-hover:scale-105 cursor-pointer"
            aria-label="Buka Chatbot VeriBot"
          >
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <img
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDG1OVdrHa4OReg5Y6KpLfPq9tOefFCIA5CdZos0HI5AI5zb4dopsARmUHyqIg7qOYwH49QR0SaS9MhuP01gEmUzoNCOfE0wYSbhaRm6paII5QFlrLMLFbeCBkLlYNfU-hb3EEsoQCus8a8uU9HGQvRbPbIaNK2ga-IHhREef9YcFkQHLMhgZcGT3A5xQWKjmkiYi95bclZy9xhw6bMbJ1XKu0IU5AFEEpzfugLVhEX6DCP6N1YJaqZ804oAY4esOEWjM4"
              alt="VeriBot Mascot"
              className="w-11 h-11 object-contain drop-shadow-md"
            />
          </button>
        </div>
      )}

      {/* Chat Drawer Box */}
      {isOpen && (
        <div className="bg-white w-[92vw] sm:w-[385px] h-[540px] rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
          {/* Header Chatbot (Top - Fixed) */}
          <div className="bg-[#213145] text-white p-4 flex items-center justify-between border-b border-slate-700 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white p-0.5 flex items-center justify-center shrink-0">
                <img
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuDG1OVdrHa4OReg5Y6KpLfPq9tOefFCIA5CdZos0HI5AI5zb4dopsARmUHyqIg7qOYwH49QR0SaS9MhuP01gEmUzoNCOfE0wYSbhaRm6paII5QFlrLMLFbeCBkLlYNfU-hb3EEsoQCus8a8uU9HGQvRbPbIaNK2ga-IHhREef9YcFkQHLMhgZcGT3A5xQWKjmkiYi95bclZy9xhw6bMbJ1XKu0IU5AFEEpzfugLVhEX6DCP6N1YJaqZ804oAY4esOEWjM4"
                  alt="VeriBot Avatar"
                  className="w-full h-full object-contain"
                />
              </div>
              <div>
                <h3 className="text-xs font-bold leading-tight font-heading">
                  VeriBot AI Sukamaju
                </h3>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
                  Aktif 24 Jam Non-Stop
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="w-7 h-7 rounded-lg bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {/* Area Pesan Chat (Middle - Scrollable) */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/40 text-xs">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] p-3 rounded-2xl shadow-2xs leading-relaxed ${
                    msg.sender === "user"
                      ? "bg-[#2563eb] text-white rounded-br-xs"
                      : "bg-white text-slate-800 border border-slate-200 rounded-bl-xs whitespace-pre-line"
                  }`}
                >
                  {msg.sender === "bot" ? renderMessageText(msg.text) : msg.text}
                </div>
                <span className="text-[9px] text-slate-400 mt-1 px-1">{msg.timestamp}</span>
              </div>
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 p-3 bg-white border border-slate-200 rounded-2xl rounded-bl-xs text-slate-500 w-28">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce delay-100"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce delay-200"></span>
                <span className="text-[10px] text-slate-400">Mengetik...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Baris Chip Saran Pertanyaan (Above Input - Sticky & Horizontal Scroll) */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden px-3 py-2 bg-slate-50/90 border-t border-slate-100 backdrop-blur-xs shrink-0">
            <button
              type="button"
              onClick={() => handleSendMessage("Berapa jam operasional loket kelurahan?")}
              className="px-3 py-1.5 rounded-full bg-white border border-blue-200 text-slate-700 hover:bg-[#2563eb] hover:text-white hover:border-[#2563eb] transition-all text-xs shadow-xs whitespace-nowrap cursor-pointer shrink-0 font-medium flex items-center gap-1"
            >
              <span>🕒 Jam Loket?</span>
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage("Apa saja syarat pembuatan KTP-EL yang rusak atau hilang?")}
              className="px-3 py-1.5 rounded-full bg-white border border-blue-200 text-slate-700 hover:bg-[#2563eb] hover:text-white hover:border-[#2563eb] transition-all text-xs shadow-xs whitespace-nowrap cursor-pointer shrink-0 font-medium flex items-center gap-1"
            >
              <span>🪪 Syarat KTP Hilang?</span>
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage("Bagaimana cara mendapatkan tiket Fast-Track?")}
              className="px-3 py-1.5 rounded-full bg-white border border-blue-200 text-slate-700 hover:bg-[#2563eb] hover:text-white hover:border-[#2563eb] transition-all text-xs shadow-xs whitespace-nowrap cursor-pointer shrink-0 font-medium flex items-center gap-1"
            >
              <span>⚡ Fast-Track?</span>
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage("Apakah pengurusan KTP masih butuh surat pengantar RT/RW?")}
              className="px-3 py-1.5 rounded-full bg-white border border-blue-200 text-slate-700 hover:bg-[#2563eb] hover:text-white hover:border-[#2563eb] transition-all text-xs shadow-xs whitespace-nowrap cursor-pointer shrink-0 font-medium flex items-center gap-1"
            >
              <span>📜 Surat RT/RW?</span>
            </button>
            <button
              type="button"
              onClick={() => handleSendMessage("Apa syarat pembuatan Kartu Identitas Anak (KIA)?")}
              className="px-3 py-1.5 rounded-full bg-white border border-blue-200 text-slate-700 hover:bg-[#2563eb] hover:text-white hover:border-[#2563eb] transition-all text-xs shadow-xs whitespace-nowrap cursor-pointer shrink-0 font-medium flex items-center gap-1"
            >
              <span>👶 Syarat KIA?</span>
            </button>
            <a
              href="https://forms.gle/RT12pHjuLkLnePEz9"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 transition-all text-xs shadow-xs whitespace-nowrap shrink-0 font-medium flex items-center gap-1"
            >
              <span>⭐ Testimoni</span>
            </a>
          </div>

          {/* Form Input Pesan (Bottom - Fixed) */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="p-3 bg-white border-t border-slate-200 flex items-center gap-2 shrink-0"
          >
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="Tanyakan ke VeriBot..."
              className="flex-1 h-10 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-blue-500 transition-colors"
            />
            <button
              type="submit"
              disabled={isLoading || !inputVal.trim()}
              className="w-10 h-10 rounded-xl bg-[#2563eb] hover:bg-blue-700 disabled:opacity-40 text-white flex items-center justify-center transition-colors cursor-pointer shadow-xs shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">send</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export const ChatbotPopup = ChatbotDrawer;
export default ChatbotDrawer;
