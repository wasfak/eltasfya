import type {
  ExtraItem,
  OrderData,
  OrderItem,
  PurchaseDetail,
  PurchaseLine,
  ReportRow,
  ReviewRow,
  StockData,
  TasfyaResult,
} from "./types";

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

/** A purchase line is a بونص (bonus / free goods) when أساسي = 100%. */
function isBonus(line: PurchaseLine): boolean {
  return line.basicPct === 100;
}

/**
 * بونص %: free (bonus) units as a percentage of the *paid* units
 * (paid = received − bonus), i.e. the "X free per Y bought" deal rate. Returns 0
 * when there is no bonus or nothing was paid for.
 */
export function bonusPercent(received: number, bonus: number): number {
  const paid = received - bonus;
  if (bonus <= 0 || paid <= 0) return 0;
  return Math.round((bonus / paid) * 10000) / 100;
}

/**
 * The settlement counts only purchases dated on or after the reference date
 * (the PO's تاريخ), and each keeps its real date. Purchases before the
 * reference date are excluded from the settlement (they still appear in the
 * full Buy History). Purchases are matched to orders by item code only — the
 * distributor (`company`) is intentionally ignored.
 */
function normalizeByDate(
  purchases: PurchaseLine[],
  referenceDate: Date
): PurchaseLine[] {
  return purchases.filter(
    (line) => line.date.getTime() >= referenceDate.getTime()
  );
}

