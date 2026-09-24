import type { AttemptRecord, QuestionState, SessionRecord } from '../types';

const DB_NAME = 'frm-portal';
const DB_VERSION = 1;

export type StoreName = 'questionState' | 'attempts' | 'sessions' | 'meta';

interface StoreValue {
  questionState: QuestionState;
  attempts: AttemptRecord;
  sessions: SessionRecord;
  meta: { key: string; value: unknown };
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

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('questionState')) {
        const s = db.createObjectStore('questionState', { keyPath: 'questionId' });
        s.createIndex('subject', 'subject');
        s.createIndex('dueDate', 'dueDate');
        s.createIndex('lastAttempted', 'lastAttempted');
      }
      if (!db.objectStoreNames.contains('attempts')) {
        const s = db.createObjectStore('attempts', { keyPath: 'attemptId' });
        s.createIndex('questionId', 'questionId');
        s.createIndex('sessionId', 'sessionId');
        s.createIndex('timestamp', 'timestamp');
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'sessionId' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // Another tab holding an older version open; the open will proceed once it closes.
    req.onblocked = () => undefined;
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

export async function getAll<S extends StoreName>(store: S): Promise<StoreValue[S][]> {
  const db = await openDb();
  return reqToPromise(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<StoreValue[S][]>);
}

export async function putMany<S extends StoreName>(store: S, values: StoreValue[S][]): Promise<void> {
  if (values.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  await txDone(tx);
}

/** Writes an attempt and its updated question-state row atomically. */
export async function putAttempt(attempt: AttemptRecord, state: QuestionState): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['attempts', 'questionState'], 'readwrite');
  tx.objectStore('attempts').put(attempt);
  tx.objectStore('questionState').put(state);
  await txDone(tx);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const row = await reqToPromise(
    db.transaction('meta', 'readonly').objectStore('meta').get(key) as IDBRequest<{ key: string; value: T } | undefined>,
  );
  return row?.value;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await putMany('meta', [{ key, value }]);
}

export async function deleteMeta(key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').delete(key);
  await txDone(tx);
}

/** Deletes question-state rows (and, if asked, everything else). The attempt log survives a per-subject reset. */
export async function clearStores(stores: StoreName[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) tx.objectStore(s).clear();
  await txDone(tx);
}

export async function deleteQuestionStates(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  const tx = db.transaction('questionState', 'readwrite');
  const os = tx.objectStore('questionState');
  for (const id of ids) os.delete(id);
  await txDone(tx);
}
