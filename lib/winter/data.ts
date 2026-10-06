import { readFile, stat } from "node:fs/promises";
import path from "node:path";

// Last winter's (Oct–Dec 2025) branch sales, one entry per item code (each
// تشغيلة code is its own row). Generated from forcast\10.htm, 11.htm, 12.htm.
export type WinterItem = {
  code: string;
  name: string;
  supplier: string;
  /** Units sold in Oct, Nov, Dec. */
  m: [number, number, number];
  /**
   * Only on linked families: every code of the product, highest-selling first
   * (`code` is then that first one and `m` is the family total).
   */
  codes?: string[];
  /** Winter category (from the forcast finall report); absent = not winter. */
  cat?: string;
};

type WinterData = { year: number; months: number[]; items: WinterItem[] };

const FILE = path.join(process.cwd(), "lib", "winter", "sales.json");

// Cached in memory, but re-read whenever the file changes on disk (e.g. after
// regenerating it) so a running server never serves a stale shape.
let cache: { mtime: number; data: Promise<WinterData> } | null = null;

export async function loadWinterData(): Promise<WinterData> {
  const mtime = (await stat(FILE)).mtimeMs;
  if (!cache || cache.mtime !== mtime) {
    cache = {
      mtime,
      data: readFile(FILE, "utf8").then((t) => JSON.parse(t) as WinterData),
    };
  }
  return cache.data;
}

const MAX_RESULTS = 50;

/**
 * Digits only → the exact code first, then codes starting with it. Otherwise
 * every word of the query must appear in the item name. Results keep the
 * file's order (best sellers first).
 */
export function searchWinter(
  items: WinterItem[],
  query: string,
  limit = MAX_RESULTS,
): WinterItem[] {
  const q = query.trim();
  if (!q) return [];

  if (/^\d+$/.test(q)) {
    const exact = items.filter((i) => i.code === q);
    const prefix = items.filter((i) => i.code !== q && i.code.startsWith(q));
    return [...exact, ...prefix].slice(0, limit);
  }

  const words = q.toUpperCase().split(/\s+/).filter(Boolean);
  const out: WinterItem[] = [];
  for (const i of items) {
    const name = i.name.toUpperCase();
    if (words.every((w) => name.includes(w))) {
      out.push(i);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// ---- تشغيلات (link family) -------------------------------------------------

// Strip the price-generation tags (ت.ق, ت.ج, ت.ج2…, ن.ج1…), "كود جديد NNN"
// cross-references and #X# shortage markers, so every code of one product
// shares the same base name.
export function familyName(name: string): string {
  return name
    .replace(/كود\s*جديد\s*\d*/g, " ")
    .replace(/#[^#\s]{1,6}#/g, " ")
    .replace(/ت\.ق|ت\.ج\d*|ن\.ج\d*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

const familyIndex = new WeakMap<WinterItem[], Map<string, WinterItem[]>>();

function familiesOf(items: WinterItem[]): Map<string, WinterItem[]> {
  let idx = familyIndex.get(items);
  if (!idx) {
    idx = new Map();
    for (const it of items) {
      const key = familyName(it.name);
      const list = idx.get(key);
      if (list) list.push(it);
      else idx.set(key, [it]);
    }
    familyIndex.set(items, idx);
  }
  return idx;
}

/**
 * Same search, but each match is expanded to its whole family (all its
 * تشغيلات codes, matched or not) and merged into one row.
 */
export function searchWinterFamilies(
  items: WinterItem[],
  query: string,
): WinterItem[] {
  const fams = familiesOf(items);
  const seen = new Set<string>();
  const out: WinterItem[] = [];
  for (const hit of searchWinter(items, query, Infinity)) {
    const key = familyName(hit.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mergeFamily(key, fams.get(key) ?? [hit]));
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

// One row for a whole family; members are stored best-sellers first.
function mergeFamily(key: string, members: WinterItem[]): WinterItem {
  const m: [number, number, number] = [0, 0, 0];
  for (const it of members) for (let i = 0; i < 3; i++) m[i] += it.m[i];
  return {
    code: members[0].code,
    codes: members.map((it) => it.code),
    name: key,
    supplier: members[0].supplier,
    m,
    cat: members.find((it) => it.cat)?.cat,
  };
}

const total = (i: WinterItem) => i.m[0] + i.m[1] + i.m[2];

// ---- Company (supplier) filter ----------------------------------------------

const supplierIndex = new WeakMap<WinterItem[], Map<string, WinterItem[]>>();

function bySupplier(items: WinterItem[]): Map<string, WinterItem[]> {
  let idx = supplierIndex.get(items);
  if (!idx) {
    idx = new Map();
    for (const it of items) {
      const list = idx.get(it.supplier);
      if (list) list.push(it);
      else idx.set(it.supplier, [it]);
    }
    supplierIndex.set(items, idx);
  }
  return idx;
}

/**
 * Only the items of one company (same array each call, so the family index
 * cached per array keeps working). Empty supplier = everything.
 */
export function itemsOfSupplier(items: WinterItem[], supplier: string): WinterItem[] {
  if (!supplier) return items;
  return bySupplier(items).get(supplier) ?? [];
}

/** Every company, biggest Oct–Dec sellers first. */
export function listSuppliers(items: WinterItem[]): string[] {
  return [...bySupplier(items)]
    .map(([name, list]) => ({ name, units: list.reduce((s, i) => s + total(i), 0) }))
    .sort((a, b) => b.units - a.units)
    .map((s) => s.name);
}

/** A company's best sellers (all items, not only winter), or their families. */
export function topOfSupplier(items: WinterItem[], family: boolean, n = 100): WinterItem[] {
  if (!family) return items.slice(0, n); // already sorted by total
  const fams = familiesOf(items);
  return [...fams]
    .map(([k, members]) => mergeFamily(k, members))
    .sort((a, b) => total(b) - total(a))
    .slice(0, n);
}

/** The top 50 best-selling winter-related items (or families) over Oct–Dec. */
export function topWinter(items: WinterItem[], family: boolean, n = 50): WinterItem[] {
  const winter = items.filter((i) => i.cat);
  if (!family) return winter.slice(0, n); // already sorted by total
  const fams = familiesOf(items);
  const keys = new Set(winter.map((i) => familyName(i.name)));
  return [...keys]
    .map((k) => mergeFamily(k, fams.get(k) ?? []))
    .sort((a, b) => total(b) - total(a))
    .slice(0, n);
}
