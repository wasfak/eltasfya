import ExcelJS from "exceljs";
import { bonusPercent } from "./report";
import type { ReportRow } from "./types";

/**
 * Settlement (التسوية) color scheme, mirroring the on-screen table and using
 * Excel's familiar Good / Neutral / Bad palette:
 *   تسوية = 0  → green  (matched)
 *   تسوية > 0  → yellow (surplus)
 *   تسوية < 0  → red    (shortage)
 */
const SETTLE_STYLE = {
  zero: { fill: "FFC6EFCE", font: "FF006100" }, // green
  pos: { fill: "FFFFEB9C", font: "FF9C6500" }, // yellow
  neg: { fill: "FFFFC7CE", font: "FF9C0006" }, // red
} as const;

function settleStyle(tasfya: number) {
  if (tasfya < 0) return SETTLE_STYLE.neg;
  if (tasfya > 0) return SETTLE_STYLE.pos;
  return SETTLE_STYLE.zero;
}

// Thin gridlines on every side of every cell.
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFB0B0B0" } },
  bottom: { style: "thin", color: { argb: "FFB0B0B0" } },
  left: { style: "thin", color: { argb: "FFB0B0B0" } },
  right: { style: "thin", color: { argb: "FFB0B0B0" } },
};

/**
 * The export now mirrors the on-screen table: every visible column is written.
 * Rows carry the full report shape plus `isExtra` (to render الحالة and to blank
 * out the order column for over-order items). `tasfya` drives row highlighting.
 * The per-invoice line breakdown shown in the UI is flattened to the item-level
 * aggregate here (one row per item), except اسم المورد which keeps one text line
 * per invoice.
 */
type ExportRow = Pick<
  ReportRow,
  | "code"
  | "name"
  | "supplier"
  | "order"
  | "received"
  | "basicPct"
  | "extraPct"
  | "specialPct"
  | "bonus"
  | "tasfya"
  | "lines"
> & { isExtra?: boolean };

/** A percentage as shown in the table: "26.47%", or "—" when zero. */
function pctText(value: number): string {
  return value ? `${Number(value.toFixed(2))}%` : "—";
}

/**
 * Renders one of the per-invoice columns (received / discounts) with one text
 * line per purchase line, matching the on-screen breakdown. With no lines it
 * falls back to the item-level aggregate via `whenEmpty`.
 */
function perLine(
  r: ExportRow,
  line: (l: ExportRow["lines"][number]) => string | number,
  whenEmpty: string | number,
): string | number {
  if (r.lines.length === 0) return whenEmpty;
  if (r.lines.length === 1) return line(r.lines[0]);
  return r.lines.map(line).join("\n");
}

/**
 * اسم المورد: one text line per purchase line, each showing the supplier plus
 * its invoice number and date (e.g. "فارما اوفر سيز — Inv. 684752 · 2026/06/22"),
 * matching the per-invoice breakdown shown in the on-screen table. Falls back to
 * the joined aggregate supplier when there are no lines.
 */
function supplierOf(r: ExportRow): string {
  if (r.lines.length === 0) return r.supplier;
  return r.lines
    .map((l) => {
      const meta = [l.invoice && `Inv. ${l.invoice}`, l.date]
        .filter(Boolean)
        .join(" · ");
      return [l.supplier || "—", meta].filter(Boolean).join(" — ");
    })
    .join("\n");
}

/** The exported columns, in the same left-to-right order as the table. */
const COLUMNS: {
  header: string;
  width: number;
  value: (r: ExportRow) => string | number;
}[] = [
  { header: "كود الصنف", width: 16, value: (r) => r.code },
  { header: "اسم الصنف", width: 50, value: (r) => r.name },
  { header: "الحالة", width: 12, value: (r) => (r.isExtra ? "زائد" : "مطلوب") },
  {
    header: "الكمية المطلوبة",
    width: 16,
    value: (r) => (r.isExtra ? "" : r.order),
  },
  { header: "التسوية", width: 14, value: (r) => r.tasfya },
  { header: "بونص", width: 10, value: (r) => r.bonus },
  {
    header: "بونص %",
    width: 10,
    value: (r) => pctText(bonusPercent(r.received, r.bonus)),
  },
  { header: "اسم المورد", width: 32, value: (r) => supplierOf(r) },
  {
    header: "كمية الوارد",
    width: 14,
    value: (r) => perLine(r, (l) => l.received, r.received),
  },
  {
    header: "أساسي %",
    width: 12,
    value: (r) => perLine(r, (l) => pctText(l.basicPct), pctText(r.basicPct)),
  },
  {
    header: "إضافي %",
    width: 12,
    value: (r) => perLine(r, (l) => pctText(l.extraPct), pctText(r.extraPct)),
  },
  {
    header: "خاص %",
    width: 12,
    value: (r) => perLine(r, (l) => pctText(l.specialPct), pctText(r.specialPct)),
  },
];

function addSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  rows: ExportRow[],
) {
  const sheet = workbook.addWorksheet(sheetName, {
    // Left-to-right sheet (previously right-to-left).
    views: [{ rightToLeft: false, state: "frozen", ySplit: 1 }],
  });

  sheet.columns = COLUMNS.map((col) => ({
    header: col.header,
    width: col.width,
  }));

  for (const row of rows) {
    sheet.addRow(COLUMNS.map((col) => col.value(row)));
  }

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  for (let c = 1; c <= COLUMNS.length; c++) {
    headerRow.getCell(c).border = THIN_BORDER;
  }

  // Data rows line up 1:1 with `rows` (header is row 1). The whole row is
  // colored by its settlement value (green = 0, yellow > 0, red < 0).
  rows.forEach((src, i) => {
    const row = sheet.getRow(i + 2);
    row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

    const style = settleStyle(src.tasfya);
    const fill: ExcelJS.Fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: style.fill },
    };

    for (let c = 1; c <= COLUMNS.length; c++) {
      const cell = row.getCell(c);
      cell.border = THIN_BORDER;
      cell.fill = fill;
      cell.font = { color: { argb: style.font } };
    }
  });

  return sheet;
}

export async function buildWorkbook(
  report: ExportRow[],
  extraItems: ExportRow[],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();

  addSheet(workbook, "Report", report);
  addSheet(workbook, "Extra Items", extraItems);

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
