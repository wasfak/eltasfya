import ExcelJS from "exceljs";
import type { ReportRow } from "./types";

const YELLOW_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFFF00" },
};

const GREEN_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFC6EFCE" },
};

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
 * out the order column for over-order items). `bonus` also drives row
 * highlighting. The per-invoice line breakdown shown in the UI is flattened to
 * the item-level aggregate here (one row per item).
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

/** A blank cell for a zero discount, matching the "—" shown in the table. */
function pctOrBlank(value: number): number | string {
  return value ? Number(value.toFixed(2)) : "";
}

/** اسم المورد: prefer the joined aggregate, else the line suppliers (as in the UI). */
function supplierOf(r: ExportRow): string {
  return (
    r.supplier ||
    r.lines
      .map((l) => l.supplier)
      .filter(Boolean)
      .join(", ")
  );
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
  { header: "اسم المورد", width: 32, value: (r) => supplierOf(r) },
  { header: "كمية الوارد", width: 14, value: (r) => r.received },
  { header: "أساسي %", width: 12, value: (r) => pctOrBlank(r.basicPct) },
  { header: "إضافي %", width: 12, value: (r) => pctOrBlank(r.extraPct) },
  { header: "خاص %", width: 12, value: (r) => pctOrBlank(r.specialPct) },
];

const NAME_FLAGS = ["#C.C#", "#B#", "#NA#"];

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

  // Data rows line up 1:1 with `rows` (header is row 1). Highlighting is decided
  // from the source data, not the visible cells.
  rows.forEach((src, i) => {
    const row = sheet.getRow(i + 2);
    row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

    // Bonus rows (أساسي = 100%) take precedence, then flagged names.
    const fill =
      (src.bonus ?? 0) > 0
        ? GREEN_FILL
        : NAME_FLAGS.some((flag) => src.name.includes(flag))
          ? YELLOW_FILL
          : null;

    for (let c = 1; c <= COLUMNS.length; c++) {
      const cell = row.getCell(c);
      cell.border = THIN_BORDER;
      if (fill) cell.fill = fill;
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
