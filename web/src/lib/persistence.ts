import { useContent } from '../store/content';
import { useProgress } from '../store/progress';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import type { SessionMode, SessionRecord } from '../types';
import { deleteMeta, getMeta, setMeta } from './db';

const SNAPSHOT_KEY = 'currentSession';

type Snapshot = Pick<
  ReturnType<typeof useSession.getState>,
  'sessionId' | 'status' | 'config' | 'queue' | 'currentIndex' | 'answers' | 'skipped' | 'marked' | 'startedAt' | 'endedAt'
>;

function snapshotOf(s: ReturnType<typeof useSession.getState>): Snapshot {
  const { sessionId, status, config, queue, currentIndex, answers, skipped, marked, startedAt, endedAt } = s;
  return { sessionId, status, config, queue, currentIndex, answers, skipped, marked, startedAt, endedAt };
}

function modeOf(s: Snapshot): SessionMode {
  return s.config?.mode ?? 'drill';
}

function sessionRecord(s: Snapshot): SessionRecord | null {
  if (!s.sessionId || !s.startedAt) return null;
  const answered = s.queue.filter((id) => s.answers[id]);
  const correct = answered.filter((id) => s.answers[id].correct).length;
  const time = answered.reduce((sum, id) => sum + s.answers[id].timeTakenSeconds, 0);
  return {
    sessionId: s.sessionId,
    startedAt: s.startedAt,
    endedAt: s.endedAt ?? new Date().toISOString(),
    mode: modeOf(s),
    scope: { kind: s.config?.scopeKind ?? 'subject', keys: s.config?.selectedKeys ?? [] },
    totalQuestions: s.queue.length,
    answered: answered.length,
    skipped: s.queue.filter((id) => !s.answers[id] && s.skipped[id]).length,
    correct,
    wrong: answered.length - correct,
    accuracy: answered.length ? correct / answered.length : 0,
    avgTimeSeconds: answered.length ? time / answered.length : 0,
  };
}

let started = false;

/**
 * Loads saved progress, restores an unfinished session, then mirrors session events into IndexedDB:
 * each new answer → attempt + question state, mark toggles → markedForReview, finish → session record.
 */
export async function initPersistence(): Promise<void> {
  if (started) return;
  started = true;

  await useProgress.getState().load();
  const available = useProgress.getState().status === 'ready';

  if (available) {
    try {
      const saved = await getMeta<Snapshot>(SNAPSHOT_KEY);
      if (saved && saved.status !== 'idle' && saved.queue.length > 0 && useSession.getState().status === 'idle') {
        useSession.setState(saved);
      }
    } catch (e) {
      console.warn('[persistence] could not restore session', e);
    }
  }

  useUi.setState({ persistenceReady: true });

  let saveTimer: number | undefined;
  let lastSessionId = useSession.getState().sessionId;

  useSession.subscribe((s, prev) => {
    const progress = useProgress.getState();
    const byId = useContent.getState().byId;

    // A new session: pre-flag questions already marked for review in earlier sessions.
    if (s.sessionId && s.sessionId !== lastSessionId) {
      lastSessionId = s.sessionId;
      const marked: Record<string, true> = {};
      for (const id of s.queue) if (progress.states[id]?.markedForReview) marked[id] = true;
      if (Object.keys(marked).length > 0) {
        useSession.setState({ marked: { ...marked, ...s.marked } });
        return;
      }
    }

    if (s.sessionId && s.answers !== prev.answers) {
      for (const id of Object.keys(s.answers)) {
        if (prev.answers[id] || prev.sessionId !== s.sessionId) continue;
        const q = byId[id];
        if (q) progress.recordAnswer(q, s.answers[id], s.sessionId, modeOf(s));
      }
    }

    if (s.marked !== prev.marked && s.sessionId === prev.sessionId) {
      for (const id of new Set([...Object.keys(s.marked), ...Object.keys(prev.marked)])) {
        const now = !!s.marked[id];
        if (now !== !!prev.marked[id] && byId[id]) progress.setMarked(byId[id], now);
      }
    }

    if (s.status === 'finished' && (prev.status !== 'finished' || s.endedAt !== prev.endedAt)) {
      const rec = sessionRecord(snapshotOf(s));
      if (rec) progress.recordSession(rec);
    }

    if (!available) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const cur = useSession.getState();
      const op = cur.status === 'idle' ? deleteMeta(SNAPSHOT_KEY) : setMeta(SNAPSHOT_KEY, snapshotOf(cur));
      op.catch((e) => console.warn('[persistence] could not save session', e));
    }, 300);
  });
}
