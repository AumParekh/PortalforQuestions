// Grid Settler: pure round building. A two-axis grid from the notes (frequency × severity, a
// comparison table's columns × rows, …) and a tray of tiles; every round is one tile placed in one
// cell. Everything shown comes from the curated file (validated against the notes by
// tools/games/validate_grid-settler.py); nothing is generated here.
//
// Session shapes:
// - One grid: its tiles are split into discovery (3–5, spread over both axes) and pressure (3–5).
//   The grid is left part-filled at the naming pause and completed under pressure, where the
//   pattern is revealed. Tiles beyond ten are placed from the notes at the start ("given").
// - Two grids (a reading with several small grids): discovery fills one grid, pressure a second,
//   novel one; each phase ends with its own full grid and pattern. Tiles beyond five per grid are
//   given.
import type { Corpus } from '../../corpus';
import { learningObjectives } from '../../corpus';
import type { ItemSrs, Reading, TrapCategory } from '../../types';
import type { ConceptNaming, MechanicPlan, MechanicRound, RoundResult } from '../../arc/plugin';
import { srsPriority } from '../../srs';
import { shuffle } from '../../random';
import type { GsData, GsGrid, GsTile } from './schema';
import { firstSentence, gridData, noteLatex, noteLine } from './schema';
import { spreadPick, splitCounts, timeFor } from './maths';

export type PresetKind = 'given' | 'earlier';

export interface GsPayload {
  grid: GsGrid;
  tile: GsTile;
  /** Tiles already on the grid when this phase opens: given from the notes, or placed in discovery. */
  preset: { tileId: string; kind: PresetKind }[];
  /** True when this phase's placements complete the grid, so the board reveals the pattern at the end. */
  completes: boolean;
}

export const MIN_ROUNDS = 6;
export const MAX_ROUNDS = 10;
export const MAX_PER_PHASE = 5;
/** A grid this small is played alongside a second grid when the reading has one. */
export const TWO_GRID_BELOW = 8;
/** A tile in the wrong cell is one category mistaken for its neighbour: a Sibling trap. */
export const CATEGORY: TrapCategory = 'Sibling';

export interface GsBuildInput {
  corpus: Corpus;
  srs: Readonly<Record<string, ItemSrs>>;
  today: string;
  rng: () => number;
}

export function gridsFor(reading: Reading, data: GsData | null): GsGrid[] {
  return data ? data.grids.filter((g) => g.readingId === reading.reading_id) : [];
}

/** A grid always yields at least 6 placements (3 + 3), so one valid grid is a full arc. */
export function supportsGrid(reading: Reading, corpus: Corpus): boolean {
  return gridsFor(reading, gridData(corpus.extras)).some((g) => g.tiles.length >= MIN_ROUNDS);
}

type Ranked = GsTile & { tier: number };

/** Tiles ordered due → unseen → rest (shared SRS), seeded shuffle within a tier. */
export function rankTiles(grid: GsGrid, ctx: Pick<GsBuildInput, 'srs' | 'today' | 'rng'>): Ranked[] {
  return shuffle(grid.tiles, ctx.rng)
    .map((t, i) => ({ t: { ...t, tier: srsPriority(ctx.srs[t.id], ctx.today) }, i }))
    .sort((a, b) => a.t.tier - b.t.tier || a.i - b.i)
    .map((x) => x.t);
}

/** How much a grid needs reviewing: mean over its tiles of 2 (due), 1 (unseen), 0 (seen, not due). */
export function gridNeed(grid: GsGrid, ctx: Pick<GsBuildInput, 'srs' | 'today'>): number {
  const sum = grid.tiles.reduce((s, t) => s + (2 - srsPriority(ctx.srs[t.id], ctx.today)), 0);
  return sum / Math.max(1, grid.tiles.length);
}

/** Grids in play order: most in need first, seeded shuffle among equals. */
export function rankGrids(grids: readonly GsGrid[], ctx: Pick<GsBuildInput, 'srs' | 'today' | 'rng'>): GsGrid[] {
  return shuffle(grids, ctx.rng)
    .map((g, i) => ({ g, need: gridNeed(g, ctx), i }))
    .sort((a, b) => b.need - a.need || a.i - b.i)
    .map((x) => x.g);
}

export interface GridPlan {
  grid: GsGrid;
  discovery: GsTile[];
  pressure: GsTile[];
  given: GsTile[];
}

function strip(t: Ranked): GsTile {
  return { id: t.id, text: t.text, x: t.x, y: t.y, why: t.why };
}

/** The session's grids and which tile goes where. Null when the reading has no playable grid. */
export function planSession(grids: readonly GsGrid[], ctx: Pick<GsBuildInput, 'srs' | 'today' | 'rng'>): GridPlan[] | null {
  const playable = rankGrids(
    grids.filter((g) => g.tiles.length >= MIN_ROUNDS),
    ctx,
  );
  const first = playable[0];
  if (!first) return null;
  const second = playable[1];
  if (second && first.tiles.length < TWO_GRID_BELOW) {
    // Two grids: discovery fills the first, pressure a new one.
    const a = rankTiles(first, ctx);
    const b = rankTiles(second, ctx);
    const aIdx = new Set(spreadPick(a, MAX_PER_PHASE));
    const aPlay = a.filter((_, i) => aIdx.has(i));
    return [
      { grid: first, discovery: aPlay.map(strip), pressure: [], given: a.filter((_, i) => !aIdx.has(i)).map(strip) },
      {
        grid: second,
        discovery: [],
        pressure: shuffle(b.slice(0, MAX_PER_PHASE), ctx.rng).map(strip),
        given: b.slice(MAX_PER_PHASE).map(strip),
      },
    ];
  }
  const ranked = rankTiles(first, ctx);
  const played = ranked.slice(0, MAX_ROUNDS);
  const { discovery: nDisc } = splitCounts(played.length);
  const discIdx = new Set(spreadPick(played, nDisc));
  return [
    {
      grid: first,
      discovery: played.filter((_, i) => discIdx.has(i)).map(strip),
      pressure: shuffle(
        played.filter((_, i) => !discIdx.has(i)),
        ctx.rng,
      ).map(strip),
      given: ranked.slice(MAX_ROUNDS).map(strip),
    },
  ];
}

