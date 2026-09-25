import { GraduationCap, CalendarDays, CheckSquare, ChevronRight, Gamepad2, Gauge, Sigma } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ExamPhase } from '../../games/examDate';

export const PHASE_LABEL: Record<ExamPhase, string> = {
  setup: 'Setup phase',
  learn: 'Learn phase',
  consolidate: 'Consolidate phase',
  final: 'Final review',
  after: 'Exam done',
};

/** One line on what today is for, by phase (PORTAL_PLAN §0b). */
export const PHASE_TIP: Record<ExamPhase, string> = {
  setup: 'Get ahead: cover a new reading today.',
  learn: 'Cover a new reading today.',
  consolidate: 'A timed mock or a weak-topic drill.',
  final: 'Due items and the formula sheet only.',
  after: 'Set your next exam date in Settings to plan again.',
};

/** A local YYYY-MM-DD at midday, so a DST change at midnight can't move it to another day. */
function dayAtNoon(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/** "25 Nov 2026" in the reader's locale. */
export function formatExamDay(day: string): string {
  return dayAtNoon(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "61 days to the exam", "1 day to the exam", "Exam day", or "Exam was 25 Nov 2026". */
export function countdownText(days: number, exam: string): string {
  if (days > 1) return `${days} days to the exam`;
  if (days === 1) return '1 day to the exam';
  if (days === 0) return 'Exam day';
  return `Exam was ${formatExamDay(exam)}`;
}

export function ExamCountdown({ days, phase, exam, onOpenSettings }: { days: number; phase: ExamPhase; exam: string; onOpenSettings: () => void }) {
  const line = phase === 'after' || days === 0 ? countdownText(days, exam) : `${countdownText(days, exam)} · ${PHASE_LABEL[phase]}`;
  return (
    <button
      type="button"
      onClick={onOpenSettings}
      aria-label={`${line}. Exam date ${formatExamDay(exam)}. Change it in Settings.`}
      className="mt-4 flex min-h-[44px] w-full items-center gap-3 rounded-2xl bg-card-light px-4 py-3 text-left shadow-sm transition hover:shadow-md dark:bg-card-dark"
    >
      <GraduationCap className="h-5 w-5 shrink-0 text-primary-600 dark:text-primary-100" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug">{line}</span>
        <span className="block text-[15px] text-slate-600 dark:text-slate-400">FRM Part II · {formatExamDay(exam)}</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
    </button>
  );
}

export type PlanSection = 'questions' | 'formulas' | 'sense' | 'truefalse' | 'games';

export interface PlanRow {
  key: PlanSection;
  count: number;
  /** Most items one tap starts (the question bank's Due session takes 20 at a time); undefined = no limit. */
  perSession?: number;
  onOpen: () => void;
}

/** Rough minutes per due item, for the suggested time on each row. */
const MINUTES_PER_ITEM: Record<PlanSection, number> = { questions: 1.5, formulas: 0.5, sense: 1, truefalse: 0.25, games: 0.4 };

const SECTION: Record<PlanSection, { title: string; icon: ReactNode; one: string; many: string; none: string }> = {
  questions: {
    title: 'Question bank',
    icon: <CalendarDays className="h-5 w-5" aria-hidden="true" />,
    one: 'question due for review',
    many: 'questions due for review',
    none: 'Nothing due: start a new session',
  },
  formulas: {
    title: 'Formula Gym',
    icon: <Sigma className="h-5 w-5" aria-hidden="true" />,
    one: 'formula due',
    many: 'formulas due',
    none: 'Nothing due',
  },
  sense: {
    title: 'Sense Check',
    icon: <Gauge className="h-5 w-5" aria-hidden="true" />,
    one: 'scenario due',
    many: 'scenarios due',
    none: 'Nothing due',
  },
  truefalse: {
    title: 'True / False',
    icon: <CheckSquare className="h-5 w-5" aria-hidden="true" />,
    one: 'missed statement to get right',
    many: 'missed statements to get right',
    none: 'No missed statements',
  },
  games: {
    title: 'Notes Games',
    icon: <Gamepad2 className="h-5 w-5" aria-hidden="true" />,
    one: 'item due',
    many: 'items due',
    none: 'Nothing due',
  },
};

export function minutesFor(key: PlanSection, count: number): number {
  return count > 0 ? Math.max(1, Math.round(count * MINUTES_PER_ITEM[key])) : 0;
}

/**
 * Today's plan: what is due in each section (sections with something due first, in the given order), each row
 * opening that section, with a rough time and the phase's one-line tip.
 */
export function TodaysPlan({ rows, phase }: { rows: PlanRow[]; phase: ExamPhase }) {
  const ordered = [...rows.filter((r) => r.count > 0), ...rows.filter((r) => r.count === 0)];
  const total = rows.reduce((sum, r) => sum + minutesFor(r.key, r.count), 0);
  return (
    <section aria-labelledby="todays-plan-title" className="mt-3 rounded-2xl bg-card-light p-4 shadow-sm dark:bg-card-dark sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="todays-plan-title" className="font-semibold">
          Today's plan
        </h2>
        <span className="text-[15px] text-slate-600 dark:text-slate-400">{total > 0 ? `about ${total} min of reviews` : 'All caught up'}</span>
      </div>
      <p className="mt-1 text-[15px] text-slate-600 dark:text-slate-400">{PHASE_TIP[phase]}</p>
      <ul className="-mx-2 mt-2">
        {ordered.map((r) => {
          const s = SECTION[r.key];
          const mins = minutesFor(r.key, r.count);
          const batch = r.perSession !== undefined && r.count > r.perSession ? ` · ${r.perSession} per session` : '';
          const detail = r.count > 0 ? `${r.count.toLocaleString()} ${r.count === 1 ? s.one : s.many}${batch} · about ${mins} min` : s.none;
          return (
            <li key={r.key}>
              <button
                type="button"
                onClick={r.onOpen}
                className="flex min-h-[56px] w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <span
                  className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    r.count > 0
                      ? 'bg-primary-50 text-primary-600 dark:bg-slate-800 dark:text-primary-100'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {s.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium leading-snug">{s.title}</span>
                  <span className="block text-[15px] text-slate-600 dark:text-slate-400">{detail}</span>
                </span>
                {r.count > 0 && (
                  <span className="shrink-0 rounded-full bg-primary-50 px-2.5 py-0.5 text-[15px] font-semibold tabular-nums text-primary-700 dark:bg-slate-800 dark:text-primary-100">
                    {r.count.toLocaleString()}
                  </span>
                )}
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
