import type { OrderData, OrderItem } from "./types";

function parseSofTechDate(value: string): Date {
  // Format: YYYY/M/D
  const [y, m, d] = value.split("/").map(Number);
  return new Date(y, m - 1, d);
}

/** Parses a SofTech numeric cell, stripping the thousands separators it adds
 * to values ≥ 1000 (e.g. "1,000"), which would otherwise become NaN. */
function toNumber(value: string): number {
  return Number((value || "0").replace(/,/g, "")) || 0;
}

/**
 * Parses the "أمر توريد" (supply order) table.
 *
 * Item rows start at index 13; the last row ("Page 1 of 1") is dropped.
 * Per item row: order quantity = col[7], name = col[14] (spans 8-15),
 * code = col[16] (spans 16-17).
 *
 * Row 12 holds the order's reference date at col[10] and order number at col[16].
 */
export function parseOrder(matrix: string[][]): OrderData {
  const referenceDate = parseSofTechDate(matrix[12]?.[10] ?? "");
  const orderNumber = matrix[12]?.[16] ?? "";

  const items: OrderItem[] = [];
  for (let i = 13; i < matrix.length - 1; i++) {
    const row = matrix[i];
    const code = (row?.[16] ?? "").trim();
    if (!code || Number.isNaN(Number(code))) continue;

    items.push({
      code: String(Number(code)),
      name: (row[14] ?? "").trim(),
      order: Math.trunc(toNumber(row[7] ?? "")),
    });
  }

  return { items, referenceDate, orderNumber };
}
