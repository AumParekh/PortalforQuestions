// Table Fill board (brief §7.2). One sheet at a time: the table with its lifted-out cells as
// dashed blanks, and the loose cells in a tray underneath. Tap a blank, then a tile (a blank is
// always selected, so tapping tiles fills the table in reading order), or drag a tile onto any
// blank. Keyboard: Tab to a blank and press Enter to select it; Tab to a tile and press Enter, or
// press its number 1–9. Right cells lock in place; a wrong one holds for a beat, then the notes'
// cell fades in underneath and the loose tile goes back to the tray. Pressure sheets run on one
// draining timer per sheet; when it runs out, the rest of the table fills itself in.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import type { Blank, Sheet, TableFillPayload, Tile } from './build';
import { rowGrade } from './build';
import { toDisplay } from '../../text';
import { GameCard, NoteText, TimerBar } from '../../theme/primitives';

const SMALL: CSSProperties = { fontSize: 15, lineHeight: 1.55 };
const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace", fontSize: 15 };
const KICKER: CSSProperties = { fontSize: 15 };
/** The wrong-answer hold (§10.3) plus the 520 ms fade of the correction. */
const HOLD_MS = 800 + 520;
const DRAG_THRESHOLD = 6;

type CellState =
  | { status: 'right'; text: string }
  | { status: 'wrong'; text: string; wrong: string }
  | { status: 'revealed'; text: string };

function letterOf(objectiveId: string | undefined): string {
  const m = objectiveId ? /\s([a-z]+)$/i.exec(objectiveId.trim()) : null;
  return m ? m[1] : '';
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        const os = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        setReduced(os || document.documentElement.classList.contains('reduce-motion'));
      } catch {
        setReduced(false);
      }
    };
    read();
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener?.('change', read);
    return () => mq.removeEventListener?.('change', read);
  }, []);
  return reduced;
}

/** Minimum column width from the longest cell, so long prose wraps and the table scrolls sideways inside its box. */
function columnMinRem(sheet: Sheet, col: number): number {
  const longest = Math.max(
    toDisplay(sheet.headers[col] ?? '').length,
    ...sheet.rows.map((r) => toDisplay(r.cells[col] ?? '').length),
  );
  if (longest <= 12) return 6.5;
  if (longest <= 40) return 9.5;
  return 14;
}

/** The first cell in a row that stays on screen: how the row is named to screen readers and in feedback. */
function anchorOf(sheet: Sheet, rowIndex: number): string {
  const row = sheet.rows[rowIndex];
  const blanked = new Set(sheet.blanks.filter((b) => b.row === rowIndex).map((b) => b.col));
  const cell = row.cells.find((c, i) => !blanked.has(i) && toDisplay(c).trim());
  return cell ? toDisplay(cell) : `row ${rowIndex + 1}`;
}

