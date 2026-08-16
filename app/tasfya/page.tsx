"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Filter,
  History,
  Loader2,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseHtmlTable } from "@/lib/tasfya/parseTable";
import { parseOrder } from "@/lib/tasfya/order";
import { parsePurchases } from "@/lib/tasfya/purchases";
import { parseStock } from "@/lib/tasfya/stock";
import {
  parseCosmoCsv,
  type CosmoData,
  type CosmoRow,
} from "@/lib/tasfya/cosmo";
import { bonusPercent, computeReport } from "@/lib/tasfya/report";
import { buildSimpleWorkbook } from "@/lib/tasfya/exportExcel";
import {
  parseOrderExcel,
  readFileAsArrayBuffer,
} from "@/lib/tasfya/orderExcel";
import { ProjectBar } from "@/components/tasfya/project-bar";
import type {
  OrderData,
  PurchaseLine,
  ReportRow,
  StockData,
  TasfyaResult,
} from "@/lib/tasfya/types";

type CombinedRow = ReportRow & {
  isExtra: boolean;
  // Matching AppSheet CSV row (by code), present only in Cosmo mode.
  cosmo?: CosmoRow;
};

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
  | "bonusPct"
  | "tasfya"
  | "csvSales55"
  | "csvMain"
  | "csvOrder"
  | "csvBranches"
  | "csvChange";

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

/**
 * "علامة" rows: the item name contains one of these exact markers and the
 * settlement (التسوية) is ≥ 0. Such rows are highlighted purple and flagged.
 */
const ALAMA_MARKERS = ["#C.C#", "#B#", "#NA#"];

function isAlama(name: string, tasfya: number): boolean {
  return tasfya >= 0 && ALAMA_MARKERS.some((m) => name.includes(m));
}

/**
 * "ناقص" rows: the item name contains one of the markers (#C.C# / #B# / #NA#).
 * These mark items we couldn't source the full needed quantity for — regardless
 * of the settlement value, so unlike isAlama there's no tasfya condition. Such
 * rows are painted red and can be hidden with the الناقص quick button.
 */
function isNaqis(name: string): boolean {
  return ALAMA_MARKERS.some((m) => name.includes(m));
}

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
  { key: "bonus", label: "بونص", numeric: true, value: (r) => String(r.bonus) },
  {
    key: "bonusPct",
    label: "بونص %",
    numeric: true,
    value: (r) => String(bonusPercent(r.received, r.bonus)),
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
];

/** Exact CSV header names for the five Cosmo columns we surface. */
const CSV_KEYS = {
  sales55: "بيع 55يوم",
  main: "الرئيسي",
  order: "Order",
  branches: "الفروع",
  change: "نسبة التغير",
} as const;

/**
 * Extra columns shown only in Cosmo mode, read from the matched CSV row.
 * نسبة التغير keeps its "%" text, so it sorts as a string (numeric: false).
 */
const COSMO_COLUMNS: typeof COLUMNS = [
  {
    key: "csvSales55",
    label: "بيع 55 يوم",
    numeric: true,
    value: (r) => r.cosmo?.[CSV_KEYS.sales55] ?? "",
  },
  {
    key: "csvMain",
    label: "الرئيسي",
    numeric: true,
    value: (r) => r.cosmo?.[CSV_KEYS.main] ?? "",
  },
  {
    key: "csvOrder",
    label: "Order (كوزمو)",
    numeric: true,
    value: (r) => r.cosmo?.[CSV_KEYS.order] ?? "",
  },
  {
    key: "csvBranches",
    label: "الفروع",
    numeric: true,
    value: (r) => r.cosmo?.[CSV_KEYS.branches] ?? "",
  },
  {
    key: "csvChange",
    label: "نسبة التغير",
    numeric: false,
    value: (r) => r.cosmo?.[CSV_KEYS.change] ?? "",
  },
];

/** Reads a CSV numeric cell, dropping thousands separators and blanks. */
function csvNum(v: string | undefined): number {
  return Number((v ?? "").replace(/,/g, "")) || 0;
}

/**
 * Cosmo "ReOrder" quantity: when the item's on-hand stock (الفروع branches +
 * الرئيسي main) is below its 55-day sales (بيع 55يوم), returns the gap between
 * them — i.e. how many need reordering. Otherwise returns null. Only rows with
 * a matched CSV row (Cosmo mode) can qualify. Items with no paid arrival from
 * the supplier (كمية الوارد − بونص ≤ 0, i.e. nothing came or only بونص did) are
 * excluded: with no purchase to settle the reorder against, the equation isn't
 * added.
 */
