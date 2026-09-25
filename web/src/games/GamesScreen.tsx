// Entry to the Notes → Games layer (PORTAL_PLAN §3c): a Play button that auto-picks by rotation,
// a browser to pick any reading or any mechanic, stability and coverage panels, and the game log.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, History, Play } from 'lucide-react';
import './games.css';
import { navigate } from '../lib/router';
import type { MechanicId, Reading, SessionLog, SessionTrigger } from './types';
import { AREA_NAMES, MECHANIC_CATALOGUE, TRAP_CATEGORIES, mechanicIdFromName } from './types';
import type { Corpus } from './corpus';
import { useGameData } from './data';
import { useGameProgress } from './progress';
import { MECHANICS, getMechanic } from './mechanics';
import type { AnyMechanicPlugin, MechanicPlan } from './arc/plugin';
import type { NarrativeFrame } from './arc/frames';
import { pickFrame } from './arc/frames';
import { chooseSession, priorityCategory } from './rotation';
import type { RotationChoice } from './rotation';
import { choiceStatement, formatGameLogMd, formatLogLines } from './log';
import { dueItemIds, localDate } from './srs';
import { seededRng } from './random';
import { areaCoverage, categoryTotals, readingCoverage, rotationInput } from './stats';
import { SessionShell } from './arc/SessionShell';
import { CopyButton, StabilityRows } from './arc/CloseScreen';
import { GameButton, GameCard } from './theme/primitives';

interface Setup {
  plugin: AnyMechanicPlugin;
  reading: Reading;
  plan: MechanicPlan<unknown>;
  frame: NarrativeFrame;
  choice: RotationChoice;
  statement: string;
  trigger: SessionTrigger;
}

type View =
  | { kind: 'home' }
  | { kind: 'reading'; readingId: string }
  | { kind: 'mechanic'; mechanicId: MechanicId }
  | { kind: 'brief'; setup: Setup }
  | { kind: 'play'; setup: Setup; n: number }
  | { kind: 'log' }
  | { kind: 'none'; message: string };

interface PrepareOpts {
  namedReading?: string;
  namedMechanic?: MechanicId;
}

/** Rotation → build → frame → one-line choice statement. Reads current state at call time. */
function prepare(corpus: Corpus, opts: PrepareOpts): Setup | string {
  const { sessions, items } = useGameProgress.getState();
  const today = localDate();
  const input = rotationInput(corpus, sessions, items, MECHANICS, today);
  const choice = chooseSession({ ...input, namedReading: opts.namedReading ?? null, namedMechanic: opts.namedMechanic ?? null });
  if (!choice) {
    if (opts.namedReading && opts.namedMechanic) return 'That mechanic has too little material in this reading for a full arc.';
    if (opts.namedReading) return 'No built mechanic has enough material in this reading yet.';
    return 'No reading has enough material for the mechanics built so far.';
  }
  const plugin = getMechanic(choice.mechanic);
  const reading = corpus.readingById[choice.readingId];
  if (!plugin || !reading) return 'Nothing playable was found.';
  const seed = (Date.now() ^ (sessions.length * 2654435761)) >>> 0;
  const plan = plugin.build(reading, {
    corpus,
    srs: items,
    today,
    rng: seededRng(seed),
    priorityCategory: choice.priorityCategory,
  });
  if (!plan || plan.rounds.length === 0) return `${plugin.title} could not build a session from ${reading.reading_id}.`;
  const frame = pickFrame(
    sessions.map((s) => s.frame),
    plugin.frames,
  );
  const last = sessions[sessions.length - 1];
  const statement = choiceStatement(choice, plugin.title, plan.target, last ? last.mechanicTitle : null);
  const trigger: SessionTrigger = opts.namedReading ? 'reading' : opts.namedMechanic ? 'mechanic' : 'auto';
  return { plugin, reading, plan, frame, choice, statement, trigger };
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="mb-8 flex items-center gap-3">
      <GameButton variant="quiet" onClick={onBack} ariaLabel="Back">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      </GameButton>
      <div>
        <div className="g-kicker">Notes games</div>
        <h1 className="g-title">{title}</h1>
      </div>
    </header>
  );
}

