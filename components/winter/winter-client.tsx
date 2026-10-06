"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  ChevronLeft,
  ChevronRight,
  Link2,
  Loader2,
  Minus,
  Search,
  Snowflake,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WinterItem } from "@/lib/winter/data";

const MONTHS = ["Oct", "Nov", "Dec"] as const;
const PAGE_SIZE = 20;

type SortKey = "code" | "name" | "oct" | "nov" | "dec" | "total" | "change";
const MONTH_KEYS = ["oct", "nov", "dec"] as const;

function sortValue(it: WinterItem, key: SortKey): number {
  const [o, n, d] = it.m;
  switch (key) {
    case "oct": return o;
    case "nov": return n;
    case "dec": return d;
    case "total": return o + n + d;
    // Oct → Dec %; "new" (0 → sales) ranks above any %, no sales at all below.
    case "change": return o === 0 ? (d > 0 ? Infinity : -Infinity) : (d - o) / o;
    default: return 0;
  }
}

function SortButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: React.ReactNode;
  active: boolean;
  dir: 1 | -1 | null;
  onClick: () => void;
}) {
  const Icon = dir === 1 ? ArrowUp : dir === -1 ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 hover:text-foreground",
        active && "text-foreground",
      )}
      title="Sort"
    >
      {label}
      <Icon className={cn("size-3.5", !active && "opacity-50")} />
    </button>
  );
}
const fmt = (n: number) => n.toLocaleString("en-US");

// % change from a to b, or null when there is no base to compare against.
function pct(a: number, b: number): number | null {
  if (a === 0) return null;
  return ((b - a) / a) * 100;
}

function Ticker({ from, to, big }: { from: number; to: number; big?: boolean }) {
  const p = pct(from, to);
  // Within ±3% counts as flat.
  const dir =
    p === null ? (to > 0 ? "up" : "flat") : p > 3 ? "up" : p < -3 ? "down" : "flat";
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  const label =
    p === null ? (to > 0 ? "new" : "—") : `${p > 0 ? "+" : ""}${Math.round(p)}%`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium tabular-nums",
        big ? "text-sm" : "text-xs",
        dir === "up" && "text-emerald-600 dark:text-emerald-400",
        dir === "down" && "text-red-600 dark:text-red-400",
        dir === "flat" && "text-muted-foreground",
      )}
    >
      <Icon className={big ? "size-4" : "size-3.5"} />
      {label}
    </span>
  );
}

