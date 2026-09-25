// A separate IndexedDB database for the game layer, so its schema versions never collide with
// the app's 'frm-portal' database.
import type { CoverageRow, FrameId, ItemSrs, MechanicId, RoundLog, SessionLog, TrapCategory } from './types';
import { TRAP_CATEGORIES } from './types';
import { formatLogLines } from './log';

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
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      // Some private modes throw synchronously instead of firing onerror.
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
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
      if (timedOut) {
        // The caller already gave up on this open; don't leak a connection that could block a later upgrade.
        db.close();
        return;
      }
      const forget = () => {
        if (dbPromise === settled) dbPromise = null;
      };
      // Another tab upgrading: step aside so it isn't blocked; the next call reopens.
      db.onversionchange = () => {
        db.close();
        forget();
      };
      // The browser closed the connection (storage cleared, disk error): reopen on next use.
      db.onclose = forget;
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('frm-games IndexedDB failed to open'));
    // Blocked by an older connection in another tab: wait (the timeout below bounds it).
    req.onblocked = () => undefined;
  });
  // A blocked or hung open must not hang the games screen.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('frm-games IndexedDB timed out'));
    }, OPEN_TIMEOUT_MS);
  });
  const settled: Promise<IDBDatabase> = Promise.race([opening, timeout]).finally(() => clearTimeout(timer));
  dbPromise = settled;
  settled.catch(() => {
    if (dbPromise === settled) dbPromise = null;
  });
  return settled;
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
  const clean = sanitizeGamesExport(snapshot);
  if (!clean) throw new Error('Not a games export');
  const { snapshot: data } = clean;
  const db = await openGamesDb();
  const stores: GameStoreName[] = ['sessions', 'items', 'coverage'];
  const tx = db.transaction(stores, 'readwrite');
  const done = txDone(tx);
  try {
    for (const s of stores) tx.objectStore(s).clear();
    for (const v of data.sessions) tx.objectStore('sessions').put(v);
    for (const v of data.items) tx.objectStore('items').put(v);
    for (const v of data.coverage) tx.objectStore('coverage').put(v);
  } catch (e) {
    // A put that throws (bad key, uncloneable value) must not let the queued clears commit on their own.
    try {
      tx.abort();
    } catch {
      // Already finished.
    }
    await done.catch(() => undefined);
    throw e;
  }
  await done;
}

// ---- Validation of imported rows ----
// The UI trusts these shapes (category tallies index by category, the log view reads `lines`),
// so a hand-edited or future-version file is normalised row by row and bad rows are dropped.

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isoDate = (v: unknown): v is string => str(v) && !Number.isNaN(Date.parse(v));
const dayDate = (v: unknown): v is string => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
const category = (v: unknown): TrapCategory | undefined => (TRAP_CATEGORIES as readonly unknown[]).includes(v) ? (v as TrapCategory) : undefined;
const categories = (v: unknown): TrapCategory[] => (Array.isArray(v) ? v.map(category).filter((c): c is TrapCategory => !!c) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(str) : []);
const FRAME_IDS: readonly string[] = ['museum-tour', 'night-court', 'autopsy-room', 'heist-debrief', 'swearing-in', 'forecast-desk', 'signal-room', 'field-guide'];

function roundRow(v: unknown): RoundLog | null {
  if (!isRec(v) || !str(v.blockId) || typeof v.correct !== 'boolean') return null;
  const row: RoundLog = {
    roundId: str(v.roundId) ? v.roundId : '',
    itemId: str(v.itemId) ? v.itemId : v.blockId,
    blockId: v.blockId,
    phase: v.phase === 'discovery' ? 'discovery' : 'pressure',
    correct: v.correct,
    timeMs: num(v.timeMs) && v.timeMs >= 0 ? v.timeMs : 0,
    timedOut: v.timedOut === true,
    grade: num(v.grade) ? Math.max(0, Math.min(5, Math.round(v.grade))) : v.correct ? 4 : 1,
  };
  if (str(v.objectiveId)) row.objectiveId = v.objectiveId;
  const c = category(v.category);
  if (c) row.category = c;
  return row;
}

