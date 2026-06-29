"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileSpreadsheet,
  Filter,
  HardDrive,
  Loader2,
  Search,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseHtmlTable } from "@/lib/tasfya/parseTable";
import { parsePurchases } from "@/lib/tasfya/purchases";
import { parseStock } from "@/lib/tasfya/stock";
import { computeReview } from "@/lib/tasfya/report";
import {
  savePurchases,
  loadPurchases,
  clearPurchases,
} from "@/lib/tasfya/purchasesCache";
import type { PurchaseDetail, PurchaseLine, ReviewRow } from "@/lib/tasfya/types";

const ENTRY =
  "flex flex-col items-center justify-center text-center min-h-[2.75rem] px-3 border-b border-border/50 last:border-b-0";

interface ReviewResult {
  rows: ReviewRow[];
  /** Codes requested in the Excel sheet. */
  requested: number;
  /** Requested codes that had no purchase activity in the period. */
  missing: string[];
  referenceDate: Date;
}

/** A row as rendered: an item with only its filter-matching lines kept. */
interface DisplayRow {
  code: string;
  name: string;
  lines: PurchaseDetail[];
  /** بونص recomputed from the visible lines (lines where أساسي = 100%). */
  bonus: number;
}

function pct(value: number) {
  if (!value) return "—";
  return `${Number(value.toFixed(2))}%`;
}

type FilterKey = "supplier" | "basicPct";

/**
 * Columns that support an Excel-style filter dropdown. Both render a per-line
 * breakdown, so filtering operates on the individual purchase lines: only the
 * lines whose value is allowed are kept, and an item disappears once none of
 * its lines match.
 */
const FILTER_COLS: {
  key: FilterKey;
  numeric: boolean;
  /** The value a single purchase line contributes to this column's domain. */
  lineValue: (l: PurchaseDetail) => string;
  /** How a raw domain value is shown in the dropdown. */
  format: (v: string) => string;
}[] = [
  {
    key: "supplier",
    numeric: false,
    lineValue: (l) => l.supplier || "",
    format: (v) => (v === "" ? "(Blanks)" : v),
  },
  {
    key: "basicPct",
    numeric: true,
    lineValue: (l) => String(l.basicPct),
    format: (v) => (v === "" ? "(Blanks)" : pct(Number(v))),
  },
];

const FILTER_BY_KEY = Object.fromEntries(
  FILTER_COLS.map((c) => [c.key, c]),
) as Record<FilterKey, (typeof FILTER_COLS)[number]>;

/** A line's discount % compared to the previous invoice for the same item. */
type Trend = "first" | "same" | "up" | "down" | "na";

/** The three discount columns we watch for changes across invoices. */
const DISCOUNT_GETTERS: ((l: PurchaseDetail) => number)[] = [
  (l) => l.basicPct,
  (l) => l.extraPct,
  (l) => l.specialPct,
];

/**
 * Walks an item's invoices (already chronological) and marks, for one discount
 * column, how each line compares to the previous invoice *from the same
 * supplier* — discount rates only make sense to compare within one اسم المورد.
 * بونص lines (أساسي = 100%) are free goods, not a discount rate, so they are
 * skipped and don't reset the baseline.
 */
function trendsFor(
  lines: PurchaseDetail[],
  get: (l: PurchaseDetail) => number,
): Trend[] {
  const out: Trend[] = [];
  const prevBySupplier = new Map<string, number>();
  for (const l of lines) {
    if (l.basicPct === 100) {
      out.push("na");
      continue;
    }
    const key = l.supplier || "";
    const v = get(l);
    const prev = prevBySupplier.get(key);
    if (prev === undefined) out.push("first");
    else out.push(v > prev ? "up" : v < prev ? "down" : "same");
    prevBySupplier.set(key, v);
  }
  return out;
}

/** True when any watched discount changed across an item's invoices. */
function hasDiscountChange(lines: PurchaseDetail[]): boolean {
  return DISCOUNT_GETTERS.some((g) =>
    trendsFor(lines, g).some((t) => t === "up" || t === "down"),
  );
}

