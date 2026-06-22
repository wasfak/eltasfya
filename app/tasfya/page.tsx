"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Download,
  FileSpreadsheet,
  Filter,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseHtmlTable } from "@/lib/tasfya/parseTable";
import { parseOrder } from "@/lib/tasfya/order";
import { parsePurchases } from "@/lib/tasfya/purchases";
import { parseStock } from "@/lib/tasfya/stock";
import { computeReport } from "@/lib/tasfya/report";
import { buildWorkbook } from "@/lib/tasfya/exportExcel";
import type { ReportRow, TasfyaResult } from "@/lib/tasfya/types";

type CombinedRow = ReportRow & { isExtra: boolean };

type SortDir = "asc" | "desc";
type ColKey =
  | "code"
  | "name"
  | "status"
  | "order"
  | "supplier"
  | "received"
  | "basicPct"
  | "extraPct"
  | "specialPct"
  | "bonus"
  | "tasfya";

const ENTRY =
  "flex flex-col items-center justify-center text-center min-h-[2.75rem] px-3 border-b border-border/50 last:border-b-0";

type SettleCat = "zero" | "pos" | "neg";

/** Settlement category: لم يصل (< 0), وصل (= 0), زياده (> 0). */
function settleCat(tasfya: number): SettleCat {
  if (tasfya < 0) return "neg";
  if (tasfya === 0) return "zero";
  return "pos";
}

const SETTLE_BUTTONS: { key: SettleCat; label: string }[] = [
  { key: "zero", label: "وصل" },
  { key: "pos", label: "زياده" },
  { key: "neg", label: "لم يصل" },
];

function rowClass(tasfya: number) {
  if (tasfya < 0) return "bg-red-50/40 dark:bg-red-950/20";
  if (tasfya === 0) return "bg-emerald-50/40 dark:bg-emerald-950/20";
  return "bg-amber-50/40 dark:bg-amber-950/20";
}

function accentClass(tasfya: number) {
  if (tasfya < 0) return "border-s-red-500";
  if (tasfya === 0) return "border-s-emerald-500";
  return "border-s-amber-400";
}

function tasfyaPillClass(tasfya: number) {
  if (tasfya < 0)
    return "border-red-200 bg-red-50 text-red-700 focus:ring-red-400/40 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";
  if (tasfya === 0)
    return "border-emerald-200 bg-emerald-50 text-emerald-700 focus:ring-emerald-400/40 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
  return "border-amber-200 bg-amber-50 text-amber-700 focus:ring-amber-400/40 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
}

/** Per-column metadata: how to read, sort and filter each column. */
const COLUMNS: {
  key: ColKey;
  label: string;
  numeric: boolean;
  value: (r: CombinedRow) => string;
}[] = [
  { key: "code", label: "كود الصنف", numeric: false, value: (r) => r.code },
  { key: "name", label: "اسم الصنف", numeric: false, value: (r) => r.name },
  {
    key: "status",
    label: "الحالة",
    numeric: false,
    value: (r) => (r.isExtra ? "زائد" : "مطلوب"),
  },
  {
    key: "order",
    label: "الكمية المطلوبة",
    numeric: true,
    value: (r) => (r.isExtra ? "" : String(r.order)),
  },
  {
    key: "tasfya",
    label: "التسوية",
    numeric: true,
    value: (r) => String(r.tasfya),
  },
  {
    key: "supplier",
    label: "اسم المورد",
    numeric: false,
    value: (r) =>
      r.supplier ||
      r.lines
        .map((l) => l.supplier)
        .filter(Boolean)
        .join(", "),
  },
  {
    key: "received",
    label: "كمية الوارد",
    numeric: true,
    value: (r) => String(r.received),
  },
  {
    key: "basicPct",
    label: "أساسي %",
    numeric: true,
    value: (r) => String(r.basicPct),
  },
  {
    key: "extraPct",
    label: "إضافي %",
    numeric: true,
    value: (r) => String(r.extraPct),
  },
  {
    key: "specialPct",
    label: "خاص %",
    numeric: true,
    value: (r) => String(r.specialPct),
  },
  { key: "bonus", label: "بونص", numeric: true, value: (r) => String(r.bonus) },
];

const COL_BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c])) as Record<
  ColKey,
  (typeof COLUMNS)[number]
>;