function sessionRow(v: unknown): SessionLog | null {
  if (!isRec(v) || !nonEmpty(v.sessionId) || !num(v.number) || !isoDate(v.timestamp)) return null;
  if (!nonEmpty(v.mechanic) || !nonEmpty(v.readingId) || !Array.isArray(v.rounds)) return null;
  const rounds = v.rounds.map(roundRow).filter((r): r is RoundLog => !!r);
  const byCategory: SessionLog['byCategory'] = {};
  for (const r of rounds) {
    if (!r.category) continue;
    const t = (byCategory[r.category] ??= { caught: 0, missed: 0 });
    if (r.correct) t.caught++;
    else t.missed++;
  }
  const base: SessionLog = {
    sessionId: v.sessionId,
    number: Math.max(1, Math.round(v.number)),
    startedAt: isoDate(v.startedAt) ? v.startedAt : v.timestamp,
    timestamp: v.timestamp,
    mechanic: v.mechanic as MechanicId,
    mechanicTitle: nonEmpty(v.mechanicTitle) ? v.mechanicTitle : v.mechanic,
    readingId: v.readingId,
    frame: str(v.frame) && FRAME_IDS.includes(v.frame) ? (v.frame as FrameId) : 'museum-tour',
    trigger: v.trigger === 'reading' || v.trigger === 'mechanic' ? v.trigger : 'auto',
    completed: v.completed === true,
    roundsPlanned: num(v.roundsPlanned) ? v.roundsPlanned : rounds.length,
    rounds,
    caught: rounds.filter((r) => r.correct).length,
    taught: str(v.taught) ? v.taught : '',
    taughtObjective: str(v.taughtObjective) ? v.taughtObjective : '',
    conceptBlockId: str(v.conceptBlockId) ? v.conceptBlockId : '',
    objectivesClosed: v.completed === true ? strings(v.objectivesClosed) : [],
    categoriesDrawn: categories(v.categoriesDrawn),
    missCategories: categories(v.missCategories),
    byCategory,
    blockIds: strings(v.blockIds),
    lines: [],
  };
  const lines = strings(v.lines);
  return { ...base, lines: lines.length === 3 ? lines : formatLogLines(base) };
}

function itemRow(v: unknown): ItemSrs | null {
  if (!isRec(v) || !nonEmpty(v.itemId) || !dayDate(v.dueDate)) return null;
  const row: ItemSrs = {
    itemId: v.itemId,
    interval: num(v.interval) && v.interval >= 0 ? Math.min(3650, v.interval) : 0,
    repetition: num(v.repetition) && v.repetition >= 0 ? Math.round(v.repetition) : 0,
    efactor: num(v.efactor) ? Math.min(5, Math.max(1.3, v.efactor)) : 2.5,
    dueDate: v.dueDate,
    lastResult: v.lastResult === 'correct' ? 'correct' : 'wrong',
    lastGrade: num(v.lastGrade) ? Math.max(0, Math.min(5, Math.round(v.lastGrade))) : 0,
    lastReviewed: isoDate(v.lastReviewed) ? v.lastReviewed : new Date(0).toISOString(),
    reviews: num(v.reviews) && v.reviews >= 0 ? v.reviews : 0,
    lapses: num(v.lapses) && v.lapses >= 0 ? v.lapses : 0,
  };
  if (str(v.readingId)) row.readingId = v.readingId;
  const c = category(v.category);
  if (c) row.category = c;
  return row;
}

function coverageRow(v: unknown): CoverageRow | null {
  if (!isRec(v) || !nonEmpty(v.objectiveId) || !str(v.readingId) || !isoDate(v.closedAt)) return null;
  return {
    objectiveId: v.objectiveId,
    readingId: v.readingId,
    closedAt: v.closedAt,
    firstClosedAt: isoDate(v.firstClosedAt) ? v.firstClosedAt : v.closedAt,
    times: num(v.times) && v.times >= 1 ? Math.round(v.times) : 1,
  };
}

function validRows<T>(list: unknown, parse: (v: unknown) => T | null, key: (t: T) => string): { ok: T[]; bad: number } {
  const byKey = new Map<string, T>();
  let bad = 0;
  for (const x of Array.isArray(list) ? list : []) {
    const r = parse(x);
    if (r) byKey.set(key(r), r);
    else bad++;
  }
  return { ok: [...byKey.values()], bad };
}

/**
 * Validates an untrusted games snapshot (from an import file). Returns null when it isn't a
 * games export at all; otherwise the usable rows plus how many were dropped.
 */
export function sanitizeGamesExport(v: unknown): { snapshot: GamesExport; skipped: number } | null {
  if (!isRec(v) || v.kind !== 'frm-games') return null;
  const sessions = validRows(v.sessions, sessionRow, (r) => r.sessionId);
  const items = validRows(v.items, itemRow, (r) => r.itemId);
  const coverage = validRows(v.coverage, coverageRow, (r) => r.objectiveId);
  sessions.ok.sort((a, b) => a.number - b.number || a.timestamp.localeCompare(b.timestamp));
  return {
    snapshot: {
      kind: 'frm-games',
      version: 1,
      exportedAt: str(v.exportedAt) ? v.exportedAt : '',
      sessions: sessions.ok,
      items: items.ok,
      coverage: coverage.ok,
    },
    skipped: sessions.bad + items.bad + coverage.bad,
  };
}
