import { useMemo } from 'react';
import { LineChart } from 'lucide-react';
import { Section, TabShell } from '../components/shell/TabShell';
import { AccuracyRing } from '../components/dashboard/AccuracyRing';
import { ActionCard } from '../components/dashboard/Cards';
import { StatTile } from '../components/dashboard/StatTile';
import { TopicMap } from '../components/dashboard/TopicMap';
import { WeakLos } from '../components/dashboard/WeakLos';
import { navigate } from '../lib/router';
import { overallStats, weakestLos } from '../lib/stats';
import { useContent } from '../store/content';
import { useProgress } from '../store/progress';

function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Progress: how the question bank is going. The overall numbers, then where to work next (weakest LOs, the topic
 * map), then the way into the detailed charts.
 */
export function ProgressScreen() {
  const files = useContent((s) => s.files);
  const subjectQuestions = useContent((s) => s.subjectQuestions);
  const byId = useContent((s) => s.byId);
  const states = useProgress((s) => s.states);
  const attempts = useProgress((s) => s.attempts);

  const subjectFiles = useMemo(() => files.filter((f) => f.type === 'subject'), [files]);
  const stats = useMemo(() => overallStats(states, attempts), [states, attempts]);
  const weak = useMemo(() => weakestLos(subjectQuestions, states, 5), [subjectQuestions, states]);

  return (
    <TabShell title="Progress" lead="How the question bank is going">
      <section className="mt-4 rounded-2xl bg-card-light p-4 shadow-sm dark:bg-card-dark sm:p-5" aria-labelledby="overview-title">
        <h2 id="overview-title" className="sr-only">
          Overall progress
        </h2>
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <AccuracyRing accuracy={stats.accuracy} />
          <div className="grid w-full flex-1 grid-cols-2 gap-2">
            <StatTile label="Attempted" value={`${stats.questionsAttempted.toLocaleString()}/${subjectQuestions.length.toLocaleString()}`} />
            <StatTile label="Time studied" value={formatDuration(stats.secondsStudied)} />
            <StatTile label="Correct" value={stats.correct} className="text-emerald-600 dark:text-emerald-400" />
            <StatTile label="Wrong" value={stats.wrong} className="text-red-600 dark:text-red-400" />
          </div>
        </div>
      </section>

      <Section title="Weakest learning objectives" hint={weak.length > 0 ? 'Tap one to drill every question in it.' : undefined}>
        <WeakLos groups={weak} />
      </Section>

      {subjectFiles.length > 0 && (
        <Section title="Topic map" hint="Open a subject, then tap a topic for a 20-question drill.">
          <TopicMap subjectFiles={subjectFiles} byId={byId} states={states} startOpen={false} />
        </Section>
      )}

      <Section title="In depth">
        <ActionCard
          icon={<LineChart className="h-5 w-5" aria-hidden="true" />}
          title="Detailed analytics"
          detail="Accuracy over time, study calendar, time per question, trap types and past sessions"
          onClick={() => navigate('/analytics')}
        />
      </Section>
    </TabShell>
  );
}
