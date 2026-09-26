// The mechanic plug-in contract. A mechanic builds rounds from a reading and renders them; the
// SessionShell owns the five-phase arc, timing of phases, SRS updates, logging and the Close.
import type { Corpus } from '../corpus';
import type { FrameId, ItemSrs, MechanicId, PlayPhase, Reading, TrapCategory } from '../types';
import type { NarrativeFrame } from './frames';

export interface MechanicContext {
  corpus: Corpus;
  /** Shared SM-2 state by item ID: prefer due items, then unseen ones. */
  srs: Readonly<Record<string, ItemSrs>>;
  /** Local date YYYY-MM-DD, for due checks. */
  today: string;
  /** Seeded; use it for every random choice so a session is reproducible. */
  rng: () => number;
  /** A trap category missed three or more times running (§12.3); weight it up when present. */
  priorityCategory: TrapCategory | null;
}

/**
 * One playable unit. Every round names the item it reviews and the block it came from (§9.6), for
 * the SRS schedule and the session log only: IDs are never shown to the player.
 */
export interface MechanicRound<P = unknown> {
  id: string;
  phase: PlayPhase;
  /** Stable extracted-item ID (trap ID, sub-item ID or block ID): the key of the shared SRS schedule. */
  itemId: string;
  /** Source block ID: logged, never shown (feedback shows the notes' content, not where it sits). */
  blockId: string;
  /** Objective ID ("LTR-1 a") this round exercises; objectives with rounds close when the arc completes. */
  objectiveId?: string;
  /** Trap category drawn on, for the stability measurement. */
  category?: TrapCategory;
  /** Time limit under pressure (ms). Discovery rounds are untimed. */
  timeLimitMs?: number;
  /** Comfortable answer time (ms) used to turn speed into an SRS grade. */
  targetMs: number;
  payload: P;
}

/**
 * Just-in-time naming (§8.3): the official term and one line on its role in the reading, both shown
 * (LaTeX or display text; rendered through NoteText). The source block and LO are logged only.
 */
export interface ConceptNaming {
  term: string;
  /** Logged only. */
  blockId: string;
  /** "LTR-1 a"; logged only. */
  objectiveId: string;
  line: string;
}

export interface MechanicPlan<P = unknown> {
  /** Discovery rounds first (3–5), then pressure rounds (3–5). */
  rounds: MechanicRound<P>[];
  /** Target concept for the §9.3 choice statement. */
  target: string;
  /**
   * Opening frame line (§8.1): names the mechanic and the kind of concept it will reveal —
   * structural priming only, no terminology.
   */
  opening: string;
  /** Default naming if the mechanic doesn't adapt it to how discovery went. */
  concept: ConceptNaming;
}

export interface RoundResult {
  roundId: string;
  correct: boolean;
  timeMs: number;
  timedOut?: boolean;
  /** Override the shell's correctness+speed grade (0–5), e.g. for partial credit. */
  grade?: number;
}

export interface MechanicRenderProps<P = unknown> {
  phase: PlayPhase;
  /** This phase's rounds, in play order. */
  rounds: MechanicRound<P>[];
  reading: Reading;
  corpus: Corpus;
  frame: NarrativeFrame;
  /** Report each round once, when answered (or timed out). The shell grades, reviews and logs it. */
  onResult: (result: RoundResult) => void;
  /** Call after the last round's feedback has been shown; the shell moves to the next arc phase. */
  onPhaseDone: () => void;
}

export interface MechanicPlugin<P = unknown> {
  id: MechanicId;
  title: string;
  /** Frames that suit this mechanic; the shell picks one not used last time. */
  frames?: readonly FrameId[];
  /** Trap categories this mechanic drills; rotation steers a priority category to these. */
  drills?: readonly TrapCategory[];
  /** Whether the reading has enough material for a full arc. */
  supports: (reading: Reading, corpus: Corpus) => boolean;
  /** Builds the session: 6–10 rounds split into discovery and pressure. Null if it can't. */
  build: (reading: Reading, ctx: MechanicContext) => MechanicPlan<P> | null;
  /** Optionally adapt the naming to discovery (e.g. name what the player just missed). */
  name?: (plan: MechanicPlan<P>, discovery: readonly RoundResult[], env: { reading: Reading; corpus: Corpus }) => ConceptNaming;
  Render: (props: MechanicRenderProps<P>) => JSX.Element | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMechanicPlugin = MechanicPlugin<any>;
