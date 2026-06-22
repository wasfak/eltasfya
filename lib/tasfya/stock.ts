import type { StockData, StockItem } from "./types";

function toNumber(value: string): number {
  return Number((value || "0").replace(/,/g, "")) || 0;
}

/**
 * Parses the stock / inventory export (e.g. `bio_stock.html`). This file is the
 * supplier's product master: every row's `المورد` column is the supplier, and it
 * lists every code carried for that supplier (including old/new/equivalent
 * codes). It defines the "same company" universe used to flag extra items.
 *
 * Layout: a header row, then ROWSPAN=2 per item (a data row followed by a near
 * empty continuation row). After colspan expansion each data row has 14 columns:
 *   3 سعر الشراء · 4 سعر البيع · 5 المورد · 7 الرصيد المتاح · 10 الرصيد ·
 *   12 إسم الصنف · 13 الكود.
 * The header row and the 1-cell continuation rows are skipped.
 */
export function parseStock(matrix: string[][]): StockData {
  const items: StockItem[] = [];

  for (const row of matrix) {
    if (!row || row.length < 14) continue; // continuation row
    const rawCode = (row[13] ?? "").trim();
    if (!rawCode || Number.isNaN(Number(rawCode))) continue; // header row

    items.push({
      code: String(Number(rawCode)),
      name: (row[12] ?? "").trim(),
      supplier: (row[5] ?? "").trim(),
      purchasePrice: toNumber(row[3] ?? ""),
      salePrice: toNumber(row[4] ?? ""),
      balance: toNumber(row[10] ?? ""),
    });
  }

  // Supplier label = most common `المورد` value in the file.
  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.supplier) counts.set(it.supplier, (counts.get(it.supplier) ?? 0) + 1);
  }
  let supplier = "";
  let best = -1;
  for (const [name, n] of counts) {
    if (n > best) {
      supplier = name;
      best = n;
    }
  }

  const byCode = new Map<string, StockItem>();
  for (const it of items) if (!byCode.has(it.code)) byCode.set(it.code, it);

  return { items, byCode, codes: new Set(byCode.keys()), supplier };
}