function reorderQty(row: CombinedRow): number | null {
  if (!row.cosmo) return null;
  if (row.received - row.bonus <= 0) return null;
  const onHand =
    csvNum(row.cosmo[CSV_KEYS.branches]) + csvNum(row.cosmo[CSV_KEYS.main]);
  const sales55 = csvNum(row.cosmo[CSV_KEYS.sales55]);
  // Round the gap to the nearest multiple of 5 (e.g. 448 → 450).
  return onHand < sales55 ? Math.round((sales55 - onHand) / 5) * 5 : null;
}

/** Numeric value of a row's نسبة التغير (change %), e.g. "38%" → 38. */
function changePct(row: CombinedRow): number | null {
  const raw = row.cosmo?.[CSV_KEYS.change];
  if (!raw) return null;
  const n = parseFloat(raw.replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

/** One purchase event (invoice) in an item's buy history. */
type HistoryEvent = {
  date: Date;
  dateText: string;
  company: string;
  invoice: string;
  paid: number;
  free: number;
  bonusPct: number;
  basicPct: number;
  extraPct: number;
  specialPct: number;
};

function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Parses the "YYYY-MM-DD" date-input value into a local-midnight Date, matching
 * how PO/purchase dates are built (new Date(y, m-1, d)). Returns null when the
 * field is empty or malformed, so the file's own reference date is kept.
 */
function parseStartOverride(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * Builds an item's buy history from the raw purchase lines: every invoice
 * (company + invoice# + date) becomes one event, combining its paid line(s)
 * and any بونص (أساسي = 100%) free line into paid/free quantities, a bonus %
 * (free ÷ paid), and quantity-weighted discount rates. Sorted oldest → newest
 * so a rising/falling/vanishing bonus is visible down the list. Uses ALL dates
 * (no settlement cutoff), so a full year of data shows the full trend.
 */
function buildHistory(lines: PurchaseLine[]): HistoryEvent[] {
  const groups = new Map<
    string,
    {
      date: Date;
      company: string;
      invoice: string;
      paid: number;
      free: number;
      wBasic: number;
      wExtra: number;
      wSpecial: number;
    }
  >();

  for (const l of lines) {
    const dateText = fmtDate(l.date);
    const key = `${l.company}||${l.invoice}||${dateText}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        date: l.date,
        company: l.company,
        invoice: l.invoice,
        paid: 0,
        free: 0,
        wBasic: 0,
        wExtra: 0,
        wSpecial: 0,
      };
      groups.set(key, g);
    }
    if (l.basicPct === 100) {
      g.free += l.kmya;
    } else {
      g.paid += l.kmya;
      g.wBasic += l.basicPct * l.kmya;
      g.wExtra += l.extraPct * l.kmya;
      g.wSpecial += l.specialPct * l.kmya;
    }
  }

  return [...groups.values()]
    .map((g) => ({
      date: g.date,
      dateText: fmtDate(g.date),
      company: g.company,
      invoice: g.invoice,
      paid: g.paid,
      free: g.free,
      bonusPct: g.paid > 0 ? round2((g.free / g.paid) * 100) : 0,
      basicPct: g.paid ? round2(g.wBasic / g.paid) : 0,
      extraPct: g.paid ? round2(g.wExtra / g.paid) : 0,
      specialPct: g.paid ? round2(g.wSpecial / g.paid) : 0,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Default ordering: always sort by اسم الصنف (item name) ascending. */
const DEFAULT_SORT: { col: ColKey; dir: SortDir } = { col: "name", dir: "asc" };

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

// "تصفية التصفية": a second settlement pass. The order comes from an Excel sheet
// (code / item name / Order / company — the same file the settlement download
// produces) instead of the order/stock HTML files, and there's no stock master,
// so over-order (extra) items aren't detected. Everything else matches medicine.
type Mode = "medicine" | "cosmo" | "tasfya2";

export default function TasfyaPage() {
  // Which workflow the user picked on the landing screen. `null` = not chosen
  // yet, so the mode selector is shown. Medicine mode is the existing report;
  // Cosmo mode is a separate workflow (still to be built out).
  const [mode, setMode] = useState<Mode | null>(null);

  const [orderFile, setOrderFile] = useState<File | null>(null);
  const [stockFile, setStockFile] = useState<File | null>(null);
  // Purchase-invoice HTML files. Multiple are allowed so the medicine-store
  // and cosmo-store registers (same structure) can be processed together.
  const [purchasesFiles, setPurchasesFiles] = useState<File[]>([]);

  // Cosmo mode: the extra AppSheet ViewData CSV, parsed.
  const [cosmoData, setCosmoData] = useState<CosmoData | null>(null);
  const [cosmoError, setCosmoError] = useState<string | null>(null);

  // تصفية التصفية mode: the order Excel sheet. There's no reference date — all
  // purchases in the invoices file are counted (no date cutoff).
  const [orderExcelFile, setOrderExcelFile] = useState<File | null>(null);

  // Optional manual settlement start date ("YYYY-MM-DD" from the date input).
  // When set, it overrides the PO's تاريخ as the cutoff — used when a PO was
  // never made (or has the wrong date) so the user can still run the تصفية from
  // a date they choose. Empty = keep the file's own reference date.
  const [startDateOverride, setStartDateOverride] = useState("");
  const [result, setResult] = useState<TasfyaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Full parsed purchase lines (all dates) for the buy-history panel, plus the
  // item code whose history is currently open (null = panel closed).
  const [allPurchases, setAllPurchases] = useState<PurchaseLine[]>([]);
  const [historyCode, setHistoryCode] = useState<string | null>(null);

  // Currently loaded saved project (null = unsaved working state). `uploadKey`
  // remounts the file inputs so "New" visually clears the chosen files.
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [uploadKey, setUploadKey] = useState(0);

  // Cosmo: highlight rows whose نسبة التغير is ≥ this threshold (raw input).
  const [changeThreshold, setChangeThreshold] = useState("");
  const changeThr = useMemo(() => {
    const n = parseFloat(changeThreshold.replace("%", ""));
    return Number.isFinite(n) ? n : null;
  }, [changeThreshold]);

  // Excel-style table state.
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [sort, setSort] = useState<{ col: ColKey; dir: SortDir } | null>(
    DEFAULT_SORT,
  );
  const [menu, setMenu] = useState<{
    col: ColKey;
    x: number;
    top: number;
    bottom: number;
  } | null>(null);
  const [valSearch, setValSearch] = useState("");
  // Quick settlement filter (وصل / زياده / لم يصل). Empty = show all.
  const [settle, setSettle] = useState<Set<SettleCat>>(new Set());
  // Quick "ReOrder" filter: when on, show only rows needing a reorder.
  const [reorderOnly, setReorderOnly] = useState(false);
  // Quick "الناقص" filter: when on, hide all ناقص rows (marker items) from view.
  const [hideNaqis, setHideNaqis] = useState(false);

  // Per-item settlement overrides, keyed by code, kept as raw strings.
  const [edits, setEdits] = useState<Record<string, string>>({});

  function effectiveTasfya(code: string, base: number) {
    const raw = edits[code];
    if (raw === undefined) return base;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  // CSV rows keyed by item code, for attaching the Cosmo columns to each row.
  const cosmoByCode = useMemo(() => {
    const map = new Map<string, CosmoRow>();
    if (cosmoData) for (const r of cosmoData.rows) map.set(r["code"], r);
    return map;
  }, [cosmoData]);

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
    ].map((r) => {
      const cosmo = cosmoByCode.get(r.code);
      // In Cosmo mode, fold the ReOrder gap into the settlement number,
      // adding any main-order shortfall (لم يصل, tasfya < 0) on top of the
      // equation gap. An arrived/over-received order (وصل / زياده) contributes
      // nothing — only what "didn't come" is added.
      const ro = reorderQty({ ...r, isExtra: false, cosmo });
      const shortfall = r.tasfya < 0 ? -r.tasfya : 0;
      const base = ro !== null ? shortfall + ro : r.tasfya;
      return { ...r, tasfya: effectiveTasfya(r.code, base), cosmo };
    });
    // effectiveTasfya reads `edits`, the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, edits, cosmoByCode]);

  // Columns to hide because their value is absent (zero) across every item:
  // بونص (and its %) when there's no bonus anywhere, and إضافي/خاص % likewise.
  const hiddenCols = useMemo(() => {
    const hidden = new Set<ColKey>();
    const hasBonus = allRows.some((r) => r.bonus !== 0);
    const hasExtra = allRows.some(
      (r) => r.extraPct !== 0 || r.lines.some((l) => l.extraPct !== 0),
    );
    const hasSpecial = allRows.some(
      (r) => r.specialPct !== 0 || r.lines.some((l) => l.specialPct !== 0),
    );
    if (!hasBonus) {
      hidden.add("bonus");
      hidden.add("bonusPct");
    }
    if (!hasExtra) hidden.add("extraPct");
    if (!hasSpecial) hidden.add("specialPct");
    return hidden;
  }, [allRows]);

  // Active column set: base report columns (+ CSV columns in Cosmo mode), minus
  // any hidden empty columns. `colByKey` is the lookup used for sort/filter.
  const columns = useMemo(() => {
    const base = mode === "cosmo" ? [...COLUMNS, ...COSMO_COLUMNS] : COLUMNS;
    return base.filter((c) => !hiddenCols.has(c.key));
  }, [mode, hiddenCols]);
  const colByKey = useMemo(
    () =>
      Object.fromEntries(columns.map((c) => [c.key, c])) as Record<
        ColKey,
        (typeof COLUMNS)[number]
      >,
    [columns],
  );

  // Distinct values per column, sorted, for the Excel-style filter dropdown.
  const domains = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of columns) {
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
  }, [allRows, columns]);

  // Rows passing the global search + Excel column filters (before settlement
  // filter / sort) — used both for the وصل/زياده/لم يصل counts and downstream.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const active = Object.entries(filters);

    return allRows.filter((row) => {
      if (q && !columns.some((c) => c.value(row).toLowerCase().includes(q)))
        return false;
      for (const [key, allowed] of active) {
        if (!allowed.has(colByKey[key as ColKey].value(row))) return false;
      }
      return true;
    });
  }, [allRows, search, filters, columns, colByKey]);

  const settleCounts = useMemo(() => {
    const c = { zero: 0, pos: 0, neg: 0 };
    for (const r of filteredRows) c[settleCat(r.tasfya)]++;
    return c;
  }, [filteredRows]);

  const reorderCount = useMemo(
    () => filteredRows.filter((r) => reorderQty(r) !== null).length,
    [filteredRows],
  );

  const naqisCount = useMemo(
    () => filteredRows.filter((r) => isNaqis(r.name)).length,
    [filteredRows],
  );

  // Buy history for the item whose panel is open (null = closed).
  const history = useMemo(() => {
    if (!historyCode) return null;
    const lines = allPurchases.filter((l) => l.code === historyCode);
    const events = buildHistory(lines);
    const name =
      allRows.find((r) => r.code === historyCode)?.name ?? lines[0]?.name ?? "";
    // Best deal = the invoice with the highest bonus %, and the trend from the
    // first bonus-bearing purchase to the last.
    const withBonus = events.filter((e) => e.bonusPct > 0);
    const best = withBonus.reduce<HistoryEvent | null>(
      (b, e) => (!b || e.bonusPct > b.bonusPct ? e : b),
      null,
    );
    const firstPct = withBonus[0]?.bonusPct ?? 0;
    const lastPct = events[events.length - 1]?.bonusPct ?? 0;
    return { name, events, best, firstPct, lastPct };
  }, [historyCode, allPurchases, allRows]);

  const visibleRows = useMemo(() => {
    // The quick buttons (settlement categories + ReOrder) combine with OR: a row
    // shows if it matches any active button. With none active, all rows pass.
    const settleActive = settle.size > 0;
    const roOn = reorderOnly && mode === "cosmo";
    let out =
      !settleActive && !roOn
        ? filteredRows
        : filteredRows.filter(
            (r) =>
              (settleActive && settle.has(settleCat(r.tasfya))) ||
              (roOn && reorderQty(r) !== null),
          );
    if (hideNaqis) out = out.filter((r) => !isNaqis(r.name));

    if (sort) {
      const col = colByKey[sort.col];
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
  }, [filteredRows, settle, sort, colByKey, reorderOnly, mode, hideNaqis]);

  const roActive = reorderOnly && mode === "cosmo";

  const activeFilterCount =
    Object.keys(filters).length +
    (search.trim() ? 1 : 0) +
    settle.size +
    (roActive ? 1 : 0) +
    (hideNaqis ? 1 : 0);

  const toggleSettle = (key: SettleCat) =>
    setSettle((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // ---- Filter helpers (Excel-style dropdown) ----
  const setColumnFilter = (
    col: ColKey,
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
    setReorderOnly(false);
    setHideNaqis(false);
  };

  // Load a saved project's data into the view.
  const applyProject = (
    nextResult: TasfyaResult,
    nextEdits: Record<string, string>,
  ) => {
    setResult(nextResult);
    setEdits(nextEdits);
    setError(null);
    // Saved projects don't store raw purchase lines, so history is unavailable.
    setAllPurchases([]);
    setHistoryCode(null);
    clearAll();
    setSort(DEFAULT_SORT);
  };

  // Clear everything for a fresh upload (a new, unsaved project).
  const newProject = () => {
    setResult(null);
    setEdits({});
    setError(null);
    setOrderFile(null);
    setStockFile(null);
    setPurchasesFiles([]);
    setCosmoData(null);
    setCosmoError(null);
    setOrderExcelFile(null);
    setStartDateOverride("");
    setAllPurchases([]);
    setHistoryCode(null);
    setUploadKey((k) => k + 1);
    clearAll();
    setSort(DEFAULT_SORT);
  };

  const toggleSort = (col: ColKey) => {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  };

  // Close the buy-history panel on Escape.
  useEffect(() => {
    if (!historyCode) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setHistoryCode(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [historyCode]);

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

  const fmt = (col: ColKey, v: string) =>
    v === ""
      ? "(Blanks)"
      : colByKey[col].numeric
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

  // Can the Process button run? Medicine/Cosmo need order + stock + purchases
  // HTML; تصفية التصفية needs the order Excel + purchases HTML.
  const canProcess =
    mode === "tasfya2"
      ? !!orderExcelFile && purchasesFiles.length > 0
      : !!orderFile && !!stockFile && purchasesFiles.length > 0;

  // Shared bookkeeping after a report is computed from freshly uploaded files.
  function afterProcess(nextResult: TasfyaResult, purchases: PurchaseLine[]) {
    setResult(nextResult);
    setAllPurchases(purchases); // keep raw lines for the buy-history panel
    setEdits({});
    setCurrentId(null); // a freshly processed report is a new, unsaved project
    clearAll();
    setSort(DEFAULT_SORT);
  }

  async function handleProcess() {
    if (loading || !canProcess) return;
    if (mode === "tasfya2") return handleProcessTasfya2();
    setLoading(true);
    setError(null);
    try {
      const [orderHtml, stockHtml, purchasesHtmls] = await Promise.all([
        readFileAsText(orderFile!),
        readFileAsText(stockFile!),
        Promise.all(purchasesFiles.map(readFileAsText)),
      ]);

      const order = parseOrder(parseHtmlTable(orderHtml));
      // A manually chosen start date overrides the PO's own تاريخ as the cutoff.
      const override = parseStartOverride(startDateOverride);
      if (override) order.referenceDate = override;
      const stock = parseStock(parseHtmlTable(stockHtml));
      // Merge every uploaded register (e.g. medicine store + cosmo store) into
      // one list of purchase lines before computing the report.
      const purchases = purchasesHtmls.flatMap((html) =>
        parsePurchases(parseHtmlTable(html)),
      );
      afterProcess(computeReport(order, purchases, stock), purchases);
    } catch {
      setError(
        "حدث خطأ أثناء معالجة الملفات. تأكد من أنها ملفات SofTech صحيحة.",
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  // تصفية التصفية: build the "order" from the uploaded Excel sheet (code / item
  // name / Order / company) and run the same settlement against the purchases.
  // There's no stock master, so an empty one is passed — this suppresses
  // over-order (extra) items and takes the supplier from the sheet's company.
  async function handleProcessTasfya2() {
    if (!orderExcelFile || purchasesFiles.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const [excelBuffer, purchasesHtmls] = await Promise.all([
        readFileAsArrayBuffer(orderExcelFile),
        Promise.all(purchasesFiles.map(readFileAsText)),
      ]);

      const { items, company } = await parseOrderExcel(excelBuffer);
      if (items.length === 0) {
        setError(
          "لم يتم العثور على أصناف في ملف Excel. تأكد من وجود أعمدة code و item name و Order و company.",
        );
        setResult(null);
        return;
      }

      const purchases = purchasesHtmls.flatMap((html) =>
        parsePurchases(parseHtmlTable(html)),
      );
      const order: OrderData = {
        items,
        // No PO here, so default to no date cutoff (count every purchase line);
        // a manually chosen start date, when given, becomes the cutoff instead.
        referenceDate: parseStartOverride(startDateOverride) ?? new Date(0),
        orderNumber: "",
      };
      // Empty stock master: no codes ⇒ no extra items; supplier from the sheet.
      const stock: StockData = {
        items: [],
        byCode: new Map(),
        codes: new Set(),
        supplier: company,
      };
      afterProcess(computeReport(order, purchases, stock), purchases);
    } catch {
      setError(
        "حدث خطأ أثناء معالجة الملفات. تأكد من صحة ملف الفواتير (HTML) وملف Excel.",
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  // ---- Cosmo mode: parse the extra AppSheet ViewData CSV ----
  async function handleCosmoFile(file: File | null) {
    if (!file) {
      setCosmoData(null);
      setCosmoError(null);
      return;
    }
    setCosmoError(null);
    try {
      const text = await readFileAsText(file);
      const data = parseCosmoCsv(text);
      if (data.headers.length === 0 || data.rows.length === 0) {
        setCosmoData(null);
        setCosmoError("ملف CSV فارغ أو غير صالح.");
        return;
      }
      setCosmoData(data);
    } catch {
      setCosmoData(null);
      setCosmoError("حدث خطأ أثناء قراءة ملف CSV.");
    }
  }

  async function handleDownload() {
    if (!result) return;
    // Which items to export: those matching any active quick button (settlement
    // categories OR ReOrder); if no button is active, all rows.
    const settleActive = settle.size > 0;
    const noButtons = !settleActive && !roActive;
    const rows = noButtons
      ? allRows
      : allRows.filter(
          (r) =>
            (settleActive && settle.has(settleCat(r.tasfya))) ||
            (roActive && reorderQty(r) !== null),
        );

    // Simplified sheet: code, item name, Order (= |التسوية|), company (supplier).
    const buffer = await buildSimpleWorkbook(
      rows.map((r) => ({
        code: r.code,
        name: r.name,
        tasfya: Math.abs(r.tasfya),
      })),
      result.supplierCompany,
    );
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `order_${result.supplierCompany || "report"}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const fileInputClass =
    "block w-full cursor-pointer text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90";

  // Landing screen: pick a mode before anything else is shown.
  if (mode === null) {
    return (
      <div
        dir="ltr"
        className="mx-auto flex min-h-[70vh] w-full max-w-3xl flex-col items-center justify-center gap-8 p-6"
      >
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Choose a mode</h1>
          <p className="mt-2 text-sm">Make your life easier!!..</p>
        </div>
        <div className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => setMode("medicine")}
            className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center shadow-sm transition hover:border-primary hover:shadow-md"
          >
            <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
              <FileSpreadsheet className="size-7" />
            </span>
            <span className="text-lg font-semibold">Medicine mode</span>
            <span className="text-sm text-muted-foreground">
              Purchase order settlement report from SofTech files.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode("cosmo")}
            className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center shadow-sm transition hover:border-primary hover:shadow-md"
          >
            <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
              <FileSpreadsheet className="size-7" />
            </span>
            <span className="text-lg font-semibold">Cosmo mode</span>
            <span className="text-sm text-muted-foreground">
              Same settlement report, plus the AppSheet inventory CSV.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode("tasfya2")}
            className="group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center shadow-sm transition hover:border-primary hover:shadow-md"
          >
            <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
              <FileSpreadsheet className="size-7" />
            </span>
            <span className="text-lg font-semibold" dir="rtl">
              تصفية التصفية
            </span>
            <span className="text-sm text-muted-foreground">
              A second settlement pass: the order comes from an Excel sheet
              (code / item name / Order / company) plus the purchase invoices.
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div dir="ltr" className="mx-auto w-full max-w-[120rem] space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "cosmo"
              ? "Cosmo — "
              : mode === "tasfya2"
                ? "تصفية التصفية — "
                : ""}
            Purchase Order Settlement Report
          </h1>
          <p className="text-sm text-muted-foreground">
            {mode === "tasfya2"
              ? "Upload the order Excel sheet (code / item name / Order / company) and the purchase invoices file to generate the settlement report."
              : mode === "cosmo"
                ? "Upload the purchase order, supplier stock, and purchase invoices files, plus the AppSheet CSV, to generate the settlement report."
                : "Upload the purchase order, supplier stock, and purchase invoices files to generate the settlement report."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setMode(null)}>
            <ArrowUpDown /> Change mode
          </Button>
          <Button onClick={handleProcess} disabled={!canProcess || loading}>
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <FileSpreadsheet />
            )}
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

      <ProjectBar
        result={result}
        edits={edits}
        currentId={currentId}
        onCurrentIdChange={setCurrentId}
        onApply={applyProject}
        onNew={newProject}
      />

      {/* Upload section — kept in Arabic as requested */}
      <div
        key={uploadKey}
        className={cn(
          "grid gap-4",
          mode === "cosmo" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3",
        )}
      >
        {mode !== "tasfya2" && (
          <div className="space-y-2 rounded-xl border border-border p-4">
            <label className="text-sm font-medium">
              ملف أمر التوريد (HTML)
            </label>
            <input
              type="file"
              accept=".html,.htm"
              onChange={(e) => setOrderFile(e.target.files?.[0] ?? null)}
              className={fileInputClass}
            />
          </div>
        )}
        {mode !== "tasfya2" && (
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
        )}
        <div className="space-y-2 rounded-xl border border-border p-4">
          <label className="text-sm font-medium">
            ملف سجل فواتير شراء الأصناف (HTML)
          </label>
          <input
            type="file"
            accept=".html,.htm"
            multiple
            onChange={(e) =>
              setPurchasesFiles(Array.from(e.target.files ?? []))
            }
            className={fileInputClass}
          />
          {purchasesFiles.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {purchasesFiles.length} ملف:{" "}
              {purchasesFiles.map((f) => f.name).join("، ")}
            </p>
          )}
        </div>
        {mode === "tasfya2" && (
          <div className="space-y-2 rounded-xl border border-border p-4">
            <label className="text-sm font-medium">
              ملف الطلب (Excel: code / item name / Order / company)
            </label>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setOrderExcelFile(e.target.files?.[0] ?? null)}
              className={fileInputClass}
            />
            {orderExcelFile && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                {orderExcelFile.name}
              </p>
            )}
          </div>
        )}
        {mode === "cosmo" && (
          <div className="space-y-2 rounded-xl border border-border p-4">
            <label className="text-sm font-medium">
              ملف بيانات كوزمو (CSV)
            </label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleCosmoFile(e.target.files?.[0] ?? null)}
              className={fileInputClass}
            />
            {cosmoData && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                تم تحميل {cosmoData.rows.length.toLocaleString("en-US")} صف من
                CSV
              </p>
            )}
          </div>
        )}
      </div>

      {/* Optional manual start date: overrides the PO's date as the settlement
          cutoff — for when no PO was made (or its date is wrong). */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4">
        <label htmlFor="start-date" className="text-sm font-medium">
          تاريخ بداية التصفية (اختياري)
        </label>
        <input
          id="start-date"
          type="date"
          value={startDateOverride}
          onChange={(e) => setStartDateOverride(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {startDateOverride ? (
          <button
            type="button"
            onClick={() => setStartDateOverride("")}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            مسح
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {mode === "tasfya2"
              ? "اتركه فارغًا لحساب كل الفواتير بدون تاريخ بداية."
              : "اتركه فارغًا لاستخدام تاريخ أمر التوريد."}
          </span>
        )}
      </div>

      {mode === "cosmo" && cosmoError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {cosmoError}
        </div>
      )}

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

          {/* Quick settlement filters: وصل / زياده / لم يصل (+ ReOrder in Cosmo) */}
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
            {mode === "cosmo" && (
              <Button
                size="sm"
                variant={reorderOnly ? "default" : "outline"}
                onClick={() => setReorderOnly((v) => !v)}
              >
                ReOrder ({reorderCount})
              </Button>
            )}
            <Button
              size="sm"
              variant={hideNaqis ? "default" : "outline"}
              onClick={() => setHideNaqis((v) => !v)}
            >
              {hideNaqis ? "Show Naqis" : "Hide Naqis"} {naqisCount}
            </Button>
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
            {mode === "cosmo" && (
              <div className="flex items-center gap-2">
                <label className="whitespace-nowrap text-sm text-muted-foreground">
                  نسبة التغير ≥
                </label>
                <input
                  value={changeThreshold}
                  onChange={(e) => setChangeThreshold(e.target.value)}
                  placeholder="20%"
                  className="h-9 w-24 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
            )}
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
                  {columns.map((col) => {
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
                              const r = e.currentTarget.getBoundingClientRect();
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
                {visibleRows.map((row) => {
                  const alama = isAlama(row.name, row.tasfya);
                  const naqis = isNaqis(row.name);
                  // Cosmo: does this row's نسبة التغير meet the typed threshold?
                  const cp = changePct(row);
                  const changeHit =
                    mode === "cosmo" &&
                    changeThr !== null &&
                    cp !== null &&
                    cp >= changeThr;
                  return (
                    <tr
                      key={`${row.code}-${row.isExtra ? "extra" : "report"}`}
                      className={cn(
                        "border-b-2 border-neutral-400 transition-colors last:border-0 hover:bg-muted/40 dark:border-neutral-600",
                        changeHit
                          ? "bg-teal-100 dark:bg-teal-950/40"
                          : alama
                            ? "bg-purple-100 dark:bg-purple-950/40"
                            : naqis
                              ? "bg-red-200 text-red-950 dark:bg-red-900/50 dark:text-red-50"
                              : rowClass(row.tasfya),
                      )}
                    >
                      <td
                        className={cn(
                          "border-s-4 px-4 py-3 text-center align-middle font-medium tabular-nums",
                          alama
                            ? "border-s-purple-500"
                            : naqis
                              ? "border-s-red-600"
                              : accentClass(row.tasfya),
                        )}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          <span>{row.code}</span>
                          {allPurchases.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setHistoryCode(row.code)}
                              title="Buy history / bonus over time"
                              aria-label={`Buy history for ${row.code}`}
                              className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <History className="size-4" />
                            </button>
                          )}
                          {alama && (
                            <span className="inline-flex rounded-full bg-purple-600 px-2 py-0.5 text-xs font-semibold text-white dark:bg-purple-500">
                              3alama
                            </span>
                          )}
                        </div>
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
                        <div className="flex flex-col items-center justify-center gap-1.5">
                          <input
                            type="number"
                            value={edits[row.code] ?? String(row.tasfya)}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [row.code]: e.target.value,
                              }))
                            }
                            style={{
                              // Grow with the value so big numbers (e.g. -10000)
                              // aren't clipped; never narrower than ~4 chars.
                              width: `calc(${Math.max(
                                4,
                                (edits[row.code] ?? String(row.tasfya)).length,
                              )}ch + 4rem)`,
                            }}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-center font-bold tabular-nums outline-none transition focus:ring-2",
                              tasfyaPillClass(row.tasfya),
                            )}
                            aria-label={`Edit settlement for item ${row.code}`}
                          />
                          {mode === "cosmo" &&
                            (() => {
                              const ro = reorderQty(row);
                              return ro !== null ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white dark:bg-blue-500">
                                  ReOrder
                                </span>
                              ) : null;
                            })()}
                        </div>
                      </td>
                      {!hiddenCols.has("bonus") && (
                        <td className="px-4 py-3 text-center align-middle font-medium tabular-nums">
                          {row.bonus}
                        </td>
                      )}
                      {!hiddenCols.has("bonusPct") && (
                        <td className="px-4 py-3 text-center align-middle font-medium tabular-nums">
                          {pct(bonusPercent(row.received, row.bonus))}
                        </td>
                      )}
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
                      {!hiddenCols.has("extraPct") && (
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
                      )}
                      {!hiddenCols.has("specialPct") && (
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
                      )}
                      {mode === "cosmo" &&
                        COSMO_COLUMNS.map((col) => {
                          const v = col.value(row);
                          const showTick = col.key === "csvChange" && changeHit;
                          return (
                            <td
                              key={col.key}
                              className="px-4 py-3 text-center align-middle tabular-nums"
                            >
                              <div className="flex items-center justify-center gap-1">
                                {v || (
                                  <span className="text-muted-foreground/40">
                                    —
                                  </span>
                                )}
                                {showTick && (
                                  <CheckCircle2 className="size-4 text-green-600 dark:text-green-500" />
                                )}
                              </div>
                            </td>
                          );
                        })}
                    </tr>
                  );
                })}
                {visibleRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={columns.length}
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

      {/* Buy-history panel: an item's purchases over time, bonus per مورد */}
      {history && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setHistoryCode(null);
          }}
        >
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-border p-4">
              <div>
                <h2 className="text-lg font-bold">Buy history</h2>
                <p className="text-sm text-muted-foreground">
                  {historyCode} — {history.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryCode(null)}
                aria-label="Close"
                className="grid size-8 place-items-center rounded-lg hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>

            {history.events.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                No purchases found for this item.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 text-sm">
                  {history.best ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      Best bonus: {history.best.bonusPct}% —{" "}
                      {history.best.company || "—"} ({history.best.dateText})
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                      No bonus in any purchase
                    </span>
                  )}
                  {history.best &&
                    (history.lastPct > history.firstPct ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <TrendingUp className="size-4" /> Bonus rising (
                        {history.firstPct}% → {history.lastPct}%)
                      </span>
                    ) : history.lastPct < history.firstPct ? (
                      <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
                        <TrendingDown className="size-4" /> Bonus falling (
                        {history.firstPct}% → {history.lastPct}%)
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Bonus steady ({history.lastPct}%)
                      </span>
                    ))}
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-muted">
                      <tr className="text-muted-foreground">
                        <th className="px-3 py-2 text-start font-semibold">
                          التاريخ
                        </th>
                        <th className="px-3 py-2 text-start font-semibold">
                          المورد
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          فاتورة
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          مدفوع
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          بونص
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          بونص %
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          أساسي %
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          إضافي %
                        </th>
                        <th className="px-3 py-2 text-center font-semibold">
                          خاص %
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.events.map((e, i) => {
                        const isBest =
                          history.best !== null &&
                          e === history.best &&
                          e.bonusPct > 0;
                        return (
                          <tr
                            key={i}
                            className={cn(
                              "border-b border-border/50 last:border-0",
                              isBest && "bg-emerald-50 dark:bg-emerald-950/30",
                            )}
                          >
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                              {e.dateText}
                            </td>
                            <td className="px-3 py-2">{e.company || "—"}</td>
                            <td className="px-3 py-2 text-center tabular-nums">
                              {e.invoice || "—"}
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums">
                              {e.paid}
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums">
                              {e.free}
                            </td>
                            <td
                              className={cn(
                                "px-3 py-2 text-center font-semibold tabular-nums",
                                e.bonusPct > 0
                                  ? "text-emerald-700 dark:text-emerald-300"
                                  : "text-muted-foreground",
                              )}
                            >
                              {e.bonusPct ? `${e.bonusPct}%` : "—"}
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums">
                              {pct(e.basicPct)}
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums">
                              {pct(e.extraPct)}
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums">
                              {pct(e.specialPct)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
