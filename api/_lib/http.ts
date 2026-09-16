// Shared helpers untuk Vercel Serverless Functions — AIPEX VeriBot.
// File di folder api/_lib TIDAK diekspos sebagai route (underscore prefix).

export function setCors(req: any, res: any): boolean {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-nara-route-api-key, x-nara-api-key"
  );
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}

export function sendJson(res: any, status: number, payload: unknown) {
  res.status(status).json(payload);
}

/** Baca JSON body —兼容 Vercel bodyParser on/off. */
export async function readJsonBody(req: any): Promise<any> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string" && req.body.trim()) {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
  }
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve) => {
    req.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve());
    req.on("error", () => resolve());
  });
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

/** Baca raw buffer (untuk endpoint upload). */
export async function readRawBody(req: any, maxBytes = 12 * 1024 * 1024): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  // bodyParser sudah parse JSON → tidak ada raw; kembalikan kosong agar caller pakai req.body
  if (req.body && typeof req.body === "object" && !(req as any)._rawBodyConsumed) {
    return Buffer.alloc(0);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolve) => {
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total <= maxBytes) chunks.push(Buffer.from(c));
    });
    req.on("end", () => resolve());
    req.on("error", () => resolve());
  });
  return Buffer.concat(chunks);
}

export interface ParsedUpload {
  fileBytes: Buffer | null;
  mimeType: string;
  fields: Record<string, string>;
}

/**
 * Parser multipart/form-data minimal tanpa dependensi tambahan
 * (mendukung 1 file field "file" + text fields). Untuk JSON, pakai readJsonBody.
 */
export function parseMultipartBuffer(
  buf: Buffer,
  contentType: string
): ParsedUpload | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  const boundary = (m?.[1] || m?.[2] || "").trim();
  if (!boundary || !buf.length) return null;
  const delimiter = `--${boundary}`;
  const raw = buf.toString("latin1");
  const parts = raw.split(delimiter);
  const out: ParsedUpload = { fileBytes: null, mimeType: "image/jpeg", fields: {} };
  for (const part of parts) {
    if (!part || part === "--" || part === "--\r\n") continue;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const header = part.slice(0, headerEnd);
    let body: string = part.slice(headerEnd + 4);
    if (body.endsWith("\r\n")) body = body.slice(0, -2);
    if (body === "--" || body === "--\r\n") continue;
    const nameMatch = /name="([^"]+)"/i.exec(header);
    const filenameMatch = /filename="([^"]*)"/i.exec(header);
    const typeMatch = /Content-Type:\s*([^\r\n;]+)/i.exec(header);
    const fieldName = nameMatch?.[1];
    if (!fieldName) continue;
    if (filenameMatch && filenameMatch[1]) {
      if (typeMatch?.[1]) out.mimeType = typeMatch[1].trim() || out.mimeType;
      out.fileBytes = Buffer.from(body, "latin1");
    } else {
      out.fields[fieldName] = Buffer.from(body, "latin1").toString("utf8");
    }
  }
  return out;
}
