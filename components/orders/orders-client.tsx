"use client";

import * as React from "react";
import { Check, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import companiesData from "@/lib/orders/companies.json";

// Demo: only these four, and only the companies they're responsible for.
const PEOPLE = ["ياسمين", "AYA", "وفاء", "سالى"];

// [company name, number of item codes, responsible person from the report's
// "المسئول عن المورد" column (null when unassigned)], largest first.
const COMPANIES = (companiesData as [string, number, string | null][]).filter(
  ([, , o]) => o && PEOPLE.includes(o),
);
const ITEMS = new Map(COMPANIES.map(([c, n]) => [c, n]));
/** OWNERS[company] = person responsible for that company's orders. */
const OWNERS: Record<string, string> = Object.fromEntries(
  COMPANIES.map(([c, , o]) => [c, o!]),
);

const STORAGE_KEY = "orders-review-demo-v3";
const MAX_RESULTS = 50;

type Person = { name: string; away: boolean };
type Order = {
  id: string;
  company: string;
  items: number;
  /** Person responsible for the company when the order was registered. */
  owner: string | null;
  reviewer: string;
  createdAt: number;
  reviewedAt: number | null;
};
type State = { people: Person[]; orders: Order[] };

const initialState = (): State => ({
  people: PEOPLE.map((name) => ({ name, away: false })),
  orders: [],
});

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

/** Review load (items) each person was assigned this month. */
function reviewLoads(state: State) {
  const from = monthStart();
  const load = new Map(state.people.map((p) => [p.name, 0]));
  for (const o of state.orders) {
    if (o.createdAt >= from && load.has(o.reviewer)) {
      load.set(o.reviewer, load.get(o.reviewer)! + o.items);
    }
  }
  return load;
}

/** Least-loaded available person who isn't responsible for the company. */
function pickReviewer(state: State, owner: string | null): string | null {
  const load = reviewLoads(state);
  const candidates = state.people.filter((p) => !p.away && p.name !== owner);
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      load.get(a.name)! - load.get(b.name)! || a.name.localeCompare(b.name),
  );
  return candidates[0].name;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const fmtDate = (t: number) =>
  new Date(t).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

function CompanyPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (company: string | null) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMPANIES.filter(([c]) => !q || c.toLowerCase().includes(q)).slice(
      0,
      MAX_RESULTS,
    );
  }, [query]);

  const pick = (company: string) => {
    onChange(company);
    setQuery("");
    setHighlight(0);
    setOpen(false);
  };

  if (value) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-md border border-input bg-muted px-3 text-sm">
        <span dir="auto" className="truncate font-medium">
          {value}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
          {fmt(ITEMS.get(value) ?? 0)} items
          <button
            type="button"
            aria-label="Clear company"
            onClick={() => onChange(null)}
            className="hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={query}
        placeholder="Search company..."
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && results[highlight]) {
            e.preventDefault();
            pick(results[highlight][0]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm shadow-md">
          {results.map(([c, n], i) => (
            <li
              key={c}
              // mousedown fires before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5",
                i === highlight && "bg-accent text-accent-foreground",
              )}
            >
              <span dir="auto" className="truncate">
                {c}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {fmt(n)} items
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function OrdersClient() {
  const [state, setState] = React.useState<State>(initialState);
  const [loaded, setLoaded] = React.useState(false);

  const [company, setCompany] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage once
      if (saved) setState({ ...initialState(), ...JSON.parse(saved) });
    } catch {}
    setLoaded(true);
  }, []);

  React.useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state, loaded]);

  const loads = React.useMemo(() => reviewLoads(state), [state]);
  const from = monthStart();
  const pending = state.orders.filter((o) => o.reviewedAt === null);
  const reviewed = state.orders
    .filter((o) => o.reviewedAt !== null)
    .sort((a, b) => b.reviewedAt! - a.reviewedAt!);

  const stats = state.people.map((p) => {
    const month = state.orders.filter((o) => o.createdAt >= from);
    return {
      ...p,
      companies: COMPANIES.filter(([, , o]) => o === p.name).length,
      reviewItems: loads.get(p.name) ?? 0,
      reviewCount: month.filter((o) => o.reviewer === p.name).length,
      pending: pending.filter((o) => o.reviewer === p.name).length,
    };
  });
  const avg =
    stats.length > 0
      ? stats.reduce((s, p) => s + p.reviewItems, 0) / stats.length
      : 0;
  const maxLoad = Math.max(1, ...stats.map((s) => s.reviewItems));

  const registerOrder = () => {
    if (!company) return;
    const owner = OWNERS[company] ?? null;
    const reviewer = pickReviewer(state, owner);
    if (!reviewer) {
      setNotice("No available reviewer — everyone else is marked away.");
      return;
    }
    const order: Order = {
      id: crypto.randomUUID(),
      company,
      items: ITEMS.get(company) ?? 0,
      owner,
      reviewer,
      createdAt: Date.now(),
      reviewedAt: null,
    };
    setState((s) => ({ ...s, orders: [order, ...s.orders] }));
    setNotice(
      owner
        ? `Assigned to ${reviewer} for review (${owner} is responsible for this company).`
        : `Assigned to ${reviewer} for review. Note: this company has no responsible person yet.`,
    );
    setCompany(null);
  };

  const toggleAway = (name: string) =>
    setState((s) => ({
      ...s,
      people: s.people.map((x) =>
        x.name === name ? { ...x, away: !x.away } : x,
      ),
    }));

  const updateOrder = (id: string, patch: Partial<Order>) =>
    setState((s) => ({
      ...s,
      orders: s.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));

  return (
    <div className="space-y-5">
      <Card title="New order">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <CompanyPicker value={company} onChange={setCompany} />
          <Button className="h-10" disabled={!company} onClick={registerOrder}>
            <Plus className="size-4" /> Register order
          </Button>
        </div>
        {company && (
          <p className="mt-3 text-sm text-muted-foreground">
            Responsible:{" "}
            <b className="text-foreground">
              {OWNERS[company] ?? "nobody yet"}
            </b>
          </p>
        )}
        {notice && !company && (
          <p className="mt-3 text-sm text-muted-foreground">{notice}</p>
        )}
      </Card>

      <Card
        title="Review load this month"
        action={
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Average {fmt(Math.round(avg))} items
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setState((s) => ({ ...s, orders: [] }))
              }
            >
              <RotateCcw className="size-4" /> Reset
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {[...stats]
            .sort((a, b) => b.reviewItems - a.reviewItems)
            .map((p) => (
            <div
              key={p.name}
              className={cn(
                "grid items-center gap-3 sm:grid-cols-[140px_1fr_auto]",
                p.away && "opacity-50",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {p.away && (
                  <span className="rounded bg-muted px-1.5 text-xs">away</span>
                )}
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${(p.reviewItems / maxLoad) * 100}%` }}
                />
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground tabular-nums">
                <span>
                  <b className="text-foreground">{fmt(p.reviewItems)}</b> items
                  reviewed ({p.reviewCount})
                </span>
                <span>{p.pending} pending</span>
                <span>{p.companies} companies</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title={`Waiting for review (${pending.length})`}>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing waiting — every registered order has been reviewed.
          </p>
        ) : (
          <OrdersTable
            orders={pending}
            onReview={(id) => updateOrder(id, { reviewedAt: Date.now() })}
            onDelete={(id) =>
              setState((s) => ({
                ...s,
                orders: s.orders.filter((o) => o.id !== id),
              }))
            }
          />
        )}
      </Card>

      {reviewed.length > 0 && (
        <Card title={`Reviewed (${reviewed.length})`}>
          <OrdersTable
            orders={reviewed}
            onUndo={(id) => updateOrder(id, { reviewedAt: null })}
          />
        </Card>
      )}

      <Card
        title="Team"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm("Clear all demo data?")) setState(initialState());
            }}
          >
            <RotateCcw className="size-4" /> Reset demo
          </Button>
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">
          Responsibilities come from the uploaded report — nobody reviews their
          own companies. Click a name to mark them away.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {stats.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => toggleAway(p.name)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-muted",
                p.away && "opacity-50",
              )}
            >
              <span className={cn("font-medium", p.away && "line-through")}>
                {p.name}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {p.away
                  ? "away"
                  : `${p.companies} companies · ${fmt(
                      COMPANIES.reduce(
                        (s, [, n, o]) => (o === p.name ? s + n : s),
                        0,
                      ),
                    )} items`}
              </span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function OrdersTable({
  orders,
  onReview,
  onDelete,
  onUndo,
}: {
  orders: Order[];
  onReview?: (id: string) => void;
  onDelete?: (id: string) => void;
  onUndo?: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-2 pr-3 font-medium">Company</th>
            <th className="py-2 pr-3 font-medium">Items</th>
            <th className="py-2 pr-3 font-medium">Reviewer</th>
            <th className="py-2 pr-3 font-medium">
              {onUndo ? "Reviewed" : "Registered"}
            </th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b border-border last:border-0">
              <td className="py-2 pr-3 text-left">
                <bdi>{o.company}</bdi>
              </td>
              <td className="py-2 pr-3 tabular-nums">{fmt(o.items)}</td>
              <td className="py-2 pr-3 font-medium capitalize">{o.reviewer}</td>
              <td className="py-2 pr-3 text-muted-foreground tabular-nums">
                {fmtDate(o.reviewedAt ?? o.createdAt)}
              </td>
              <td className="py-2 text-right whitespace-nowrap">
                {onReview && (
                  <Button size="sm" variant="outline" onClick={() => onReview(o.id)}>
                    <Check className="size-4" /> Reviewed
                  </Button>
                )}
                {onUndo && (
                  <Button size="sm" variant="ghost" onClick={() => onUndo(o.id)}>
                    Undo
                  </Button>
                )}
                {onDelete && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete order"
                    onClick={() => onDelete(o.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
