import type { Question, QuestionState } from '../types';
import { accuracyOf } from './stats';

/**
 * FRM Part II exam weights (PORTAL_PLAN §0b), keyed by the question bank's subject codes (the file name: MR.json …).
 * The notes use ORR / LTR / IM for OR / LR / IR.
 */
export const EXAM_WEIGHTS: Record<string, number> = { MR: 0.2, CR: 0.2, OR: 0.2, LR: 0.15, IR: 0.15, CI: 0.1 };

export interface SubjectCoverage {
  /** Bank code, e.g. "MR". */
  code: string;
  /** Subject name from the content, e.g. "Market Risk". */
  subject: string;
  weight: number;
  total: number;
  /** Questions answered at least once. */
  attempted: number;
  /** attempted / total. */
  coverage: number;
  attempts: number;
  accuracy: number | null;
  /** Share of the exam at risk: weight × (1 − coverage × accuracy). The largest is the subject most behind. */
  gap: number;
  questionIds: string[];
}

/** "MR.json" → "MR"; null for mocks and anything outside the six banks. */
export function bankCode(file: string): string | null {
  const m = /^([A-Z]+)\.json$/.exec(file);
  return m && m[1] in EXAM_WEIGHTS ? m[1] : null;
}

/** Coverage and accuracy per weighted subject, in exam-weight order (heaviest first). */
export function subjectCoverage(questions: Question[], states: Record<string, QuestionState>): SubjectCoverage[] {
  const bySubject = new Map<string, SubjectCoverage & { correct: number }>();
  for (const q of questions) {
    const code = bankCode(q.file);
    if (!code) continue;
    let g = bySubject.get(code);
    if (!g) {
      g = { code, subject: q.subject, weight: EXAM_WEIGHTS[code], total: 0, attempted: 0, coverage: 0, attempts: 0, correct: 0, accuracy: null, gap: 0, questionIds: [] };
      bySubject.set(code, g);
    }
    g.total++;
    g.questionIds.push(q.id);
    const s = states[q.id];
    if (s && s.totalAttempts > 0) {
      g.attempted++;
      g.attempts += s.totalAttempts;
      g.correct += s.totalCorrect;
    }
  }
  const order = Object.keys(EXAM_WEIGHTS);
  return [...bySubject.values()]
    .map(({ correct, ...g }) => {
      const coverage = g.total ? g.attempted / g.total : 0;
      const accuracy = accuracyOf(correct, g.attempts);
      return { ...g, coverage, accuracy, gap: g.weight * (1 - coverage * (accuracy ?? 0)) };
    })
    .sort((a, b) => b.weight - a.weight || order.indexOf(a.code) - order.indexOf(b.code));
}

/** The subject most behind for its weight (largest gap), or null when there is nothing to compare. */
export function mostBehind(rows: SubjectCoverage[]): SubjectCoverage | null {
  let worst: SubjectCoverage | null = null;
  for (const r of rows) if (!worst || r.gap > worst.gap + 1e-9) worst = r;
  return worst;
}
