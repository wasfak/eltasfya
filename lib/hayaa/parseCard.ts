/**
 * Parser for the SofTech "كارت حركة صنف في مخزن" PDF (DataWindow print).
 *
 * The PDF has a fixed layout: every movement is one text line, and each field
 * sits in a fixed horizontal band. We read positioned text with pdf.js, group
 * items into lines by y, then assign each item to a column by its centre x.
 */

/** One positioned text run as pdf.js reports it (PDF units, y grows upward). */
export type PdfTextItem = { str: string; x: number; y: number; w: number };

export type CardMovement = {
  page: number;
  /** ISO yyyy-mm-dd (تاريخ المستند). */
  docDate: string;
  /** HH:mm from تاريخ / وقت الحركة. */
  time: string;
  docType: string;
  docNo: string;
  /** Full جهة التعامل as printed, e.g. "أرابيسك-صيدلية ابراهيم فودة". */
  party: string;
  /** Part before the first "-" (area / branch tag). */
  partyArea: string;
  /** Part after the first "-" (the pharmacy name to match against the lookup). */
  partyName: string;
  expiry: string;
  batch: string;
  qtyIn: number;
  qtyOut: number;
  balance: number;
  user: string;
};

export type ParsedCard = {
  code: string;
  /** Full item name line as printed (normalised). */
  itemName: string;
  /** Latin product name, e.g. "GAPTIN 400 MG 30 CAP". */
  productName: string;
  /** تشغيلات price tag, e.g. "ت.ج", "ت.ج4", "ت.ق" ("" if none). */
  priceTag: string;
  openingBalance: number | null;
  pages: number;
  movements: CardMovement[];
};

/* ------------------------------------------------------------------ */
/* Text normalisation                                                  */
/* ------------------------------------------------------------------ */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

/**
 * The PDF stores Arabic as presentation forms (U+FExx). NFKC folds them back
 * to base letters, but yields Persian yeh/keheh/heh-doachashmee, so map those
 * to the Arabic letters used everywhere else (lookup file, user input).
 */
export function normalizeArabic(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/ی/g, "ي")
    .replace(/ک/g, "ك")
    .replace(/[ھہ]/g, "ه")
    .replace(/ـ/g, "")
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

type Col =
  | "user"
  | "balance"
  | "qtyOut"
  | "qtyIn"
  | "batch"
  | "expiry"
  | "party"
  | "docNo"
  | "docType"
  | "time"
  | "docDate";

/** Column bands by item centre x (upper bound, exclusive), left → right. */
const BANDS: Array<[number, Col]> = [
  [100, "user"],
  [175, "balance"],
  [235, "qtyOut"],
  [285, "qtyIn"],
  [340, "batch"],
  [400, "expiry"],
  [575, "party"],
  [615, "docNo"],
  [685, "docType"],
  [755, "time"],
  [Infinity, "docDate"],
];

function colFor(item: PdfTextItem): Col {
  const cx = item.x + item.w / 2;
  for (const [max, col] of BANDS) if (cx < max) return col;
  return "docDate";
}

const ROW_TOLERANCE = 2;
const DATE_RE = /^(\d{4})\/(\d{2})\/(\d{2})$/;
const TIME_RE = /(\d{2}:\d{2})/;

/** Groups items into lines (top → bottom), each line sorted right → left. */
function groupLines(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const lines: PdfTextItem[][] = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - it.y) <= ROW_TOLERANCE) line.push(it);
    else lines.push([it]);
  }
  for (const line of lines) line.sort((a, b) => b.x - a.x);
  return lines;
}

