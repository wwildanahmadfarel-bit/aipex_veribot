import React from "react";

interface AipexLogoProps {
  className?: string;
  size?: number;
}

export const AipexLogo: React.FC<AipexLogoProps> = ({ className = "w-full h-full", size = 32 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="AIPEX Logo"
    >
      <defs>
        <linearGradient id="aipex-blue-1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id="aipex-blue-2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient id="aipex-blue-3" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#60a5fa" />
        </linearGradient>
        <linearGradient id="aipex-blue-4" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#93c5fa" />
        </linearGradient>
      </defs>

      {/* Top Node */}
      <circle cx="50" cy="20" r="9" fill="url(#aipex-blue-1)" />
      <path
        d="M38 31 C44 26, 56 26, 62 31 C68 36, 66 43, 60 48 C50 38, 42 42, 38 31 Z"
        fill="url(#aipex-blue-1)"
      />

      {/* Right Node */}
      <circle cx="80" cy="50" r="9" fill="url(#aipex-blue-4)" />
      <path
        d="M69 38 C74 44, 74 56, 69 62 C64 68, 57 66, 52 60 C62 50, 58 42, 69 38 Z"
        fill="url(#aipex-blue-4)"
      />

      {/* Bottom Node */}
      <circle cx="50" cy="80" r="9" fill="url(#aipex-blue-2)" />
      <path
        d="M62 69 C56 74, 44 74, 38 69 C32 64, 34 57, 40 52 C50 62, 58 58, 62 69 Z"
        fill="url(#aipex-blue-2)"
      />

      {/* Left Node */}
      <circle cx="20" cy="50" r="9" fill="url(#aipex-blue-3)" />
      <path
        d="M31 62 C26 56, 26 44, 31 38 C36 32, 43 34, 48 40 C38 50, 42 58, 31 62 Z"
        fill="url(#aipex-blue-3)"
      />

      {/* Central Ring */}
      <circle cx="50" cy="50" r="16" stroke="#2563eb" strokeWidth="7" fill="#ffffff" />
      <circle cx="50" cy="50" r="7" fill="#1d4ed8" />
    </svg>
  );
};

export default AipexLogo;
