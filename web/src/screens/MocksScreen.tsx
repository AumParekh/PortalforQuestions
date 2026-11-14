import { useMemo } from 'react';
import { CardGrid, Section, TabShell } from '../components/shell/TabShell';
import { MockCard, MockResumeBanners } from '../components/dashboard/MockCard';
import { useContent } from '../store/content';
import { mockSlug } from '../mock/model';
import { resultsFor, useMock } from '../mock/store';

/** Mocks: full timed exams. An attempt in progress comes first, then every paper with its last result. */
export function MocksScreen() {
  const files = useContent((s) => s.files);
  const results = useMock((s) => s.results);
  const attempts = useMock((s) => s.attempts);
  const mockFiles = useMemo(() => files.filter((f) => f.type === 'mock'), [files]);

  return (
    <TabShell
      title="Mocks"
      lead={
        mockFiles.length > 0
          ? `${mockFiles.length} timed ${mockFiles.length === 1 ? 'exam' : 'exams'} under exam conditions`
          : 'Timed exams under exam conditions'
      }
    >
      <MockResumeBanners files={mockFiles} attempts={attempts} />
      {mockFiles.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-card-light p-4 text-slate-600 shadow-sm dark:bg-card-dark dark:text-slate-400">No mock exams are loaded yet.</p>
      ) : (
        <Section title="Exam papers" hint="No answers are shown until you submit. The clock keeps running if you leave.">
          <CardGrid>
            {mockFiles.map((f) => {
              const slug = mockSlug(f.path);
              return <MockCard key={f.path} file={f} results={resultsFor(results, slug)} attempt={attempts[slug]} />;
            })}
          </CardGrid>
        </Section>
      )}
    </TabShell>
  );
}
