import React from "react";

// Renderer jawaban bot VeriBot — paragraf rapi gaya EYD + Poppins.
// - Paragraf (\n\n): rata kanan-kiri (justify) + alinea (indent baris pertama).
// - Inline: **tebal**, *miring*, `kode`.
// - Daftar "• / -" -> <ul>, "1." -> <ol> (tanpa indent alinea).
// - URL otomatis jadi link _blank.
// Aman XSS: semua teks dirender sebagai node React (tidak ada dangerouslySetInnerHTML).

const URL_RE = /(https?:\/\/[^\s)]+)/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Token: **tebal**, *miring*, `kode`, URL — sisanya teks polos.
  const tokenRe = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s)]+)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  const pushText = (s: string) => {
    if (s) out.push(<React.Fragment key={`${keyPrefix}-t${k++}`}>{s}</React.Fragment>);
  };
  while ((m = tokenRe.exec(text)) !== null) {
    pushText(text.slice(last, m.index));
    last = m.index + m[0].length;
    const tok = m[0];
    if (/^https?:\/\//.test(tok)) {
      out.push(
        <a
          key={`${keyPrefix}-u${k++}`}
          href={tok}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline break-all hover:text-blue-800"
        >
          {tok}
        </a>
      );
    } else if (tok.startsWith("**")) {
      out.push(
        <strong key={`${keyPrefix}-b${k++}`} className="font-semibold text-slate-900">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("*")) {
      out.push(<em key={`${keyPrefix}-i${k++}`}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("`")) {
      out.push(
        <code
          key={`${keyPrefix}-c${k++}`}
          className="font-code-num bg-slate-100 border border-slate-200 rounded px-1 text-[11px]"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
  }
  pushText(text.slice(last));
  return out;
}

function isBullet(line: string): boolean {
  return /^[•\-\*]\s+/.test(line.trim());
}

function bulletText(line: string): string {
  return line.trim().replace(/^[•\-\*]\s+/, "");
}

function isOrdered(line: string): boolean {
  return /^\d+[.)]\s+/.test(line.trim());
}

function orderedText(line: string): string {
  return line.trim().replace(/^\d+[.)]\s+/, "");
}

/** Render teks jawaban bot menjadi blok paragraf/daftar yang rapi. */
export function renderChatReply(text: string): React.ReactNode {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;
  const blocks = normalized.split(/\n{2,}/);
  const nodes: React.ReactNode[] = [];
  let listBuf: { ordered: boolean; items: string[] } | null = null;
  const flushList = () => {
    if (!listBuf || listBuf.items.length === 0) {
      listBuf = null;
      return;
    }
    const { ordered, items } = listBuf;
    listBuf = null;
    const idx = nodes.length;
    if (ordered) {
      nodes.push(
        <ol key={`ol${idx}`} className="list-decimal ml-5 space-y-1 text-justify">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `ol${idx}-${j}`)}</li>
          ))}
        </ol>
      );
    } else {
      nodes.push(
        <ul key={`ul${idx}`} className="list-disc ml-5 space-y-1 text-justify">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `ul${idx}-${j}`)}</li>
          ))}
        </ul>
      );
    }
  };

  blocks.forEach((block, bi) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    // Kelompokkan baris berurutan: teks biasa -> paragraf, lajur list -> daftar.
    // (Contoh backend: "Judul:\n• a\n• b" dalam satu blok.)
    let paraBuf: string[] = [];
    const flushPara = () => {
      if (paraBuf.length === 0) return;
      const joined = paraBuf.join(" ");
      paraBuf = [];
      const idx = nodes.length;
      nodes.push(
        <p
          key={`p${bi}-${idx}`}
          style={{ textAlign: "justify", textIndent: "1.5em" }}
          className="leading-relaxed"
        >
          {renderInline(joined, `p${bi}-${idx}`)}
        </p>
      );
    };
    const pushListLine = (line: string) => {
      const ordered = isOrdered(line);
      const item = ordered ? orderedText(line) : bulletText(line);
      if (listBuf && listBuf.ordered === ordered) {
        listBuf.items.push(item);
        return;
      }
      flushList();
      listBuf = { ordered, items: [item] };
    };
    lines.forEach((line) => {
      if (isBullet(line) || isOrdered(line)) {
        flushPara();
        pushListLine(line);
      } else {
        flushList();
        paraBuf.push(line);
      }
    });
    flushPara();
  });
  flushList();

  return <div className="space-y-2">{nodes}</div>;
}

export function hasChatMarkdown(text: string): boolean {
  return URL_RE.test(String(text || "")) || /\*\*[^*]+\*\*/.test(String(text || ""));
}
