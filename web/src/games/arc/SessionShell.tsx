// The five-phase teaching arc (brief §8): Opening frame → Discovery → Just-in-time naming →
// Pressure → Close. Mechanics plug in via MechanicPlugin; the shell owns grading, the shared SRS
// schedule, the session log and coverage.
import { useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ArcPhase, Reading, RoundLog, SessionLog, SessionTrigger } from '../types';
import type { Corpus } from '../corpus';
import type { AnyMechanicPlugin, ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from './plugin';
import type { NarrativeFrame } from './frames';
import { gradeFromAnswer } from '../srs';
import { useGameProgress } from '../progress';
import { formatLogLines, orderedCategories, tallyByCategory, unique } from '../log';
import { newSessionId } from '../random';
import { learningObjectives } from '../corpus';
import { GameButton, GameCard, PhaseDots } from '../theme/primitives';
import { CloseScreen } from './CloseScreen';

const PHASE_INDEX: Record<ArcPhase, number> = { opening: 0, discovery: 1, naming: 2, pressure: 3, close: 4 };

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

function letterOf(objectiveId: string): string {
  const m = /\s([a-z]+)$/i.exec(objectiveId.trim());
  return m ? m[1] : objectiveId;
}

export function SessionShell({ plugin, reading, corpus, plan, frame, trigger, onExit, onPlayNext }: SessionShellProps) {
  const [phase, setPhase] = useState<ArcPhase>('opening');
  const [naming, setNaming] = useState<ConceptNaming | null>(null);
  const [log, setLog] = useState<SessionLog | null>(null);
  const sessionId = useRef(newSessionId());
  const startedAt = useRef(new Date().toISOString());
  const results = useRef<{ round: MechanicRound<unknown>; result: RoundResult; grade: number }[]>([]);

  const byPhase = useMemo(
    () => ({
      discovery: plan.rounds.filter((r) => r.phase === 'discovery'),
      pressure: plan.rounds.filter((r) => r.phase === 'pressure'),
    }),
    [plan],
  );
  const roundById = useMemo(() => new Map(plan.rounds.map((r) => [r.id, r])), [plan]);

  const onResult = (result: RoundResult) => {
    const round = roundById.get(result.roundId);
    if (!round || results.current.some((x) => x.round.id === round.id)) return;
    const grade = result.grade ?? gradeFromAnswer(result.correct, result.timeMs, round.targetMs, result.timedOut ?? false);
    results.current.push({ round, result, grade });
    // One shared schedule: every answer in any mechanic reviews its item.
    useGameProgress.getState().review(round.itemId, grade, { readingId: reading.reading_id, category: round.category });
  };

  const close = (completed: boolean) => {
    const named = naming ?? plan.concept;
    const rounds: RoundLog[] = results.current.map(({ round, result, grade }) => ({
      roundId: round.id,
      itemId: round.itemId,
      blockId: round.blockId,
      objectiveId: round.objectiveId,
      category: round.category,
      phase: round.phase,
      correct: result.correct,
      timeMs: Math.round(result.timeMs),
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
    if (rounds.length > 0) progress.recordSession(full);
    setLog(full);
    setPhase('close');
  };

  const afterDiscovery = () => {
    const disc = results.current.filter((x) => x.round.phase === 'discovery').map((x) => x.result);
    setNaming(plugin.name ? plugin.name(plan, disc, { reading, corpus }) : plan.concept);
    setPhase('naming');
  };

  const begin = () => setPhase(byPhase.discovery.length ? 'discovery' : 'pressure');

  const Render = plugin.Render;

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 pb-16 pt-4 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <GameButton variant="quiet" onClick={onExit} ariaLabel="Leave session">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </GameButton>
          <div className="min-w-0">
            <div className="g-kicker truncate">{frame.title}</div>
            <div className="g-small truncate">
              <span className="g-strong">{reading.reading_id}</span> · {plugin.title}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PhaseDots index={PHASE_INDEX[phase]} />
          {(phase === 'discovery' || phase === 'naming' || phase === 'pressure') && (
            <GameButton variant="quiet" onClick={() => close(false)}>
              End
            </GameButton>
          )}
        </div>
      </header>

      {phase === 'opening' && (
        <GameCard className="g-enter space-y-5 py-10 text-center">
          <div className="g-kicker">{frame.title}</div>
          <h1 className="g-title">
            {reading.reading_id} · {plugin.title}
          </h1>
          <p className="g-serif g-muted mx-auto max-w-[52ch]">{frame.line}</p>
          <hr className="g-rule mx-auto max-w-[120px]" />
          <p className="g-reading mx-auto">{plan.opening}</p>
          <GameButton variant="primary" onClick={begin}>
            Begin
          </GameButton>
        </GameCard>
      )}

      {phase === 'discovery' && (
        <Render
          key="discovery"
          phase="discovery"
          rounds={byPhase.discovery}
          reading={reading}
          corpus={corpus}
          frame={frame}
          onResult={onResult}
          onPhaseDone={afterDiscovery}
        />
      )}

      {phase === 'naming' && naming && (
        <GameCard className="g-enter space-y-4 py-8">
          <div className="g-kicker">What you were catching</div>
          <p className="g-title g-assemble">{naming.term}</p>
          <p className="g-reading">{naming.line}</p>
          <p className="g-small g-muted">
            {reading.reading_id} {letterOf(naming.objectiveId)} · block <span className="g-mono">{naming.blockId}</span>
          </p>
          <div className="pt-2">
            <GameButton variant="primary" onClick={() => (byPhase.pressure.length ? setPhase('pressure') : close(true))}>
              Now under pressure
            </GameButton>
          </div>
        </GameCard>
      )}

      {phase === 'pressure' && (
        <Render
          key="pressure"
          phase="pressure"
          rounds={byPhase.pressure}
          reading={reading}
          corpus={corpus}
          frame={frame}
          onResult={onResult}
          onPhaseDone={() => close(true)}
        />
      )}

      {phase === 'close' && log && (
        <CloseScreen log={log} reading={reading} frame={frame} naming={naming ?? plan.concept} onExit={onExit} onPlayNext={onPlayNext} />
      )}
    </div>
  );
}