export function objectiveFor(corpus: Corpus, reading: Reading, grid: GsGrid): string {
  return corpus.objectiveOfBlock[grid.sourceBlock] ?? learningObjectives(reading)[0]?.id ?? reading.reading_id;
}

/** The default naming (§8.3): the grid's title, and the first line of the notes' explanation (as NoteText snippets). */
export function defaultNaming(corpus: Corpus, reading: Reading, grid: GsGrid): ConceptNaming {
  const explanation = noteLine(grid.explanation);
  const line = explanation ? firstSentence(explanation) : `${grid.x.label} against ${grid.y.label}.`;
  return { term: noteLatex(grid.title), blockId: grid.sourceBlock, objectiveId: objectiveFor(corpus, reading, grid), line: noteLatex(line) };
}

export function buildGrid(reading: Reading, ctx: GsBuildInput): MechanicPlan<GsPayload> | null {
  const data = gridData(ctx.corpus.extras);
  const plans = planSession(gridsFor(reading, data), ctx);
  if (!plans) return null;
  const rounds: MechanicRound<GsPayload>[] = [];
  let pressureStep = 0;
  for (const p of plans) {
    const cells = p.grid.x.values.length * p.grid.y.values.length;
    const objectiveId = ctx.corpus.objectiveOfBlock[p.grid.sourceBlock];
    const given = p.given.map((t) => ({ tileId: t.id, kind: 'given' as const }));
    const earlier = p.discovery.map((t) => ({ tileId: t.id, kind: 'earlier' as const }));
    const mk = (tile: GsTile, phase: 'discovery' | 'pressure'): MechanicRound<GsPayload> => {
      const limit = phase === 'pressure' ? timeFor(tile.text, cells, pressureStep++) : undefined;
      return {
        id: `${tile.id}#${phase}`,
        phase,
        itemId: tile.id,
        blockId: p.grid.sourceBlock,
        objectiveId,
        category: CATEGORY,
        timeLimitMs: limit,
        targetMs: limit ?? timeFor(tile.text, cells, null),
        payload: {
          grid: p.grid,
          tile,
          preset: phase === 'discovery' ? given : [...given, ...earlier],
          completes: phase === 'pressure' || p.pressure.length === 0,
        },
      };
    };
    for (const t of p.discovery) rounds.push(mk(t, 'discovery'));
    for (const t of p.pressure) rounds.push(mk(t, 'pressure'));
  }
  // Discovery rounds first, then pressure (the two-grid plan already emits them in that order).
  rounds.sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'discovery' ? -1 : 1));
  const nDisc = rounds.filter((r) => r.phase === 'discovery').length;
  const nPress = rounds.length - nDisc;
  if (nDisc < 3 || nPress < 3 || rounds.length < MIN_ROUNDS) return null;

  const main = plans[0].grid;
  const concept = defaultNaming(ctx.corpus, reading, main);
  const axes = (g: GsGrid) => noteLatex(`${g.x.label} runs across, ${g.y.label} runs down`);
  const opening =
    plans.length === 1
      ? `Grid Settler. One grid: ${axes(main)}. ${main.tiles.length} tiles, and each belongs in one cell. Some cells take several, some stay empty. Settle them all and see what the full grid shows.`
      : `Grid Settler. Two grids from this reading, one before the pause and one after. In the first, ${axes(main)}. Each tile belongs in one cell; some cells take several, some stay empty. Watch what each grid shows once it is full.`;
  return { rounds, target: main.title, opening, concept };
}

/**
 * Names what discovery showed: the grid's concept, with the first tile the player misplaced and
 * the notes' reason it sits where it does. Else the default naming.
 */
export function nameAfterDiscovery(corpus: Corpus, reading: Reading, plan: MechanicPlan<GsPayload>, discovery: readonly RoundResult[]): ConceptNaming {
  const byId = new Map(plan.rounds.map((r) => [r.id, r]));
  const missed = discovery
    .filter((d) => !d.correct)
    .map((d) => byId.get(d.roundId))
    .find((r): r is MechanicRound<GsPayload> => !!r);
  const first = plan.rounds.find((r) => r.phase === 'discovery');
  if (!first) return plan.concept;
  const base = defaultNaming(corpus, reading, first.payload.grid);
  if (!missed) return base;
  const { grid, tile } = missed.payload;
  const why = noteLine(tile.why);
  const placed = `${tile.text} sits at ${grid.x.values[tile.x]} × ${grid.y.values[tile.y]}`;
  return {
    ...base,
    line: `${base.line} ${noteLatex(why ? `${placed}: ${why}` : `${placed}.`)}`,
  };
}
