export interface OrderItem {
  code: string;
  name: string;
  order: number;
}

export interface PurchaseLine {
  code: string;
  name: string;
  company: string;
  invoice: string;
  date: Date;
  kmya: number;
  basicPct: number;
  extraPct: number;
  specialPct: number;
}

/** One purchase line of an item, shown in the per-supplier breakdown. */
export interface PurchaseDetail {
  supplier: string;
  invoice: string;
  date: string;
  received: number;
  basicPct: number;
  extraPct: number;
  specialPct: number;
}

export interface ReportRow {
  code: string;
  name: string;
  /** Distributor(s) the item was purchased from (إسم المورد), joined if several. */
  supplier: string;
  order: number;
  /** Total received quantity across all purchase lines (incl. bonus units). */
  received: number;
  /** أساسي discount % (quantity-weighted over non-bonus lines). */
  basicPct: number;
  /** إضافي discount %. */
  extraPct: number;
  /** خاص discount %. */
  specialPct: number;
  /** بونص: quantity received free (lines where أساسي = 100%). */
  bonus: number;
  /** التسوية = (received − bonus) − order. */
  tasfya: number;
  /** Per-purchase-line breakdown (one entry per supplier/invoice). */
  lines: PurchaseDetail[];
}

export interface ExtraItem {
  code: string;
  name: string;
  /** Distributor(s) the item was purchased from (إسم المورد), joined if several. */
  supplier: string;
  received: number;
  basicPct: number;
  extraPct: number;
  specialPct: number;
  bonus: number;
  /** Per-purchase-line breakdown (one entry per supplier/invoice). */
  lines: PurchaseDetail[];
}

export interface OrderData {
  items: OrderItem[];
  referenceDate: Date;
  orderNumber: string;
}

export interface StockItem {
  code: string;
  name: string;
  supplier: string;
  purchasePrice: number;
  salePrice: number;
  balance: number;
}

export interface StockData {
  items: StockItem[];
  byCode: Map<string, StockItem>;
  codes: Set<string>;
  supplier: string;
}

export interface TasfyaResult {
  report: ReportRow[];
  extraItems: ExtraItem[];
  supplierCompany: string;
  referenceDate: Date;
  orderNumber: string;
}
