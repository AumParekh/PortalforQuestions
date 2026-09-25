import type { TFCard, TFState } from '../../types';

export type StatusFilter = 'all' | 'new' | 'missed' | 'wrong';
export type DeckSize = 10 | 20 | 40 | 'all';
export type DeckOrder = 'shuffled' | 'weakest';

export interface TfSetup {
  subjects: string[];
  /** `${subject}::${topic}` keys. A subject with none of its topics listed contributes all of them. */
  topics: string[];
  status: StatusFilter;
  size: DeckSize;
  order: DeckOrder;
}

export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'Never seen' },
  { value: 'missed', label: 'Missed before' },
  { value: 'wrong', label: 'Still wrong' },
];

export const SIZE_OPTIONS: { value: DeckSize; label: string }[] = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 40, label: '40' },
  { value: 'all', label: 'All' },
];

export const ORDER_OPTIONS: { value: DeckOrder; label: string }[] = [
  { value: 'shuffled', label: 'Shuffled' },
  { value: 'weakest', label: 'Weakest first' },
];

const STORAGE_KEY = 'frm.truefalse.v1';

export const DEFAULT_SETUP: TfSetup = { subjects: [], topics: [], status: 'all', size: 20, order: 'shuffled' };

function pick<T>(value: unknown, allowed: { value: T }[], fallback: T): T {
  const hit = allowed.find((a) => a.value === value);
  return hit ? hit.value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** The saved setup, or null when nothing (valid) was saved. Subjects/topics are validated against the deck later. */
export function loadSetup(): TfSetup | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    return {
      subjects: strings(d.subjects),
      topics: strings(d.topics),
      status: pick(d.status, STATUS_OPTIONS, DEFAULT_SETUP.status),
      size: pick(d.size, SIZE_OPTIONS, DEFAULT_SETUP.size),
      order: pick(d.order, ORDER_OPTIONS, DEFAULT_SETUP.order),
    };
  } catch {
    return null;
  }
}

export function saveSetup(setup: TfSetup) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(setup));
  } catch {
    // Storage may be unavailable (private mode, quota); setup still works without it.
  }
}

export const topicKey = (subject: string, topic: string) => `${subject}::${topic}`;

// Same subject order as the question banks; anything unknown sorts after, alphabetically.
const CODE_ORDER = ['IR', 'MR', 'CR', 'LR', 'OR', 'CI'];

export interface SubjectInfo {
  subject: string;
  total: number;
  seen: number;
  attempts: number;
  correct: number;
  topics: { key: string; topic: string; total: number }[];
}

export function subjectInfo(cards: TFCard[], states: Record<string, TFState>): SubjectInfo[] {
  const map = new Map<string, SubjectInfo & { rank: number; topicMap: Map<string, number> }>();
  for (const c of cards) {
    let s = map.get(c.subject);
    if (!s) {
      const code = c.sourceId.split('-')[0] ?? '';
      const idx = CODE_ORDER.indexOf(code);
      s = { subject: c.subject, total: 0, seen: 0, attempts: 0, correct: 0, topics: [], rank: idx === -1 ? 99 : idx, topicMap: new Map() };
      map.set(c.subject, s);
    }
    s.total += 1;
    s.topicMap.set(c.topic, (s.topicMap.get(c.topic) ?? 0) + 1);
    const st = states[c.id];
    if (st && st.totalAttempts > 0) {
      s.seen += 1;
      s.attempts += st.totalAttempts;
      s.correct += st.totalCorrect;
    }
  }
  return [...map.values()]
    .sort((a, b) => a.rank - b.rank || a.subject.localeCompare(b.subject))
    .map(({ rank: _rank, topicMap, ...s }) => ({
      ...s,
      topics: [...topicMap.entries()]
        .map(([topic, total]) => ({ key: topicKey(s.subject, topic), topic, total }))
        .sort((a, b) => a.topic.localeCompare(b.topic)),
    }));
}

export function matchesStatus(state: TFState | undefined, status: StatusFilter): boolean {
  switch (status) {
    case 'new':
      return !state || state.totalAttempts === 0;
    case 'missed':
      return !!state && state.totalWrong > 0;
    case 'wrong':
      return !!state && state.lastResult === 'wrong';
    default:
      return true;
  }
}

/** Cards matching the setup's subjects, topics and status (before ordering and sizing). */
export function filterPool(cards: TFCard[], states: Record<string, TFState>, setup: TfSetup): TFCard[] {
  const subjects = new Set(setup.subjects);
  const topics = new Set(setup.topics);
  const narrowed = new Set<string>();
  for (const k of setup.topics) narrowed.add(k.slice(0, k.indexOf('::')));
  return cards.filter(
    (c) =>
      subjects.has(c.subject) &&
      (!narrowed.has(c.subject) || topics.has(topicKey(c.subject, c.topic))) &&
      matchesStatus(states[c.id], setup.status),
  );
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardAccuracy(state: TFState | undefined): number {
  return state && state.totalAttempts > 0 ? state.totalCorrect / state.totalAttempts : 0.5;
}

export function buildDeck(cards: TFCard[], states: Record<string, TFState>, setup: TfSetup): string[] {
  const pool = filterPool(cards, states, setup);
  const ordered =
    setup.order === 'weakest'
      ? [...pool].sort((a, b) => cardAccuracy(states[a.id]) - cardAccuracy(states[b.id]) || a.id.localeCompare(b.id))
      : shuffle(pool);
  const ids = spreadTwins(ordered.map((c) => c.id), cards);
  return setup.size === 'all' ? ids : ids.slice(0, setup.size);
}

const TWIN_GAP = 4;

/** Keeps a false card and its corrected twin at least TWIN_GAP apart so one never gives away the other. */
export function spreadTwins(ids: string[], cards: TFCard[]): string[] {
  const twinOf = new Map<string, string>();
  for (const c of cards) if (c.twinId) twinOf.set(c.id, c.twinId);
  const out: string[] = [];
  const deferred: string[] = [];
  const place = (id: string) => {
    const twin = twinOf.get(id);
    const recent = out.slice(-TWIN_GAP);
    if (twin && recent.includes(twin)) return false;
    out.push(id);
    return true;
  };
  for (const id of ids) {
    if (!place(id)) deferred.push(id);
    for (let i = 0; i < deferred.length; i++) if (place(deferred[i])) deferred.splice(i--, 1);
  }
  return [...out, ...deferred];
}

export function pct(correct: number, total: number): number {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function haptic(pattern: number | number[]) {
  try {
    if (window.matchMedia?.('(pointer: coarse)').matches) navigator.vibrate?.(pattern);
  } catch {
    // vibrate can throw in some embedded browsers; feedback is optional
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

export function isCoarsePointer(): boolean {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  } catch {
    return false;
  }
}
