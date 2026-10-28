// Ekspor Excel bulanan — dibuat di browser tanpa library & tanpa Serverless Function.
// Format: satu file .xlsx berisi sheet "Rekap" + SEMUA sheet layanan (termasuk
// yang belum ada tiketnya) agar struktur laporan selalu konsisten.
// NIK disamarkan secara default; opsi NIK lengkap hanya untuk arsip resmi.

import {
  BULAN_PANJANG,
  formatTicketDate,
  isApprovedStatus,
  isRejectedStatus,
  parseTicketMonth,
} from "./monthLabels";
import { getTicketStatusInfo, maskNik } from "./ticketStatus";

export interface ExcelTicket {
  kode_tiket: string;
  nik: string;
  nama: string;
  no_hp?: string;
  alamat?: string;
  jenis_dokumen: string;
  skor_kejelasan: number;
  status_verifikasi: string;
  catatan?: string;
  created_at: string;
}

export interface ExcelExportOptions {
  tickets: ExcelTicket[];
  year: number;
  month: number;
  /** true = NIK disamarkan (default aman). */
  maskNik: boolean;
}

export interface BuiltWorkbook {
  blob: Blob;
  fileName: string;
  count: number;
  sheets: string[];
}

interface SheetGroup {
  name: string;
  tickets: ExcelTicket[];
}

// Urutan pencocokan penting: akta spesifik SEBELUM "akta" generik.
const SHEET_RULES: Array<{ name: string; re: RegExp }> = [
  { name: "Akta Kematian", re: /akta\s*kematian|kematian/ },
  { name: "Akta Perkawinan", re: /akta\s*(perkawinan|nikah)|perkawinan|nikah/ },
  { name: "Akta Kelahiran", re: /akta\s*kelahiran|kelahiran/ },
  { name: "Kartu Keluarga", re: /kartu\s*keluarga|\bkk\b/ },
  { name: "KIA", re: /kartu\s*identitas\s*anak|\bkia\b/ },
  { name: "Surat Pindah", re: /surat\s*pindah|skpwni|\bpindah\b/ },
  { name: "Sinkron NIK", re: /sinkron|konsolidasi/ },
  { name: "SKU", re: /keterangan\s*usaha|\bsku\b|\busaha\b/ },
  { name: "IKD", re: /identitas\s*digital|\bikd\b/ },
  { name: "KTP-EL", re: /ktp|kartu\s*tanda\s*penduduk/ },
  { name: "Akta Kelahiran", re: /^akta$/ },
];

const SHEET_ORDER = [
  "KTP-EL",
  "KIA",
  "IKD",
  "Akta Kematian",
  "Akta Perkawinan",
  "Surat Pindah",
  "Sinkron NIK",
  "SKU",
  "Kartu Keluarga",
  "Akta Kelahiran",
  "Lainnya",
];

function groupTickets(tickets: ExcelTicket[]): SheetGroup[] {
  const map = new Map<string, ExcelTicket[]>();
  tickets.forEach((t) => {
    const hay = String(t.jenis_dokumen || "")
      .replace(/[_-]+/g, " ")
      .toLowerCase();
    const rule = SHEET_RULES.find((r) => r.re.test(hay));
    const name = rule?.name || "Lainnya";
    if (!map.has(name)) map.set(name, []);
    map.get(name)!.push(t);
  });
  return SHEET_ORDER.map((name) => ({ name, tickets: map.get(name) || [] }));
}

function nikForExport(raw: unknown, samarkan: boolean): string {
  const text = String(raw ?? "").trim();
  if (!text || text === "—" || text === "-") return "-";
  if (samarkan) return maskNik(text);
  const digits = text.replace(/\D/g, "");
  return digits || text;
}

