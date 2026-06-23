import type { PurchaseLine } from "./types";

function parseSofTechDate(value: string): Date {
  // Format: YYYY/MM/DD
  const [y, m, d] = value.split("/").map(Number);
  return new Date(y, m - 1, d);
}

/** Parses a SofTech numeric cell, stripping the thousands separators it adds
 * to values ≥ 1000 (e.g. "1,000"), which would otherwise become NaN. */
function toNumber(value: string): number {
  return Number((value || "0").replace(/,/g, "")) || 0;
}

/**
 * Parses the "سجل فواتير شراء الأصناف" (purchase invoices register) table.
 *
 * Data rows start at index 7; the last row ("Page 1 of 1") is dropped.
 *
 * The table alternates between "title" rows (item name spans cols 12-18,
 * item code sits in col[19]) and "data" rows (col[19] holds the branch name
 * instead, e.g. "الرئيـســـي"). Each data row is one purchase line:
 *   special% (خاص) = col[6], extra% (إضافي) = col[7],
 *   basic% (أساسي) = col[9] (spans 8-9), received qty (كمية الوارد) = col[10],
 *   invoice# (رقم فاتورة الشراء) = col[11] (spans 11-12),
 *   company = col[13] (spans 13-16), date = col[17] (spans 17-18).
 *
 * Title rows are recognized by col[19] being numeric (the item code) and are
 * used to back-fill `code`/`name` for the data rows that follow them.
 */
export function parsePurchases(matrix: string[][]): PurchaseLine[] {
  const lines: PurchaseLine[] = [];

  let currentCode = "";
  let currentName = "";

  for (let i = 7; i < matrix.length - 1; i++) {
    const row = matrix[i];
    if (!row || row.length === 0) continue;

    const col19 = (row[19] ?? "").trim();
    if (col19 && !Number.isNaN(Number(col19))) {
      // Title row: holds the item code and (in cols 12-18) the item name.
      currentCode = String(Number(col19));
      currentName = (row[15] ?? "").trim();
      continue;
    }

    const kmya = toNumber(row[10] ?? "");
    if (!kmya) continue;

    lines.push({
      code: currentCode,
      name: currentName,
      company: (row[13] ?? "").trim(),
      invoice: (row[11] ?? "").trim(),
      date: parseSofTechDate((row[17] ?? "").trim()),
      kmya,
      basicPct: toNumber(row[9] ?? ""),
      extraPct: toNumber(row[7] ?? ""),
      specialPct: toNumber(row[6] ?? ""),
    });
  }

  return lines;
}
