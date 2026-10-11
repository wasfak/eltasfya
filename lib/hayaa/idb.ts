/**
 * Minimal IndexedDB helper for the hayaa pages: one object store per
 * database, every operation in its own transaction that resolves only once
 * it's committed to disk.
 */

const dbs = new Map<string, Promise<IDBDatabase>>();

function openDb(name: string, store: string, keyPath: string): Promise<IDBDatabase> {
  let p = dbs.get(name);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(store, { keyPath });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbs.delete(name);
        reject(req.error);
      };
    });
    dbs.set(name, p);
  }
  return p;
}

export function idbStore(name: string, store: string, keyPath: string) {
  return async function tx<T>(
    mode: IDBTransactionMode,
    op: (s: IDBObjectStore) => IDBRequest<T> | void,
  ): Promise<T | undefined> {
    const db = await openDb(name, store, keyPath);
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = op(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error("تم إلغاء الحفظ"));
    });
  };
}

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (!(await navigator.storage?.persisted?.())) await navigator.storage?.persist?.();
  } catch {
    // best effort — the data is still saved
  }
}
