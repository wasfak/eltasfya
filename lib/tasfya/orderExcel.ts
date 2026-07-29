import ExcelJS from "exceljs";
import type { OrderItem } from "./types";

export interface OrderExcelData {
  items: OrderItem[];
  /** The اسم المورد (supplier) taken from the sheet's `company` column. */
  company: string;
}

/** Reads a File as an ArrayBuffer (for ExcelJS to load a .xlsx workbook). */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Normalizes a header cell to lowercase, trimmed, single-spaced text. */
function norm(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Header aliases for each column we read. The sheet produced by the settlement
 * download (buildSimpleWorkbook) uses "code / item name / Order / company"; we
 * also accept the Arabic labels so a hand-made sheet works too.
 */
const HEADER_ALIASES: Record<"code" | "name" | "order" | "company", string[]> = {
  code: ["code", "كود الصنف", "كود", "الكود"],
  name: ["item name", "اسم الصنف", "الصنف", "name"],
  order: ["order", "الكمية المطلوبة", "الكمية", "الطلب", "التسوية"],
  company: ["company", "اسم المورد", "المورد", "الشركة"],
};

/**
 * Parses the order Excel used by "تصفية التصفية" mode. The workbook is the same
 * four-column sheet the settlement download produces — code, item name, Order
 * (the quantity to settle against), company (the supplier). Rows without a code
 * are skipped; the ordered quantity is coerced to a number (blank → 0). The
 * supplier is read from the first non-empty `company` cell.
 */
export async function parseOrderExcel(
  buffer: ArrayBuffer,
): Promise<OrderExcelData> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) return { items: [], company: "" };

  // Locate the header row (first row that contains a recognizable "code"
  // header) and map each wanted column to its 1-based column index.
  let headerRowNum = 0;
  const colIndex: Partial<Record<"code" | "name" | "order" | "company", number>> =
    {};

  const isAlias = (
    key: keyof typeof HEADER_ALIASES,
    value: string,
  ): boolean => HEADER_ALIASES[key].some((a) => norm(a) === value);

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

  if (!headerRowNum || colIndex.code === undefined) {
    return { items: [], company: "" };
  }

  const cellText = (row: ExcelJS.Row, col: number | undefined): string =>
    col === undefined ? "" : String(row.getCell(col).value ?? "").trim();

  const items: OrderItem[] = [];
  let company = "";

  for (let r = headerRowNum + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const code = cellText(row, colIndex.code);
    if (!code) continue;

    const name = cellText(row, colIndex.name);
    const orderRaw = cellText(row, colIndex.order).replace(/,/g, "");
    const order = Number(orderRaw) || 0;

    if (!company) {
      const c = cellText(row, colIndex.company);
      if (c) company = c;
    }

    items.push({ code, name, order });
  }

  return { items, company };
}
