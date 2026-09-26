// The five-phase teaching arc (brief §8): Opening frame → Discovery → Just-in-time naming →
// Pressure → Close. Mechanics plug in via MechanicPlugin; the shell owns grading, the shared SRS
// schedule, the session log and coverage.
//
// The shell enforces the plug-in contract rather than trusting it: a round is graded once (repeat
// or unknown results are ignored), onPhaseDone only counts for the phase that is on screen and only
// once, nothing is taken after the Close, and the callbacks handed to the mechanic keep a stable
// identity so effects that depend on them don't re-run. A mechanic that throws is caught and the
// session can still be closed; one that reports every round but never calls onPhaseDone gets a
// "Move on" fallback.
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ArcPhase, PlayPhase, Reading, RoundLog, SessionLog, SessionTrigger } from '../types';
import type { Corpus } from '../corpus';
import type { AnyMechanicPlugin, ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from './plugin';
import type { NarrativeFrame } from './frames';
import { gradeFromAnswer } from '../srs';
import { useGameProgress } from '../progress';
import { formatLogLines, orderedCategories, tallyByCategory, unique } from '../log';
import { newSessionId } from '../random';
import { learningObjectives } from '../corpus';
import { GameButton, GameCard, NoteText, PhaseDots } from '../theme/primitives';
import { CloseScreen } from './CloseScreen';

const PHASE_INDEX: Record<ArcPhase, number> = { opening: 0, discovery: 1, naming: 2, pressure: 3, close: 4 };
const PHASE_LABEL: Record<ArcPhase, string> = {
  opening: 'Opening',
  discovery: 'Discovery',
  naming: 'Naming',
  pressure: 'Pressure',
  close: 'Close',
};
/** After every round of a phase is reported, how long to wait for onPhaseDone before offering a way on. */
const STALL_MS = 15000;

export interface SessionShellProps {
  plugin: AnyMechanicPlugin;
  reading: Reading;
  corpus: Corpus;
  plan: MechanicPlan<unknown>;
  frame: NarrativeFrame;
  trigger: SessionTrigger;
  onExit: () => void;
  onPlayNext?: () => void;
}

type Answered = { round: MechanicRound<unknown>; result: RoundResult; grade: number };

/** Keeps a mechanic's render error inside the session instead of blanking the whole screen. */
class MechanicBoundary extends Component<{ children: ReactNode; onEnd: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[games] mechanic failed to render', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <GameCard className="space-y-4 py-8">
        <p className="g-title">This board stopped working.</p>
        <p className="g-muted">Your answers so far are kept. End the session to see what was caught.</p>
        <GameButton variant="primary" onClick={this.props.onEnd}>
          End session
        </GameButton>
      </GameCard>
    );
  }
}