function pct(value: number) {
  if (!value) return "—";
  return `${Number(value.toFixed(2))}%`;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

export default function TasfyaPage() {
  const [orderFile, setOrderFile] = useState<File | null>(null);
  const [stockFile, setStockFile] = useState<File | null>(null);
  const [purchasesFile, setPurchasesFile] = useState<File | null>(null);
  const [result, setResult] = useState<TasfyaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Excel-style table state.
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [sort, setSort] = useState<{ col: ColKey; dir: SortDir } | null>(null);
  const [menu, setMenu] = useState<{
    col: ColKey;
    x: number;
    top: number;
    bottom: number;
  } | null>(null);
  const [valSearch, setValSearch] = useState("");
  // Quick settlement filter (وصل / زياده / لم يصل). Empty = show all.
  const [settle, setSettle] = useState<Set<SettleCat>>(new Set());

  // Per-item settlement overrides, keyed by code, kept as raw strings.
  const [edits, setEdits] = useState<Record<string, string>>({});

  function effectiveTasfya(code: string, base: number) {
    const raw = edits[code];
    if (raw === undefined) return base;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  // Ordered + over-order items merged into one list, with the user's overrides.
  const allRows = useMemo<CombinedRow[]>(() => {
    if (!result) return [];
    return [
      ...result.report.map((r) => ({ ...r, isExtra: false })),
      ...result.extraItems.map((e) => ({
        ...e,
        order: 0,
        tasfya: e.received - e.bonus,
        isExtra: true,
      })),
    ].map((r) => ({ ...r, tasfya: effectiveTasfya(r.code, r.tasfya) }));
    // effectiveTasfya reads `edits`, the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, edits]);

  // Distinct values per column, sorted, for the Excel-style filter dropdown.
  const domains = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of COLUMNS) {
      const set = new Set<string>();
      for (const row of allRows) set.add(col.value(row));
      map[col.key] = [...set].sort((a, b) => {
        if (a === "" || b === "") return a === "" ? 1 : -1;
        return col.numeric
          ? Number(a) - Number(b)
          : a.localeCompare(b, "ar", { numeric: true });
      });
    }
    return map;
  }, [allRows]);

  // Rows passing the global search + Excel column filters (before settlement
  // filter / sort) — used both for the وصل/زياده/لم يصل counts and downstream.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const active = Object.entries(filters);

    return allRows.filter((row) => {
      if (q && !COLUMNS.some((c) => c.value(row).toLowerCase().includes(q)))
        return false;
      for (const [key, allowed] of active) {
        if (!allowed.has(COL_BY_KEY[key as ColKey].value(row))) return false;
      }
      return true;
    });
  }, [allRows, search, filters]);

  const settleCounts = useMemo(() => {
    const c = { zero: 0, pos: 0, neg: 0 };
    for (const r of filteredRows) c[settleCat(r.tasfya)]++;
    return c;
  }, [filteredRows]);

  const visibleRows = useMemo(() => {
    let out =
      settle.size === 0
        ? filteredRows
        : filteredRows.filter((r) => settle.has(settleCat(r.tasfya)));

    if (sort) {
      const col = COL_BY_KEY[sort.col];
      out = [...out].sort((a, b) => {
        const av = col.value(a);
        const bv = col.value(b);
        if (av === "" || bv === "") return av === bv ? 0 : av === "" ? 1 : -1;
        const cmp = col.numeric
          ? Number(av) - Number(bv)
          : av.localeCompare(bv, "ar", { numeric: true, sensitivity: "base" });
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [filteredRows, settle, sort]);

  const activeFilterCount =
    Object.keys(filters).length + (search.trim() ? 1 : 0) + settle.size;

  const toggleSettle = (key: SettleCat) =>
    setSettle((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ---- Filter helpers (Excel-style dropdown) ----
  const setColumnFilter = (col: ColKey, mutate: (allowed: Set<string>) => void) => {
    setFilters((prev) => {
      const allowed = prev[col] ? new Set(prev[col]) : new Set(domains[col]);
      mutate(allowed);
      const next = { ...prev };
      if (allowed.size === domains[col].length) delete next[col];
      else next[col] = allowed;
      return next;
    });
  };

  const toggleValue = (col: ColKey, value: string) =>
    setColumnFilter(col, (allowed) => {
      if (allowed.has(value)) allowed.delete(value);
      else allowed.add(value);
    });

  const setAllValues = (col: ColKey, values: string[], checked: boolean) =>
    setColumnFilter(col, (allowed) => {
      for (const v of values) checked ? allowed.add(v) : allowed.delete(v);
    });

  const clearColumn = (col: ColKey) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
    setMenu(null);
  };

  const clearAll = () => {
    setSearch("");
    setFilters({});
    setSettle(new Set());
  };

  const toggleSort = (col: ColKey) => {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  };

  // Close the dropdown on outside click / escape / scroll.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-col-filter]")) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const onScroll = () => setMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menu]);

  const fmt = (col: ColKey, v: string) =>
    v === ""
      ? "(Blanks)"
      : COL_BY_KEY[col].numeric
        ? Number(v).toLocaleString("en-US")
        : v;

  const menuValues = useMemo(() => {
    if (!menu) return [];
    const q = valSearch.trim().toLowerCase();
    if (!q) return domains[menu.col];
    return domains[menu.col].filter((v) =>
      fmt(menu.col, v).toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, valSearch, domains]);

  const menuAllChecked =
    menu &&
    menuValues.every((v) => !filters[menu.col] || filters[menu.col].has(v));

  async function handleProcess() {
    if (!orderFile || !stockFile || !purchasesFile) return;
    setLoading(true);
    setError(null);
    try {
      const [orderHtml, stockHtml, purchasesHtml] = await Promise.all([
        readFileAsText(orderFile),
        readFileAsText(stockFile),
        readFileAsText(purchasesFile),
      ]);

      const order = parseOrder(parseHtmlTable(orderHtml));
      const stock = parseStock(parseHtmlTable(stockHtml));
      const purchases = parsePurchases(parseHtmlTable(purchasesHtml));
      setResult(computeReport(order, purchases, stock));
      setEdits({});
      clearAll();
      setSort(null);
    } catch {
      setError(
        "حدث خطأ أثناء معالجة الملفات. تأكد من أنها ملفات SofTech صحيحة.",
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload() {
    if (!result) return;
    // Export exactly what's on screen: the rows passing the current search,
    // column filters and settlement filter, in their current sort order,
    // with the user's settlement edits already applied.
    const report = visibleRows.filter((r) => !r.isExtra);
    const extra = visibleRows.filter((r) => r.isExtra);
    const buffer = await buildWorkbook(report, extra);
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tasfya-${result.orderNumber || "report"}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const fileInputClass =
    "block w-full cursor-pointer text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90";

  return (
    <div dir="ltr" className="mx-auto w-full max-w-[120rem] space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Purchase Order Settlement Report
          </h1>
          <p className="text-sm text-muted-foreground">
            Upload the purchase order, supplier stock, and purchase invoices
            files to generate the settlement report.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleProcess}
            disabled={!orderFile || !stockFile || !purchasesFile || loading}
          >
            {loading ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
            {loading ? "Processing..." : "Process"}
          </Button>
          {result && (
            <Button variant="outline" onClick={handleDownload}>
              <Download />
              Download Excel
            </Button>
          )}
        </div>
      </div>

      {/* Upload section — kept in Arabic as requested */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2 rounded-xl border border-border p-4">
          <label className="text-sm font-medium">ملف أمر التوريد (HTML)</label>
          <input
            type="file"
            accept=".html,.htm"
            onChange={(e) => setOrderFile(e.target.files?.[0] ?? null)}
            className={fileInputClass}
          />
        </div>
        <div className="space-y-2 rounded-xl border border-border p-4">
          <label className="text-sm font-medium">
            ملف رصيد المخزن للمورد (HTML)
          </label>
          <input
            type="file"
            accept=".html,.htm"
            onChange={(e) => setStockFile(e.target.files?.[0] ?? null)}
            className={fileInputClass}
          />
        </div>
        <div className="space-y-2 rounded-xl border border-border p-4">
          <label className="text-sm font-medium">
            ملف سجل فواتير شراء الأصناف (HTML)
          </label>
          <input
            type="file"
            accept=".html,.htm"
            onChange={(e) => setPurchasesFile(e.target.files?.[0] ?? null)}
            className={fileInputClass}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>Supplier: {result.supplierCompany || "—"}</span>
            <span>·</span>
            <span>Order #: {result.orderNumber}</span>
            <span>·</span>
            <span>
              Ref. Date: {result.referenceDate.toLocaleDateString("en-US")}
            </span>
            <span>·</span>
            <span>Total Items: {allRows.length}</span>
            <span>·</span>
            <span>Over-order: {result.extraItems.length}</span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-red-500" />
              Settlement &lt; 0 (Shortage)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-emerald-500" />
              Settlement = 0 (Matched)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-amber-400" />
              Settlement &gt; 0 (Surplus)
            </span>
          </div>

          {/* Quick settlement filters: وصل / زياده / لم يصل */}
          <div className="flex flex-wrap items-center gap-2">
            {SETTLE_BUTTONS.map((b) => (
              <Button
                key={b.key}
                size="sm"
                variant={settle.has(b.key) ? "default" : "outline"}
                onClick={() => toggleSettle(b.key)}
              >
                {b.label} ({settleCounts[b.key]})
              </Button>
            ))}
          </div>

          {/* Toolbar: global search + row count + clear all */}
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
            <p className="text-sm text-muted-foreground">
              {visibleRows.length.toLocaleString("en-US")} of{" "}
              {allRows.length.toLocaleString("en-US")} rows
            </p>
            {activeFilterCount > 0 && (
              <Button variant="outline" size="sm" onClick={clearAll}>
                <X /> Clear all ({activeFilterCount})
              </Button>
            )}
          </div>

          <div className="max-h-[70vh] overflow-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted">
                <tr>
                  {COLUMNS.map((col) => {
                    const sorted = sort?.col === col.key;
                    const filtered = !!filters[col.key];
                    return (
                      <th
                        key={col.key}
                        className="border-b border-border text-center font-semibold text-muted-foreground"
                      >
                        <div
                          data-col-filter
                          className="flex items-center justify-between gap-1 px-2 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-1 py-1 text-xs hover:bg-muted/60 hover:text-foreground"
                            title={`Sort by ${col.label}`}
                          >
                            <span className="truncate whitespace-nowrap">
                              {col.label}
                            </span>
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
                          <button
                            type="button"
                            aria-label={`Filter ${col.label}`}
                            onClick={(e) => {
                              const r =
                                e.currentTarget.getBoundingClientRect();
                              setValSearch("");
                              setMenu((m) =>
                                m?.col === col.key
                                  ? null
                                  : {
                                      col: col.key,
                                      x: Math.min(
                                        r.left,
                                        window.innerWidth - 290,
                                      ),
                                      top: r.top,
                                      bottom: r.bottom,
                                    },
                              );
                            }}
                            className={cn(
                              "grid size-6 shrink-0 place-items-center rounded hover:bg-muted",
                              filtered && "text-primary",
                            )}
                          >
                            <Filter
                              className={cn(
                                "size-3.5",
                                filtered && "fill-primary/20",
                              )}
                            />
                          </button>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.code}
                    className={cn(
                      "border-b border-border/50 transition-colors last:border-0 hover:bg-muted/40",
                      rowClass(row.tasfya),
                    )}
                  >
                    <td
                      className={cn(
                        "border-s-4 px-4 py-3 text-center align-middle font-medium tabular-nums",
                        accentClass(row.tasfya),
                      )}
                    >
                      {row.code}
                    </td>
                    <td className="px-4 py-3 text-center align-middle">
                      {row.name}
                    </td>
                    <td className="px-4 py-3 text-center align-middle">
                      {row.isExtra ? (
                        <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                          زائد
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                          مطلوب
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center align-middle tabular-nums">
                      {row.isExtra ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        row.order
                      )}
                    </td>
                    <td className="px-4 py-3 text-center align-middle">
                      <input
                        type="number"
                        value={edits[row.code] ?? String(row.tasfya)}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [row.code]: e.target.value,
                          }))
                        }
                        className={cn(
                          "w-20 rounded-full border px-3 py-1.5 text-center font-bold tabular-nums outline-none transition focus:ring-2",
                          tasfyaPillClass(row.tasfya),
                        )}
                        aria-label={`Edit settlement for item ${row.code}`}
                      />
                    </td>
                    <td className="p-0 align-top text-center">
                      {row.lines.length === 0 ? (
                        <div className={ENTRY}>
                          <span className="text-muted-foreground/40">—</span>
                        </div>
                      ) : (
                        row.lines.map((l, i) => (
                          <div key={i} className={ENTRY}>
                            <span className="font-medium whitespace-nowrap">
                              {l.supplier || "—"}
                            </span>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {[l.invoice && `Inv. ${l.invoice}`, l.date]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </div>
                        ))
                      )}
                    </td>
                    <td className="p-0 align-top text-center tabular-nums">
                      {row.lines.length === 0 ? (
                        <div className={ENTRY}>{row.received}</div>
                      ) : (
                        row.lines.map((l, i) => (
                          <div key={i} className={ENTRY}>
                            {l.received}
                          </div>
                        ))
                      )}
                    </td>
                    <td className="p-0 align-top text-center tabular-nums">
                      {row.lines.length === 0 ? (
                        <div className={ENTRY}>{pct(row.basicPct)}</div>
                      ) : (
                        row.lines.map((l, i) => (
                          <div key={i} className={ENTRY}>
                            {pct(l.basicPct)}
                          </div>
                        ))
                      )}
                    </td>
                    <td className="p-0 align-top text-center tabular-nums">
                      {row.lines.length === 0 ? (
                        <div className={ENTRY}>{pct(row.extraPct)}</div>
                      ) : (
                        row.lines.map((l, i) => (
                          <div key={i} className={ENTRY}>
                            {pct(l.extraPct)}
                          </div>
                        ))
                      )}
                    </td>
                    <td className="p-0 align-top text-center tabular-nums">
                      {row.lines.length === 0 ? (
                        <div className={ENTRY}>{pct(row.specialPct)}</div>
                      ) : (
                        row.lines.map((l, i) => (
                          <div key={i} className={ENTRY}>
                            {pct(l.specialPct)}
                          </div>
                        ))
                      )}
                    </td>
                    <td className="px-4 py-3 text-center align-middle font-medium tabular-nums">
                      {row.bonus}
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={COLUMNS.length}
                      className="px-3 py-10 text-center text-muted-foreground"
                    >
                      No rows match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Excel-style filter dropdown */}
      {menu &&
        (() => {
          const spaceBelow = window.innerHeight - menu.bottom;
          const spaceAbove = menu.top;
          const openUp = spaceBelow < 320 && spaceAbove > spaceBelow;
          const maxHeight = Math.max(180, (openUp ? spaceAbove : spaceBelow) - 16);
          return (
        <div
          data-col-filter
          style={
            openUp
              ? {
                  position: "fixed",
                  bottom: window.innerHeight - menu.top + 4,
                  left: menu.x,
                  maxHeight,
                }
              : { position: "fixed", top: menu.bottom + 4, left: menu.x, maxHeight }
          }
          className="z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-card p-2 text-sm shadow-xl"
        >
          <div className="flex gap-1 pb-2">
            <button
              type="button"
              onClick={() => {
                setSort({ col: menu.col, dir: "asc" });
                setMenu(null);
              }}
              className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <ArrowUp className="size-3.5" /> Sort ascending
            </button>
            <button
              type="button"
              onClick={() => {
                setSort({ col: menu.col, dir: "desc" });
                setMenu(null);
              }}
              className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <ArrowDown className="size-3.5" /> Sort descending
            </button>
          </div>

          <div className="-mx-2 border-t border-border" />

          <div className="relative pt-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={valSearch}
              onChange={(e) => setValSearch(e.target.value)}
              placeholder="Search values…"
              className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>

          <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-medium hover:bg-muted">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={!!menuAllChecked}
              ref={(el) => {
                if (el)
                  el.indeterminate =
                    !menuAllChecked &&
                    menuValues.some(
                      (v) => !filters[menu.col] || filters[menu.col].has(v),
                    );
              }}
              onChange={(e) => setAllValues(menu.col, menuValues, e.target.checked)}
            />
            <span>(Select all{valSearch ? " in search" : ""})</span>
          </label>

          <div className="min-h-0 flex-1 overflow-auto py-1">
            {menuValues.length === 0 && (
              <p className="px-2 py-3 text-center text-muted-foreground">
                No matching values.
              </p>
            )}
            {menuValues.map((v) => {
              const checked = !filters[menu.col] || filters[menu.col].has(v);
              return (
                <label
                  key={v}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={checked}
                    onChange={() => toggleValue(menu.col, v)}
                  />
                  <span
                    className={cn(
                      "truncate",
                      v === "" && "text-muted-foreground italic",
                    )}
                    title={fmt(menu.col, v)}
                  >
                    {fmt(menu.col, v)}
                  </span>
                </label>
              );
            })}
          </div>

          <div className="-mx-2 border-t border-border" />

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => clearColumn(menu.col)}
              disabled={!filters[menu.col]}
            >
              Clear filter
            </Button>
            <Button size="sm" onClick={() => setMenu(null)}>
              <Check /> Done
            </Button>
          </div>
        </div>
          );
        })()}
    </div>
  );
}
