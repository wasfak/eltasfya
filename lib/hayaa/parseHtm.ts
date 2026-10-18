/**
 * Parser for the SofTech "سجل الحركة التفصيلي" HTML export (.htm).
 *
 * The file is one big <TABLE>. After a header block (movement type, period),
 * each document is a header row (amounts, party, doc no, user, date/time)
 * followed by its item rows (line total, unit price, qty, item name, code).
 *
 * Files can be hundreds of MB, so the file is streamed and parsed row by row
 * in the browser — it is never uploaded nor held in memory as one string.
 */
import {
  normalizeArabic,
  splitItemName,
  splitParty,
  type CardMovement,
  type ParsedCard,
} from "./parseCard";
import { isTransferCancel, TRANSFER_OUT } from "./report";

export type HtmDoc = {
  /** نوع الحركة of the file this document came from ("" if the header is missing). */
  docType: string;
  docNo: string;
  /** ISO yyyy-mm-dd. */
  docDate: string;
  /** HH:mm (24h). */
  time: string;
  party: string;
  partyArea: string;
  partyName: string;
  user: string;
  amount: number;
};

export type HtmLine = {
  doc: HtmDoc;
  qty: number;
  unitPrice: number;
  total: number;
};

export type HtmItem = {
  code: string;
  itemName: string;
  productName: string;
  priceTag: string;
  lines: HtmLine[];
};

export type ParsedHtm = {
  /** نوع الحركة as printed, e.g. "صرف - تبادل بين الفروع". */
  movementType: string;
  /** Report period (ISO), "" if not found. */
  from: string;
  to: string;
  items: Map<string, HtmItem>;
  docs: number;
  lines: number;
  /** Sum of document amounts — should equal the report's grand total. */
  docsTotal: number;
  /** The grand total printed at the end of the report (null if missing). */
  reportTotal: number | null;
  /** Rows with data the parser didn't recognise (should be 0). */
  unknownRows: number;
  /** A few unrecognised rows' values, for diagnosis. */
  unknownSamples: string[][];
  /** Item lines before any document header (the file's start is missing). */
  orphanLines: number;
};

const CELL_RE = /<T([DH])([^>]*)>([^<]*)/gi;
const ROW_END_RE = /<\/TR>/i;
const NUM_RE = /^-?[\d,]+(\.\d+)?$/;
const DATETIME_RE = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?\s+(\d{4})\/(\d{2})\/(\d{2})/i;
const DATE_RE = /^(\d{4})\/(\d{2})\/(\d{2})$/;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, "&");
}

