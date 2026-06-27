import type {
  ExtraItem,
  OrderData,
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

const DATE_NORMALIZATION_WINDOW_DAYS = 100;

/** A purchase line is a بونص (bonus / free goods) when أساسي = 100%. */
function isBonus(line: PurchaseLine): boolean {
  return line.basicPct === 100;
}

function daysBetween(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Applies the reference-date rule (ported from the original script): lines older
 * than `referenceDate - 100 days` are treated as having occurred on
 * `referenceDate`; every line (after that adjustment) must fall on or after
 * `referenceDate` to be counted. Purchases are matched to orders by item code
 * only — the distributor (`company`) is intentionally ignored.
 */
function normalizeByDate(
  purchases: PurchaseLine[],
  referenceDate: Date
): PurchaseLine[] {
  const result: PurchaseLine[] = [];

  for (const line of purchases) {
    let date = line.date;
    if (daysBetween(date, referenceDate) > DATE_NORMALIZATION_WINDOW_DAYS) {
      date = referenceDate;
    }
    if (date.getTime() < referenceDate.getTime()) continue;

    result.push({ ...line, date });
  }

  return result;
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
  lines: PurchaseDetail[];
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
        lines: [],
      };
      builders.set(line.code, b);
    }

    if (line.company) b.suppliers.add(line.company);
    b.lines.push({
      supplier: line.company,
      invoice: line.invoice,
      date: formatDate(line.date),
      received: line.kmya,
      basicPct: round2(line.basicPct),
      extraPct: round2(line.extraPct),
      specialPct: round2(line.specialPct),
    });
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
      lines: b.lines,
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

  const report: ReportRow[] = order.items.map((item) => {
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
