import ExcelJS from "exceljs";
import type { CardMovement, ParsedCard } from "./parseCard";
import { matchBranch, type Branch } from "./branches";

export type ReportStyle = "gaptin" | "averozolid";

export const TRANSFER_OUT = "صرف - تبادل بين الفروع";
const TRANSFER_CANCEL = "إلغاء صرف - تبادل بين الفروع";

const STORE_GLN = 6220002605773;
const STORE_NAME = "مخزن الطرشوبي للادوية";

export type ReportRow = {
  movement: CardMovement;
  branch: Branch;
  /** Batch as printed on the card (blank stays blank). */
  batch: string;
};

export type ReportSelection = {
  rows: ReportRow[];
  /** PDF party names (transfer rows only) with no lookup branch → dropped. */
  unmatched: Map<string, number>;
};

/**
 * Applies the report rules to one card:
 * - only صرف - تبادل بين الفروع, minus those reversed by a later إلغاء صرف
 * - destination must be in the lookup
 * - one row per branch per day, first `maxPerDay` branches by time
 * - optional inclusive date range (ISO yyyy-mm-dd); empty = whole card
 */
export function selectReportRows(
  card: ParsedCard,
  maxPerDay: number,
  range: { from?: string; to?: string } = {},
): ReportSelection {
  const moves = card.movements;

  // A cancel reverses the latest earlier transfer to the same party/quantity.
  const cancelled = new Set<number>();
  moves.forEach((m, i) => {
    if (m.docType !== TRANSFER_CANCEL) return;
    for (let j = i - 1; j >= 0; j--) {
      const t = moves[j];
      if (
        t.docType === TRANSFER_OUT &&
        !cancelled.has(j) &&
        t.party === m.party &&
        t.qtyOut === m.qtyIn
      ) {
        cancelled.add(j);
        return;
      }
    }
  });

  const rows: ReportRow[] = [];
  const unmatched = new Map<string, number>();
  const perDay = new Map<string, Set<string>>();

  moves.forEach((m, i) => {
    if (m.docType !== TRANSFER_OUT || cancelled.has(i)) return;
    if (range.from && m.docDate < range.from) return;
    if (range.to && m.docDate > range.to) return;
    const branch = matchBranch(m.party, m.partyName);
    if (!branch) {
      unmatched.set(m.party, (unmatched.get(m.party) ?? 0) + 1);
      return;
    }
    const day = perDay.get(m.docDate) ?? new Set<string>();
    perDay.set(m.docDate, day);
    if (day.has(branch.license) || day.size >= maxPerDay) return;
    day.add(branch.license);
    rows.push({ movement: m, branch, batch: m.batch });
  });

  return { rows, unmatched };
}

/* ------------------------------------------------------------------ */
/* Workbook                                                            */
/* ------------------------------------------------------------------ */

type Cell = string | number;

/** Numeric strings become numbers (Excel shows them without the green flag). */
function num(s: string): Cell {
  return /^\d+$/.test(s) ? Number(s) : s;
}

function dmy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}/${y}`;
}

function ymd(iso: string): string {
  return iso.replace(/-/g, "/");
}

/** Header fills, as in the user's Google Sheets templates. */
const PINK = "FFEAD1DC";
const MAUVE = "FFD5A6BD";
const PEACH = "FFF9CB9C";
const CREAM = "FFFCE5CD";

type Ctx = { r: ReportRow; i: number; item: string; maker: string };

type Column = {
  header: string;
  width: number;
  fill: string;
  value: (c: Ctx) => Cell;
};

const LAYOUTS: Record<ReportStyle, Column[]> = {
  gaptin: [
    { header: "م", width: 6, fill: PINK, value: (c) => c.i + 1 },
    { header: "الكود المكاني للمخزن GLN", width: 20, fill: PINK, value: () => STORE_GLN },
    { header: "اسم المخزن", width: 22, fill: PINK, value: () => STORE_NAME },
    { header: "اسم الصنف", width: 24, fill: MAUVE, value: (c) => c.item },
    { header: "Batch number", width: 13, fill: PINK, value: (c) => num(c.r.batch) },
    { header: "الشركة صاحبة المستحضر", width: 26, fill: MAUVE, value: (c) => c.maker },
    { header: "الكمية المباعة", width: 11, fill: PEACH, value: (c) => c.r.movement.qtyOut },
    { header: "تاريخ الفاتورة", width: 13, fill: PEACH, value: (c) => dmy(c.r.movement.docDate) },
    { header: "رقم الفاتورة", width: 13, fill: PEACH, value: (c) => num(c.r.movement.docNo) },
    { header: "اسم المؤسسة الصيدلية", width: 36, fill: PINK, value: (c) => c.r.branch.name },
    { header: "عنوان المؤسسة بالتفصيل", width: 16, fill: PINK, value: () => "" },
    { header: "اسم المحافظة", width: 14, fill: PINK, value: (c) => c.r.branch.governorate },
    { header: "رقم الرخصة", width: 10, fill: PINK, value: (c) => c.r.branch.license },
    { header: "GLN (الكود المكانى للصيدلية)", width: 18, fill: PINK, value: (c) => c.r.branch.gln },
  ],
  averozolid: [
    { header: "م", width: 6, fill: PINK, value: (c) => c.i + 1 },
    { header: "اسم الفرع المورد", width: 24, fill: PINK, value: () => STORE_NAME },
    { header: "اسم الصنف", width: 28, fill: MAUVE, value: (c) => c.item },
    { header: "الشركة صاحبة المستحضر", width: 20, fill: MAUVE, value: (c) => c.maker },
    { header: "الكمية المباعة", width: 12, fill: PEACH, value: (c) => c.r.movement.qtyOut },
    { header: "تاريخ الفاتورة", width: 14, fill: PEACH, value: (c) => ymd(c.r.movement.docDate) },
    { header: "رقم الفاتورة", width: 14, fill: PEACH, value: (c) => num(c.r.movement.docNo) },
    { header: "اسم المؤسسة الصيدلية", width: 44, fill: MAUVE, value: (c) => c.r.branch.name },
    { header: "عنوان المؤسسة بالتفصيل", width: 16, fill: CREAM, value: () => "" },
    { header: "اسم المحافظة", width: 16, fill: MAUVE, value: (c) => c.r.branch.governorate },
  ],
};

const thin = { style: "thin" } as const;
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

export type ReportOptions = {
  style: ReportStyle;
  manufacturer: string;
};

export async function buildReportWorkbook(
  card: ParsedCard,
  rows: ReportRow[],
  { style, manufacturer }: ReportOptions,
): Promise<ArrayBuffer> {
  const columns = LAYOUTS[style];
  const item = card.productName || card.itemName;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1", {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: false }],
  });
  ws.columns = columns.map((c) => ({ width: c.width }));

  const header = ws.addRow(columns.map((c) => c.header));
  header.height = 45;
  header.eachCell((cell, n) => {
    cell.font = { name: "Arial", size: 12, bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: columns[n - 1].fill },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER;
  });

  rows.forEach((r, i) => {
    const ctx: Ctx = { r, i, item, maker: manufacturer };
    const row = ws.addRow(columns.map((c) => c.value(ctx)));
    row.eachCell({ includeEmpty: true }, (c) => {
      c.font = { name: "Arial", size: 11 };
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.border = BORDER;
      if (typeof c.value === "number") c.numFmt = "0";
    });
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
