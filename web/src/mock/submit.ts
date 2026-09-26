import { useContent } from '../store/content';
import { useProgress } from '../store/progress';
import type { MockEndReason, MockResult, SessionRecord } from '../types';
import { buildResult, deadlineOf, mockFileBySlug } from './model';
import { useMock } from './store';

/**
 * Scores the attempt in progress for `slug` and records it: the result in the mock history, then one attempt per
 * question through the same `recordAnswer` path as a normal session (mode 'mock', unanswered = wrong with selected
 * ''), so Review Wrong, analytics, streaks and spaced repetition pick them up, and a session record for analytics.
 * Returns null when there is nothing to submit (already submitted, e.g. in another tab, or discarded).
 */
export function submitMock(slug: string, endedBy: MockEndReason, now = Date.now()): MockResult | null {
  const attempt = useMock.getState().take(slug);
  if (!attempt) return null;
  const { byId, files } = useContent.getState();
  const file = mockFileBySlug(files, slug);
  const result = buildResult(attempt, file?.name ?? slug, byId, endedBy, Math.min(now, deadlineOf(attempt)));
  // Every question was removed by a content update: nothing left to score.
  if (result.total === 0) return null;
  useMock.getState().addResult(result);

  const progress = useProgress.getState();
  for (const item of result.items) {
    const q = byId[item.questionId];
    if (!q) continue;
    progress.recordAnswer(
      q,
      { selected: item.selected, correct: item.correct, timeTakenSeconds: item.timeSeconds, timedOut: endedBy === 'time' && item.selected === '' },
      result.resultId,
      'mock',
    );
  }
  const totalSeconds = result.items.reduce((sum, i) => sum + i.timeSeconds, 0);
  const session: SessionRecord = {
    sessionId: result.resultId,
    startedAt: result.startedAt,
    endedAt: result.submittedAt,
    mode: 'mock',
    scope: { kind: 'subject', keys: [result.name] },
    totalQuestions: result.total,
    answered: result.answered,
    skipped: 0,
    correct: result.correct,
    // Unanswered questions score as wrong in a mock, so the session's accuracy is the mock score.
    wrong: result.total - result.correct,
    accuracy: result.correct / result.total,
    avgTimeSeconds: totalSeconds / result.total,
  };
  progress.recordSession(session);
  return result;
}

/** Submits every attempt whose time ran out (e.g. while the app was closed), as the exam would have. */
export function settleExpiredMocks(now = Date.now()): MockResult[] {
  const out: MockResult[] = [];
  for (const a of Object.values(useMock.getState().attempts)) {
    if (deadlineOf(a) > now) continue;
    const r = submitMock(a.slug, 'time', now);
    if (r) out.push(r);
  }
  return out;
}