function toNumber(s: string): number {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function isoDate(s: string): string {
  const m = DATE_RE.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** "12:00:29 AM  2026/10/06" → { date: "2026-10-06", time: "00:00" }. */
function parseDateTime(s: string): { date: string; time: string } | null {
  const m = DATETIME_RE.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const ampm = m[3]?.toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return {
    date: `${m[4]}-${m[5]}-${m[6]}`,
    time: `${String(h).padStart(2, "0")}:${m[2]}`,
  };
}

type Cell = { th: boolean; value: string };

function rowCells(row: string): Cell[] {
  const cells: Cell[] = [];
  for (const m of row.matchAll(CELL_RE)) {
    cells.push({
      th: m[1].toUpperCase() === "H",
      value: decodeEntities(m[3]).trim(),
    });
  }
  return cells;
}

class HtmParser {
  result: ParsedHtm = {
    movementType: "",
    from: "",
    to: "",
    items: new Map(),
    docs: 0,
    lines: 0,
    docsTotal: 0,
    reportTotal: null,
    unknownRows: 0,
    unknownSamples: [],
    orphanLines: 0,
  };
  private doc: HtmDoc | null = null;

  row(row: string) {
    const cells = rowCells(row);
    const vals = cells.map((c) => c.value).filter(Boolean);
    if (!vals.length) return;

    if (cells.some((c) => c.th && c.value)) {
      this.headerRow(vals.map(normalizeArabic));
      return;
    }

    // Document header: paid, amount, consumer price, party, doc no, user, date/time.
    if (vals.length === 7) {
      const dt = parseDateTime(vals[6]);
      if (dt) {
        const party = normalizeArabic(vals[3]);
        const { area, name } = splitParty(party);
        this.doc = {
          docType: this.result.movementType,
          docNo: vals[4],
          docDate: dt.date,
          time: dt.time,
          party,
          partyArea: area,
          partyName: name,
          user: vals[5],
          amount: toNumber(vals[1]),
        };
        this.result.docs++;
        this.result.docsTotal += this.doc.amount;
        return;
      }
    }

    // Item line: line total, unit price, qty, item name, code.
    if (vals.length === 5 && this.doc && NUM_RE.test(vals[0])) {
      const [total, unitPrice, qty, name, code] = vals;
      let item = this.result.items.get(code);
      if (!item) {
        const itemName = normalizeArabic(name);
        item = { code, itemName, ...splitItemName(itemName), lines: [] };
        this.result.items.set(code, item);
      }
      item.lines.push({
        doc: this.doc,
        qty: toNumber(qty),
        unitPrice: toNumber(unitPrice),
        total: toNumber(total),
      });
      this.result.lines++;
      return;
    }

    // Item line with no document above it: SofTech lost the file's beginning.
    if (vals.length === 5 && !this.doc && NUM_RE.test(vals[0])) {
      this.result.orphanLines++;
      return;
    }

    // Grand total: amount + label.
    if (vals.length === 2 && NUM_RE.test(vals[0])) {
      this.result.reportTotal = toNumber(vals[0]);
      return;
    }

    // Column headings above each document's items, and the page footer.
    const first = normalizeArabic(vals[0]);
    if (first === "إجمالي الصنف" || /^Page \d+ of/i.test(first)) return;

    this.result.unknownRows++;
    if (this.result.unknownSamples.length < 5) this.result.unknownSamples.push(vals);
  }

  /** Report header rows: "<value> <label>" pairs for period and movement type. */
  private headerRow(vals: string[]) {
    // Labels compared without spaces / colons / hamza, so layout drift still matches.
    const key = (s: string) => s.replace(/[\s:]+/g, "").replace(/[أإآ]/g, "ا");
    const isLabel = (v: string | undefined, label: string) =>
      v !== undefined && key(v) === key(label);
    const before = (label: string) => {
      const i = vals.findIndex((v) => isLabel(v, label));
      return i > 0 ? vals[i - 1] : "";
    };
    const from = vals.find((v, i) => DATE_RE.test(v) && isLabel(vals[i + 1], "خلال الفترة من"));
    const to = vals.find((v, i) => DATE_RE.test(v) && isLabel(vals[i + 1], "إلى"));
    if (from) this.result.from = isoDate(from);
    if (to) this.result.to = isoDate(to);
    const type = before("نوع الحركة");
    if (type) this.result.movementType = type;
  }
}

/**
 * Streams the file through the parser. `onProgress` gets 0..1 by bytes read.
 */
export async function parseMovementHtm(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<ParsedHtm> {
  const parser = new HtmParser();
  const decoder = new TextDecoder("utf-8");
  const reader = file.stream().getReader();
  let read = 0;
  let tail = "";
  let lastReport = 0;

  const feed = (text: string) => {
    const parts = (tail + text).split(ROW_END_RE);
    tail = parts.pop() ?? "";
    for (const part of parts) parser.row(part);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    read += value.byteLength;
    feed(decoder.decode(value, { stream: true }));
    const now = performance.now();
    if (now - lastReport > 100) {
      lastReport = now;
      onProgress?.(read / file.size);
      // Hand the main thread back so the page can repaint the progress.
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  feed(decoder.decode());
  if (tail.trim()) parser.row(tail);
  onProgress?.(1);
  const result = parser.result;
  // No period in the header (file's start missing) → take it from the documents.
  if (!result.from || !result.to) {
    for (const item of result.items.values()) {
      for (const l of item.lines) {
        const d = l.doc.docDate;
        if (!result.from || d < result.from) result.from = d;
        if (!result.to || d > result.to) result.to = d;
      }
    }
  }
  return result;
}

/**
 * One item of the htm as a ParsedCard, so the hayaa report logic works on it
 * unchanged. The htm has no batch/expiry/balance — `batch` is typed by hand
 * and applied to every movement of the item.
 */
export function itemToCard(
  htm: ParsedHtm,
  item: HtmItem,
  batch = "",
): ParsedCard {
  const movements: CardMovement[] = item.lines.map((l) => {
    // No type found in the header → this page only takes transfer files, so assume one.
    const docType = l.doc.docType || TRANSFER_OUT;
    // A cancellation brings the qty back in, as on the PDF card.
    const cancel = isTransferCancel(docType);
    return {
      page: 1,
      docDate: l.doc.docDate,
      time: l.doc.time,
      docType,
      docNo: l.doc.docNo,
      party: l.doc.party,
      partyArea: l.doc.partyArea,
      partyName: l.doc.partyName,
      expiry: "",
      batch,
      qtyIn: cancel ? l.qty : 0,
      qtyOut: cancel ? 0 : l.qty,
      balance: 0,
      user: l.doc.user,
    };
  });
  return {
    code: item.code,
    itemName: item.itemName,
    productName: item.productName,
    priceTag: item.priceTag,
    openingBalance: null,
    pages: 1,
    movements,
  };
}

export type MergedHtm = {
  htm: ParsedHtm;
  /** Lines skipped because an earlier file already had their document. */
  duplicateLines: number;
};

/**
 * Combines several parsed files into one. A document (doc no + date) that
 * appears in more than one file — overlapping periods — is kept only from the
 * first file, so quantities are never counted twice. Each item's lines are
 * re-sorted by date/time, since the report rules depend on that order.
 */
export function mergeHtms(files: ParsedHtm[]): MergedHtm {
  const merged: ParsedHtm = {
    movementType: files.find((f) => f.movementType)?.movementType ?? "",
    from: "",
    to: "",
    items: new Map(),
    docs: 0,
    lines: 0,
    docsTotal: 0,
    reportTotal: null,
    unknownRows: 0,
    unknownSamples: [],
    orphanLines: 0,
  };
  const docOwner = new Map<string, number>();
  let duplicateLines = 0;

  files.forEach((file, fi) => {
    if (file.from && (!merged.from || file.from < merged.from)) merged.from = file.from;
    if (file.to && file.to > merged.to) merged.to = file.to;
    merged.unknownRows += file.unknownRows;
    merged.orphanLines += file.orphanLines;

    for (const item of file.items.values()) {
      let target = merged.items.get(item.code);
      for (const line of item.lines) {
        const key = `${line.doc.docType}|${line.doc.docNo}|${line.doc.docDate}`;
        const owner = docOwner.get(key);
        if (owner === undefined) {
          docOwner.set(key, fi);
          merged.docs++;
          merged.docsTotal += line.doc.amount;
        } else if (owner !== fi) {
          duplicateLines++;
          continue;
        }
        if (!target) {
          target = { ...item, lines: [] };
          merged.items.set(item.code, target);
        }
        target.lines.push(line);
        merged.lines++;
      }
    }
  });

  for (const item of merged.items.values()) {
    item.lines.sort((a, b) =>
      a.doc.docDate === b.doc.docDate
        ? a.doc.time.localeCompare(b.doc.time)
        : a.doc.docDate.localeCompare(b.doc.docDate),
    );
  }
  return { htm: merged, duplicateLines };
}
