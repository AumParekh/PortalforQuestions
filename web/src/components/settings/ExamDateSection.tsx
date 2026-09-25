import { useEffect, useState } from 'react';
import { CAP_DAYS_BEFORE_EXAM, DEFAULT_EXAM_DATE, daysToExam, examCapDay, examPhase, isExamDay } from '../../games/examDate';
import { useSettings } from '../../lib/settings';
import { localDay } from '../../formulas/storage';
import { PHASE_LABEL, countdownText, formatExamDay } from '../dashboard/ExamPlan';
import { SettingsRow, SettingsSection, buttonSecondary } from './controls';

/** Settings → Exam: the exam date behind the Home countdown, the study phase and the review cap. */
export function ExamDateSection() {
  const exam = useSettings((s) => s.examDate);
  const setSettings = useSettings((s) => s.set);
  // The input's own text, so a half-typed date doesn't overwrite the saved one.
  const [draft, setDraft] = useState(exam);
  useEffect(() => setDraft(exam), [exam]);

  const today = localDay();
  const days = daysToExam(today, exam);
  const phase = examPhase(today, exam);
  const status = phase === 'after' || days === 0 ? countdownText(days, exam) : `${countdownText(days, exam)} · ${PHASE_LABEL[phase]}`;
  const invalid = draft !== '' && !isExamDay(draft);
  // The cap only shapes reviews scheduled before exam − 2 (games/examDate.ts capNextDue).
  const capNote =
    days > CAP_DAYS_BEFORE_EXAM
      ? `Reviews in every section are scheduled no later than ${formatExamDay(examCapDay(exam))}, two days before the exam.`
      : 'Reviews answered from now on follow their normal spacing.';

  const change = (value: string) => {
    setDraft(value);
    if (isExamDay(value)) setSettings({ examDate: value });
  };

  return (
    <SettingsSection title="Exam" description="Drives the countdown and today's plan on Home.">
      <SettingsRow
        label="Exam date"
        htmlFor="exam-date"
        hint={`${status}. ${capNote}`}
      >
        {/* min/max match the range isExamDay accepts, so the picker and the saved setting agree. */}
        <input
          id="exam-date"
          type="date"
          value={draft}
          min="2000-01-01"
          max="2100-12-31"
          required
          aria-invalid={invalid || draft === ''}
          onChange={(e: { currentTarget: HTMLInputElement }) => change(e.currentTarget.value)}
          onBlur={() => setDraft(exam)}
          className="min-h-[44px] w-full max-w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:[color-scheme:dark]"
        />
        {exam !== DEFAULT_EXAM_DATE && (
          <button type="button" onClick={() => change(DEFAULT_EXAM_DATE)} className={buttonSecondary}>
            Reset to {formatExamDay(DEFAULT_EXAM_DATE)}
          </button>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
