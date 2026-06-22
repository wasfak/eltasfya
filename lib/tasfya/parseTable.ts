/**
 * Parses the first <table> in a SofTech-exported HTML report into a matrix of
 * cell text, expanding `colspan` by repeating the cell's text that many times.
 *
 * This reproduces the behavior of `pandas.read_html(html, flavor='lxml')[0]`,
 * which fills every column spanned by a merged cell with the same value.
 * Rowspan is intentionally not propagated downward — the header rows that use
 * it are dropped by row-slicing in order.ts / purchases.ts.
 *
 * Relies on the global `DOMParser` (available in browsers; Node callers must
 * polyfill `globalThis.DOMParser`, e.g. via `linkedom`).
 */
export function parseHtmlTable(html: string): string[][] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return [];

  const rows: string[][] = [];
  for (const tr of Array.from(table.querySelectorAll("tr"))) {
    const row: string[] = [];
    for (const cell of Array.from(tr.querySelectorAll("td, th"))) {
      // Attribute names should be case-insensitive per the HTML spec; some
      // parsers (e.g. linkedom) don't lowercase them, so look up both ways.
      const colspanAttr =
        cell.getAttribute("colspan") ?? cell.getAttribute("COLSPAN");
      const span = Number(colspanAttr ?? "1") || 1;
      const text = (cell.textContent ?? "").trim();
      for (let i = 0; i < span; i++) row.push(text);
    }
    rows.push(row);
  }
  return rows;
}