function TileButton({
  tile,
  n,
  reduced,
  disabled,
  onTap,
  onDragTo,
  blankAt,
  onHover,
  registerRef,
}: {
  tile: Tile;
  n: number;
  reduced: boolean;
  disabled: boolean;
  onTap: (tileId: string) => void;
  onDragTo: (tileId: string, blankKey: string) => void;
  blankAt: (x: number, y: number) => string | null;
  onHover: (key: string | null) => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}) {
  const start = useRef<{ x: number; y: number; pointerId: number; dragging: boolean } | null>(null);
  // A drag ends in a click on desktop; ignore clicks for a moment after one.
  const suppressUntil = useRef(0);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    start.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety; the drag still works without it on most pointers.
    }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    s.dragging = true;
    setOffset({ x: dx, y: dy });
    onHover(blankAt(e.clientX, e.clientY));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    start.current = null;
    if (!s || s.pointerId !== e.pointerId || !s.dragging) return;
    suppressUntil.current = performance.now() + 400;
    setOffset(null);
    onHover(null);
    const key = blankAt(e.clientX, e.clientY);
    if (key) onDragTo(tile.id, key);
  };
  const onPointerCancel = () => {
    start.current = null;
    setOffset(null);
    onHover(null);
  };
  const lifted = offset !== null;
  const style: CSSProperties = {
    minHeight: 44,
    maxWidth: '100%',
    padding: '0.55rem 0.9rem',
    borderRadius: 12,
    border: '1px solid var(--g-rule)',
    background: 'var(--g-card)',
    color: 'var(--g-ink)',
    textAlign: 'left',
    fontSize: 16,
    lineHeight: 1.5,
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: '0.6rem',
    ...(lifted
      ? { transform: `translate(${offset.x}px, ${offset.y}px)${reduced ? '' : ' scale(1.035)'}`, transition: 'none' }
      : null),
  };
  return (
    <button
      ref={registerRef}
      type="button"
      className={`g-draggable${lifted ? ' is-lifted' : ''}`}
      style={style}
      disabled={disabled}
      aria-keyshortcuts={n <= 9 ? String(n) : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={() => {
        if (performance.now() < suppressUntil.current) return;
        onTap(tile.id);
      }}
    >
      {n <= 9 && (
        <span className="g-muted" style={MONO} aria-hidden="true">
          {n}
        </span>
      )}
      <span className="g-serif">
        <NoteText latex={tile.text} />
      </span>
    </button>
  );
}

