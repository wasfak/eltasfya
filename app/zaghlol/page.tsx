"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  FileSpreadsheet,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ExcelJS from "exceljs";
import { parseCosmoCsv, type CosmoRow } from "@/lib/tasfya/cosmo";
import {
  parseStockWorkbook,
  type StockRow,
} from "@/lib/tasfya/zaghlolStock";
import { readFileAsArrayBuffer } from "@/lib/tasfya/orderExcel";

/** The CSV header holding the item code, matched against the stock sheet. */
const CODE_KEY = "code";
const NAME_KEY = "اسم الصنف";

/** A متاح stock item joined to its matching CSV row (undefined = no match). */
type JoinedRow = {
  code: string;
  name: string;
  comment: string;
  csv?: CosmoRow;
};

type SortDir = "asc" | "desc";

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

/** True when the stock comment marks the item as available (contains متاح). */
function isAvailable(comment: string): boolean {
  return comment.includes("متاح");
}

/** Reads a CSV numeric cell, dropping thousands separators; NaN → not numeric. */
function asNumber(v: string): number {
  return Number(v.replace(/,/g, ""));
}

export default function ZaghlolPage() {
  const [stockFile, setStockFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [rows, setRows] = useState<JoinedRow[] | null>(null);
  // CSV headers, in file order, minus code/name (shown as fixed leading columns).
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ col: string; dir: SortDir } | null>(null);
  // When on, hide متاح items that have no matching row in the CSV.
  const [matchedOnly, setMatchedOnly] = useState(false);

  const canProcess = !!stockFile && !!csvFile;

  async function handleProcess() {
    if (!canProcess || loading) return;
    setLoading(true);
    setError(null);
    try {
      const [stockBuffer, csvText] = await Promise.all([
        readFileAsArrayBuffer(stockFile!),
        readFileAsText(csvFile!),
      ]);

      const stock: StockRow[] = await parseStockWorkbook(stockBuffer);
      const csv = parseCosmoCsv(csvText);

      if (stock.length === 0) {
        setError(
          "لم يتم العثور على أصناف في ملف Excel. تأكد من وجود عمودي الكود و comment.",
        );
        setRows(null);
        return;
      }
      if (csv.headers.length === 0 || csv.rows.length === 0) {
        setError("ملف CSV فارغ أو غير صالح.");
        setRows(null);
        return;
      }

      // Index the CSV rows by code for the join.
      const csvByCode = new Map<string, CosmoRow>();
      for (const r of csv.rows) csvByCode.set(r[CODE_KEY], r);

      // Keep only the متاح stock items, then attach each one's CSV row.
      const joined: JoinedRow[] = stock
        .filter((s) => isAvailable(s.comment))
        .map((s) => ({
          code: s.code,
          name: s.name,
          comment: s.comment,
          csv: csvByCode.get(s.code),
        }));

      setRows(joined);
      setCsvHeaders(
        csv.headers.filter((h) => h !== CODE_KEY && h !== NAME_KEY),
      );
    } catch {
      setError("حدث خطأ أثناء معالجة الملفات. تأكد من صحة ملف Excel وملف CSV.");
      setRows(null);
    } finally {
      setLoading(false);
    }
  }

  // A CSV value for a joined row, given a header key ("" for missing rows).
  const cellValue = (row: JoinedRow, key: string): string => {
    if (key === CODE_KEY) return row.code;
    if (key === NAME_KEY) return row.name;
    return row.csv?.[key] ?? "";
  };

  // CSV columns that carry at least one non-empty value across all shown rows;
  // the rest are hidden so the table isn't a sea of blank columns.
  const visibleCsvHeaders = useMemo(() => {
    if (!rows) return [];
    return csvHeaders.filter((h) => rows.some((r) => (r.csv?.[h] ?? "") !== ""));
  }, [rows, csvHeaders]);

  const matchedCount = useMemo(
    () => (rows ? rows.filter((r) => r.csv).length : 0),
    [rows],
  );

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    let out = matchedOnly ? rows.filter((r) => r.csv) : rows;
    if (q) {
      out = out.filter(
        (r) =>
          r.code.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          visibleCsvHeaders.some((h) =>
            (r.csv?.[h] ?? "").toLowerCase().includes(q),
          ),
      );
    }
    if (sort) {
      const { col, dir } = sort;
      out = [...out].sort((a, b) => {
        const av = cellValue(a, col);
        const bv = cellValue(b, col);
        if (av === "" || bv === "") return av === bv ? 0 : av === "" ? 1 : -1;
        const an = asNumber(av);
        const bn = asNumber(bv);
        const cmp =
          Number.isFinite(an) && Number.isFinite(bn) && av !== "" && bv !== ""
            ? an - bn
            : av.localeCompare(bv, "ar", { numeric: true });
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, sort, matchedOnly, visibleCsvHeaders]);

  const toggleSort = (col: string) =>
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null;
    });

  async function handleDownload() {
    if (!rows) return;
    // Export every column shown in the table: code, item name, then each CSV
    // column. Numeric-looking cells are written as numbers so Excel can sum/sort.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Zaghloul", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = columns.map((c) => ({
      header: c.key === CODE_KEY ? "code" : c.key === NAME_KEY ? "item name" : c.key,
      key: c.key,
      width: c.key === NAME_KEY ? 48 : 14,
    }));
    sheet.getRow(1).font = { bold: true };
    for (const r of filteredRows) {
      const record: Record<string, string | number> = {};
      for (const c of columns) {
        const raw = cellValue(r, c.key);
        const n = asNumber(raw);
        // Keep code/name as text; write other cells as numbers when they parse.
        record[c.key] =
          c.key !== CODE_KEY &&
          c.key !== NAME_KEY &&
          raw !== "" &&
          Number.isFinite(n)
            ? n
            : raw;
      }
      sheet.addRow(record);
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "zaghlol.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  const fileInputClass =
    "block w-full cursor-pointer text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90";

  const columns = [
    { key: CODE_KEY, label: "الكود" },
    { key: NAME_KEY, label: "اسم الصنف" },
    ...visibleCsvHeaders.map((h) => ({ key: h, label: h })),
  ];

  return (
    <div dir="ltr" className="mx-auto w-full max-w-[120rem] space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Zaghlol</h1>
          <p className="text-sm text-muted-foreground">
            Upload the STOCK master (Excel) and the AppSheet CSV. Every item
            marked <span dir="rtl">متاح</span> is matched to its row in the CSV
            by code.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleProcess} disabled={!canProcess || loading}>
            {loading ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
            {loading ? "Processing..." : "Process"}
          </Button>
          {rows && (
            <Button variant="outline" onClick={handleDownload}>
              <Download />
              Download Excel
            </Button>
          )}
        </div>
      </div>

      {/* Upload section */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-border p-4">
          <label className="text-sm font-medium">
            ملف المخزون (Excel: اسم الصنف / الكود / comment)
          </label>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setStockFile(e.target.files?.[0] ?? null)}
            className={fileInputClass}
          />
          {stockFile && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              {stockFile.name}
            </p>
          )}
        </div>
        <div className="space-y-2 rounded-xl border border-border p-4">
          <label className="text-sm font-medium">ملف بيانات الأصناف (CSV)</label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
            className={fileInputClass}
          />
          {csvFile && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              {csvFile.name}
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {rows && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-60 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search all columns…"
                className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            <Button
              size="sm"
              variant={matchedOnly ? "default" : "outline"}
              onClick={() => setMatchedOnly((v) => !v)}
            >
              Matched only ({matchedCount})
            </Button>
            <p className="text-sm text-muted-foreground">
              {filteredRows.length.toLocaleString("en-US")} of{" "}
              {rows.length.toLocaleString("en-US")} متاح items
            </p>
            {(search || matchedOnly) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setMatchedOnly(false);
                }}
              >
                <X /> Clear
              </Button>
            )}
          </div>

          <div className="max-h-[70vh] overflow-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted">
                <tr>
                  {columns.map((col) => {
                    const sorted = sort?.col === col.key;
                    return (
                      <th
                        key={col.key}
                        className="border-b border-border px-2 py-2 text-center font-semibold text-muted-foreground"
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className="flex w-full items-center justify-center gap-1 rounded px-1 py-1 text-xs hover:bg-muted/60 hover:text-foreground"
                          title={`Sort by ${col.label}`}
                        >
                          <span className="whitespace-nowrap">{col.label}</span>
                          {sorted ? (
                            sort!.dir === "asc" ? (
                              <ArrowUp className="size-3.5 shrink-0" />
                            ) : (
                              <ArrowDown className="size-3.5 shrink-0" />
                            )
                          ) : (
                            <ArrowUpDown className="size-3.5 shrink-0 text-muted-foreground/40" />
                          )}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => {
                  const unmatched = !row.csv;
                  return (
                    <tr
                      key={`${row.code}-${idx}`}
                      className={cn(
                        "border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40",
                        unmatched && "bg-red-50/50 dark:bg-red-950/20",
                      )}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className="whitespace-nowrap px-4 py-2.5 text-center align-middle tabular-nums"
                        >
                          {col.key === CODE_KEY && unmatched ? (
                            <span className="inline-flex items-center gap-1.5">
                              {row.code}
                              <span className="rounded-full bg-red-200 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/50 dark:text-red-200">
                                no CSV
                              </span>
                            </span>
                          ) : (
                            cellValue(row, col.key) || (
                              <span className="text-muted-foreground/30">—</span>
                            )
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
