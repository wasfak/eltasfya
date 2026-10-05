"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  FileSpreadsheet,
  Filter,
  Gift,
  HardDrive,
  Loader2,
  PackageX,
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
import { computeReview, bonusPercent } from "@/lib/tasfya/report";
import {
  buildBonusGapWorkbook,
  buildExtraRuleWorkbook,
  buildReviewWorkbook,
} from "@/lib/tasfya/exportExcel";
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
  /**
   * Invoices (keyed `${company}||${invoice}`) that carry a بونص line for ANY
   * item — بونص is an invoice-level term at these suppliers, so a paid line's
   * expected إضافي depends on whether its whole invoice got a بونص, not just its
   * own item. Computed from the full purchase file, across every code.
   */
  bonusInvoices: Set<string>;
}

const EMPTY_INVOICE_SET: Set<string> = new Set();

/** Invoice-level بونص key for a rendered purchase line. */
function bonusInvoiceKey(l: PurchaseDetail): string {
  return `${l.supplier}||${l.invoice}`;
}

/** A row as rendered: an item with only its filter-matching lines kept. */
interface DisplayRow {
  code: string;
  name: string;
  lines: PurchaseDetail[];
  /** بونص recomputed from the visible lines (lines where أساسي = 100%). */
  bonus: number;
  /** Total received quantity across the visible lines (incl. bonus units). */
  received: number;
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

/**
 * Discount rates within this many percentage points of each other are treated
 * as unchanged — a jump like 29.99% → 30% is just rounding noise, not a real
 * change in the deal, so it shouldn't be flagged.
 */
const DISCOUNT_EPSILON = 0.1;

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
    else if (Math.abs(v - prev) <= DISCOUNT_EPSILON) out.push("same");
    else out.push(v > prev ? "up" : "down");
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

/** Stable key identifying one invoice (per supplier + date) within an item. */
function invoiceKey(l: PurchaseDetail): string {
  return `${l.supplier}||${l.invoice}||${l.date}`;
}

/**
 * For an item that receives a بونص on at least one invoice, returns the set of
 * its invoices that brought a paid (non-bonus) line but NO بونص line — i.e. the
 * purchases where the expected free goods are missing. Returns an empty set for
 * items that never get a bonus at all, since there's no established deal to
 * measure a "missing" bonus against.
 */
function missingBonusInvoices(lines: PurchaseDetail[]): Set<string> {
  const byInvoice = new Map<string, { paid: boolean; bonus: boolean }>();
  for (const l of lines) {
    const key = invoiceKey(l);
    const g = byInvoice.get(key) ?? { paid: false, bonus: false };
    if (l.basicPct === 100) g.bonus = true;
    else g.paid = true;
    byInvoice.set(key, g);
  }
  const out = new Set<string>();
  const anyBonus = [...byInvoice.values()].some((g) => g.bonus);
  if (!anyBonus) return out;
  for (const [key, g] of byInvoice) {
    if (g.paid && !g.bonus) out.add(key);
  }
  return out;
}

/**
 * This rule applies only to purchases from رامكو فارم ادويه. Matched on
 * "رامكو فارم" so it excludes the unrelated رامكو للاستيراد والتصدير (and the
 * bare "رامكو"), which follow different deals.
 */
const RAMCO = "رامكو فارم";
function isRamco(supplier: string): boolean {
  return supplier.includes(RAMCO);
}

const near = (a: number, b: number) => Math.abs(a - b) <= DISCOUNT_EPSILON;

/**
 * The إضافي rule (رامكو only). Every paid line from رامكو must be exactly one of:
 *   • إضافي = the standalone rate (5%) — allowed on its own, بونص or not; or
 *   • إضافي = the with-بونص rate (2.5%) AND its invoice carries a بونص — the
 *     reduced rate is only granted alongside the free goods that justify it.
 * ANYTHING else is a violation: the reduced rate with no بونص, or any other
 * إضافي entirely (3%, 1%, 0%, …). `bonusInvoices` holds the invoices (keyed
 * `${company}||${invoice}`) that carry a بونص anywhere.
 */
function isExtraRuleViolation(
  l: PurchaseDetail,
  bonusInvoices: Set<string>,
  standaloneRate: number,
  withBonusRate: number,
): boolean {
  // The standard rate is always fine.
  if (near(l.extraPct, standaloneRate)) return false;
  // The reduced rate is fine only when the invoice actually got a بونص.
  if (near(l.extraPct, withBonusRate) && bonusInvoices.has(bonusInvoiceKey(l)))
    return false;
  // Any other rate — or the reduced rate without a بونص — breaks the rule.
  return true;
}

/** Plain-Arabic reason a رامكو paid line breaks the إضافي rule. */
function extraRuleReason(
  l: PurchaseDetail,
  bonusInvoices: Set<string>,
  standaloneRate: number,
  withBonusRate: number,
): string {
  if (near(l.extraPct, withBonusRate) && !bonusInvoices.has(bonusInvoiceKey(l)))
    return `إضافي ${pct(l.extraPct)} (مخفّض) بدون بونص في الفاتورة`;
  return `إضافي ${pct(l.extraPct)} — المسموح ${pct(standaloneRate)} أو ${pct(
    withBonusRate,
  )} مع بونص`;
}

/** Invoice keys of رامكو paid lines that break the إضافي rule. */
function extraRuleViolations(
  lines: PurchaseDetail[],
  bonusInvoices: Set<string>,
  standaloneRate: number,
  withBonusRate: number,
): Set<string> {
  const out = new Set<string>();
  for (const l of lines) {
    if (l.basicPct === 100) continue; // the بونص line itself, not a paid line
    if (!isRamco(l.supplier)) continue; // rule is رامكو-only
    if (isExtraRuleViolation(l, bonusInvoices, standaloneRate, withBonusRate))
      out.add(invoiceKey(l));
  }
  return out;
}

/** One offending paid line. */
interface ExtraViolationLine {
  line: PurchaseDetail;
}

/** Like {@link extraRuleViolations} but returns the offending paid lines. */
function extraRuleViolationLines(
  lines: PurchaseDetail[],
  bonusInvoices: Set<string>,
  standaloneRate: number,
  withBonusRate: number,
): ExtraViolationLine[] {
  const out: ExtraViolationLine[] = [];
  for (const l of lines) {
    if (l.basicPct === 100) continue;
    if (!isRamco(l.supplier)) continue;
    if (isExtraRuleViolation(l, bonusInvoices, standaloneRate, withBonusRate))
      out.push({ line: l });
  }
  return out;
}

/**
 * Renders one discount column's per-line cells, marking a line that differs
 * from the previous invoice with a ▲ (higher discount) or ▼ (lower discount).
 * A line flagged in `violations` (by index) is tinted red with a ⚠ instead — it
 * breaks the بونص → إضافي rule.
 */
function discountColumn(
  lines: PurchaseDetail[],
  trends: Trend[],
  get: (l: PurchaseDetail) => number,
  violations?: boolean[],
) {
  return (
    <td className="p-0 align-top text-center tabular-nums">
      {lines.map((l, i) => {
        const bad = violations?.[i];
        const up = !bad && trends[i] === "up";
        const down = !bad && trends[i] === "down";
        return (
          <div
            key={i}
            className={cn(
              ENTRY,
              bad && "bg-red-100 dark:bg-red-950/50",
              up && "bg-emerald-50 dark:bg-emerald-950/30",
              down && "bg-red-50 dark:bg-red-950/30",
            )}
          >
            <span
              className={cn(
                "inline-flex items-center gap-1",
                (up || down || bad) && "font-bold",
                up && "text-emerald-700 dark:text-emerald-300",
                down && "text-red-700 dark:text-red-300",
                bad && "text-red-700 dark:text-red-300",
              )}
            >
              {bad && <AlertTriangle className="size-3" />}
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
  // Show only items that received at least one بونص line in the current view.
  const [showBonusOnly, setShowBonusOnly] = useState(false);
  // Show only items that have an invoice missing its expected بونص.
  const [showBonusGaps, setShowBonusGaps] = useState(false);
  // Show only رامكو paid lines that break the إضافي rule (see
  // isExtraRuleViolation). Two configurable rates: the standalone rate that's
  // allowed on its own (5%) and the reduced rate that's only allowed with a
  // بونص (2.5%).
  const [showExtraRule, setShowExtraRule] = useState(false);
  const [extraStandalone, setExtraStandalone] = useState("5");
  const [extraWithBonus, setExtraWithBonus] = useState("2.5");

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
      const received = lines.reduce((sum, l) => sum + l.received, 0);
      out.push({ code: r.code, name: r.name, lines, bonus, received });
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

  // Items that received at least one بونص line among their visible lines.
  const bonusCount = useMemo(
    () => baseRows.reduce((n, r) => n + (r.bonus > 0 ? 1 : 0), 0),
    [baseRows],
  );

  // Items with at least one invoice that's missing its expected بونص.
  const bonusGapCount = useMemo(
    () =>
      baseRows.reduce(
        (n, r) => n + (missingBonusInvoices(r.lines).size > 0 ? 1 : 0),
        0,
      ),
    [baseRows],
  );

  // The two إضافي rates. A blank/invalid input disables the rule (Number("") is
  // 0, so guard the empty string).
  const standaloneRate =
    extraStandalone.trim() === "" ? NaN : Number(extraStandalone);
  const withBonusRate =
    extraWithBonus.trim() === "" ? NaN : Number(extraWithBonus);
  const extraRuleReady =
    Number.isFinite(standaloneRate) && Number.isFinite(withBonusRate);

  // Invoices that carry a بونص for any item (invoice-level term).
  const bonusInvoices = result?.bonusInvoices ?? EMPTY_INVOICE_SET;

  // Items with at least one رامكو line that breaks the إضافي rule.
  const extraRuleCount = useMemo(() => {
    if (!extraRuleReady) return 0;
    return baseRows.reduce(
      (n, r) =>
        n +
        (extraRuleViolations(r.lines, bonusInvoices, standaloneRate, withBonusRate)
          .size > 0
          ? 1
          : 0),
      0,
    );
  }, [baseRows, extraRuleReady, bonusInvoices, standaloneRate, withBonusRate]);

  const showExtraRuleActive = showExtraRule && extraRuleReady;

  const visibleRows = useMemo<DisplayRow[]>(() => {
    let rows = baseRows;
    if (showChangedActive) rows = rows.filter((r) => changedCodes.has(r.code));
    if (showBonusOnly) rows = rows.filter((r) => r.bonus > 0);
    if (showBonusGaps)
      rows = rows.filter((r) => missingBonusInvoices(r.lines).size > 0);
    if (showExtraRuleActive)
      rows = rows.filter(
        (r) =>
          extraRuleViolations(r.lines, bonusInvoices, standaloneRate, withBonusRate)
            .size > 0,
      );
    return rows;
  }, [
    baseRows,
    showChangedActive,
    changedCodes,
    showBonusOnly,
    showBonusGaps,
    showExtraRuleActive,
    bonusInvoices,
    standaloneRate,
    withBonusRate,
  ]);

  const activeFilterCount =
    Object.keys(filters).length +
    (search.trim() ? 1 : 0) +
    (showChangedActive ? 1 : 0) +
    (showBonusOnly ? 1 : 0) +
    (showBonusGaps ? 1 : 0) +
    (showExtraRuleActive ? 1 : 0);

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
    setShowBonusOnly(false);
    setShowBonusGaps(false);
    setShowExtraRule(false);
  };

  // Export every bonus-gap invoice among the currently visible rows: one row per
  // invoice that brought a paid line but no بونص (item, supplier, invoice, date).
  async function downloadBonusGaps() {
    const rows = visibleRows.flatMap((r) => {
      const gaps = missingBonusInvoices(r.lines);
      if (gaps.size === 0) return [];
      const seen = new Set<string>();
      return r.lines
        .filter((l) => gaps.has(invoiceKey(l)) && !seen.has(invoiceKey(l)) && seen.add(invoiceKey(l)))
        .map((l) => ({
          code: r.code,
          name: r.name,
          supplier: l.supplier,
          invoice: l.invoice,
          date: l.date,
        }));
    });
    if (rows.length === 0) return;

    const buffer = await buildBonusGapWorkbook(rows);
    downloadXlsx(buffer, "invoices_without_bonus.xlsx");
  }

  // Export exactly what's on screen (search + column filters + toggles applied):
  // one row per visible item, mirroring the table columns and their per-line
  // breakdown, with missing-بونص rows tinted red.
  async function downloadResults() {
    if (visibleRows.length === 0) return;
    const rows = visibleRows.map((r) => ({
      code: r.code,
      name: r.name,
      bonus: r.bonus,
      received: r.received,
      lines: r.lines,
      gaps: missingBonusInvoices(r.lines),
    }));
    const buffer = await buildReviewWorkbook(rows);
    downloadXlsx(buffer, "review.xlsx");
  }

  // Export every إضافي-rule violation among the visible rows: one row per
  // offending invoice line with code, name, invoice number, supplier, date,
  // whether the invoice had a بونص, the actual إضافي, and a plain reason.
  async function downloadExtraViolations() {
    if (!extraRuleReady) return;
    const rows = visibleRows.flatMap((r) =>
      extraRuleViolationLines(
        r.lines,
        bonusInvoices,
        standaloneRate,
        withBonusRate,
      ).map((v) => ({
        code: r.code,
        name: r.name,
        supplier: v.line.supplier,
        invoice: v.line.invoice,
        date: v.line.date,
        actualExtra: v.line.extraPct,
        reason: extraRuleReason(
          v.line,
          bonusInvoices,
          standaloneRate,
          withBonusRate,
        ),
      })),
    );
    if (rows.length === 0) return;
    const buffer = await buildExtraRuleWorkbook(rows);
    downloadXlsx(buffer, "extra_rule_violations.xlsx");
  }

  function downloadXlsx(buffer: ArrayBuffer, fileName: string) {
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

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

      // بونص is an invoice-level term: collect every invoice (across ALL items,
      // not just the requested codes) that carries a بونص line in the period, so
      // the إضافي rule can tell whether a paid line's whole invoice got a بونص.
      const bonusInvoices = new Set<string>();
      for (const l of purchases) {
        if (
          l.basicPct === 100 &&
          l.date.getTime() >= referenceDate.getTime()
        )
          bonusInvoices.add(`${l.company}||${l.invoice}`);
      }

      setResult({
        rows,
        requested: codes.length,
        missing,
        referenceDate,
        bonusInvoices,
      });
      setSearch("");
      setFilters({});
      setMenu(null);
      setShowChanged(false);
      setShowBonusOnly(false);
      setShowBonusGaps(false);
      setShowExtraRule(false);
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
            <Button
              size="sm"
              variant={showBonusOnly ? "default" : "outline"}
              onClick={() => setShowBonusOnly((v) => !v)}
              disabled={bonusCount === 0}
            >
              <Gift />
              له بونص ({bonusCount})
            </Button>
            <Button
              size="sm"
              variant={showBonusGaps ? "default" : "outline"}
              onClick={() => setShowBonusGaps((v) => !v)}
              disabled={bonusGapCount === 0}
            >
              <PackageX />
              فاتورة بدون بونص ({bonusGapCount})
            </Button>
            <div className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1">
              <Button
                size="sm"
                variant={showExtraRuleActive ? "default" : "outline"}
                onClick={() => setShowExtraRule((v) => !v)}
                disabled={!extraRuleReady || extraRuleCount === 0}
              >
                <AlertTriangle />
                مخالفة إضافي (رامكو) ({extraRuleCount})
              </Button>
              <span className="text-xs text-muted-foreground">رامكو · إضافي</span>
              <input
                type="number"
                step="0.5"
                value={extraStandalone}
                onChange={(e) => setExtraStandalone(e.target.value)}
                className="h-8 w-14 rounded-md border border-border bg-background px-1.5 text-center text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                title="نسبة إضافي المسموحة بمفردها (بدون بونص)"
              />
              <span className="text-xs text-muted-foreground">% أو</span>
              <input
                type="number"
                step="0.5"
                value={extraWithBonus}
                onChange={(e) => setExtraWithBonus(e.target.value)}
                className="h-8 w-14 rounded-md border border-border bg-background px-1.5 text-center text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                title="نسبة إضافي المخفّضة التي يجب أن يصاحبها بونص (رامكو)"
              />
              <span className="text-xs text-muted-foreground">% + بونص</span>
              <Button
                size="sm"
                variant="outline"
                onClick={downloadExtraViolations}
                disabled={!extraRuleReady || extraRuleCount === 0}
                title="تحميل تفاصيل المخالفات (كود، اسم، رقم فاتورة، السبب)"
              >
                <Download />
                تحميل المخالفات
              </Button>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={downloadBonusGaps}
              disabled={bonusGapCount === 0}
            >
              <Download />
              تحميل بدون بونص
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={downloadResults}
              disabled={visibleRows.length === 0}
            >
              <FileSpreadsheet />
              تحميل النتائج ({visibleRows.length})
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
                  <th>بونص</th>
                  <th>% بونص</th>
                  <th>{filterHeader("supplier", "اسم المورد")}</th>
                  <th>كمية الوارد</th>
                  <th>{filterHeader("basicPct", "أساسي %")}</th>
                  <th>إضافي %</th>
                  <th>خاص %</th>
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
                  // Invoices that brought a paid line but no بونص (only for
                  // items that get a bonus elsewhere).
                  const gaps = missingBonusInvoices(row.lines);
                  // Per-line flags for lines breaking the بونص → إضافي rule.
                  const extraViol = extraRuleReady
                    ? extraRuleViolations(
                        row.lines,
                        bonusInvoices,
                        standaloneRate,
                        withBonusRate,
                      )
                    : new Set<string>();
                  const extraFlags = row.lines.map(
                    (l) => l.basicPct !== 100 && extraViol.has(invoiceKey(l)),
                  );
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
                      <td className="px-4 py-3 text-center align-middle font-medium tabular-nums">
                        {row.bonus}
                      </td>
                      <td className="px-4 py-3 text-center align-middle font-medium tabular-nums">
                        {pct(bonusPercent(row.received, row.bonus))}
                      </td>
                      <td className="p-0 align-top text-center">
                        {row.lines.map((l, i) => {
                          const gap = gaps.has(invoiceKey(l));
                          return (
                            <div
                              key={i}
                              className={cn(
                                ENTRY,
                                gap && "bg-red-50 dark:bg-red-950/30",
                              )}
                            >
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 font-medium whitespace-nowrap",
                                  gap && "text-red-700 dark:text-red-300",
                                )}
                              >
                                {gap && (
                                  <PackageX className="size-3 shrink-0" />
                                )}
                                {l.supplier || "—"}
                              </span>
                              <span
                                className={cn(
                                  "text-xs whitespace-nowrap",
                                  gap
                                    ? "text-red-600/80 dark:text-red-400/80"
                                    : "text-muted-foreground",
                                )}
                              >
                                {[l.invoice && `Inv. ${l.invoice}`, l.date]
                                  .filter(Boolean)
                                  .join(" · ")}
                                {gap && " · بدون بونص"}
                              </span>
                            </div>
                          );
                        })}
                      </td>
                      <td className="p-0 align-top text-center tabular-nums">
                        {row.lines.map((l, i) => (
                          <div key={i} className={ENTRY}>
                            {l.received}
                          </div>
                        ))}
                      </td>
                      {discountColumn(row.lines, tBasic, (l) => l.basicPct)}
                      {discountColumn(
                        row.lines,
                        tExtra,
                        (l) => l.extraPct,
                        extraFlags,
                      )}
                      {discountColumn(row.lines, tSpecial, (l) => l.specialPct)}
                    </tr>
                  );
                })}
                {visibleRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
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
