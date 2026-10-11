/**
 * Parser for the SofTech stock (الأرصدة) HTML export (.htm). We only need
 * each item's code, name and supplier (المورد = the company), to link the
 * movement report's codes to a company.
 *
 * The file is one <TABLE>: a <TH> heading row, then one 14-cell row per item
 * (followed by a spacer row) and a "إجمالي الرصيد" footer.
 */
import { normalizeArabic, splitItemName } from "./parseCard";

export type StockItem = {
  code: string;
  itemName: string;
  productName: string;
  company: string;
};

export type ParsedStock = {
  items: StockItem[];
  /** Rows that looked like items but had no code (should be 0). */
  skipped: number;
};

const CELL_RE = /<T([DH])[^>]*>([^<]*)/gi;
const CODE_RE = /^\d+$/;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, "&");
}

export async function parseStockHtm(file: File): Promise<ParsedStock> {
  const text = await file.text();
  let cols: { code: number; name: number; company: number } | null = null;
  let width = 0;
  const items: StockItem[] = [];
  let skipped = 0;

  for (const row of text.split(/<\/TR>/i)) {
    const cells = [...row.matchAll(CELL_RE)].map((m) => ({
      th: m[1].toUpperCase() === "H",
      value: normalizeArabic(decodeEntities(m[2])),
    }));
    if (!cells.length) continue;

    if (!cols) {
      if (!cells.some((c) => c.th)) continue;
      const at = (label: string) => cells.findIndex((c) => c.value === label);
      const code = at("الكود");
      const name = at("إسم الصنف");
      const company = at("المورد");
      if (code < 0 || name < 0 || company < 0) {
        throw new Error("ليس ملف أرصدة — لم يتم العثور على أعمدة الكود / إسم الصنف / المورد");
      }
      cols = { code, name, company };
      width = cells.length;
      continue;
    }

    // Spacer rows (1 cell) and anything not shaped like an item row.
    if (cells.length !== width) continue;
    const code = cells[cols.code].value;
    const itemName = cells[cols.name].value;
    if (!CODE_RE.test(code)) {
      // The footer ("إجمالي الرصيد") has no code and no item name.
      if (itemName && !/^Rec\b/i.test(itemName)) skipped++;
      continue;
    }
    items.push({
      code,
      itemName,
      productName: splitItemName(itemName).productName,
      company: cells[cols.company].value,
    });
  }

  if (!cols) throw new Error("ليس ملف أرصدة — لا يوجد صف عناوين");
  return { items, skipped };
}