function CoverageBar({ closed, total }: { closed: number; total: number }) {
  const pct = total ? (closed / total) * 100 : 0;
  return (
    <div className="g-bar" role="img" aria-label={`${closed} of ${total} objectives closed`}>
      <span className="is-caught" style={{ width: `${pct}%`, background: 'var(--g-navy)' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Briefing({ setup, onStart, onBack }: { setup: Setup; onStart: () => void; onBack: () => void }) {
  const { reading, plan, frame } = setup;
  const closing = new Set(plan.rounds.map((r) => r.objectiveId).filter(Boolean));
  const carry = reading.objectives.filter((o) => !closing.has(o.id));
  return (
    <div className="g-enter space-y-6">
      <Header title="Next session" onBack={onBack} />
      <GameCard className="space-y-4">
        <div className="g-kicker">The choice</div>
        <p className="g-reading">{setup.statement}</p>
      </GameCard>
      <GameCard className="space-y-4">
        <div className="g-kicker">Tick-check · {reading.reading_id}</div>
        <ul className="space-y-2">
          {reading.objectives.map((o) => {
            const on = closing.has(o.id);
            return (
              <li key={o.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-[0.45rem] inline-block h-3 w-3 shrink-0 border"
                  style={{ borderColor: 'var(--g-navy)', background: on ? 'var(--g-navy)' : 'transparent' }}
                />
                <span className={on ? '' : 'g-muted'}>
                  <span className="g-strong">{o.id}</span> <span className="g-serif">{o.text}</span>
                  <span className="sr-only">{on ? ' (this session closes it)' : ' (carries over)'}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="g-small g-muted">
          {carry.length === 0
            ? 'This arc closes every objective in the reading.'
            : `Carries over: ${carry.map((o) => o.id).join(', ')}.`}
        </p>
      </GameCard>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="g-small g-muted">
          Frame: {frame.title} · {plan.rounds.length} statements · about 5 minutes
        </span>
        <GameButton variant="primary" onClick={onStart}>
          <Play className="h-4 w-4" aria-hidden="true" /> Start
        </GameButton>
      </div>
    </div>
  );
}

function ReadingView({
  corpus,
  reading,
  onPlay,
  onBack,
}: {
  corpus: Corpus;
  reading: Reading;
  onPlay: (o: PrepareOpts) => void;
  onBack: () => void;
}) {
  const coverage = useGameProgress((s) => s.coverage);
  const playable = MECHANICS.filter((m) => m.supports(reading, corpus));
  const cov = readingCoverage(reading, coverage);
  return (
    <div className="g-enter space-y-6">
      <Header title={`${reading.reading_id} · ${reading.title}`} onBack={onBack} />
      <GameCard className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="g-kicker">Objectives</div>
          <span className="g-small g-muted">
            {cov.closed} of {cov.total} closed{reading.src != null ? ` · SRC ${reading.src}` : ''}
          </span>
        </div>
        <ul className="space-y-2">
          {reading.objectives.map((o) => (
            <li key={o.id} className={coverage[o.id] ? '' : 'g-muted'}>
              <span className="g-strong">{o.id}</span> <span className="g-serif">{o.text}</span>
              {coverage[o.id] && <span className="g-chip is-green ml-2">closed</span>}
            </li>
          ))}
        </ul>
      </GameCard>
      <GameCard className="space-y-4">
        <div className="g-kicker">Mechanics</div>
        <div className="flex flex-wrap gap-2">
          {(reading.mechanics_supported ?? []).map((name) => {
            const id = mechanicIdFromName(name);
            const live = !!id && playable.some((m) => m.id === id);
            return (
              <span key={name} className={`g-chip${live ? ' is-live' : ''}`}>
                {name}
              </span>
            );
          })}
          {(reading.mechanics_supported ?? []).length === 0 && <span className="g-small g-muted">No mechanics listed for this reading.</span>}
        </div>
        <div className="flex flex-wrap gap-3 pt-2">
          <GameButton variant="primary" onClick={() => onPlay({ namedReading: reading.reading_id })} disabled={playable.length === 0}>
            <Play className="h-4 w-4" aria-hidden="true" /> Play this reading
          </GameButton>
          {playable.map((m) => (
            <GameButton key={m.id} onClick={() => onPlay({ namedReading: reading.reading_id, namedMechanic: m.id })}>
              {m.title}
            </GameButton>
          ))}
        </div>
        {playable.length === 0 && <p className="g-small g-muted">None of the mechanics built so far has enough material here yet.</p>}
      </GameCard>
    </div>
  );
}

function MechanicView({
  corpus,
  plugin,
  onPlay,
  onBack,
}: {
  corpus: Corpus;
  plugin: AnyMechanicPlugin;
  onPlay: (o: PrepareOpts) => void;
  onBack: () => void;
}) {
  const readings = useMemo(() => corpus.readings.filter((r) => plugin.supports(r, corpus)), [corpus, plugin]);
  return (
    <div className="g-enter space-y-6">
      <Header title={plugin.title} onBack={onBack} />
      <GameCard className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="g-kicker">{readings.length} readings with enough material</div>
          <GameButton variant="primary" onClick={() => onPlay({ namedMechanic: plugin.id })} disabled={readings.length === 0}>
            <Play className="h-4 w-4" aria-hidden="true" /> Pick a reading for me
          </GameButton>
        </div>
        <ul className="divide-y" style={{ borderColor: 'var(--g-rule)' }}>
          {readings.map((r) => (
            <li key={r.reading_id}>
              <button
                type="button"
                className="flex w-full items-baseline gap-3 py-3 text-left"
                onClick={() => onPlay({ namedReading: r.reading_id, namedMechanic: plugin.id })}
              >
                <span className="g-strong w-16 shrink-0">{r.reading_id}</span>
                <span className="g-serif">{r.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </GameCard>
    </div>
  );
}

function LogView({ sessions, onBack }: { sessions: SessionLog[]; onBack: () => void }) {
  const md = useMemo(() => formatGameLogMd(sessions), [sessions]);
  const newest = useMemo(() => [...sessions].reverse(), [sessions]);
  return (
    <div className="g-enter space-y-6">
      <Header title="Game log" onBack={onBack} />
      <div className="flex flex-wrap gap-3">
        <CopyButton text={md} label="Copy game-log.md" />
        <GameButton onClick={() => downloadText('game-log.md', md)} disabled={sessions.length === 0}>
          <Download className="h-4 w-4" aria-hidden="true" /> Download game-log.md
        </GameButton>
      </div>
      {newest.length === 0 && <p className="g-muted">No sessions yet.</p>}
      <ul className="space-y-4">
        {newest.map((s) => (
          <li key={s.sessionId}>
            <GameCard tone="soft" className="!p-4">
              <div className="g-small g-muted mb-2">
                {new Date(s.timestamp).toLocaleString()}
                {s.completed ? '' : ' · arc not completed'}
              </div>
              <pre className="g-mono whitespace-pre-wrap break-words">{(s.lines.length ? s.lines : formatLogLines(s)).join('\n')}</pre>
            </GameCard>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Home({
  corpus,
  onPlay,
  go,
}: {
  corpus: Corpus;
  onPlay: (o: PrepareOpts) => void;
  go: (v: View) => void;
}) {
  const sessions = useGameProgress((s) => s.sessions);
  const items = useGameProgress((s) => s.items);
  const coverage = useGameProgress((s) => s.coverage);
  const storage = useGameProgress((s) => s.status);
  const [tab, setTab] = useState<'readings' | 'mechanics'>('readings');

  const totals = useMemo(() => categoryTotals(sessions), [sessions]);
  const priority = useMemo(() => priorityCategory(sessions), [sessions]);
  const due = useMemo(() => dueItemIds(items).length, [items]);
  const overall = useMemo(() => areaCoverage(corpus.readings, coverage), [corpus, coverage]);
  const areas = useMemo(() => Object.keys(corpus.readingsByArea), [corpus]);
  const byCategory = useMemo(() => {
    const out: SessionLog['byCategory'] = {};
    for (const c of TRAP_CATEGORIES) if (totals[c].caught + totals[c].missed > 0) out[c] = totals[c];
    return out;
  }, [totals]);

  return (
    <div className="g-enter space-y-8">
      <Header title="Notes games" onBack={() => navigate('/')} />

      <GameCard tone="navy" className="flex flex-col gap-5 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="g-serif text-xl">A five-minute session from the notes.</p>
          <p className="g-small" style={{ opacity: 0.8 }}>
            Picked by rotation: a mechanic you haven't used lately, a reading you haven't played lately, items due for review first.
          </p>
        </div>
        <GameButton variant="gold" onClick={() => onPlay({})}>
          <Play className="h-4 w-4" aria-hidden="true" /> Play
        </GameButton>
      </GameCard>

      <div className="grid gap-6 md:grid-cols-2">
        <GameCard className="space-y-4">
          <div className="g-kicker">Trap stability</div>
          <StabilityRows byCategory={byCategory} />
          {priority && (
            <p className="g-small">
              <span className="g-strong">{priority}</span> has been missed three or more times running; the next session leads with it.
            </p>
          )}
          <p className="g-small g-muted">
            {due} {due === 1 ? 'item' : 'items'} due for review · {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'} played
          </p>
        </GameCard>
        <GameCard className="space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <div className="g-kicker">Coverage</div>
            <span className="g-small g-muted">
              {overall.closed} of {overall.total} objectives
            </span>
          </div>
          <ul className="space-y-3">
            {areas.map((a) => {
              const c = areaCoverage(corpus.readingsByArea[a], coverage);
              return (
                <li key={a}>
                  <div className="flex justify-between gap-3 g-small">
                    <span>
                      <span className="g-strong">{a}</span> <span className="g-muted">{AREA_NAMES[a as keyof typeof AREA_NAMES] ?? ''}</span>
                    </span>
                    <span className="g-muted">
                      {c.closed}/{c.total}
                    </span>
                  </div>
                  <div className="mt-1">
                    <CoverageBar closed={c.closed} total={c.total} />
                  </div>
                </li>
              );
            })}
          </ul>
          <GameButton variant="quiet" onClick={() => go({ kind: 'log' })} className="!px-0">
            <History className="h-4 w-4" aria-hidden="true" /> Game log
          </GameButton>
        </GameCard>
      </div>

      {storage === 'unavailable' && (
        <p className="g-small g-muted">Browser storage is unavailable, so sessions and review schedules last only until this page closes.</p>
      )}

      <section className="space-y-4">
        <div className="flex gap-2" role="tablist" aria-label="Browse">
          <GameButton selected={tab === 'readings'} onClick={() => setTab('readings')}>
            By reading
          </GameButton>
          <GameButton selected={tab === 'mechanics'} onClick={() => setTab('mechanics')}>
            By mechanic
          </GameButton>
        </div>

        {tab === 'readings' &&
          areas.map((a) => (
            <GameCard key={a} className="space-y-2">
              <div className="g-kicker">
                {a} · {AREA_NAMES[a as keyof typeof AREA_NAMES] ?? a}
              </div>
              <ul>
                {corpus.readingsByArea[a].map((r) => {
                  const c = readingCoverage(r, coverage);
                  return (
                    <li key={r.reading_id} className="border-t first:border-t-0" style={{ borderColor: 'var(--g-rule)' }}>
                      <button
                        type="button"
                        className="flex w-full flex-col gap-1 py-3 text-left sm:flex-row sm:items-baseline sm:gap-3"
                        onClick={() => go({ kind: 'reading', readingId: r.reading_id })}
                      >
                        <span className="g-strong w-16 shrink-0">{r.reading_id}</span>
                        <span className="g-serif flex-1">{r.title}</span>
                        <span className="g-small g-muted shrink-0">
                          {c.closed}/{c.total} closed · {(r.mechanics_supported ?? []).length} mechanics
                        </span>
                      </button>
                      {(r.mechanics_supported ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pb-3 sm:pl-[4.75rem]">
                          {(r.mechanics_supported ?? []).map((name) => {
                            const id = mechanicIdFromName(name);
                            const live = !!id && !!getMechanic(id);
                            return (
                              <span key={name} className={`g-chip${live ? ' is-live' : ''}`}>
                                {name}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </GameCard>
          ))}

        {tab === 'mechanics' && (
          <GameCard className="space-y-2">
            <ul>
              {MECHANIC_CATALOGUE.map((m) => {
                const plugin = getMechanic(m.id);
                return (
                  <li key={m.id} className="border-t first:border-t-0" style={{ borderColor: 'var(--g-rule)' }}>
                    <button
                      type="button"
                      disabled={!plugin}
                      className={`flex w-full items-baseline justify-between gap-3 py-3 text-left ${plugin ? '' : 'g-muted cursor-default'}`}
                      onClick={() => plugin && go({ kind: 'mechanic', mechanicId: m.id })}
                    >
                      <span className={plugin ? 'g-strong' : ''}>{m.name}</span>
                      <span className="g-small g-muted">{plugin ? m.family : 'not built yet'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </GameCard>
        )}
      </section>
    </div>
  );
}

export function GamesScreen() {
  const status = useGameData((s) => s.status);
  const error = useGameData((s) => s.error);
  const corpus = useGameData((s) => s.corpus);
  const loadData = useGameData((s) => s.load);
  const loadProgress = useGameProgress((s) => s.load);
  const progressStatus = useGameProgress((s) => s.status);
  const [view, setView] = useState<View>({ kind: 'home' });
  const [back, setBack] = useState<View>({ kind: 'home' });

  useEffect(() => {
    loadData();
    loadProgress();
  }, [loadData, loadProgress]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view.kind]);

  const play = (opts: PrepareOpts) => {
    if (!corpus) return;
    const r = prepare(corpus, opts);
    if (view.kind !== 'brief' && view.kind !== 'play') setBack(view);
    setView(typeof r === 'string' ? { kind: 'none', message: r } : { kind: 'brief', setup: r });
  };

  const progressReady = progressStatus === 'ready' || progressStatus === 'unavailable';

  let body: JSX.Element;
  if (status === 'error') {
    body = (
      <div className="space-y-4 py-16 text-center">
        <p className="g-title">Game content isn't available.</p>
        <p className="g-muted">{error}</p>
        <GameButton variant="primary" onClick={() => loadData()}>
          Try again
        </GameButton>
      </div>
    );
  } else if (!corpus || !progressReady) {
    body = (
      <div className="space-y-4 py-8" aria-busy="true" aria-label="Loading games">
        {[0, 1, 2].map((i) => (
          <div key={i} className="g-card h-24 animate-pulse" />
        ))}
      </div>
    );
  } else if (view.kind === 'play') {
    const s = view.setup;
    return (
      <div className="game-root">
        <SessionShell
          key={view.n}
          plugin={s.plugin}
          reading={s.reading}
          corpus={corpus}
          plan={s.plan}
          frame={s.frame}
          trigger={s.trigger}
          onExit={() => setView(back.kind === 'home' || back.kind === 'reading' || back.kind === 'mechanic' ? back : { kind: 'home' })}
          onPlayNext={() => play({})}
        />
      </div>
    );
  } else if (view.kind === 'brief') {
    const setup = view.setup;
    body = <Briefing setup={setup} onStart={() => setView({ kind: 'play', setup, n: Date.now() })} onBack={() => setView(back)} />;
  } else if (view.kind === 'reading' && corpus.readingById[view.readingId]) {
    body = <ReadingView corpus={corpus} reading={corpus.readingById[view.readingId]} onPlay={play} onBack={() => setView({ kind: 'home' })} />;
  } else if (view.kind === 'mechanic' && getMechanic(view.mechanicId)) {
    body = <MechanicView corpus={corpus} plugin={getMechanic(view.mechanicId)!} onPlay={play} onBack={() => setView({ kind: 'home' })} />;
  } else if (view.kind === 'log') {
    body = <LogViewConnected onBack={() => setView({ kind: 'home' })} />;
  } else if (view.kind === 'none') {
    body = (
      <div className="g-enter space-y-6">
        <Header title="Nothing to play" onBack={() => setView(back)} />
        <GameCard>
          <p className="g-serif">{view.message}</p>
        </GameCard>
      </div>
    );
  } else {
    body = <Home corpus={corpus} onPlay={play} go={setView} />;
  }

  return (
    <div className="game-root">
      <div className="mx-auto w-full max-w-[860px] px-4 pb-16 pt-6 sm:px-6">{body}</div>
    </div>
  );
}

function LogViewConnected({ onBack }: { onBack: () => void }) {
  const sessions = useGameProgress((s) => s.sessions);
  return <LogView sessions={sessions} onBack={onBack} />;
}
