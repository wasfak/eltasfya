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
 * Rows passed to the export carry the full report shape, but only
 * code / name / tasfya are written. `bonus` is read solely to decide row
 * highlighting (it is not exported as a column).
 */
type ExportRow = Pick<ReportRow, "code" | "name" | "tasfya"> & { bonus?: number };

/** The only exported columns, in left-to-right order. */
const COLUMNS: { header: string; key: keyof ExportRow; width: number }[] = [
  { header: "كود الصنف", key: "code", width: 16 },
  { header: "اسم الصنف", key: "name", width: 50 },
  { header: "التسوية", key: "tasfya", width: 14 },
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
    key: String(col.key),
    width: col.width,
  }));

  for (const row of rows) {
    sheet.addRow({ code: row.code, name: row.name, tasfya: row.tasfya });
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
