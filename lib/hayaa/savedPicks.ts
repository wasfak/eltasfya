/**
 * The codes the user saved from their picks, kept in the browser (IndexedDB)
 * so the next uploaded movement file can mark them again in one click.
 */
import { idbStore } from "./idb";

export type SavedPick = { code: string; productName: string };

const tx = idbStore("hayaa-picks", "picks", "code");

export async function loadSavedPicks(): Promise<SavedPick[]> {
  return (await tx<SavedPick[]>("readonly", (s) => s.getAll())) ?? [];
}

/** Replaces the saved list with `picks`. */
export async function saveSavedPicks(picks: SavedPick[]): Promise<void> {
  await tx("readwrite", (s) => {
    s.clear();
    for (const p of picks) s.put(p);
  });
}

export async function clearSavedPicks(): Promise<void> {
  await tx("readwrite", (s) => s.clear());
}

/**
 * Product name as a matching key: a price raise gives the same product a new
 * code (ت.ج1 → ت.ج2, sometimes with a trailing "~"), so a saved pick also
 * marks the new codes of its product.
 */
export function productKey(productName: string): string {
  return productName.replace(/~/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}
