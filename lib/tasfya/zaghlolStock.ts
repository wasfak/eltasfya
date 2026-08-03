import ExcelJS from "exceljs";

/** One row of the STOCK UNILIVER master sheet. */
export interface StockRow {
  code: string;
  name: string;
  comment: string;
}

/** Normalizes a header cell to lowercase, trimmed, single-spaced text. */
function norm(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Header aliases for the three columns we read from the stock sheet. */
const HEADER_ALIASES: Record<"code" | "name" | "comment", string[]> = {
  code: ["الكود", "كود", "code", "كود الصنف"],
  name: ["إســــم الصـــــنف", "اسم الصنف", "الصنف", "name", "item name"],
  comment: ["comment", "الحالة", "ملاحظة", "ملاحظات"],
};

/**
 * Parses the "STOCK UNILIVER" master workbook — an item availability list whose
 * columns are item name / code / comment (e.g. "متاح"). Rows without a code are
 * skipped. The header row is located by finding the first row that carries a
 * recognizable code header, so a few leading rows or reordered columns are fine.
 */
export async function parseStockWorkbook(
  buffer: ArrayBuffer,
): Promise<StockRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const isAlias = (key: keyof typeof HEADER_ALIASES, value: string): boolean =>
    HEADER_ALIASES[key].some((a) => norm(a) === value);

  let headerRowNum = 0;
  const colIndex: Partial<Record<"code" | "name" | "comment", number>> = {};

  for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
    const row = sheet.getRow(r);
    const found: typeof colIndex = {};
    row.eachCell((cell, col) => {
      const value = norm(cell.value);
      (Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]).forEach(
        (key) => {
          if (found[key] === undefined && isAlias(key, value)) found[key] = col;
        },
      );
    });
    if (found.code !== undefined) {
      headerRowNum = r;
      Object.assign(colIndex, found);
      break;
    }
  }

  if (!headerRowNum || colIndex.code === undefined) return [];

  const cellText = (row: ExcelJS.Row, col: number | undefined): string =>
    col === undefined ? "" : String(row.getCell(col).value ?? "").trim();

  const rows: StockRow[] = [];
  for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const code = cellText(row, colIndex.code);
    if (!code) continue;
    rows.push({
      code,
      name: cellText(row, colIndex.name),
      comment: cellText(row, colIndex.comment),
    });
  }

  return rows;
}
