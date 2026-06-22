import ExcelJS from "exceljs";
import type { ExtraItem, ReportRow } from "./types";

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

const REPORT_COLUMNS: { header: string; key: keyof ReportRow; width?: number }[] = [
  { header: "كود الصنف", key: "code" },
  { header: "اسم الصنف", key: "name", width: 50 },
  { header: "اسم المورد", key: "supplier", width: 28 },
  { header: "الكمية المطلوبة", key: "order" },
  { header: "كمية الوارد", key: "received" },
  { header: "أساسي %", key: "basicPct" },
  { header: "إضافي %", key: "extraPct" },
  { header: "خاص %", key: "specialPct" },
  { header: "بونص", key: "bonus" },
  { header: "التسوية", key: "tasfya" },
];

const EXTRA_COLUMNS: { header: string; key: keyof ExtraItem; width?: number }[] = [
  { header: "كود الصنف", key: "code" },
  { header: "اسم الصنف", key: "name", width: 50 },
  { header: "اسم المورد", key: "supplier", width: 28 },
  { header: "كمية الوارد", key: "received" },
  { header: "أساسي %", key: "basicPct" },
  { header: "إضافي %", key: "extraPct" },
  { header: "خاص %", key: "specialPct" },
  { header: "بونص", key: "bonus" },
];

const NAME_FLAGS = ["#C.C#", "#B#", "#NA#"];

function addSheet<Row extends { name: string }>(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  columns: { header: string; key: keyof Row; width?: number }[],
  rows: Row[]
) {
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
  });

  sheet.columns = columns.map((col) => ({
    header: col.header,
    key: String(col.key),
    width: col.width ?? Math.max(10, col.header.length * 1.5),
  }));

  for (const row of rows) {
    sheet.addRow(row as Record<string, unknown>);
  }

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  for (let c = 1; c <= columns.length; c++) {
    headerRow.getCell(c).border = THIN_BORDER;
  }

  const nameColIndex = columns.findIndex((c) => c.key === "name") + 1;
  const bonusColIndex = columns.findIndex((c) => c.key === "bonus") + 1;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

    const name = String(row.getCell(nameColIndex).value ?? "");
    const bonus = bonusColIndex
      ? Number(row.getCell(bonusColIndex).value ?? 0)
      : 0;

    // Bonus rows (أساسي = 100%) take precedence so they're easy to spot.
    const fill = bonus > 0
      ? GREEN_FILL
      : NAME_FLAGS.some((flag) => name.includes(flag))
        ? YELLOW_FILL
        : null;

    // Gridlines on every cell; fill only the flagged rows.
    for (let c = 1; c <= columns.length; c++) {
      const cell = row.getCell(c);
      cell.border = THIN_BORDER;
      if (fill) cell.fill = fill;
    }
  });

  return sheet;
}

export async function buildWorkbook(
  report: ReportRow[],
  extraItems: ExtraItem[]
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();

  addSheet(workbook, "Report", REPORT_COLUMNS, report);
  addSheet(workbook, "Extra Items", EXTRA_COLUMNS, extraItems);

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
