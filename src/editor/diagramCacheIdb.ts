/** IndexedDB cold store for diagram SVG cache (survives app restarts). */

const DB_NAME = "markspace-diagram-cache";
const DB_VERSION = 1;
const STORE = "svgs";

/** Soft caps — eviction deletes oldest by touchedAt. */
export const DISK_MAX_ENTRIES = 120;
export const DISK_MAX_BYTES = 32 * 1024 * 1024;

export type DiskDiagramEntry = {
  key: string;
  svg: string;
  touchedAt: number;
  bytes: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("touchedAt", "touchedAt", { unique: false });
      }
    };
  });
  return dbPromise;
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export async function diskGetDiagram(
  key: string,
): Promise<DiskDiagramEntry | undefined> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const entry = await idbReq(
      tx.objectStore(STORE).get(key) as IDBRequest<DiskDiagramEntry | undefined>,
    );
    return entry ?? undefined;
  } catch {
    return undefined;
  }
}

export async function diskTouchDiagram(key: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const entry = await idbReq(
      store.get(key) as IDBRequest<DiskDiagramEntry | undefined>,
    );
    if (!entry) return;
    entry.touchedAt = Date.now();
    store.put(entry);
    await txDone(tx);
  } catch {
    // ignore persistence errors
  }
}

export async function diskPutDiagram(key: string, svg: string): Promise<void> {
  try {
    const db = await openDb();
    const entry: DiskDiagramEntry = {
      key,
      svg,
      touchedAt: Date.now(),
      bytes: svg.length * 2,
    };
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
    await txDone(tx);
    await evictIfNeeded();
  } catch {
    // ignore persistence errors
  }
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx aborted"));
  });
}

async function evictIfNeeded(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const all = await idbReq(store.getAll() as IDBRequest<DiskDiagramEntry[]>);
  await txDone(tx);

  if (all.length === 0) return;

  let totalBytes = all.reduce((sum, e) => sum + (e.bytes || 0), 0);
  if (all.length <= DISK_MAX_ENTRIES && totalBytes <= DISK_MAX_BYTES) return;

  const ordered = [...all].sort((a, b) => a.touchedAt - b.touchedAt);
  const toDelete: string[] = [];
  let count = ordered.length;

  for (const entry of ordered) {
    if (count <= DISK_MAX_ENTRIES && totalBytes <= DISK_MAX_BYTES) break;
    toDelete.push(entry.key);
    totalBytes -= entry.bytes || 0;
    count -= 1;
  }

  if (toDelete.length === 0) return;

  const delTx = db.transaction(STORE, "readwrite");
  const delStore = delTx.objectStore(STORE);
  for (const key of toDelete) delStore.delete(key);
  await txDone(delTx);
}