function SheetBoard({
  sheet,
  rounds,
  phase,
  onRowResult,
  onNext,
  last,
}: {
  sheet: Sheet;
  rounds: MechanicRound<TableFillPayload>[];
  phase: PlayPhase;
  onRowResult: (round: MechanicRound<TableFillPayload>, r: RoundResult) => void;
  onNext: () => void;
  last: boolean;
}) {
  const reduced = useReducedMotion();
  const timed = phase === 'pressure';
  const limitMs = sheet.timeLimitMs ?? rounds.reduce((n, r) => n + (r.timeLimitMs ?? 0), 0);
  const order = useMemo(() => [...sheet.blanks].sort((a, b) => a.row - b.row || a.col - b.col), [sheet]);
  const blankByKey = useMemo(() => new Map(sheet.blanks.map((b) => [b.key, b])), [sheet]);
  const roundByRow = useMemo(() => new Map(rounds.map((r) => [r.payload.rowIndex, r])), [rounds]);

  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [tray, setTray] = useState<Tile[]>(() => sheet.tiles);
  const [cursor, setCursor] = useState<string | null>(order[0]?.key ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [settled, setSettled] = useState(true);
  /** Screen-reader announcement of every placement. */
  const [announce, setAnnounce] = useState('');
  /** The latest correction stays on screen until the next one: correct version and its source. */
  const [lastMiss, setLastMiss] = useState<string | null>(null);

  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const rowTime = useRef<Map<number, number>>(new Map());
  const lastEvent = useRef(performance.now());
  const reported = useRef<Set<number>>(new Set());
  const blankEls = useRef<Map<string, HTMLElement>>(new Map());
  const tileEls = useRef<(HTMLButtonElement | null)[]>([]);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const refocusTile = useRef<number | null>(null);
  const refocusBlank = useRef(false);
  const mountedAt = useRef(performance.now());
  const holdTimer = useRef<number | null>(null);
  /** Set by a placement: bring the next selected blank into view (sideways too, in a wide table). */
  const revealCursor = useRef(false);
  const [stick, setStick] = useState(true);
  const [trayH, setTrayH] = useState(0);

  const finished = timedOut || order.every((b) => cells[b.key]);

  const blankAt = (x: number, y: number): string | null => {
    for (const [key, el] of blankEls.current) {
      if (cellsRef.current[key]) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return key;
    }
    return null;
  };

  const report = (rowIndex: number, state: Record<string, CellState>, byTimeout: boolean) => {
    if (reported.current.has(rowIndex)) return;
    const round = roundByRow.get(rowIndex);
    if (!round) return;
    const own = sheet.blanks.filter((b) => b.row === rowIndex);
    const right = own.filter((b) => state[b.key]?.status === 'right').length;
    const wrong = own.filter((b) => state[b.key]?.status === 'wrong').length;
    const out = byTimeout && own.some((b) => state[b.key]?.status === 'revealed');
    if (!out && own.some((b) => !state[b.key])) return;
    reported.current.add(rowIndex);
    onRowResult(round, {
      roundId: round.id,
      correct: !out && wrong === 0,
      timeMs: rowTime.current.get(rowIndex) ?? 0,
      timedOut: out,
      grade: rowGrade(right, wrong, out),
    });
  };

  const nextOpen = (state: Record<string, CellState>, after: Blank): string | null => {
    const i = order.findIndex((b) => b.key === after.key);
    const rest = [...order.slice(i + 1), ...order.slice(0, i)];
    return rest.find((b) => !state[b.key])?.key ?? null;
  };

  const place = (tileId: string, blankKey: string) => {
    if (finished) return;
    const blank = blankByKey.get(blankKey);
    const tile = tray.find((t) => t.id === tileId);
    if (!blank || !tile || cells[blankKey]) return;
    const now = performance.now();
    rowTime.current.set(blank.row, (rowTime.current.get(blank.row) ?? 0) + (now - lastEvent.current));
    lastEvent.current = now;
    const right = tile.norm === blank.norm;
    const state: Record<string, CellState> = {
      ...cells,
      [blankKey]: right ? { status: 'right', text: blank.answer } : { status: 'wrong', text: blank.answer, wrong: tile.text },
    };
    // A wrong tile goes back to the tray; the notes' cell comes out of it instead.
    const usedIdx = right ? tray.findIndex((t) => t.id === tile.id) : tray.findIndex((t) => t.norm === blank.norm && t.id !== tile.id);
    const inTray = trayRef.current?.contains(document.activeElement) ?? false;
    refocusTile.current = inTray ? tray.findIndex((t) => t.id === tile.id) : null;
    refocusBlank.current = [...blankEls.current.values()].some((el) => el === document.activeElement);
    setTray(usedIdx >= 0 ? tray.filter((_, i) => i !== usedIdx) : tray);
    setCells(state);
    setCursor(nextOpen(state, blank));
    revealCursor.current = true;
    const header = toDisplay(sheet.headers[blank.col] ?? '');
    const anchor = anchorOf(sheet, blank.row);
    if (right) {
      setAnnounce(`${anchor} · ${header}: placed.`);
    } else {
      // A second miss inside the hold restarts it, so Next never unlocks before the latest correction shows.
      setSettled(false);
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        setSettled(true);
      }, HOLD_MS);
      const line = `${anchor} · ${header}: the notes have “${toDisplay(blank.answer)}”, not “${toDisplay(tile.text)}”.`;
      setLastMiss(line);
      setAnnounce(`${line} Block ${sheet.blockId}.`);
    }
    report(blank.row, state, false);
  };

  const tapTile = (tileId: string) => {
    if (cursor) place(tileId, cursor);
  };

  // Keep keyboard focus in the tray after a tile leaves it.
  useEffect(() => {
    const i = refocusTile.current;
    if (i === null) return;
    refocusTile.current = null;
    const els = tileEls.current.filter((el): el is HTMLButtonElement => !!el);
    if (els.length) els[Math.min(i, els.length - 1)].focus();
  }, [tray]);

  useEffect(
    () => () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    },
    [],
  );

  // After a placement the selection moves on; keep that blank on screen (it may sit under the
  // sticky tray, or off to the side in a table that scrolls sideways).
  useEffect(() => {
    if (!revealCursor.current) return;
    revealCursor.current = false;
    const el = cursor ? blankEls.current.get(cursor) : undefined;
    if (!el || typeof el.scrollIntoView !== 'function') return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [cursor, cells, reduced]);

  // Focus was on the blank just filled: follow the selection to the next open blank.
  useEffect(() => {
    if (!refocusBlank.current) return;
    refocusBlank.current = false;
    if (cursor) blankEls.current.get(cursor)?.focus();
  }, [cells, cursor]);

  // The tray sticks to the bottom of the screen while it is short; a tall tray sits under the table.
  useEffect(() => {
    const measure = () => {
      const el = trayRef.current;
      if (!el) return;
      const short = el.scrollHeight <= window.innerHeight * 0.4;
      setStick(short);
      setTrayH(short ? el.offsetHeight : 0);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [tray]);

  // Pressure: one timer for the sheet; when it runs out the table fills itself in.
  useEffect(() => {
    if (!timed || !limitMs || finished) return;
    const t = window.setTimeout(() => setTimedOut(true), Math.max(0, limitMs - (performance.now() - mountedAt.current)));
    return () => window.clearTimeout(t);
  }, [timed, limitMs, finished]);

  useEffect(() => {
    if (!timedOut) return;
    const now = performance.now();
    const state: Record<string, CellState> = { ...cellsRef.current };
    const openRows = new Set<number>();
    for (const b of order) {
      if (!state[b.key]) {
        state[b.key] = { status: 'revealed', text: b.answer };
        openRows.add(b.row);
      }
    }
    if (openRows.size === 0) return;
    // The time since the last placement goes to the rows left open.
    for (const r of openRows) rowTime.current.set(r, (rowTime.current.get(r) ?? 0) + (now - lastEvent.current) / openRows.size);
    setCells(state);
    setTray([]);
    setCursor(null);
    setLastMiss('Time ran out. The cells in gold are filled in from the notes.');
    setAnnounce('Time ran out. The rest of the table is filled in from the notes.');
    for (const r of openRows) report(r, state, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timedOut]);

  // Number keys pick a tile for the selected blank.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || finished) return;
      if (/^[1-9]$/.test(e.key)) {
        const tile = tray[Number(e.key) - 1];
        if (tile && cursor) {
          e.preventDefault();
          place(tile.id, cursor);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (finished && settled) nextRef.current?.focus();
  }, [finished, settled]);

  const cursorBlank = cursor ? blankByKey.get(cursor) : undefined;
  const choosingFor = cursorBlank ? `${toDisplay(sheet.headers[cursorBlank.col] ?? '')} · ${anchorOf(sheet, cursorBlank.row)}` : null;
  const letter = letterOf(rounds[0]?.objectiveId);
  const showHeading = sheet.heading && (phase === 'pressure' || finished);
  const width = sheet.headers.length;

  let prevGroup: string | null = null;
  const body = sheet.rows.map((row, ri) => {
    const out: JSX.Element[] = [];
    if (row.group && row.group !== prevGroup) {
      out.push(
        <tr key={`g${ri}`}>
          <th scope="colgroup" colSpan={width} className="g-grid-cell g-kicker" style={{ ...KICKER, textAlign: 'left', padding: '0.5rem 0.75rem', background: 'var(--g-soft)' }}>
            <NoteText latex={row.group} />
          </th>
        </tr>,
      );
    }
    prevGroup = row.group;
    out.push(
      <tr key={`r${ri}`}>
        {row.cells.map((cell, ci) => {
          const key = `${ri}:${ci}`;
          const blank = blankByKey.get(key);
          const tdStyle: CSSProperties = { padding: '0.5rem 0.75rem', verticalAlign: 'top', textAlign: 'left' };
          if (!blank) {
            return (
              <td key={ci} className="g-grid-cell g-serif" style={{ ...tdStyle, fontSize: 16 }}>
                <NoteText latex={cell} />
              </td>
            );
          }
          const st = cells[key];
          if (st) {
            return (
              <td key={ci} className="g-grid-cell g-serif" style={{ ...tdStyle, fontSize: 16, padding: st.status === 'wrong' ? 0 : tdStyle.padding }}>
                {st.status === 'right' && (
                  <span className="g-assemble block" style={{ borderLeft: '3px solid var(--g-green)', paddingLeft: '0.5rem' }}>
                    <NoteText latex={st.text} />
                  </span>
                )}
                {st.status === 'revealed' && (
                  <span
                    className="g-hold-right block"
                    style={{ '--g-hold': '0ms', padding: '0.25rem 0.5rem', borderLeftColor: 'var(--g-gold)', background: 'var(--g-pale-gold)' } as CSSProperties}
                  >
                    <NoteText latex={st.text} />
                  </span>
                )}
                {st.status === 'wrong' && (
                  <div>
                    <div className="g-hold-wrong" style={{ padding: '0.4rem 0.75rem' }}>
                      <span className="sr-only">Placed: </span>
                      <s>
                        <NoteText latex={st.wrong} />
                      </s>
                    </div>
                    <div className="g-hold-right" style={{ padding: '0.4rem 0.75rem' }}>
                      <span className="sr-only">The notes have: </span>
                      <NoteText latex={st.text} />
                    </div>
                  </div>
                )}
              </td>
            );
          }
          const selected = cursor === key;
          const header = toDisplay(sheet.headers[ci] ?? '');
          return (
            <td key={ci} className="g-grid-cell" style={{ ...tdStyle, padding: '0.35rem' }}>
              <button
                type="button"
                ref={(el: HTMLButtonElement | null) => {
                  if (el) blankEls.current.set(key, el);
                  else blankEls.current.delete(key);
                }}
                className={`g-drop w-full${selected ? ' is-armed' : ''}${hover === key ? ' is-over' : ''}`}
                style={{
                  minHeight: 44,
                  minWidth: '5.5rem',
                  // Scrolling a blank into view stops above the sticky tray, not under it.
                  scrollMarginBottom: trayH + 12,
                  scrollMarginTop: 12,
                  padding: '0.4rem 0.6rem',
                  borderRadius: 8,
                  background: hover === key ? 'var(--g-pale-navy)' : selected ? 'var(--g-pale-gold)' : 'transparent',
                  borderColor: selected ? 'var(--g-gold)' : undefined,
                  borderWidth: selected ? 2 : undefined,
                  color: 'var(--g-ink-muted)',
                  textAlign: 'left',
                  ...SMALL,
                }}
                aria-pressed={selected}
                aria-label={`Blank: ${header} for ${anchorOf(sheet, ri)}`}
                disabled={finished}
                onClick={() => setCursor(key)}
              >
                {selected ? 'Choose a tile' : ''}
              </button>
            </td>
          );
        })}
      </tr>,
    );
    return out;
  });

  return (
    <GameCard className="g-enter relative space-y-4 !px-4 sm:!px-6">
      {timed && <TimerBar key={sheet.key} ms={limitMs} paused={finished} />}
      <div className="space-y-1">
        <div className="g-kicker" style={KICKER}>
          {sheet.wholeColumn !== null ? 'A whole column is out' : 'Cells lifted out'}
          {letter ? ` · LO ${letter}` : ''}
        </div>
        {showHeading && (
          <p className="g-serif g-strong" style={{ fontSize: 18 }}>
            <NoteText latex={sheet.heading ?? ''} />
          </p>
        )}
      </div>

      <div
        className="overflow-x-auto"
        role="region"
        aria-label="Table, scrolls sideways when wide"
        tabIndex={0}
        style={{ overscrollBehaviorX: 'contain' }}
      >
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {sheet.headers.map((h, ci) => (
                <th
                  key={ci}
                  scope="col"
                  className="g-grid-cell"
                  style={{
                    minWidth: `${columnMinRem(sheet, ci)}rem`,
                    padding: '0.5rem 0.75rem',
                    textAlign: 'left',
                    verticalAlign: 'bottom',
                    fontSize: 15,
                    fontWeight: 600,
                    background: sheet.wholeColumn === ci && !finished ? 'var(--g-pale-gold)' : 'var(--g-soft)',
                  }}
                >
                  <NoteText latex={h} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>

      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {lastMiss && (
        <p key={lastMiss} className="g-settle" style={SMALL} aria-hidden="true">
          {lastMiss} <span className="g-muted">block <span style={MONO}>{sheet.blockId}</span></span>
        </p>
      )}

      {!finished && (
        <div
          ref={trayRef}
          role="group"
          aria-label={choosingFor ? `Loose cells. Choosing for ${choosingFor}` : 'Loose cells'}
          className={`${stick ? 'sticky bottom-0 z-10 ' : ''}-mx-4 space-y-2 border-t px-4 pt-3 sm:-mx-6 sm:px-6`}
          style={{
            background: 'var(--g-card)',
            borderColor: 'var(--g-rule)',
            paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
          }}
        >
          <p className="g-muted" style={SMALL}>
            {choosingFor ? (
              <>
                Choosing for <span className="g-strong">{choosingFor}</span>. Tap a tile, press its number, or drag it onto any blank.
              </>
            ) : (
              'Tap a blank in the table, then a tile, or drag a tile onto a blank.'
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {tray.map((t, i) => (
              <TileButton
                key={t.id}
                tile={t}
                n={i + 1}
                reduced={reduced}
                disabled={finished}
                onTap={tapTile}
                onDragTo={place}
                blankAt={blankAt}
                onHover={setHover}
                registerRef={(el) => {
                  tileEls.current[i] = el;
                }}
              />
            ))}
          </div>
        </div>
      )}

      {finished && (
        <div className="g-settle space-y-3 border-l-[3px] pl-4" style={{ borderColor: 'var(--g-navy)' }}>
          {sheet.caption && (
            <p className="g-serif" style={{ fontSize: 17 }}>
              <NoteText latex={sheet.caption} />
            </p>
          )}
          <p className="g-source" style={SMALL}>
            block <span style={MONO}>{sheet.blockId}</span>
          </p>
        </div>
      )}

      {finished && (
        <div className="flex justify-end">
          <button ref={nextRef} type="button" className="g-btn is-primary" onClick={onNext} disabled={!settled}>
            {last ? 'Continue' : 'Next table'}
          </button>
        </div>
      )}
    </GameCard>
  );
}

/** One short rule per row in play this phase: pending, caught, missed. No numbers. */
function Docket({ rounds, results }: { rounds: MechanicRound<TableFillPayload>[]; results: Record<string, boolean> }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {rounds.map((r) => {
        const res = results[r.id];
        const bg = res === undefined ? 'var(--g-rule)' : res ? 'var(--g-green)' : 'var(--g-red)';
        return <span key={r.id} className="h-1 flex-1" style={{ background: bg }} />;
      })}
    </div>
  );
}

export function TableFillBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<TableFillPayload>) {
  const sheets = useMemo(() => {
    const out: { sheet: Sheet; rounds: MechanicRound<TableFillPayload>[] }[] = [];
    for (const r of rounds) {
      const s = r.payload?.sheet;
      if (!s) continue;
      const cur = out.find((x) => x.sheet.key === s.key);
      if (cur) cur.rounds.push(r);
      else out.push({ sheet: s, rounds: [r] });
    }
    return out;
  }, [rounds]);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<Record<string, boolean>>({});
  const done = useRef(false);

  useEffect(() => {
    if (sheets.length === 0 && !done.current) {
      done.current = true;
      onPhaseDone();
    }
  }, [sheets.length, onPhaseDone]);

  const cur = sheets[index];
  if (!cur) return null;

  const onRowResult = (_round: MechanicRound<TableFillPayload>, r: RoundResult) => {
    onResult(r);
    setResults((xs) => ({ ...xs, [r.roundId]: r.correct }));
  };
  const next = () => {
    if (index + 1 < sheets.length) setIndex(index + 1);
    else if (!done.current) {
      done.current = true;
      onPhaseDone();
    }
  };

  return (
    <div className="space-y-5">
      <div className="g-kicker" style={KICKER}>
        {phase === 'discovery' ? 'Put the table back together' : 'Under pressure'}
      </div>
      <Docket rounds={rounds} results={results} />
      <SheetBoard
        key={cur.sheet.key}
        sheet={cur.sheet}
        rounds={cur.rounds}
        phase={phase}
        onRowResult={onRowResult}
        onNext={next}
        last={index + 1 === sheets.length}
      />
    </div>
  );
}
