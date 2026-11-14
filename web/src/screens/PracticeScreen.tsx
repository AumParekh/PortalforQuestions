import { useMemo } from 'react';
import { useToday } from '../hooks/useToday';
import { CalendarDays, Dices, History, Library, Play } from 'lucide-react';
import { CardGrid, Section, TabShell } from '../components/shell/TabShell';
import { ActionCard, FileCard, TierCard, fileProgress } from '../components/dashboard/Cards';
import type { TierGroup } from '../components/dashboard/Cards';
import { openSetupWith, startDueReview, startRandomDrill, startSubjectQuick } from '../components/dashboard/launch';
import { SearchBox } from '../components/dashboard/SearchBox';
import { buildCatalog, tiersOf } from '../lib/catalog';
import { RECALL_TIERS } from '../lib/recallTiers';
import { navigate } from '../lib/router';
import { useSettings } from '../lib/settings';
import { DUE_SESSION_CAP, dueQuestionIds, nextDue } from '../lib/srs';
import { wrongQuestionStates } from '../lib/stats';
import { useContent } from '../store/content';
import { useProgress } from '../store/progress';
import { addDays, localDay } from '../formulas/storage';

/** A local YYYY-MM-DD at midday, so a DST change at midnight can't move it to another day. */
function dayAtNoon(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

function dueDetail(count: number, today: string, next: { day: string; count: number } | null): string {
  if (count > 0) {
    return count > DUE_SESSION_CAP
      ? `Spaced review: the ${DUE_SESSION_CAP} most overdue of ${count} due questions`
      : `Spaced review of ${count} ${count === 1 ? 'question' : 'questions'} due today`;
  }
  if (!next) return 'Nothing due yet: answered questions come back here on a spaced schedule';
  const when =
    next.day === addDays(today, 1)
      ? 'tomorrow'
      : dayAtNoon(next.day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `Nothing due today. Next: ${next.count} ${next.count === 1 ? 'question' : 'questions'} ${when}`;
}

/**
 * Practice: the question bank. Ways to start a session first, then what is waiting for review, then the bank by
 * recall tier and by subject.
 */
export function PracticeScreen() {
  const files = useContent((s) => s.files);
  const questions = useContent((s) => s.questions);
  const subjectQuestions = useContent((s) => s.subjectQuestions);
  const byId = useContent((s) => s.byId);
  const states = useProgress((s) => s.states);
  const exam = useSettings((s) => s.examDate);
  const day = useToday();

  const subjectFiles = useMemo(() => files.filter((f) => f.type === 'subject'), [files]);
  const subjectIds = useMemo(() => new Set(subjectQuestions.map((q) => q.id)), [subjectQuestions]);
  // Spaced-repetition reviews: attempted questions whose due date is today or earlier.
  const questionDue = useMemo(() => {
    const d = localDay();
    const known = (id: string) => !!byId[id];
    return { today: d, count: dueQuestionIds(states, d, known).length, next: nextDue(states, d, known) };
  }, [states, byId, day, exam]);
  // Matches Review Wrong's default "Still wrong only" view.
  const wrongCount = useMemo(
    () => wrongQuestionStates(states).filter((s) => s.lastResult === 'wrong' && byId[s.questionId]).length,
    [states, byId],
  );
  const progressByPath = useMemo(() => {
    const out: Record<string, ReturnType<typeof fileProgress>> = {};
    for (const f of subjectFiles) out[f.path] = fileProgress(f, states);
    return out;
  }, [subjectFiles, states]);
  // Recall-workbook tiers: a question belongs to every tier one of its sections is in.
  const tierGroups = useMemo((): TierGroup[] => {
    const sections = buildCatalog(subjectQuestions, 'section');
    return RECALL_TIERS.map((info) => ({
      info,
      questionIds: subjectQuestions.filter((q) => tiersOf(q).includes(info.id)).map((q) => q.id),
      sectionKeys: sections.filter((it) => it.code?.startsWith(info.id)).map((it) => it.key),
    })).filter((t) => t.questionIds.length > 0);
  }, [subjectQuestions]);
  const progressByTier = useMemo(() => tierGroups.map((t) => fileProgress(t, states)), [tierGroups, states]);
  const none = subjectQuestions.length === 0;

  return (
    <TabShell
      title="Practice"
      lead={`${subjectQuestions.length.toLocaleString()} questions in ${subjectFiles.length} ${subjectFiles.length === 1 ? 'subject' : 'subjects'}`}
    >
      <div className="mt-4">
        <SearchBox questions={questions} allowedIds={subjectIds} />
      </div>

      <Section title="Start a session">
        <CardGrid>
          <ActionCard
            primary
            icon={<Play className="h-5 w-5" aria-hidden="true" />}
            title="New Session"
            detail="Choose subjects, chapters, LOs or tiers, and how many questions"
            onClick={() => navigate('/setup')}
            disabled={none}
          />
          <ActionCard
            icon={<Library className="h-5 w-5" aria-hidden="true" />}
            title="Question library"
            detail="Open a learning objective and solve every question in it"
            onClick={() => navigate('/library')}
            disabled={none}
          />
          <ActionCard
            icon={<Dices className="h-5 w-5" aria-hidden="true" />}
            title="Random Drill"
            detail="20 random questions from all subjects"
            onClick={() => startRandomDrill(subjectQuestions)}
            disabled={none}
          />
        </CardGrid>
      </Section>

      <Section title="Review">
        <CardGrid>
          <ActionCard
            icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
            title={questionDue.count > 0 ? `Due for review (${questionDue.count})` : 'Due for review'}
            detail={dueDetail(questionDue.count, questionDue.today, questionDue.next)}
            onClick={() => startDueReview(states, byId, localDay())}
            disabled={questionDue.count === 0}
          />
          <ActionCard
            icon={<History className="h-5 w-5" aria-hidden="true" />}
            title={wrongCount > 0 ? `Review Wrong (${wrongCount})` : 'Review Wrong'}
            detail={wrongCount > 0 ? 'Every question you have missed' : 'Nothing to review yet: questions you miss land here'}
            onClick={() => navigate('/review')}
            disabled={wrongCount === 0}
          />
        </CardGrid>
      </Section>

      {tierGroups.length > 0 && (
        <Section title="By tier" hint="Recall workbook sections, Tier A first. Tap a tier to choose its sections; a question can sit in more than one tier.">
          <CardGrid>
            {tierGroups.map((t, i) => (
              <TierCard key={t.info.id} tier={t} progress={progressByTier[i]} onOpen={() => openSetupWith('section', t.sectionKeys)} />
            ))}
          </CardGrid>
        </Section>
      )}

      {subjectFiles.length > 0 && (
        <Section title="By subject" hint="Tap a subject for 20 shuffled questions from it.">
          <CardGrid>
            {subjectFiles.map((f) => (
              <FileCard
                key={f.path}
                file={f}
                progress={progressByPath[f.path]}
                onOpen={() => startSubjectQuick(byId[f.questionIds[0]]?.subject ?? f.name, f)}
              />
            ))}
          </CardGrid>
        </Section>
      )}
    </TabShell>
  );
}
