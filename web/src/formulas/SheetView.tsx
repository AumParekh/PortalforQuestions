import { useMemo, useState } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { AREAS, areaName, compareReadings, readingTitle } from './deck';
import { splitEquation } from './latex';
import { useGymRun } from './run';
import { Tex } from './tex';
import type { AreaCode, Formula } from './types';
import { Text, VariableList, btnSmall, card } from './ui';

function SheetCard({ formula, revealed, onToggle }: { formula: Formula; revealed: boolean; onToggle: (() => void) | null }) {
  const parts = splitEquation(formula.latex);
  return (
    <li className={card}>
      <h4 className="break-words text-lg font-semibold leading-snug">{formula.name}</h4>
      {formula.objective && <p className="text-[15px] text-slate-600 dark:text-slate-400">LO {formula.objective}</p>}
      <div className="mt-3">
        {revealed && !onToggle ? (
          <Tex latex={formula.latex} display />
        ) : revealed ? (
          <button
            type="button"
            onClick={onToggle ?? undefined}
            aria-label={`Cover the formula for ${formula.name}`}
            className="block w-full rounded-xl px-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
          >
            <Tex latex={formula.latex} display />
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            {parts && <Tex latex={`${parts.lhs} ${parts.op}`} className="text-lg" />}
            <button
              type="button"
              onClick={onToggle ?? undefined}
              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/60 bg-primary-50 px-4 text-[15px] font-semibold text-primary-700 hover:bg-primary-100 dark:bg-primary/10 dark:text-primary-100 dark:hover:bg-primary/20"
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              {parts ? 'Tap to reveal' : 'Tap to reveal the formula'}
            </button>
          </div>
        )}
      </div>
      {revealed && formula.intuition && <Text className="mt-2 text-[15px] text-slate-700 dark:text-slate-300">{formula.intuition}</Text>}
      <VariableList formula={formula} className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700" />
    </li>
  );
}

export function SheetView({ formulas, initialArea }: { formulas: Formula[]; initialArea: string | null }) {
  const areas = useMemo(() => AREAS.filter((a) => formulas.some((f) => f.area === a.code)), [formulas]);
  const [area, setArea] = useState<AreaCode | null>(() => areas.find((a) => a.code === initialArea)?.code ?? areas[0]?.code ?? null);
  const [showAll, setShowAll] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());

  const readings = useMemo(() => {
    const map = new Map<string, Formula[]>();
    for (const f of formulas) {
      if (f.area !== area) continue;
      const list = map.get(f.readingId);
      if (list) list.push(f);
      else map.set(f.readingId, [f]);
    }
    return [...map.entries()].sort((a, b) => compareReadings(a[0], b[0]));
  }, [formulas, area]);

  const toggle = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-surface-light/85 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-slate-700 dark:bg-surface-dark/85">
        <div className="mx-auto flex max-w-[720px] items-center gap-2 px-2 py-2">
          <button
            type="button"
            onClick={() => useGymRun.getState().toSetup()}
            aria-label="Back to Formula Gym"
            className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-lg font-semibold">Formula Sheet</h1>
          <button
            type="button"
            onClick={() => {
              setShowAll((v) => !v);
              setRevealed(new Set());
            }}
            aria-pressed={showAll}
            className={`${btnSmall} ml-auto inline-flex items-center gap-2`}
          >
            {showAll ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            {showAll ? 'Self-test' : 'Show all'}
          </button>
        </div>
        <div className="mx-auto max-w-[720px] px-4 pb-2">
          <div role="group" aria-label="Area" className="flex flex-wrap gap-1.5">
            {areas.map((a) => (
              <button
                key={a.code}
                type="button"
                aria-pressed={area === a.code}
                aria-label={`${a.name} (${a.code})`}
                onClick={() => {
                  setArea(a.code);
                  window.scrollTo({ top: 0 });
                }}
                className={`min-h-[44px] min-w-[52px] rounded-lg px-2.5 text-[15px] font-semibold transition-colors motion-reduce:transition-none ${
                  area === a.code ? 'bg-primary text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {a.code}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[720px] space-y-8 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
        {area && (
          <div>
            <h2 className="text-xl font-bold">{areaName(area)}</h2>
            <p className="text-[15px] text-slate-600 dark:text-slate-400">
              {showAll ? 'Reference view: every formula shown.' : 'Right-hand sides are covered. Say each one, then tap to check.'}
            </p>
          </div>
        )}
        {readings.map(([readingId, list]) => {
          const title = readingTitle(readingId);
          return (
            <section key={readingId} aria-labelledby={`sheet-${readingId}`} className="space-y-3">
              <h3 id={`sheet-${readingId}`} className="break-words text-base font-semibold text-slate-800 dark:text-slate-200">
                {readingId}
                {title ? `: ${title}` : ''}
              </h3>
              <ul className="space-y-3">
                {list.map((f) => (
                  <SheetCard key={f.id} formula={f} revealed={showAll || revealed.has(f.id)} onToggle={showAll ? null : () => toggle(f.id)} />
                ))}
              </ul>
            </section>
          );
        })}
        {!showAll && revealed.size > 0 && (
          <button type="button" className={btnSmall} onClick={() => setRevealed(new Set())}>
            Cover all again
          </button>
        )}
      </main>
    </div>
  );
}
