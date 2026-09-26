import { Home } from 'lucide-react';
import { navigate } from '../lib/router';
import { useContent } from '../store/content';
import { BriefingView } from './BriefingView';
import { ExamView } from './ExamView';
import { mockFileBySlug, parseMockRoute } from './model';
import { ResultsView } from './ResultsView';
import { ReviewView } from './ReviewView';
import { useMock } from './store';
import { Shell, btnSecondary, card } from './ui';

function Missing({ title, body }: { title: string; body: string }) {
  return (
    <Shell title="Mock exam">
      <div className={`${card} mt-2 text-center`}>
        <p className="text-lg font-semibold">{title}</p>
        <p className="mt-2 break-words text-slate-600 dark:text-slate-400">{body}</p>
        <button type="button" onClick={() => navigate('/')} className={`${btnSecondary} mt-5`}>
          <Home className="h-4 w-4" aria-hidden="true" />
          Home
        </button>
      </div>
    </Shell>
  );
}

function Loading() {
  return (
    <div className="mx-auto max-w-[720px] space-y-4 px-4 py-8" aria-busy="true" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200 motion-reduce:animate-none dark:bg-slate-800" />
      ))}
    </div>
  );
}

/** #/mock/<slug>[/exam | /results/<id>[/<n>]]: briefing, the timed exam, results and per-question review. */
export function MockScreen({ route }: { route: string }) {
  const files = useContent((s) => s.files);
  const status = useMock((s) => s.status);
  const view = parseMockRoute(route);
  const file = view ? mockFileBySlug(files, view.slug) : undefined;

  if (!view) return <Missing title="Page not found" body="This mock exam link isn't valid." />;
  if (status === 'idle' || status === 'loading') return <Loading />;

  // Results stay viewable after a mock file is renamed or removed; everything else needs the file.
  if (view.kind === 'results') return <ResultsView slug={view.slug} resultId={view.resultId} />;
  if (view.kind === 'review') return <ReviewView slug={view.slug} resultId={view.resultId} index={view.index} />;
  if (!file) return <Missing title="Mock not available" body={`There is no mock exam called "${view.slug}" in the question bank.`} />;
  if (view.kind === 'exam') return <ExamView slug={view.slug} />;
  return <BriefingView slug={view.slug} file={file} />;
}