export function WinterClient() {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<WinterItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [searched, setSearched] = React.useState("");

  // Link family: merge every تشغيلات code of a product into one row.
  const [family, setFamily] = React.useState(true);

  // Column sort; null = as returned (best sellers first).
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 1 | -1 } | null>(null);

  // Click cycles: first direction (A→Z for text, high→low for numbers) →
  // reversed → off.
  const toggleSort = (key: SortKey) => {
    const first: 1 | -1 = key === "code" || key === "name" ? 1 : -1;
    setSort((s) =>
      s?.key !== key ? { key, dir: first } : s.dir === first ? { key, dir: -first as 1 | -1 } : null,
    );
    setPage(0);
  };

  // Top 50: show the best-selling winter-related items instead of a search.
  // On by default. Typing a search switches to search results; clearing the
  // search box brings the top list back.
  const [top, setTop] = React.useState(true);

  // Results are shown PAGE_SIZE rows at a time.
  const [page, setPage] = React.useState(0);

  // Company filter. `companyInput` is what's typed; `company` is applied only
  // once it exactly matches a known company (or is cleared).
  const [companies, setCompanies] = React.useState<string[]>([]);
  const [companyInput, setCompanyInput] = React.useState("");
  const [company, setCompany] = React.useState("");

  React.useEffect(() => {
    fetch("/api/winter?suppliers=1")
      .then((r) => r.json())
      .then((d: { suppliers: string[] }) => setCompanies(d.suppliers))
      .catch(() => {});
  }, []);

  const companySet = React.useMemo(() => new Set(companies), [companies]);

  const pickCompany = (value: string) => {
    setCompanyInput(value);
    const v = value.trim();
    if (!v) setCompany("");
    else if (companySet.has(v)) setCompany(v);
  };

  const active = top || query.trim() !== "" || company !== "";

  const sorted = React.useMemo(() => {
    if (!sort) return results;
    const { key, dir } = sort;
    return [...results].sort((a, b) => {
      if (key === "code") return dir * a.code.localeCompare(b.code, undefined, { numeric: true });
      if (key === "name") return dir * a.name.localeCompare(b.name);
      return dir * (sortValue(a, key) - sortValue(b, key));
    });
  }, [results, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const shown = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Rank by sales (results arrive best-sellers first), independent of sorting.
  const rank = React.useMemo(
    () => new Map(results.map((it, i) => [it, i + 1])),
    [results],
  );

  const th = (key: SortKey, label: React.ReactNode, align: "left" | "right") => (
    <th className={cn("px-3 py-2 font-medium", align === "right" ? "text-right" : "text-left")}>
      <SortButton
        label={label}
        active={sort?.key === key}
        dir={sort?.key === key ? sort.dir : null}
        onClick={() => toggleSort(key)}
      />
    </th>
  );

  React.useEffect(() => {
    const q = query.trim();
    if (!top && !q && !company) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (top) params.set("top", "1");
        else if (q) params.set("q", q);
        if (family) params.set("family", "1");
        if (company) params.set("supplier", company);
        const res = await fetch(`/api/winter?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { results: WinterItem[] };
        setResults(data.results);
        setPage(0);
        setSearched(q);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, top ? 0 : 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, family, top, company]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setTop(e.target.value.trim() === "");
            }}
            placeholder="Search by code or item name…"
            className="h-11 w-full rounded-lg border bg-background pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {active && loading && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        <Button
          type="button"
          variant={family ? "default" : "outline"}
          className="h-11"
          aria-pressed={family}
          onClick={() => setFamily((f) => !f)}
          title="Merge all تشغيلات codes of a product into one row"
        >
          <Link2 className="size-4" />
          Link family
        </Button>
        <Button
          type="button"
          variant={top ? "default" : "outline"}
          className="h-11"
          aria-pressed={top}
          onClick={() => setTop((t) => !t)}
          title="Top 50 best-selling winter-related items (Oct–Dec), 20 per page"
        >
          <Snowflake className="size-4" />
          Top 50 winter
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            list="winter-companies"
            value={companyInput}
            onChange={(e) => pickCompany(e.target.value)}
            placeholder="Filter by company…"
            dir="auto"
            className={cn(
              "h-10 w-full rounded-lg border bg-background pl-9 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
              company && "border-primary",
            )}
          />
          <datalist id="winter-companies">
            {companies.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {companyInput && (
            <button
              type="button"
              onClick={() => pickCompany("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear company filter"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>
      {companyInput.trim() && !company && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Pick a company from the list to apply the filter.
        </p>
      )}

      {active && (searched || company) && results.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">
          {top
            ? "No winter-related sales"
            : `No sales${searched ? ` for “${searched}”` : ""}`}
          {company && <> for <span dir="auto">{company}</span></>} in Oct–Dec 2025.
        </p>
      )}

      {active && results.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {top && (
            <span className="font-medium text-foreground">
              Top {results.length} winter-related{" "}
            </span>
          )}
          {!top && `${results.length} `}
          {company && (
            <span className="font-medium text-foreground" dir="auto">
              {company}{" "}
            </span>
          )}
          {family ? "famil" : "item"}
          {family
            ? results.length === 1 ? "y" : "ies"
            : results.length === 1 ? "" : "s"}{" "}
          shown{family && " (all تشغيلات codes merged)"} — numbers are{" "}
          <span className="font-medium text-foreground">units sold</span> per
          month.
        </p>
      )}

      {active && results.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                {top && <th className="px-3 py-2 text-right font-medium">#</th>}
                {th("code", "Code", "left")}
                {th("name", "Item", "left")}
                {MONTHS.map((m, i) => (
                  <React.Fragment key={m}>
                    {th(
                      MONTH_KEYS[i],
                      <>
                        {m} <span className="font-normal">(units)</span>
                      </>,
                      "right",
                    )}
                  </React.Fragment>
                ))}
                {th(
                  "total",
                  <>
                    Total <span className="font-normal">(units)</span>
                  </>,
                  "right",
                )}
                {th("change", "Oct → Dec", "right")}
              </tr>
            </thead>
            <tbody>
              {shown.map((it) => (
                <tr key={it.code} className="border-t align-top">
                  {top && (
                    <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                      {rank.get(it)}
                    </td>
                  )}
                  <td className="px-3 py-2 font-mono text-xs">
                    {(it.codes ?? [it.code]).map((c, i) => (
                      <div key={c} className={cn(i > 0 && "text-muted-foreground")}>
                        {c}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{it.name}</div>
                    {(it.supplier || it.cat) && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {it.cat && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-300">
                            <Snowflake className="size-3" />
                            {it.cat}
                          </span>
                        )}
                        {it.supplier}
                      </div>
                    )}
                  </td>
                  {it.m.map((v, i) => (
                    <td key={i} className="px-3 py-2 text-right">
                      <div className="tabular-nums">
                        {fmt(v)} <span className="text-xs text-muted-foreground">units</span>
                      </div>
                      {i > 0 && <Ticker from={it.m[i - 1]} to={v} />}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {fmt(it.m[0] + it.m[1] + it.m[2])}{" "}
                    <span className="text-xs font-normal text-muted-foreground">units</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Ticker from={it.m[0]} to={it.m[2]} big />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of{" "}
              {sorted.length}
              {!top && searched && results.length >= 50 &&
                " (top 50 matches — refine the search to narrow it down)"}
            </span>
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                {Array.from({ length: pageCount }, (_, i) => (
                  <Button
                    key={i}
                    type="button"
                    variant={i === page ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPage(i)}
                    aria-current={i === page ? "page" : undefined}
                  >
                    {i + 1}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
