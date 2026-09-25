import React from "react";

interface AipexLogoProps {
  className?: string;
  size?: number;
}

export const AipexLogo: React.FC<AipexLogoProps> = ({ className = "w-full h-full", size = 32 }) => {
  // Ikon "A" network (crop persegi dari favicon.jpg) — teks AIPEX ditampilkan
  // sebagai HTML di sebelah logo (Header/dashboard) agar tetap terbaca di ukuran kecil.
  return (
    <img
      src="/logo-mark.jpg"
      alt="AIPEX Logo"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
};

export default AipexLogo;
