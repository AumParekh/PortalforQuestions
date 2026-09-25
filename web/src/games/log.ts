// Session-log lines (brief §9.3, §9.7, §12.1). Pure string formatting.
import type { CategoryTally, RoundLog, SessionLog, TrapCategory } from './types';
import { TRAP_CATEGORIES } from './types';
import type { RotationChoice } from './rotation';

export function orderedCategories(cats: Iterable<TrapCategory>): TrapCategory[] {
  const set = new Set(cats);
  return TRAP_CATEGORIES.filter((c) => set.has(c));
}

export function unique<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

export function tallyByCategory(rounds: readonly RoundLog[]): Partial<Record<TrapCategory, CategoryTally>> {
  const out: Partial<Record<TrapCategory, CategoryTally>> = {};
  for (const r of rounds) {
    if (!r.category) continue;
    const t = (out[r.category] ??= { caught: 0, missed: 0 });
    if (r.correct) t.caught++;
    else t.missed++;
  }
  return out;
}

const list = (xs: readonly string[]) => (xs.length ? xs.join(', ') : 'none');

/**
 * The three §9.7 lines:
 *   Game: LTR-1 · Order Game · 8 rounds · taught: cfaR subtraction order (LTR-1 a)
 *   Caught 6/8 · misses on: Sign, Scope · block IDs: ltr1.a.fmlbox.3, ltr1.d.trapbox.1
 *   GAME LOG: #3 · LTR-1 · Order Game · taught LTR-1 a · trap cats Sign, Scope · 6/8
 * "block IDs" lists the blocks behind the misses (where to re-read); with no misses, every block
 * drawn on. "trap cats" lists the categories the session drew on.
 */
export function formatLogLines(
  s: Pick<
    SessionLog,
    'number' | 'readingId' | 'mechanicTitle' | 'rounds' | 'taught' | 'taughtObjective' | 'caught' | 'missCategories' | 'categoriesDrawn' | 'blockIds'
  >,
): string[] {
  const n = s.rounds.length;
  const missBlocks = unique(s.rounds.filter((r) => !r.correct).map((r) => r.blockId));
  const blocks = missBlocks.length ? missBlocks : s.blockIds;
  const rounds = `${n} ${n === 1 ? 'round' : 'rounds'}`;
  return [
    `Game: ${s.readingId} · ${s.mechanicTitle} · ${rounds} · taught: ${s.taught} (${s.taughtObjective})`,
    `Caught ${s.caught}/${n} · misses on: ${list(s.missCategories)} · block IDs: ${list(blocks)}`,
    `GAME LOG: #${s.number} · ${s.readingId} · ${s.mechanicTitle} · taught ${s.taughtObjective} · trap cats ${list(s.categoriesDrawn)} · ${s.caught}/${n}`,
  ];
}

/** game-log.md: one GAME LOG line per session (§12.1), oldest first. */
export function formatGameLogMd(sessions: readonly SessionLog[]): string {
  const sorted = [...sessions].sort((a, b) => a.number - b.number || a.timestamp.localeCompare(b.timestamp));
  const body = sorted.map((s) => (s.lines[2] ?? formatLogLines(s)[2]) + (s.completed ? '' : ' · arc not completed'));
  return ['# Game log', '', ...body, ''].join('\n');
}

const REASON_TEXT: Record<RotationChoice['reason'], (c: RotationChoice) => string> = {
  'named-reading': (c) => `You named ${c.readingId}`,
  'named-mechanic': () => 'You picked this mechanic',
  'every-20th': (c) => `Session #${c.sessionNumber} is a twentieth, so this is the full-corpus Coverage View`,
  'every-10th': (c) => `Session #${c.sessionNumber} is a tenth, so this is the Case Docket`,
  'every-5th': (c) => `Session #${c.sessionNumber} is a fifth, so this is the Concept Inventory`,
  'priority-category': (c) => `${c.priorityCategory} traps have been missed three or more times running, so they lead`,
  'longest-drought': () => '',
};

/**
 * The one-line choice statement (§9.3), e.g.
 * "LTR-1 · Order Game · target concept: why outflows subtract before inflows. Last session was
 *  Shatter on CR-20, so this rotates."
 */
export function choiceStatement(c: RotationChoice, mechanicTitle: string, target: string, lastTitle: string | null): string {
  const head = `${c.readingId} · ${mechanicTitle} · target concept: ${target}.`;
  const lastPart = c.last && lastTitle ? `Last session was ${lastTitle} on ${c.last.readingId}` : null;
  let tail: string;
  const reason = REASON_TEXT[c.reason](c);
  if (!c.last) {
    tail =
      c.reason === 'longest-drought'
        ? 'First session, so this starts at the highest-SRC reading with the widest mechanic support.'
        : `${reason}.`;
  } else if (c.relaxed.includes('mechanic-repeat') && c.last.mechanic === c.mechanic) {
    tail = `${lastPart}; no other built mechanic fits, so the mechanic repeats${c.last.readingId === c.readingId ? '' : ' on a new reading'}.`;
  } else if (reason) {
    tail = `${reason}. ${lastPart}.`;
  } else {
    tail = `${lastPart}, so this rotates.`;
  }
  if (c.priorityCategory && c.reason !== 'priority-category') tail += ` ${c.priorityCategory} traps are weighted up (missed three or more running).`;
  return `${head} ${tail}`;
}
