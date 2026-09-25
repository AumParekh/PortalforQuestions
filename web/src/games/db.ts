// A separate IndexedDB database for the game layer, so its schema versions never collide with
// the app's 'frm-portal' database.
import type { CoverageRow, ItemSrs, SessionLog } from './types';

const DB_NAME = 'frm-games';
const DB_VERSION = 1;
const OPEN_TIMEOUT_MS = 4000;

export type GameStoreName = 'sessions' | 'items' | 'coverage';

interface GameStoreValue {
  sessions: SessionLog;
  items: ItemSrs;
  coverage: CoverageRow;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export function openGamesDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'sessionId' });
        s.createIndex('timestamp', 'timestamp');
        s.createIndex('mechanic', 'mechanic');
        s.createIndex('readingId', 'readingId');
      }
      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'itemId' });
        s.createIndex('dueDate', 'dueDate');
        s.createIndex('readingId', 'readingId');
      }
      if (!db.objectStoreNames.contains('coverage')) {
        const s = db.createObjectStore('coverage', { keyPath: 'objectiveId' });
        s.createIndex('readingId', 'readingId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading: step aside so it isn't blocked; the next call reopens.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => undefined;
  });
  // A blocked or hung open must not hang the games screen.
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('frm-games IndexedDB timed out')), OPEN_TIMEOUT_MS),
  );
  dbPromise = Promise.race([opening, timeout]);
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

export async function getAllRows<S extends GameStoreName>(store: S): Promise<GameStoreValue[S][]> {
  const db = await openGamesDb();
  return reqToPromise(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<GameStoreValue[S][]>);
}

export async function putRows<S extends GameStoreName>(store: S, values: GameStoreValue[S][]): Promise<void> {
  if (values.length === 0) return;
  const db = await openGamesDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  await txDone(tx);
}

/** Writes a closed session and the coverage rows it closed in one transaction. */
export async function putSessionWithCoverage(session: SessionLog, coverage: CoverageRow[]): Promise<void> {
  const db = await openGamesDb();
  const tx = db.transaction(['sessions', 'coverage'], 'readwrite');
  tx.objectStore('sessions').put(session);
  const cov = tx.objectStore('coverage');
  for (const c of coverage) cov.put(c);
  await txDone(tx);
}

export async function clearGamesDb(): Promise<void> {
  const db = await openGamesDb();
  const stores: GameStoreName[] = ['sessions', 'items', 'coverage'];
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) tx.objectStore(s).clear();
  await txDone(tx);
}

export interface GamesExport {
  kind: 'frm-games';
  version: 1;
  exportedAt: string;
  sessions: SessionLog[];
  items: ItemSrs[];
  coverage: CoverageRow[];
}

/** Whole-database snapshot for backup / the planned cross-device sync (PORTAL_PLAN §7). */
export async function exportGamesDb(): Promise<GamesExport> {
  const [sessions, items, coverage] = await Promise.all([getAllRows('sessions'), getAllRows('items'), getAllRows('coverage')]);
  return { kind: 'frm-games', version: 1, exportedAt: new Date().toISOString(), sessions, items, coverage };
}

/** Wholesale replace (last-write-wins, like the rest of the app's sync). */
export async function importGamesDb(snapshot: GamesExport): Promise<void> {
  if (snapshot.kind !== 'frm-games') throw new Error('Not a games export');
  const db = await openGamesDb();
  const stores: GameStoreName[] = ['sessions', 'items', 'coverage'];
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) tx.objectStore(s).clear();
  for (const v of snapshot.sessions) tx.objectStore('sessions').put(v);
  for (const v of snapshot.items) tx.objectStore('items').put(v);
  for (const v of snapshot.coverage) tx.objectStore('coverage').put(v);
  await txDone(tx);
}
