/**
 * The code → company list from the stock files, kept in the browser
 * (IndexedDB) until the user deletes it. Each upload merges by code: new
 * codes are added, existing ones take the newer company/name.
 */
import { idbStore } from "./idb";
import type { StockItem } from "./parseStock";

export { requestPersistentStorage } from "./idb";

export type StoredStockItem = StockItem & { updatedAt: number };

const tx = idbStore("hayaa-stock", "items", "code");

export async function loadStock(): Promise<Map<string, StoredStockItem>> {
  const all = (await tx<StoredStockItem[]>("readonly", (s) => s.getAll())) ?? [];
  return new Map(all.map((i) => [i.code, i]));
}

/** Upserts every item by code in a single transaction. */
export async function mergeStock(items: StockItem[]): Promise<void> {
  const updatedAt = Date.now();
  await tx("readwrite", (s) => {
    for (const item of items) s.put({ ...item, updatedAt });
  });
}

export async function clearStock(): Promise<void> {
  await tx("readwrite", (s) => s.clear());
}