export function SessionShell({ plugin, reading, corpus, plan, frame, trigger, onExit, onPlayNext }: SessionShellProps) {
  const [phase, setPhaseState] = useState<ArcPhase>('opening');
  const [naming, setNaming] = useState<ConceptNaming | null>(null);
  const [log, setLog] = useState<SessionLog | null>(null);
  /** Rounds reported per play phase; drives the stall fallback. */
  const [reported, setReported] = useState<Record<PlayPhase, number>>({ discovery: 0, pressure: 0 });
  const [stalled, setStalled] = useState(false);
  const sessionId = useRef(newSessionId());
  const startedAt = useRef(new Date().toISOString());
  const results = useRef<Answered[]>([]);
  // Mirrors of state for callbacks that outlive a render (mechanic timers, the unmount cleanup).
  const phaseRef = useRef<ArcPhase>('opening');
  const namingRef = useRef<ConceptNaming | null>(null);
  const recorded = useRef(false);

  const setPhase = useCallback((p: ArcPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const byPhase = useMemo(
    () => ({
      discovery: plan.rounds.filter((r) => r.phase === 'discovery'),
      pressure: plan.rounds.filter((r) => r.phase === 'pressure'),
    }),
    [plan],
  );
  const roundById = useMemo(() => new Map(plan.rounds.map((r) => [r.id, r])), [plan]);

  /** Builds the log from what was answered and (once) records it. */
  const record = useCallback(
    (completed: boolean): SessionLog => {
      const named = namingRef.current ?? plan.concept;
      const rounds: RoundLog[] = results.current.map(({ round, result, grade }) => ({
        roundId: round.id,
        itemId: round.itemId,
        blockId: round.blockId,
        objectiveId: round.objectiveId,
        category: round.category,
        phase: round.phase,
        correct: result.correct,
        timeMs: Math.max(0, Math.round(Number.isFinite(result.timeMs) ? result.timeMs : 0)),
        timedOut: result.timedOut ?? false,
        grade,
      }));
      const progress = useGameProgress.getState();
      // Only lettered LOs close; intro / basics / summary sections don't count as coverage.
      const loIds = new Set(learningObjectives(reading).map((o) => o.id));
      const number = progress.sessions.reduce((n, s) => Math.max(n, s.number), 0) + 1;
      const base = {
        sessionId: sessionId.current,
        number,
        startedAt: startedAt.current,
        timestamp: new Date().toISOString(),
        mechanic: plugin.id,
        mechanicTitle: plugin.title,
        readingId: reading.reading_id,
        frame: frame.id,
        trigger,
        completed,
        roundsPlanned: plan.rounds.length,
        rounds,
        caught: rounds.filter((r) => r.correct).length,
        taught: named.term,
        taughtObjective: named.objectiveId,
        conceptBlockId: named.blockId,
        objectivesClosed: completed ? unique(plan.rounds.map((r) => r.objectiveId).filter((x): x is string => !!x && loIds.has(x))) : [],
        categoriesDrawn: orderedCategories(rounds.map((r) => r.category).filter((c): c is NonNullable<typeof c> => !!c)),
        missCategories: orderedCategories(
          rounds.filter((r) => !r.correct && r.category).map((r) => r.category as NonNullable<RoundLog['category']>),
        ),
        byCategory: tallyByCategory(rounds),
        blockIds: unique(rounds.map((r) => r.blockId)),
        lines: [] as string[],
      };
      const full: SessionLog = { ...base, lines: formatLogLines(base) };
      // Nothing answered: nothing to log.
      if (!recorded.current && rounds.length > 0) {
        recorded.current = true;
        progress.recordSession(full);
      }
      return full;
    },
    [plan, reading, plugin, frame, trigger],
  );

  const close = useCallback(
    (completed: boolean) => {
      if (phaseRef.current === 'close') return;
      const full = record(completed);
      setLog(full);
      setPhase('close');
    },
    [record, setPhase],
  );

  // Leaving mid-arc (back arrow, navigation): the answers already moved the SRS schedule, so the
  // session is logged as not completed rather than silently dropped.
  const recordRef = useRef(record);
  recordRef.current = record;
  useEffect(
    () => () => {
      if (phaseRef.current !== 'close' && results.current.length > 0) recordRef.current(false);
    },
    [],
  );

  const onResult = useCallback(
    (result: RoundResult) => {
      const now = phaseRef.current;
      if (now !== 'discovery' && now !== 'pressure') return;
      const round = result && roundById.get(result.roundId);
      if (!round || results.current.some((x) => x.round.id === round.id)) return;
      const raw =
        typeof result.grade === 'number' && Number.isFinite(result.grade)
          ? result.grade
          : gradeFromAnswer(!!result.correct, result.timeMs, round.targetMs, result.timedOut ?? false);
      const grade = Math.max(0, Math.min(5, Math.round(raw)));
      results.current.push({ round, result: { ...result, correct: !!result.correct }, grade });
      // One shared schedule: every answer in any mechanic reviews its item.
      useGameProgress.getState().review(round.itemId, grade, { readingId: reading.reading_id, category: round.category });
      setReported((c) => ({ ...c, [round.phase]: c[round.phase] + 1 }));
    },
    [roundById, reading],
  );

  const toNaming = useCallback(() => {
    const disc = results.current.filter((x) => x.round.phase === 'discovery').map((x) => x.result);
    let named = plan.concept;
    try {
      if (plugin.name) named = plugin.name(plan, disc, { reading, corpus }) ?? plan.concept;
    } catch (e) {
      console.warn('[games] naming failed; using the plan default', e);
    }
    namingRef.current = named;
    setNaming(named);
    setPhase('naming');
  }, [plan, plugin, reading, corpus, setPhase]);

  // Each phase gets its own done-callback, honoured only while that phase is on screen, so a stray
  // timer from an unmounted board (or a double call) can't skip or rewind the arc.
  const discoveryDone = useCallback(() => {
    if (phaseRef.current === 'discovery') toNaming();
  }, [toNaming]);
  const pressureDone = useCallback(() => {
    if (phaseRef.current === 'pressure') close(true);
  }, [close]);

  const begin = () => {
    if (phaseRef.current !== 'opening') return;
    // No discovery rounds: the naming still comes before pressure.
    if (byPhase.discovery.length) setPhase('discovery');
    else toNaming();
  };
  const toPressure = () => {
    if (phaseRef.current !== 'naming') return;
    if (byPhase.pressure.length) setPhase('pressure');
    else close(true);
  };

  useEffect(() => {
    setStalled(false);
    window.scrollTo(0, 0);
  }, [phase]);

  // Fallback for a board that reports every round but never calls onPhaseDone.
  const playPhase: PlayPhase | null = phase === 'discovery' || phase === 'pressure' ? phase : null;
  const allReported = playPhase !== null && byPhase[playPhase].length > 0 && reported[playPhase] >= byPhase[playPhase].length;
  useEffect(() => {
    if (!allReported) return;
    const t = window.setTimeout(() => setStalled(true), STALL_MS);
    return () => window.clearTimeout(t);
  }, [allReported, phase]);

  const Render = plugin.Render;
  const endEarly = () => close(false);

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 pb-16 pt-4 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-[1_1_14rem] items-center gap-3">
          <GameButton variant="quiet" onClick={onExit} ariaLabel="Leave session">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </GameButton>
          <div className="min-w-0 break-words">
            <div className="g-kicker">{frame.title}</div>
            <div className="g-small">
              <span className="g-strong">{reading.reading_id}</span> · {plugin.title}
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <PhaseDots index={PHASE_INDEX[phase]} />
          <span className="sr-only">
            Phase {PHASE_INDEX[phase] + 1} of 5: {PHASE_LABEL[phase]}
          </span>
          {(phase === 'discovery' || phase === 'naming' || phase === 'pressure') && (
            <GameButton variant="quiet" onClick={endEarly}>
              End
            </GameButton>
          )}
        </div>
      </header>

      {phase === 'opening' && (
        <GameCard className="g-enter space-y-5 py-10 text-center">
          <div className="g-kicker">{frame.title}</div>
          <h1 className="g-title break-words">
            {reading.reading_id} · {plugin.title}
          </h1>
          <p className="g-serif g-muted mx-auto max-w-[52ch]">{frame.line}</p>
          <hr className="g-rule mx-auto max-w-[120px]" />
          <p className="g-reading mx-auto">
            <NoteText latex={plan.opening} />
          </p>
          <GameButton variant="primary" onClick={begin}>
            Begin
          </GameButton>
        </GameCard>
      )}

      {phase === 'discovery' && (
        <MechanicBoundary key="discovery" onEnd={endEarly}>
          <Render
            phase="discovery"
            rounds={byPhase.discovery}
            reading={reading}
            corpus={corpus}
            frame={frame}
            onResult={onResult}
            onPhaseDone={discoveryDone}
          />
        </MechanicBoundary>
      )}

      {phase === 'naming' && naming && (
        <GameCard className="g-enter space-y-4 py-8">
          <div className="g-kicker">What you were catching</div>
          <p className="g-title g-assemble break-words">
            <NoteText latex={naming.term} />
          </p>
          {naming.line.trim() && (
            <p className="g-reading">
              <NoteText latex={naming.line} />
            </p>
          )}
          <div className="pt-2">
            <GameButton variant="primary" onClick={toPressure}>
              {byPhase.pressure.length ? 'Now under pressure' : 'Close the session'}
            </GameButton>
          </div>
        </GameCard>
      )}

      {phase === 'pressure' && (
        <MechanicBoundary key="pressure" onEnd={endEarly}>
          <Render
            phase="pressure"
            rounds={byPhase.pressure}
            reading={reading}
            corpus={corpus}
            frame={frame}
            onResult={onResult}
            onPhaseDone={pressureDone}
          />
        </MechanicBoundary>
      )}

      {stalled && playPhase && (
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <span className="g-small g-muted">Every round on this board is answered.</span>
          <GameButton variant="primary" onClick={playPhase === 'discovery' ? discoveryDone : pressureDone}>
            Move on
          </GameButton>
        </div>
      )}

      {phase === 'close' && log && (
        <CloseScreen log={log} reading={reading} frame={frame} naming={naming ?? plan.concept} onExit={onExit} onPlayNext={onPlayNext} />
      )}
    </div>
  );
}
