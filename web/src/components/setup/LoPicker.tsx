import { useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { loCodeTest } from '../../lib/search';
import { ChapterSearch, Highlight, matchesQuery } from './ChapterSearch';

export interface LoLeaf {
  /** What gets selected. */
  id: string;
  /** Shown before the wording and on the chosen chip: "MR-2 c". */
  code?: string;
  label: string;
  /** Second line, e.g. "12 statements · 3 seen". */
  detail?: string;
}

export interface LoChapter {
  id: string;
  /** "MR-2: Non-Parametric Approaches" */
  label: string;
  los: LoLeaf[];
}

export interface LoSubject {
  id: string;
  title: string;
  chapters: LoChapter[];
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Multi-select of learning objectives, folded twice: subjects open to their chapters, chapters to their LOs. A
 * chapter's "Select" ticks all of its LOs at once. Everything starts folded unless it holds a chosen LO; while a
 * search is typed, every match is unfolded. `selected` holds leaf ids.
 */
export function LoPicker({
  subjects,
  selected,
  onChange,
  idPrefix,
}: {
  subjects: LoSubject[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Keeps element ids unique per screen. */
  idPrefix: string;
}) {
  const [query, setQuery] = useState('');
  const chosen = useMemo(() => new Set(selected), [selected]);
  const [open, setOpen] = useState<Set<string>>(() => {
    const out = new Set<string>();
    for (const s of subjects) {
      for (const c of s.chapters) {
        if (!c.los.some((l) => chosen.has(l.id))) continue;
        out.add(`s|${s.id}`);
        out.add(`c|${c.id}`);
      }
    }
    return out;
  });

  const searching = query.trim().length > 0;
  const shown = useMemo((): LoSubject[] => {
    if (!searching) return subjects;
    // A code ("MR-2 c", "MR-2") names LOs; otherwise a chapter or subject match keeps all of its LOs, and an LO
    // match keeps just that LO.
    const byCode = loCodeTest(query);
    const coded = byCode ? subjects.some((s) => s.chapters.some((c) => c.los.some((l) => l.code && byCode(l.code)))) : false;
    return subjects
      .map((s) => ({
        ...s,
        chapters: s.chapters
          .map((c) => {
            if (coded && byCode) return { ...c, los: c.los.filter((l) => l.code && byCode(l.code)) };
            if (matchesQuery(query, c.label, s.title)) return c;
            return { ...c, los: c.los.filter((l) => matchesQuery(query, l.code, l.label)) };
          })
          .filter((c) => c.los.length > 0),
      }))
      .filter((s) => s.chapters.length > 0);
  }, [subjects, query, searching]);
  const shownIds = useMemo(() => shown.flatMap((s) => s.chapters.flatMap((c) => c.los.map((l) => l.id))), [shown]);
  const mark = loCodeTest(query) ? '' : query;

  // Chips: a chapter chosen in full is one chip; otherwise one chip per chosen LO.
  const chips = useMemo(() => {
    const out: { key: string; label: string; ids: string[] }[] = [];
    for (const s of subjects) {
      for (const c of s.chapters) {
        const picked = c.los.filter((l) => chosen.has(l.id));
        if (picked.length === 0) continue;
        if (picked.length === c.los.length && c.los.length > 1) out.push({ key: c.id, label: c.label, ids: picked.map((l) => l.id) });
        else for (const l of picked) out.push({ key: l.id, label: l.code ?? l.label, ids: [l.id] });
      }
    }
    return out;
  }, [subjects, chosen]);
  const known = useMemo(() => new Set(subjects.flatMap((s) => s.chapters.flatMap((c) => c.los.map((l) => l.id)))), [subjects]);
  const chosenCount = selected.filter((id) => known.has(id)).length;

  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  const setMany = (ids: string[], on: boolean) => {
    if (!on) {
      const drop = new Set(ids);
      onChange(selected.filter((id) => !drop.has(id)));
    } else {
      onChange([...selected, ...ids.filter((id) => !chosen.has(id))]);
    }
  };
  const toggleOpen = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allShownChosen = shownIds.length > 0 && shownIds.every((id) => chosen.has(id));
  const smallBtn =
    'min-h-[44px] rounded-xl border border-slate-200 px-3 text-[15px] font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800';

  return (
    <div className="space-y-3">
      <ChapterSearch value={query} onChange={setQuery} placeholder="Search chapters or LOs, MR-2 c" label="Search chapters or learning objectives" />

      {chosenCount > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[15px] font-medium text-slate-700 dark:text-slate-300">{count(chosenCount, 'learning objective', 'learning objectives')} chosen</p>
            <button type="button" className={smallBtn} onClick={() => onChange([])}>
              Clear
            </button>
          </div>
          <ul className="flex flex-wrap gap-2" aria-label="Chosen learning objectives">
            {chips.map((c) => (
              <li key={c.key} className="max-w-full">
                <button
                  type="button"
                  onClick={() => setMany(c.ids, false)}
                  aria-label={`Remove ${c.label}`}
                  className="inline-flex min-h-[40px] max-w-full items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-left text-[15px] font-medium leading-snug text-white hover:bg-primary-600"
                >
                  <span className="min-w-0 break-words">{c.label}</span>
                  <X className="h-4 w-4 shrink-0" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {searching && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-[15px] text-slate-600 dark:text-slate-400">
            {shownIds.length === 0 ? `Nothing matches “${query.trim()}”` : `${count(shownIds.length, 'learning objective matches', 'learning objectives match')}`}
          </p>
          {shownIds.length > 1 && (
            <button type="button" className={smallBtn} onClick={() => setMany(shownIds, !allShownChosen)}>
              {allShownChosen ? 'Unselect these' : 'Select these'}
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {shown.map((s) => {
          const subjectOpen = searching || open.has(`s|${s.id}`);
          const total = s.chapters.reduce((n, c) => n + c.los.length, 0);
          const picked = s.chapters.reduce((n, c) => n + c.los.filter((l) => chosen.has(l.id)).length, 0);
          const panelId = `${idPrefix}-subject-${s.id}`;
          return (
            <section key={s.id} className="rounded-2xl bg-card-light shadow-sm dark:bg-card-dark">
              <button
                type="button"
                aria-expanded={subjectOpen}
                aria-controls={panelId}
                disabled={searching}
                onClick={() => toggleOpen(`s|${s.id}`)}
                className="flex min-h-[52px] w-full items-center justify-between gap-2 px-4 py-2 text-left disabled:cursor-default"
              >
                <span className="min-w-0">
                  <span className="block break-words font-semibold">{s.title}</span>
                  <span className="block text-[15px] text-slate-600 dark:text-slate-400">
                    {count(s.chapters.length, 'chapter', 'chapters')} · {count(total, 'LO', 'LOs')}
                    {picked > 0 ? ` · ${picked} chosen` : ''}
                  </span>
                </span>
                {!searching && (
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 transition-transform motion-reduce:transition-none ${subjectOpen ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                )}
              </button>
              {subjectOpen && (
                <div id={panelId} className="space-y-2 border-t border-slate-200 p-2 dark:border-slate-700">
                  {s.chapters.map((c) => {
                    const chapterOpen = searching || open.has(`c|${c.id}`);
                    const ids = c.los.map((l) => l.id);
                    const on = ids.filter((id) => chosen.has(id)).length;
                    const allOn = on === ids.length;
                    return (
                      <div key={c.id} className="space-y-2">
                        <div
                          className={`flex items-stretch gap-1 rounded-xl border ${
                            on > 0
                              ? 'border-primary/40 bg-primary-50/60 dark:border-primary/40 dark:bg-primary/10'
                              : 'border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <button
                            type="button"
                            aria-expanded={chapterOpen}
                            disabled={searching}
                            onClick={() => toggleOpen(`c|${c.id}`)}
                            className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800"
                          >
                            <ChevronDown
                              className={`h-5 w-5 shrink-0 text-slate-500 transition-transform motion-reduce:transition-none dark:text-slate-400 ${chapterOpen ? '' : '-rotate-90'}`}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 [overflow-wrap:anywhere]">
                              <span className="block text-[15px] font-medium leading-snug">
                                <Highlight text={c.label} query={mark} />
                              </span>
                              <span className="block text-[15px] text-slate-600 dark:text-slate-400">
                                {count(ids.length, 'LO', 'LOs')}
                                {on > 0 ? ` · ${on} chosen` : ''}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setMany(ids, !allOn)}
                            aria-label={`${allOn ? 'Clear' : 'Select'} all in ${c.label}`}
                            className="min-h-[44px] shrink-0 rounded-xl px-3 text-[15px] font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-100 dark:hover:bg-primary/15"
                          >
                            {allOn ? 'Clear' : 'Select'}
                          </button>
                        </div>
                        {chapterOpen && (
                          <ul className="space-y-1 border-l-2 border-slate-200 pl-2 dark:border-slate-700">
                            {c.los.map((l) => {
                              const picked = chosen.has(l.id);
                              return (
                                <li key={l.id}>
                                  <button
                                    type="button"
                                    aria-pressed={picked}
                                    onClick={() => toggle(l.id)}
                                    className={`flex min-h-[52px] w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors motion-reduce:transition-none ${
                                      picked ? 'bg-primary-50 dark:bg-primary/15' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                                    }`}
                                  >
                                    <span
                                      aria-hidden="true"
                                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                                        picked ? 'border-primary bg-primary text-white' : 'border-slate-300 dark:border-slate-600'
                                      }`}
                                    >
                                      {picked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                                    </span>
                                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                      {l.code && (
                                        <span className="block text-[15px] font-semibold text-primary-700 dark:text-primary-100">
                                          <Highlight text={l.code} query={mark} />
                                        </span>
                                      )}
                                      <span className="block leading-snug">
                                        <Highlight text={l.label} query={mark} />
                                      </span>
                                      {l.detail && <span className="block text-[15px] leading-snug text-slate-600 dark:text-slate-400">{l.detail}</span>}
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