function toNumber(s: string): number {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function joinRtl(items: PdfTextItem[]): string {
  return normalizeArabic(
    [...items]
      .sort((a, b) => b.x - a.x)
      .map((i) => i.str)
      .join(" "),
  );
}

export function splitParty(party: string): { area: string; name: string } {
  const i = party.indexOf("-");
  if (i < 0) return { area: "", name: party };
  return { area: party.slice(0, i).trim(), name: party.slice(i + 1).trim() };
}

/** Latin product name and تشغيلات price tag out of a full item name. */
export function splitItemName(itemName: string): {
  productName: string;
  priceTag: string;
} {
  // Drop markers (#B#, ##F#, #ع##…), "مثيل/كود جديد <code>", and every Arabic
  // run with digits glued to it (also takes the price tag); what's left is
  // the Latin product name.
  const productName = itemName
    .replace(/#+[A-Za-z.]*#+/g, " ")
    .replace(/#/g, " ")
    .replace(/(مثيل|كود جديد)\s*\d+/g, " ")
    .replace(/\d*[؀-ۿ][؀-ۿ.\d]*/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tag = /ت\.([جق])\s*(\d*)/.exec(itemName);
  return { productName, priceTag: tag ? `ت.${tag[1]}${tag[2]}` : "" };
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/** Pure parser over already-extracted page text (testable without pdf.js). */
export function parseCardPages(pages: PdfTextItem[][]): ParsedCard {
  let code = "";
  let itemName = "";
  let openingBalance: number | null = null;
  const movements: CardMovement[] = [];

  pages.forEach((rawItems, pageIdx) => {
    const items = rawItems
      .filter((i) => i.str.trim())
      .map((i) => ({ ...i, str: normalizeArabic(i.str) }));

    // The table header line holds "نوع المستند"; movements are below it.
    const header = items.find((i) => i.str === "نوع المستند");
    if (!header) return;
    const headerY = header.y;

    if (pageIdx === 0) {
      const codeLabel = items.find((i) => i.str === "كود الصنف");
      const nameLabel = items.find((i) => i.str === "إسم الصنف" || i.str === "اسم الصنف");
      if (codeLabel) {
        code =
          items.find(
            (i) =>
              Math.abs(i.y - codeLabel.y) <= ROW_TOLERANCE &&
              i.x < codeLabel.x &&
              /^\d+$/.test(i.str),
          )?.str ?? "";
      }
      if (nameLabel) {
        itemName = joinRtl(
          rawItems.filter(
            (i) =>
              i.str.trim() &&
              Math.abs(i.y - nameLabel.y) <= ROW_TOLERANCE &&
              i.x < nameLabel.x,
          ),
        );
      }
      // رصيد ما قبله: the number on its line, above the table header.
      const openLabel = items.find((i) => i.str === "رصيد ما قبله");
      if (openLabel) {
        const v = items.find(
          (i) =>
            Math.abs(i.y - openLabel.y) <= ROW_TOLERANCE &&
            i !== openLabel &&
            /^[\d,]+(\.\d+)?$/.test(i.str),
        );
        if (v) openingBalance = toNumber(v.str);
      }
    }

    const body = rawItems.filter(
      (i) => i.str.trim() && i.y < headerY - ROW_TOLERANCE,
    );
    for (const line of groupLines(body)) {
      const cells: Partial<Record<Col, PdfTextItem[]>> = {};
      for (const it of line) (cells[colFor(it)] ??= []).push(it);
      const text = (c: Col) => (cells[c] ? joinRtl(cells[c]!) : "");

      // A movement line always carries a تاريخ المستند; totals/footer don't.
      const dm = DATE_RE.exec(text("docDate"));
      if (!dm) continue;

      const party = text("party");
      const { area, name } = splitParty(party);
      movements.push({
        page: pageIdx + 1,
        docDate: `${dm[1]}-${dm[2]}-${dm[3]}`,
        time: TIME_RE.exec(text("time"))?.[1] ?? "",
        docType: text("docType"),
        docNo: text("docNo"),
        party,
        partyArea: area,
        partyName: name,
        expiry: text("expiry"),
        batch: text("batch"),
        qtyIn: toNumber(text("qtyIn")),
        qtyOut: toNumber(text("qtyOut")),
        balance: toNumber(text("balance")),
        user: text("user"),
      });
    }
  });

  const { productName, priceTag } = splitItemName(itemName);

  return {
    code,
    itemName,
    productName,
    priceTag,
    openingBalance,
    pages: pages.length,
    movements,
  };
}

/** Reads a SofTech card PDF in the browser and parses it. */
export async function parseCardPdf(data: ArrayBuffer): Promise<ParsedCard> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: PdfTextItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const it of content.items) {
      if (!("str" in it)) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width });
    }
    pages.push(items);
  }
  await doc.destroy();
  return parseCardPages(pages);
}