/**
 * Renders one discount column's per-line cells, marking a line that differs
 * from the previous invoice with a ▲ (higher discount) or ▼ (lower discount).
 */
function discountColumn(
  lines: PurchaseDetail[],
  trends: Trend[],
  get: (l: PurchaseDetail) => number,
) {
  return (
    <td className="p-0 align-top text-center tabular-nums">
      {lines.map((l, i) => {
        const up = trends[i] === "up";
        const down = trends[i] === "down";
        return (
          <div
            key={i}
            className={cn(
              ENTRY,
              up && "bg-emerald-50 dark:bg-emerald-950/30",
              down && "bg-red-50 dark:bg-red-950/30",
            )}
          >
            <span
              className={cn(
                "inline-flex items-center gap-1",
                (up || down) && "font-bold",
                up && "text-emerald-700 dark:text-emerald-300",
                down && "text-red-700 dark:text-red-300",
              )}
            >
              {up && <ArrowUp className="size-3" />}
              {down && <ArrowDown className="size-3" />}
              {pct(get(l))}
            </span>
          </div>
        );
      })}
    </td>
  );
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

/** Parse an <input type="date"> value ("YYYY-MM-DD") as a local-midnight Date. */
function parseDateInput(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function todayInputValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ReviewPage() {
  const [purchasesFile, setPurchasesFile] = useState<File | null>(null);
  const [codesFile, setCodesFile] = useState<File | null>(null);
  const [refDate, setRefDate] = useState(todayInputValue());
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  // Show only items whose أساسي/إضافي/خاص discount changed across invoices.
  const [showChanged, setShowChanged] = useState(false);

  // Cached purchases from IndexedDB.
  const [cachedPurchases, setCachedPurchases] = useState<{
    fileName: string;
    savedAt: number;
    lines: PurchaseLine[];
  } | null>(null);

  useEffect(() => {
    loadPurchases().then((data) => {
      if (data) setCachedPurchases(data);
    });
  }, []);

  const hasPurchases = !!purchasesFile || !!cachedPurchases;

  // Excel-style per-column filters (اسم المورد / أساسي %).
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [menu, setMenu] = useState<{
    col: FilterKey;
    x: number;
    top: number;
    bottom: number;
  } | null>(null);
  const [valSearch, setValSearch] = useState("");

  // Distinct values per filter column, sorted, for the dropdown.
  const domains = useMemo(() => {
    const map: Record<string, string[]> = {};
    const rows = result?.rows ?? [];
    for (const col of FILTER_COLS) {
      const set = new Set<string>();
      for (const r of rows) for (const l of r.lines) set.add(col.lineValue(l));
      map[col.key] = [...set].sort((a, b) => {
        if (a === "" || b === "") return a === "" ? 1 : -1;
        return col.numeric
          ? Number(a) - Number(b)
          : a.localeCompare(b, "ar", { numeric: true });
      });
    }
    return map;
  }, [result]);

  // Discount comparison is only meaningful within one supplier, so it's gated
  // on the اسم المورد filter being active.
  const supplierFiltered = !!filters.supplier;

  // Rows passing the search + column filters (before the "changed" toggle),
  // each carrying only its filter-matching lines.
  const baseRows = useMemo<DisplayRow[]>(() => {
    if (!result) return [];
    const q = search.trim().toLowerCase();
    const active = Object.entries(filters);

    const out: DisplayRow[] = [];
    for (const r of result.rows) {
      if (
        q &&
        !(
          r.code.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.supplier.toLowerCase().includes(q)
        )
      )
        continue;

      // Keep only the lines that satisfy every active column filter; drop the
      // whole item once nothing is left.
      const lines = r.lines.filter((l) =>
        active.every(([key, allowed]) =>
          allowed.has(FILTER_BY_KEY[key as FilterKey].lineValue(l)),
        ),
      );
      if (lines.length === 0) continue;

      const bonus = lines.reduce(
        (sum, l) => sum + (l.basicPct === 100 ? l.received : 0),
        0,
      );
      out.push({ code: r.code, name: r.name, lines, bonus });
    }
    return out;
  }, [result, search, filters]);

  // Items whose discount changed across invoices of a chosen supplier. Empty
  // until the user filters اسم المورد.
  const changedCodes = useMemo(() => {
    const set = new Set<string>();
    if (!supplierFiltered) return set;
    for (const r of baseRows) {
      if (hasDiscountChange(r.lines)) set.add(r.code);
    }
    return set;
  }, [baseRows, supplierFiltered]);

  const showChangedActive = showChanged && supplierFiltered;

  const visibleRows = useMemo<DisplayRow[]>(() => {
    if (!showChangedActive) return baseRows;
    return baseRows.filter((r) => changedCodes.has(r.code));
  }, [baseRows, showChangedActive, changedCodes]);

  const activeFilterCount =
    Object.keys(filters).length +
    (search.trim() ? 1 : 0) +
    (showChangedActive ? 1 : 0);

  // ---- Filter helpers (Excel-style dropdown) ----
  const setColumnFilter = (
    col: FilterKey,
    mutate: (allowed: Set<string>) => void,
  ) => {
    setFilters((prev) => {
      const allowed = prev[col] ? new Set(prev[col]) : new Set(domains[col]);
      mutate(allowed);
      const next = { ...prev };
      if (allowed.size === domains[col].length) delete next[col];
      else next[col] = allowed;
      return next;
    });
  };

  const toggleValue = (col: FilterKey, value: string) =>
    setColumnFilter(col, (allowed) => {
      if (allowed.has(value)) allowed.delete(value);
      else allowed.add(value);
    });

  const setAllValues = (col: FilterKey, values: string[], checked: boolean) =>
    setColumnFilter(col, (allowed) => {
      for (const v of values) {
        if (checked) allowed.add(v);
        else allowed.delete(v);
      }
    });

  const clearColumn = (col: FilterKey) => {
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
    setShowChanged(false);
  };

  // Close the dropdown on outside click / escape / scroll.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-col-filter]"))
        setMenu(null);
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

  // Excel-style cross-filtering: the open dropdown only lists values that still
  // exist in the lines passing every OTHER active filter, so deselecting a value
  // in one column removes it from the other column's list (and from the view).
  const menuDomain = useMemo(() => {
    if (!menu || !result) return [];
    const col = FILTER_BY_KEY[menu.col];
    const others = Object.entries(filters).filter(([k]) => k !== menu.col);
    const set = new Set<string>();
    for (const r of result.rows) {
      for (const l of r.lines) {
        const ok = others.every(([k, allowed]) =>
          allowed.has(FILTER_BY_KEY[k as FilterKey].lineValue(l)),
        );
        if (ok) set.add(col.lineValue(l));
      }
    }
    return [...set].sort((a, b) => {
      if (a === "" || b === "") return a === "" ? 1 : -1;
      return col.numeric
        ? Number(a) - Number(b)
        : a.localeCompare(b, "ar", { numeric: true });
    });
  }, [menu, result, filters]);

  const menuValues = useMemo(() => {
    if (!menu) return [];
    const q = valSearch.trim().toLowerCase();
    if (!q) return menuDomain;
    return menuDomain.filter((v) =>
      FILTER_BY_KEY[menu.col].format(v).toLowerCase().includes(q),
    );
  }, [menu, valSearch, menuDomain]);

  const menuAllChecked =
    menu &&
    menuValues.every((v) => !filters[menu.col] || filters[menu.col].has(v));

  async function handleProcess() {
    if (!hasPurchases || !codesFile) return;
    setLoading(true);
    setError(null);
    try {
      let purchases: PurchaseLine[];

      if (purchasesFile) {
        const purchasesHtml = await readFileAsText(purchasesFile);
        purchases = parsePurchases(parseHtmlTable(purchasesHtml));
        await savePurchases(purchasesFile.name, purchases);
        setCachedPurchases({
          fileName: purchasesFile.name,
          savedAt: Date.now(),
          lines: purchases,
        });
      } else {
        purchases = cachedPurchases!.lines;
      }

      const codesHtml = await readFileAsText(codesFile);
      const stock = parseStock(parseHtmlTable(codesHtml));
      const codes = [...stock.codes];

      if (codes.length === 0) {
        setError(
          "لم يتم العثور على أكواد في ملف رصيد المخزن. تأكد من أنه ملف SofTech صحيح.",
        );
        setResult(null);
        return;
      }

      const referenceDate = parseDateInput(refDate);
      const codeSet = new Set(codes);
      const rows = computeReview(purchases, referenceDate, codeSet);

      const found = new Set(rows.map((r) => r.code));
      const missing = codes.filter((c) => !found.has(c));

      setResult({
        rows,
        requested: codes.length,
        missing,
        referenceDate,
      });
      setSearch("");
      setFilters({});
      setMenu(null);
      setShowChanged(false);
    } catch {
      setError(
        "حدث خطأ أثناء معالجة الملفات. تأكد من أنها ملفات SofTech صحيحة (HTML).",
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const fileInputClass =
    "block w-full cursor-pointer text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90";

  /** Renders a column header with an Excel-style filter button. */
  const filterHeader = (colKey: FilterKey, label: string) => {
    const filtered = !!filters[colKey];
    return (
      <div
        data-col-filter
        className="flex items-center justify-center gap-1"
      >
        <span className="whitespace-nowrap">{label}</span>
        <button
          type="button"
          aria-label={`Filter ${label}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setValSearch("");
            setMenu((m) =>
              m?.col === colKey
                ? null
                : {
                    col: colKey,
                    x: Math.min(r.left, window.innerWidth - 290),
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
          <Filter className={cn("size-3.5", filtered && "fill-primary/20")} />
        </button>
      </div>
    );
  };

  return (
    <div dir="ltr" className="mx-auto w-full max-w-[120rem] space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Purchase Review by Codes
          </h1>
          <p className="text-sm text-muted-foreground">
            Upload the purchase-invoices file and the supplier stock file to
            review the purchase activity for that supplier&apos;s codes only.
          </p>
        </div>
        <Button
          onClick={handleProcess}
          disabled={!hasPurchases || !codesFile || loading}
        >
          {loading ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
          {loading ? "Processing..." : "Process"}
        </Button>
      </div>

      {/* Upload section — labels kept in Arabic */}
      <div className="grid gap-4 sm:grid-cols-3">
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
          {!purchasesFile && cachedPurchases && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-1.5 text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
              <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                <HardDrive className="size-3.5" />
                محفوظ: {cachedPurchases.fileName}
                <span className="text-emerald-600/70 dark:text-emerald-400/70">
                  ({new Date(cachedPurchases.savedAt).toLocaleDateString("ar-EG")})
                </span>
              </span>
              <button
                type="button"
                onClick={async () => {
                  await clearPurchases();
                  setCachedPurchases(null);
                }}
                className="rounded p-0.5 text-emerald-600 hover:bg-emerald-100 hover:text-red-600 dark:text-emerald-400 dark:hover:bg-emerald-900 dark:hover:text-red-400"
                title="حذف الملف المحفوظ"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          )}
        </div>
        <div className="space-y-2 rounded-xl border border-border p-4">
          <label className="text-sm font-medium">
            ملف رصيد المخزن للمورد (HTML) — لأخذ الأكواد
          </label>
          <input
            type="file"
            accept=".html,.htm"
            onChange={(e) => setCodesFile(e.target.files?.[0] ?? null)}
            className={fileInputClass}
          />
        </div>
        <div className="space-y-2 rounded-xl border border-border p-4">
          <label className="text-sm font-medium">التاريخ المرجعي</label>
          <input
            type="date"
            value={refDate}
            onChange={(e) => setRefDate(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            تُحتسب فواتير الشراء اعتبارًا من هذا التاريخ (قاعدة 100 يوم).
          </p>
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
            <span>
              Ref. Date: {result.referenceDate.toLocaleDateString("en-US")}
            </span>
            <span>·</span>
            <span>Codes requested: {result.requested}</span>
            <span>·</span>
            <span>Matched: {result.rows.length}</span>
            {result.missing.length > 0 && (
              <>
                <span>·</span>
                <span>No purchases: {result.missing.length}</span>
              </>
            )}
          </div>

          {result.missing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              Codes with no purchases in this period:{" "}
              <span className="font-medium tabular-nums">
                {result.missing.join("، ")}
              </span>
            </div>
          )}

          {/* Quick filter: items whose discount changed across a supplier's
              invoices. Only meaningful once اسم المورد is filtered. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={showChangedActive ? "default" : "outline"}
              onClick={() => setShowChanged((v) => !v)}
              disabled={!supplierFiltered || changedCodes.size === 0}
            >
              <TrendingUp />
              تغيّر الخصم ({changedCodes.size})
            </Button>
            <span className="text-xs text-muted-foreground">
              {supplierFiltered
                ? "Items where أساسي / إضافي / خاص % differs between that supplier's invoices."
                : "Filter اسم المورد first to compare discount changes per supplier."}
            </span>
          </div>

          {/* Toolbar: global search + row count */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-60 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code / name / supplier…"
                className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {visibleRows.length.toLocaleString("en-US")} of{" "}
              {result.rows.length.toLocaleString("en-US")} rows
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
                <tr className="[&>th]:border-b [&>th]:border-border [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-center [&>th]:text-xs [&>th]:font-semibold [&>th]:text-muted-foreground">
                  <th>كود الصنف</th>
                  <th>اسم الصنف</th>
                  <th>{filterHeader("supplier", "اسم المورد")}</th>
                  <th>كمية الوارد</th>
                  <th>{filterHeader("basicPct", "أساسي %")}</th>
                  <th>إضافي %</th>
                  <th>خاص %</th>
                  <th>بونص</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  // Discount trends are only computed once a supplier is
                  // chosen — otherwise lines from different suppliers would be
                  // compared against each other.
                  const tBasic = supplierFiltered
                    ? trendsFor(row.lines, (l) => l.basicPct)
                    : [];
                  const tExtra = supplierFiltered
                    ? trendsFor(row.lines, (l) => l.extraPct)
                    : [];
                  const tSpecial = supplierFiltered
                    ? trendsFor(row.lines, (l) => l.specialPct)
                    : [];
                  const changed = changedCodes.has(row.code);
                  return (
                    <tr
                      key={row.code}
                      className="border-b border-border/50 transition-colors last:border-0 hover:bg-muted/40"
                    >
                      <td
                        className={cn(
                          "px-4 py-3 text-center align-middle font-medium tabular-nums",
                          changed && "border-s-4 border-s-amber-400",
                        )}
                      >
                        {row.code}
                      </td>
                      <td className="px-4 py-3 text-center align-middle">
                        <span>{row.name}</span>
                        {changed && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                            <TrendingUp className="size-3" />
                            تغيّر الخصم
                          </span>
                        )}
                      </td>
                      <td className="p-0 align-top text-center">
                        {row.lines.map((l, i) => (
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
                        ))}
                      </td>
                      <td className="p-0 align-top text-center tabular-nums">
                        {row.lines.map((l, i) => (
                          <div key={i} className={ENTRY}>
                            {l.received}
                          </div>
                        ))}
                      </td>
                      {discountColumn(row.lines, tBasic, (l) => l.basicPct)}
                      {discountColumn(row.lines, tExtra, (l) => l.extraPct)}
                      {discountColumn(row.lines, tSpecial, (l) => l.specialPct)}
                      <td className="px-4 py-3 text-center align-middle font-medium tabular-nums">
                        {row.bonus}
                      </td>
                    </tr>
                  );
                })}
                {visibleRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-10 text-center text-muted-foreground"
                    >
                      No rows match the current search / filters.
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
          const maxHeight = Math.max(
            180,
            (openUp ? spaceAbove : spaceBelow) - 16,
          );
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
                  : {
                      position: "fixed",
                      top: menu.bottom + 4,
                      left: menu.x,
                      maxHeight,
                    }
              }
              className="z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-card p-2 text-sm shadow-xl"
            >
              <div className="relative">
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
                  onChange={(e) =>
                    setAllValues(menu.col, menuValues, e.target.checked)
                  }
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
                  const checked =
                    !filters[menu.col] || filters[menu.col].has(v);
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
                        title={FILTER_BY_KEY[menu.col].format(v)}
                      >
                        {FILTER_BY_KEY[menu.col].format(v)}
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