interface Aggregate {
  code: string;
  name: string;
  supplier: string;
  received: number;
  bonus: number;
  basicPct: number;
  extraPct: number;
  specialPct: number;
  lines: PurchaseDetail[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface AggBuilder {
  code: string;
  name: string;
  suppliers: Set<string>;
  received: number;
  bonus: number;
  // quantity-weighted discount sums over non-bonus lines
  wBasic: number;
  wExtra: number;
  wSpecial: number;
  nonBonusQty: number;
  // Purchase-line breakdown, keyed so lines from the same invoice that share
  // the same supplier, date and discount rates (i.e. the same purchase split
  // across batches/تشغيلات) are merged into one, summing their quantities.
  lines: Map<string, PurchaseDetail>;
}

function aggregateByCode(lines: PurchaseLine[]): Map<string, Aggregate> {
  const builders = new Map<string, AggBuilder>();

  for (const line of lines) {
    let b = builders.get(line.code);
    if (!b) {
      b = {
        code: line.code,
        name: line.name,
        suppliers: new Set(),
        received: 0,
        bonus: 0,
        wBasic: 0,
        wExtra: 0,
        wSpecial: 0,
        nonBonusQty: 0,
        lines: new Map(),
      };
      builders.set(line.code, b);
    }

    if (line.company) b.suppliers.add(line.company);
    const basicPct = round2(line.basicPct);
    const extraPct = round2(line.extraPct);
    const specialPct = round2(line.specialPct);
    const dateText = formatDate(line.date);
    const key = `${line.company}||${line.invoice}||${dateText}||${basicPct}||${extraPct}||${specialPct}`;
    const existing = b.lines.get(key);
    if (existing) {
      existing.received += line.kmya;
    } else {
      b.lines.set(key, {
        supplier: line.company,
        invoice: line.invoice,
        date: dateText,
        received: line.kmya,
        basicPct,
        extraPct,
        specialPct,
      });
    }
    b.received += line.kmya;
    if (isBonus(line)) {
      b.bonus += line.kmya;
    } else {
      // Discount percentages are properties of the (non-bonus) purchase; take a
      // quantity-weighted average so a representative rate is shown per item.
      b.wBasic += line.basicPct * line.kmya;
      b.wExtra += line.extraPct * line.kmya;
      b.wSpecial += line.specialPct * line.kmya;
      b.nonBonusQty += line.kmya;
    }
  }

  const byCode = new Map<string, Aggregate>();
  for (const b of builders.values()) {
    const q = b.nonBonusQty || 1;
    byCode.set(b.code, {
      code: b.code,
      name: b.name,
      supplier: [...b.suppliers].join("، "),
      received: b.received,
      bonus: b.bonus,
      basicPct: b.nonBonusQty ? round2(b.wBasic / q) : 0,
      extraPct: b.nonBonusQty ? round2(b.wExtra / q) : 0,
      specialPct: b.nonBonusQty ? round2(b.wSpecial / q) : 0,
      lines: [...b.lines.values()],
    });
  }
  return byCode;
}

/**
 * Builds the Review view: every code's purchase activity (received, bonus,
 * quantity-weighted discounts and the per-invoice breakdown), after applying
 * the same reference-date rule as the settlement report. When `codes` is given,
 * only those codes are returned — used to restrict the view to the codes listed
 * in an uploaded Excel sheet. Results are sorted by item name.
 */
export function computeReview(
  purchases: PurchaseLine[],
  referenceDate: Date,
  codes?: Set<string>
): ReviewRow[] {
  const normalized = normalizeByDate(purchases, referenceDate);
  const aggregates = aggregateByCode(normalized);

  const rows: ReviewRow[] = [];
  for (const agg of aggregates.values()) {
    if (codes && !codes.has(agg.code)) continue;
    // Order each item's invoices chronologically so its buy history (and any
    // discount change) reads oldest → newest. Dates are "YYYY/MM/DD", so a
    // plain string compare is chronological.
    agg.lines.sort((a, b) => a.date.localeCompare(b.date));
    rows.push(agg);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "ar", { numeric: true }));
  return rows;
}

export function computeReport(
  order: OrderData,
  purchases: PurchaseLine[],
  stock: StockData
): TasfyaResult {
  const normalized = normalizeByDate(purchases, order.referenceDate);
  const aggregates = aggregateByCode(normalized);

  const orderCodes = new Set(order.items.map((i) => i.code));

  // A SofTech purchase order can list the same code on more than one line (e.g.
  // a real order line plus a stray 0-quantity duplicate). Each report row is
  // matched to the item's full by-code purchase aggregate, so emitting one row
  // per order line would attribute the same received quantity to every
  // duplicate — inventing a phantom surplus. Merge duplicates into one row,
  // summing the ordered quantity and keeping the first line's name/position.
  const mergedItems: OrderItem[] = [];
  const itemByCode = new Map<string, OrderItem>();
  for (const item of order.items) {
    const existing = itemByCode.get(item.code);
    if (existing) {
      existing.order += item.order;
    } else {
      const copy = { ...item };
      itemByCode.set(item.code, copy);
      mergedItems.push(copy);
    }
  }

  const report: ReportRow[] = mergedItems.map((item) => {
    const agg = aggregates.get(item.code);
    const received = agg?.received ?? 0;
    const bonus = agg?.bonus ?? 0;

    return {
      code: item.code,
      name: item.name,
      supplier: agg?.supplier ?? "",
      order: item.order,
      received,
      basicPct: agg?.basicPct ?? 0,
      extraPct: agg?.extraPct ?? 0,
      specialPct: agg?.specialPct ?? 0,
      bonus,
      tasfya: received - bonus - item.order,
      lines: agg?.lines ?? [],
    };
  });

  // Extra items: codes purchased this period that belong to the supplier (i.e.
  // present in the stock master) but were not on the order — e.g. the supplier
  // shipped an item under an old/new equivalent code that wasn't ordered.
  const extraItems: ExtraItem[] = [];
  for (const agg of aggregates.values()) {
    if (orderCodes.has(agg.code)) continue;
    if (!stock.codes.has(agg.code)) continue;
    extraItems.push({
      code: agg.code,
      name: stock.byCode.get(agg.code)?.name || agg.name,
      supplier: agg.supplier,
      received: agg.received,
      basicPct: agg.basicPct,
      extraPct: agg.extraPct,
      specialPct: agg.specialPct,
      bonus: agg.bonus,
      lines: agg.lines,
    });
  }

  return {
    report,
    extraItems,
    supplierCompany: stock.supplier,
    referenceDate: order.referenceDate,
    orderNumber: order.orderNumber,
  };
}