// --- ZIP (store, tanpa kompresi) — cukup untuk file .xlsx kecil ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function zipStore(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime =
    ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) &
    0xffff;
  const dosDate =
    (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  entries.forEach(({ name, data }) => {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + data.length;
  });

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);

  const parts = [...localParts, ...centralParts, end];
  return new Blob(parts as unknown as BlobPart[], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// --- OOXML writer minimal ---

type CellValue = string | number | null | undefined;

interface CellSpec {
  v: CellValue;
  s?: number;
}

type RowSpec = CellSpec[];

// Indeks style di styles.xml
const S = {
  header: 1,
  text: 2,
  number: 3,
  totalLabel: 4,
  totalNumber: 5,
  note: 6,
  wrap: 7,
  date: 8,
  green: 9,
  amber: 10,
  red: 11,
  blue: 12,
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><color rgb="FF0F172A"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>
<font><b/><color rgb="FF166534"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="8">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function colLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function cellXml(ref: string, cell: CellSpec): string {
  const style = cell.s ?? 0;
  const value = cell.v;
  if (value === null || value === undefined || value === "") {
    return `<c r="${ref}" s="${style}"/>`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  const text = escapeXml(String(value).replace(/\r\n/g, "\n"));
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function buildSheetXml(
  rows: RowSpec[],
  widths: number[],
  autoFilterRef?: string
): string {
  const cols = widths
    .map(
      (width, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`
    )
    .join("");

  const sheetRows = rows
    .map((row, rowIndex) => {
      const r = rowIndex + 1;
      const cells = row
        .map((cell, colIndex) => cellXml(`${colLetter(colIndex + 1)}${r}`, cell))
        .join("");
      const height = r === 1 ? ' ht="24" customHeight="1"' : "";
      return `<row r="${r}"${height}>${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${sheetRows}</sheetData>
${autoFilterRef ? `<autoFilter ref="${autoFilterRef}"/>` : ""}
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

function buildRekapRows(groups: SheetGroup[], samarkanNik: boolean): RowSpec[] {
  const header: RowSpec = [
    "No",
    "Layanan",
    "Masuk",
    "Disetujui",
    "Ditolak",
    "Perlu Verifikasi",
    "% Disetujui",
  ].map((v) => ({ v, s: S.header }));

  const rows: RowSpec[] = [header];
  let totalMasuk = 0;
  let totalDisetujui = 0;
  let totalDitolak = 0;
  let totalSisa = 0;

  groups.forEach((g, idx) => {
    const masuk = g.tickets.length;
    const disetujui = g.tickets.filter((t) => isApprovedStatus(t.status_verifikasi)).length;
    const ditolak = g.tickets.filter((t) => isRejectedStatus(t.status_verifikasi)).length;
    const sisa = masuk - disetujui - ditolak;
    totalMasuk += masuk;
    totalDisetujui += disetujui;
    totalDitolak += ditolak;
    totalSisa += sisa;
    rows.push([
      { v: idx + 1, s: S.number },
      { v: g.name, s: S.text },
      { v: masuk, s: S.number },
      { v: disetujui, s: S.number },
      { v: ditolak, s: S.number },
      { v: sisa, s: S.number },
      {
        v: masuk > 0 ? `${Math.round((disetujui / masuk) * 100)}%` : "-",
        s: S.number,
      },
    ]);
  });

  rows.push([]);
  const layananBerisi = groups.filter((g) => g.tickets.length > 0).length;
  rows.push([
    { v: "TOTAL", s: S.totalLabel },
    { v: `${layananBerisi} dari ${groups.length} layanan berisi`, s: S.totalLabel },
    { v: totalMasuk, s: S.totalNumber },
    { v: totalDisetujui, s: S.totalNumber },
    { v: totalDitolak, s: S.totalNumber },
    { v: totalSisa, s: S.totalNumber },
    {
      v: totalMasuk > 0 ? `${Math.round((totalDisetujui / totalMasuk) * 100)}%` : "-",
      s: S.totalNumber,
    },
  ]);
  rows.push([]);
  rows.push([
    {
      v: `NIK ${samarkanNik ? "disamarkan" : "lengkap"} | Sumber: dashboard AIPEX VeriBot Kelurahan Sukamaju`,
      s: S.note,
    },
  ]);

  return rows;
}

function buildDetailRows(group: SheetGroup, samarkanNik: boolean): RowSpec[] {
  const header: RowSpec = [
    "No",
    "Kode Tiket",
    "Tanggal",
    "NIK",
    "Nama",
    "No. HP",
    "Alamat",
    "Urusan Layanan",
    "Skor AI",
    "Status Tiket",
    "Status Verifikasi",
    "Catatan",
  ].map((v) => ({ v, s: S.header }));

  const rows: RowSpec[] = [header];
  group.tickets.forEach((t, idx) => {
    const info = getTicketStatusInfo(t);
    const statusStyle = info.isApproved ? S.green : info.isRejected ? S.red : S.blue;
    const verifikasiStyle =
      info.tone === "green"
        ? S.green
        : info.tone === "amber"
          ? S.amber
          : info.tone === "red"
            ? S.red
            : S.blue;
    rows.push([
      { v: idx + 1, s: S.number },
      { v: t.kode_tiket || "-", s: S.text },
      { v: formatTicketDate(t.created_at), s: S.date },
      { v: nikForExport(t.nik, samarkanNik), s: S.text },
      { v: t.nama || "-", s: S.text },
      { v: t.no_hp || "-", s: S.text },
      { v: t.alamat || "-", s: S.wrap },
      { v: t.jenis_dokumen || "-", s: S.wrap },
      {
        v: Number.isFinite(Number(t.skor_kejelasan)) ? Math.round(Number(t.skor_kejelasan)) : "-",
        s: S.number,
      },
      { v: info.statusTiket, s: statusStyle },
      { v: info.verifikasi, s: verifikasiStyle },
      { v: t.catatan || "-", s: S.wrap },
    ]);
  });

  // Sheet kosong tetap dibuat dengan header + catatan agar strukturnya jelas.
  if (group.tickets.length === 0) {
    rows.push([{ v: "Belum ada tiket layanan ini pada bulan yang dipilih.", s: S.note }]);
  }

  return rows;
}

function sanitizeSheetName(name: string, used: Set<string>): string {
  const base =
    name
      .replace(/[\\/?*[\]:]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31) || "Sheet";
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i++})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function workbookEntries(sheets: Array<{ name: string; xml: string }>): ZipEntry[] {
  const encoder = new TextEncoder();
  const used = new Set<string>();
  const names = sheets.map((s) => sanitizeSheetName(s.name, used));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )
  .join("\n")}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${names
  .map(
    (name, i) =>
      `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  )
  .join("\n")}
</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  )
  .join("\n")}
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rootRels) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    { name: "xl/styles.xml", data: encoder.encode(STYLES_XML) },
  ];
  sheets.forEach((sheet, i) => {
    entries.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: encoder.encode(sheet.xml),
    });
  });
  return entries;
}

export function buildMonthlyWorkbook(options: ExcelExportOptions): BuiltWorkbook {
  const { tickets, year, month, maskNik: samarkanNik } = options;
  const monthTickets = tickets.filter((t) => {
    const parsed = parseTicketMonth(t.created_at);
    return parsed !== null && parsed.y === year && parsed.m === month;
  });

  if (monthTickets.length === 0) {
    throw new Error(`Tidak ada tiket pada ${BULAN_PANJANG[month]} ${year}.`);
  }

  const groups = groupTickets(monthTickets);
  const sheets: Array<{ name: string; xml: string }> = [
    {
      name: "Rekap",
      xml: buildSheetXml(buildRekapRows(groups, samarkanNik), [5, 42, 9, 12, 10, 16, 13]),
    },
    ...groups.map((g) => ({
      name: g.name,
      xml: buildSheetXml(
        buildDetailRows(g, samarkanNik),
        [5, 18, 17, 20, 24, 16, 30, 36, 10, 14, 26, 40],
        g.tickets.length > 0 ? `A1:L${g.tickets.length + 1}` : undefined
      ),
    })),
  ];

  const blob = zipStore(workbookEntries(sheets));
  const fileName = `Laporan-Layanan-${year}-${String(month + 1).padStart(2, "0")}.xlsx`;
  return {
    blob,
    fileName,
    count: monthTickets.length,
    sheets: sheets.map((s) => s.name),
  };
}

export async function exportMonthlyExcel(options: ExcelExportOptions): Promise<BuiltWorkbook> {
  const built = buildMonthlyWorkbook(options);
  const url = URL.createObjectURL(built.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = built.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return built;
}
