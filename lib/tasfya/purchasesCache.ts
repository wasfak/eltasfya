import type { PurchaseLine } from "./types";

const DB_NAME = "tasfya";
const STORE = "purchases";
const KEY = "cached";

interface CachedPurchases {
  fileName: string;
  savedAt: number;
  lines: Array<Omit<PurchaseLine, "date"> & { date: string }>;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePurchases(
  fileName: string,
  lines: PurchaseLine[],
): Promise<void> {
  const db = await openDB();
  const serialized: CachedPurchases = {
    fileName,
    savedAt: Date.now(),
    lines: lines.map((l) => ({ ...l, date: l.date.toISOString() })),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(serialized, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadPurchases(): Promise<{
  fileName: string;
  savedAt: number;
  lines: PurchaseLine[];
} | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => {
        const data = req.result as CachedPurchases | undefined;
        if (!data) return resolve(null);
        resolve({
          fileName: data.fileName,
          savedAt: data.savedAt,
          lines: data.lines.map((l) => ({ ...l, date: new Date(l.date) })),
        });
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearPurchases(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
