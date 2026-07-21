/**
 * Parsing for Cosmo mode's AppSheet "ViewData" CSV export.
 *
 * The export quotes every field, so a field may itself contain commas — both
 * thousands separators ("1,484") and comma-separated ID lists
 * ("503 , 5,636 , 5,637"). Every data row also carries a trailing empty column
 * from the line-ending comma, which we drop.
 */

export type CosmoRow = Record<string, string>;

export type CosmoData = {
  /** Column headers, in file order (trailing empty column removed). */
  headers: string[];
  rows: CosmoRow[];
};

/**
 * Splits CSV text into a matrix of raw cell strings, honoring double-quoted
 * fields (with "" as an escaped quote) and both \n and \r\n line endings.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // Swallow; the following \n (if any) ends the row.
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  // Flush the final field/row if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Parses the AppSheet ViewData CSV into headers + keyed rows. Fully blank
 * lines are skipped, and the trailing empty column produced by each line's
 * final comma is trimmed from both the header and every row.
 */
export function parseCosmoCsv(text: string): CosmoData {
  const matrix = parseCsv(text).filter((r) =>
    r.some((cell) => cell.trim() !== ""),
  );
  if (matrix.length === 0) return { headers: [], rows: [] };

  let headers = matrix[0].map((h) => h.trim());
  // Drop a trailing empty header (from the line-ending comma).
  while (headers.length > 0 && headers[headers.length - 1] === "") {
    headers.pop();
  }

  const rows: CosmoRow[] = matrix.slice(1).map((cells) => {
    const rec: CosmoRow = {};
    headers.forEach((h, i) => {
      rec[h] = (cells[i] ?? "").trim();
    });
    return rec;
  });

  return { headers, rows };
}
