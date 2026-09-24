import { useMemo } from 'react';
import { Home, Play } from 'lucide-react';
import { navigate } from '../lib/router';
import { useContent } from '../store/content';
import { useSession } from '../store/session';
import type { Question, SessionConfig } from '../types';

interface Extreme {
  label: string;
  question: Question;
  measure: string;
}

const DEV_CONFIG: SessionConfig = {
  scopeKind: 'subject',
  selectedKeys: [],
  count: 'all',
  order: 'sequential',
  timerEnabled: true,
  timerSeconds: 120,
  trapOnly: false,
  wrongFirst: false,
  skipDrops: false,
};

function widestTableLine(text: string): number {
  let max = 0;
  for (const line of text.split('\n')) {
    const pipes = line.split('|').length - 1;
    if (pipes > max) max = pipes;
  }
  return max;
}

function maxBy(questions: Question[], score: (q: Question) => number): { q: Question; score: number } | null {
  let best: { q: Question; score: number } | null = null;
  for (const q of questions) {
    const s = score(q);
    if (!best || s > best.score) best = { q, score: s };
  }
  return best;
}

function computeExtremes(questions: Question[]): Extreme[] {
  const out: Extreme[] = [];
  const stem = maxBy(questions, (q) => q.question.length);
  if (stem) out.push({ label: 'Longest question stem', question: stem.q, measure: `${stem.score} chars` });
  const option = maxBy(questions, (q) => Math.max(0, ...q.options.map((o) => o.text.length)));
  if (option) out.push({ label: 'Longest single option', question: option.q, measure: `${option.score} chars` });
  const solution = maxBy(questions, (q) => q.solution.length);
  if (solution) out.push({ label: 'Longest solution', question: solution.q, measure: `${solution.score} chars` });
  const table = maxBy(questions, (q) => Math.max(widestTableLine(q.question), widestTableLine(q.solution)));
  if (table && table.score > 0) {
    out.push({ label: 'Widest markdown table', question: table.q, measure: `${table.score} pipes in one line` });
  }
  return out;
}

export function DevLongestScreen() {
  const questions = useContent((s) => s.questions);
  const enabled = window.location.hash.includes('dev=1');
  const extremes = useMemo(() => (enabled ? computeExtremes(questions) : []), [enabled, questions]);

  if (!enabled) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-16 text-center">
        <p className="text-lg font-semibold">Not found</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 font-medium text-white hover:bg-primary-600"
        >
          <Home className="h-5 w-5" aria-hidden="true" />
          Home
        </button>
      </div>
    );
  }

  const ids = Array.from(new Set(extremes.map((e) => e.question.id)));

  const open = () => {
    if (ids.length === 0) return;
    useSession.getState().start(DEV_CONFIG, ids);
    navigate('/session');
  };

  return (
    <div className="mx-auto max-w-[720px] px-4 pb-16 pt-6">
      <h1 className="text-2xl font-bold tracking-tight">Dev: worst-case content</h1>
      <p className="mt-1 text-slate-600 dark:text-slate-400">
        Scanned {questions.length} questions. Open these in the real Question screen to check layout.
      </p>

      <ul className="mt-5 space-y-3">
        {extremes.map((e) => (
          <li key={e.label} className="rounded-2xl bg-card-light p-4 shadow-sm dark:bg-card-dark">
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{e.label}</div>
            <div className="mt-1 font-mono text-sm">{e.question.id}</div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {e.question.subject} · {e.measure}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={open}
          disabled={ids.length === 0}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-5 font-medium text-white shadow-sm hover:bg-primary-600 disabled:opacity-50"
        >
          <Play className="h-5 w-5" aria-hidden="true" />
          Open in Question screen ({ids.length})
        </button>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-card-light px-5 font-medium hover:bg-slate-100 dark:border-slate-700 dark:bg-card-dark dark:hover:bg-slate-700"
        >
          <Home className="h-5 w-5" aria-hidden="true" />
          Home
        </button>
      </div>
    </div>
  );
}
