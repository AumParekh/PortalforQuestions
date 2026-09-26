// Framework Navigator board (§7.3 relational, visual addition). One map of the regulatory
// frameworks in the notes; the reading's nodes are lit. Rounds: open a node and sort its items
// (explore), place a change on its node (place), sort items between two neighbours (compare).
//
// Feel (§10.3): the dragged card lifts and sends a puck that snaps onto the nearest candidate node
// or bin; a right placement locks (the node's ring closes, the card settles green); a wrong one
// bounces back, grows a phantom branch from the wrong node that leads nowhere, and the right node
// or bin pulses until the card lands there. Comparing two nodes lights the lineage between them and
// closes the loop with an arc when the sort is done.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MutableRefObject, PointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MechanicRenderProps, MechanicRound, RoundResult } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import { GameButton, GameCard, TimerBar, WrongHold } from '../../theme/primitives';
import type { ComparePayload, ExplorePayload, FnPayload, PlacePayload } from './build';
import { readingNodes, sortGrade } from './build';
import type { Facet, FnData, FnNode } from './schema';
import { FACETS, FACET_LABEL, frameworkData, yearLabel } from './schema';
import type { BaseLayout } from './layout';
import { baseLayout } from './layout';
import type { NodeMark } from './Tree';
import { Tree, prefersReducedMotion } from './Tree';
import './framework-navigator.css';

const AUTO_ADVANCE_MS = 1200;
const HOLD_MS = 800;
const SNAP_PX = 60;

type Round = MechanicRound<FnPayload>;

function nodeTitle(n: FnNode): string {
  const y = yearLabel(n);
  return y ? `${n.name} (${y})` : `${n.name} (undated in the notes)`;
}

/** setTimeout whose pending callbacks are cleared when the component unmounts. */
function useLater(): (fn: () => void, ms: number) => void {
  const ids = useRef(new Set<number>());
  useEffect(() => {
    const pending = ids.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    };
  }, []);
  return (fn, ms) => {
    const id = window.setTimeout(() => {
      ids.current.delete(id);
      fn();
    }, ms);
    ids.current.add(id);
  };
}

// ---------------------------------------------------------------------------------------------
// Drag with snapping

interface Target {
  id: string;
  el: HTMLElement;
}

/**
 * A card that can be dragged (pointer: mouse, pen, touch) or tapped. While dragging, the card lifts
 * and a puck follows the pointer; within reach of a target the puck snaps onto its centre. Release
 * on a snapped target drops there; anywhere else the card settles back. Enter / Space = tap.
 */
function DragChip({
  children,
  className = '',
  disabled = false,
  held = false,
  label,
  getTargets,
  onDrop,
  onOver,
  onTap,
  scroller,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  held?: boolean;
  label?: string;
  getTargets: () => Target[];
  onDrop: (targetId: string) => void;
  onOver?: (targetId: string | null) => void;
  onTap?: () => void;
  scroller?: MutableRefObject<HTMLDivElement | null>;
}) {
  const [drag, setDrag] = useState<{ x: number; y: number; snap: string | null } | null>(null);
  const start = useRef<{ x: number; y: number; pointerId: number; dragging: boolean } | null>(null);
  const snapRef = useRef<string | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);

  const nearest = (x: number, y: number) => {
    let best: { id: string; cx: number; cy: number } | null = null;
    let bestD = Infinity;
    for (const t of getTargets()) {
      const r = t.el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const inside = x >= r.left - 12 && x <= r.right + 12 && y >= r.top - 12 && y <= r.bottom + 12;
      const d = Math.hypot(x - cx, y - cy);
      if ((inside || d < SNAP_PX) && d < bestD) {
        best = { id: t.id, cx, cy };
        bestD = d;
      }
    }
    return best;
  };

  const reset = () => {
    start.current = null;
    snapRef.current = null;
    setDrag(null);
    onOver?.(null);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    start.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s || s.pointerId !== e.pointerId) return;
    if (!s.dragging && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return;
    s.dragging = true;
    // Nudge the tree sideways when the pointer rides its edge.
    const sc = scroller?.current;
    if (sc) {
      const r = sc.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom) {
        if (e.clientX < r.left + 36) sc.scrollLeft -= 12;
        else if (e.clientX > r.right - 36) sc.scrollLeft += 12;
      }
    }
    const hit = nearest(e.clientX, e.clientY);
    const snap = hit?.id ?? null;
    if (snap !== snapRef.current) onOver?.(snap);
    snapRef.current = snap;
    setDrag({ x: hit ? hit.cx : e.clientX, y: hit ? hit.cy : e.clientY, snap });
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const snap = snapRef.current;
    const dragging = s.dragging;
    reset();
    if (!dragging) onTap?.();
    else if (snap) onDrop(snap);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onTap?.();
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`fn-chip${drag ? ' is-lifted' : ''}${held ? ' is-held' : ''} ${className}`}
        disabled={disabled}
        aria-pressed={held}
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
        onKeyDown={onKeyDown}
      >
        {children}
      </button>
      {/* The puck is position:fixed in viewport coordinates, so it is portalled to the game root:
          an animated (transformed) ancestor card would otherwise become its containing block. */}
      {drag &&
        createPortal(
          <span className={`fn-puck${drag.snap ? ' is-snapped' : ''}`} style={{ left: drag.x, top: drag.y }} aria-hidden="true" />,
          btn.current?.closest('.game-root') ?? document.body,
        )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Sorting items into bins (explore: the three facets; compare: A or B)

interface SortChip {
  id: string;
  text: string;
  bin: string;
}
interface SortBin {
  id: string;
  label: string;
  sub?: string;
}

/**
 * Right items lock into their bin; a wrong one bounces back to the tray while the right bin pulses,
 * and the player places it again. The first try is what counts. `forceDone` (time ran out) drops
 * every unplaced item into its bin as a miss.
 */
function SortBoard({
  bins,
  chips,
  forceDone,
  onComplete,
  twoUp,
}: {
  bins: SortBin[];
  chips: SortChip[];
  forceDone: boolean;
  onComplete: (right: number, total: number) => void;
  twoUp: boolean;
}) {
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [missed, setMissed] = useState<Set<string>>(new Set());
  const [pulse, setPulse] = useState<{ bin: string; chip: string } | null>(null);
  const [bounce, setBounce] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const binEls = useRef(new Map<string, HTMLElement>());
  const reported = useRef(false);
  const later = useLater();

  const drop = (chipId: string, binId: string) => {
    const chip = chips.find((c) => c.id === chipId);
    if (!chip || placed[chipId]) return;
    setHeld(null);
    if (chip.bin === binId) {
      setPlaced((p) => ({ ...p, [chipId]: binId }));
      if (pulse?.chip === chipId) setPulse(null);
      return;
    }
    setMissed((m) => new Set(m).add(chipId));
    setBounce(chipId);
    setPulse({ bin: chip.bin, chip: chipId });
    later(() => setBounce((b) => (b === chipId ? null : b)), 560);
  };

  useEffect(() => {
    if (!forceDone) return;
    const rest = chips.filter((c) => !placed[c.id]);
    if (rest.length === 0) return;
    setPlaced((p) => ({ ...p, ...Object.fromEntries(rest.map((c) => [c.id, c.bin])) }));
    setMissed((m) => new Set([...m, ...rest.map((c) => c.id)]));
    setPulse(null);
    setHeld(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceDone]);

  const allPlaced = chips.every((c) => placed[c.id]);
  useEffect(() => {
    if (!allPlaced || reported.current) return;
    reported.current = true;
    onComplete(chips.length - chips.filter((c) => missed.has(c.id)).length, chips.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPlaced]);

  const getTargets = () => [...binEls.current.entries()].map(([id, el]) => ({ id, el }));
  const tray = chips.filter((c) => !placed[c.id]);

  return (
    <div className="space-y-4">
      {tray.length > 0 && (
        <div className="space-y-2">
          <div className="fn-kicker">Sort these</div>
          <div className="grid gap-2">
            {tray.map((c) => (
              <DragChip
                key={c.id}
                className={bounce === c.id ? 'is-bounce' : ''}
                held={held === c.id}
                disabled={forceDone}
                getTargets={getTargets}
                onDrop={(bin) => drop(c.id, bin)}
                onOver={setOver}
                onTap={() => setHeld((h) => (h === c.id ? null : c.id))}
              >
                {c.text}
              </DragChip>
            ))}
          </div>
          <p className="fn-small g-muted">Drag an item onto its box, or tap it and then tap the box.</p>
        </div>
      )}
      <div className={`grid gap-3 ${twoUp ? 'sm:grid-cols-2' : 'md:grid-cols-3'}`}>
        {bins.map((b) => {
          const armed = held !== null;
          const inBin = chips.filter((c) => placed[c.id] === b.id);
          const cls = `fn-bin${armed ? ' is-armed' : ''}${over === b.id ? ' is-over' : ''}${pulse?.bin === b.id ? ' is-pulse' : ''}`;
          return (
            <div
              key={b.id}
              ref={(el: HTMLDivElement | null) => {
                if (el) binEls.current.set(b.id, el);
                else binEls.current.delete(b.id);
              }}
              className={cls}
              role={armed ? 'button' : 'group'}
              tabIndex={armed ? 0 : undefined}
              aria-label={armed ? `Put it in: ${b.label}` : b.label}
              onClick={armed && held ? () => drop(held, b.id) : undefined}
              onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                if (armed && held && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  drop(held, b.id);
                }
              }}
            >
              <div>
                <div className="fn-bin-label">{b.label}</div>
                {b.sub && <div className="fn-small g-muted">{b.sub}</div>}
              </div>
              {inBin.map((c) => (
                <div key={c.id} className={`fn-chip is-locked${missed.has(c.id) ? ' is-missed' : ''}`}>
                  {c.text}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The reveal: what a node introduced, restricted and was responding to

function NodeCard({ data, node, highlight }: { data: FnData; node: FnNode; highlight?: ReadonlySet<string> }) {
  const lane = data.lineages.find((l) => l.id === node.lineage)?.label ?? node.lineage;
  const parents = node.parents.map((p) => data.nodeById[p]?.short).filter(Boolean);
  const kids = (data.childrenOf[node.id] ?? []).map((k) => data.nodeById[k]?.short).filter(Boolean);
  const year = yearLabel(node);
  return (
    <article className="fn-nodecard g-enter space-y-3" aria-label={`${node.name}: what it introduced, restricted and was responding to`}>
      <div className="space-y-1">
        <h3>{node.name}</h3>
        <p className="fn-small g-muted">
          {year ?? 'Undated in the notes'} · {lane}
        </p>
        {(parents.length > 0 || kids.length > 0) && (
          <p className="fn-small g-muted">
            {parents.length > 0 && <>Grew out of {parents.join(', ')}. </>}
            {kids.length > 0 && <>Led to {kids.join(', ')}.</>}
          </p>
        )}
      </div>
      {node.summary && <p className="g-serif fn-text">{node.summary}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        {FACETS.filter((f) => node[f].length > 0).map((f) => (
          <section key={f} className="space-y-1">
            <div className="fn-kicker">{FACET_LABEL[f]}</div>
            <ul className="fn-facet-list">
              {node[f].map((t) => (
                <li key={t} className={highlight?.has(t) ? 'is-hit' : ''}>
                  {t}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------------------------
// Shared round plumbing

interface RoundProps<P> {
  round: MechanicRound<P>;
  phase: PlayPhase;
  data: FnData;
  base: BaseLayout;
  lit: ReadonlySet<string>;
  showAll: boolean;
  onAnswered: (r: RoundResult) => void;
  onNext: () => void;
  last: boolean;
}

function treeCaption(extra: string): string {
  return `Each circle is a framework, oldest on the left, one row per lineage; lines run from a framework to what grew out of it. Filled circles belong to this reading. ${extra}`;
}

function NextButton({ enabled, last, onClick }: { enabled: boolean; last: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (enabled) ref.current?.focus();
  }, [enabled]);
  return (
    <div className="flex justify-end">
      <button ref={ref} type="button" className="g-btn is-primary" disabled={!enabled} onClick={onClick}>
        {last ? 'Continue' : 'Next'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Place: a change (or a node's own item) onto its node

type PlaceStage = 'place' | 'fix' | 'hold' | 'done';

function PlaceRound({ round, phase, data, base, lit, showAll, onAnswered, onNext, last }: RoundProps<PlacePayload>) {
  const p = round.payload;
  const answer = data.nodeById[p.answer];
  const [stage, setStage] = useState<PlaceStage>('place');
  const [first, setFirst] = useState<{ correct: boolean; timedOut: boolean; pick: string | null } | null>(null);
  const [shaking, setShaking] = useState<string | null>(null);
  const [phantom, setPhantom] = useState<{ from: string; key: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const [peek, setPeek] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const started = useRef(performance.now());
  const targets = useRef(new Map<string, HTMLElement>());
  const scroller = useRef<HTMLDivElement | null>(null);
  const timed = phase === 'pressure';
  const later = useLater();

  const report = (correct: boolean, timedOut: boolean, pick: string | null) => {
    if (first) return;
    setFirst({ correct, timedOut, pick });
    onAnswered({ roundId: round.id, correct, timeMs: performance.now() - started.current, timedOut });
  };

  const place = (id: string) => {
    if (stage !== 'place' && stage !== 'fix') return;
    if (!p.candidates.includes(id)) return;
    setHeld(false);
    if (id === p.answer) {
      if (!first) {
        report(true, false, id);
        setSettled(true);
      }
      setStage('done');
      return;
    }
    if (!first) report(false, false, id);
    setShaking(id);
    setPhantom({ from: id, key: Date.now() });
    later(() => setShaking((s) => (s === id ? null : s)), 560);
    // Discovery: the right node pulses and the player places it there. Pressure: it locks by itself.
    setStage(timed ? 'hold' : 'fix');
  };

  useEffect(() => {
    if (!phantom) return;
    const t = window.setTimeout(() => setPhantom(null), 1600);
    return () => window.clearTimeout(t);
  }, [phantom]);

  useEffect(() => {
    if (!timed || stage !== 'place') return;
    const t = window.setTimeout(() => {
      report(false, true, null);
      setStage('hold');
    }, round.timeLimitMs ?? 12000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, timed]);

  useEffect(() => {
    if (stage !== 'hold') return;
    const t = window.setTimeout(() => setStage('done'), HOLD_MS + 500);
    return () => window.clearTimeout(t);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'done' || !settled || !timed || !first?.correct) return;
    const t = window.setTimeout(onNext, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, settled]);

  const marks: Record<string, NodeMark[]> = {};
  const add = (id: string, m: NodeMark) => (marks[id] = [...(marks[id] ?? []), m]);
  if (stage === 'place' || stage === 'fix') for (const c of p.candidates) add(c, 'candidate');
  if (over) add(over, 'over');
  if (shaking) add(shaking, 'wrong');
  if (stage === 'fix' || stage === 'hold') add(p.answer, 'pulse');
  if (stage === 'done') add(p.answer, 'locked');
  if (peek && peek !== p.answer) add(peek, 'open');

  const active = stage === 'place' || stage === 'fix';
  const tappable: ReadonlySet<string> | 'all' = active ? new Set(p.candidates) : stage === 'done' && !timed ? 'all' : new Set<string>();
  const wrong = first?.pick && first.pick !== p.answer ? data.nodeById[first.pick] : null;
  const explain = p.why || (answer ? answer.summary : '');
  const highlight = new Set([p.text]);

  if (!answer) return null;
  return (
    <div className="space-y-4">
      <GameCard className="g-enter relative space-y-3">
        {timed && stage === 'place' && <TimerBar ms={round.timeLimitMs ?? 12000} />}
        <div className="fn-kicker">{p.source === 'change' ? 'A regulatory change' : 'One framework’s record'}</div>
        {stage !== 'done' ? (
          <DragChip
            className={`fn-change${shaking ? ' is-bounce' : ''}`}
            held={held}
            disabled={!active}
            label={`${p.facet ? `${FACET_LABEL[p.facet]}: ` : ''}${p.text}. Drag onto a ringed framework, or tap a ringed framework to place it.`}
            getTargets={() =>
              p.candidates
                .flatMap((id) => [
                  { id, el: targets.current.get(id) },
                  { id, el: targets.current.get(`btn:${id}`) },
                ])
                .filter((t): t is Target => !!t.el)
            }
            onDrop={place}
            onOver={setOver}
            onTap={() => setHeld((h) => !h)}
            scroller={scroller}
          >
            {p.facet && <span className="fn-facet-tag">{FACET_LABEL[p.facet]}</span>}
            {p.text}
          </DragChip>
        ) : (
          <div>
            <div className={`fn-chip fn-change is-locked${first?.correct ? '' : ' is-missed'}`}>
              {p.facet && <span className="fn-facet-tag">{FACET_LABEL[p.facet]}</span>}
              {p.text}
              <span className="block fn-small g-muted mt-1">Locked on {answer.short}</span>
            </div>
          </div>
        )}
        {stage === 'place' && (
          <p className="fn-small g-muted">
            {p.source === 'change'
              ? 'Which framework made this change? Drag it onto a ringed node, or tap the node or its button below the map.'
              : 'Which framework does this belong to? Drag it onto a ringed node, or tap the node or its button below the map.'}
          </p>
        )}
        {stage === 'fix' && (
          <p className="fn-small" aria-live="polite">
            Not {wrong?.short ?? 'there'}. The pulsing node (and button) is where it belongs; place it there.
          </p>
        )}
      </GameCard>

      <Tree
        data={data}
        base={base}
        lit={lit}
        focus={p.candidates}
        showAll={showAll}
        marks={marks}
        tappable={tappable}
        onTap={active ? place : (id) => setPeek(id === peek ? null : id)}
        verb={active ? 'Place it on' : 'Look inside'}
        phantom={phantom}
        registerTarget={(id, el) => {
          if (el) targets.current.set(id, el);
          else targets.current.delete(id);
        }}
        scrollerRef={scroller}
        caption={treeCaption('Ringed circles are this round’s choices.')}
      />

      {/* The same choices as buttons: on a phone the tree is wider than the screen and a ringed
          node can sit off to the side, which a timed round should not punish. */}
      {active && (
        <div className="fn-choices" role="group" aria-label="This round’s choices">
          {p.candidates.map((id) => {
            const n = data.nodeById[id];
            if (!n) return null;
            const y = yearLabel(n);
            const cls = `g-btn fn-choice${over === id ? ' is-over' : ''}${stage === 'fix' && id === p.answer ? ' is-pulse' : ''}`;
            return (
              <button
                key={id}
                ref={(el: HTMLButtonElement | null) => {
                  const k = `btn:${id}`;
                  if (el) targets.current.set(k, el);
                  else targets.current.delete(k);
                }}
                type="button"
                className={cls}
                aria-label={`Place it on ${n.name}${y ? `, ${y}` : ', undated'}`}
                onClick={() => place(id)}
              >
                {n.short}
                {y && <span className="g-muted"> · {y}</span>}
              </button>
            );
          })}
        </div>
      )}

      {stage === 'done' && first && (
        <GameCard className="space-y-3">
          {first.correct ? (
            <div className="g-assemble border-l-[3px] pl-4" style={{ borderColor: 'var(--g-green)' }}>
              <p className="fn-text">
                <span className="g-strong">{nodeTitle(answer)}.</span> {explain}
              </p>
            </div>
          ) : (
            <WrongHold
              wrong={
                first.timedOut ? (
                  <span className="fn-text">Time ran out.</span>
                ) : (
                  <span className="fn-text">
                    Placed on <span className="g-strong">{wrong?.short}</span>
                    {wrong?.summary ? `: ${wrong.summary}` : '.'}
                  </span>
                )
              }
              right={
                <span className="fn-text">
                  <span className="g-strong">{nodeTitle(answer)}.</span> {explain}
                </span>
              }
              holdMs={HOLD_MS}
              onSettled={() => setSettled(true)}
            />
          )}
          <NextButton enabled={settled} last={last} onClick={onNext} />
        </GameCard>
      )}

      {stage === 'done' && !timed && (
        <div className="space-y-3">
          <NodeCard data={data} node={answer} highlight={highlight} />
          {peek && peek !== p.answer && data.nodeById[peek] && <NodeCard data={data} node={data.nodeById[peek]} />}
          <p className="fn-small g-muted">Tap any framework on the map to look inside it.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Explore: open a node, sort its items into introduced / restricted / responding to

function ExploreRound({ round, data, base, lit, showAll, onAnswered, onNext, last }: RoundProps<ExplorePayload>) {
  const p = round.payload;
  const node = data.nodeById[p.node];
  const [stage, setStage] = useState<'closed' | 'sort' | 'done'>('closed');
  const [peek, setPeek] = useState<string | null>(null);
  const started = useRef(performance.now());

  const open = () => {
    if (stage !== 'closed') return;
    started.current = performance.now();
    setStage('sort');
  };
  const complete = (right: number, total: number) => {
    onAnswered({ roundId: round.id, correct: right === total, timeMs: performance.now() - started.current, grade: sortGrade(right, total, false) });
    setStage('done');
  };

  const marks: Record<string, NodeMark[]> = { [p.node]: stage === 'closed' ? ['pulse'] : ['open'] };
  if (peek && peek !== p.node) marks[peek] = ['open'];
  const chips: SortChip[] = p.chips.map((c) => ({ id: c.id, text: c.text, bin: c.facet }));
  const bins: SortBin[] = FACETS.map((f: Facet) => ({ id: f, label: FACET_LABEL[f] }));

  if (!node) return null;
  return (
    <div className="space-y-4">
      <GameCard className="g-enter space-y-3">
        <div className="fn-kicker">Open a framework</div>
        {stage === 'closed' && (
          <>
            <p className="g-reading">
              One of this reading’s frameworks is pulsing on the map. Open it: its record spills out, and you sort each line into what it
              introduced, what it restricted, and what it was responding to.
            </p>
            <GameButton variant="primary" onClick={open}>
              Open {node.short}
            </GameButton>
          </>
        )}
        {stage !== 'closed' && (
          <div className="space-y-1">
            <p className="g-reading">
              <span className="g-strong">{nodeTitle(node)}</span>
            </p>
            {node.parents.length > 0 && (
              <p className="fn-small g-muted">Grew out of {node.parents.map((x) => data.nodeById[x]?.short).filter(Boolean).join(', ')}.</p>
            )}
          </div>
        )}
      </GameCard>

      <Tree
        data={data}
        base={base}
        lit={lit}
        focus={[p.node]}
        showAll={showAll}
        marks={marks}
        tappable={stage === 'closed' ? new Set([p.node]) : stage === 'done' ? 'all' : new Set<string>()}
        onTap={stage === 'closed' ? open : (id) => setPeek(id === peek ? null : id)}
        verb={stage === 'closed' ? 'Open' : 'Look inside'}
        caption={treeCaption('The pulsing circle is the one to open.')}
      />

      {stage !== 'closed' && (
        <GameCard className="space-y-4">
          <SortBoard bins={bins} chips={chips} forceDone={false} onComplete={complete} twoUp={false} />
          {stage === 'done' && (
            <>
              <NodeCard data={data} node={node} highlight={new Set(p.chips.map((c) => c.text))} />
              {peek && peek !== p.node && data.nodeById[peek] && <NodeCard data={data} node={data.nodeById[peek]} />}
              <p className="fn-small g-muted">Tap any framework on the map to look inside it.</p>
              <NextButton enabled last={last} onClick={onNext} />
            </>
          )}
        </GameCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Compare: two neighbours; sort items to the one they belong to

function CompareRound({ round, phase, data, base, lit, showAll, onAnswered, onNext, last }: RoundProps<ComparePayload>) {
  const p = round.payload;
  const a = data.nodeById[p.a];
  const b = data.nodeById[p.b];
  const [stage, setStage] = useState<'sort' | 'done'>('sort');
  const [timedOut, setTimedOut] = useState(false);
  const started = useRef(performance.now());
  const timed = phase === 'pressure';

  useEffect(() => {
    if (!timed || stage !== 'sort') return;
    const t = window.setTimeout(() => setTimedOut(true), round.timeLimitMs ?? 40000);
    return () => window.clearTimeout(t);
  }, [timed, stage, round.timeLimitMs]);

  const complete = (right: number, total: number) => {
    const out = timedOut && right < total;
    onAnswered({
      roundId: round.id,
      correct: right === total && !out,
      timeMs: performance.now() - started.current,
      timedOut: out,
      grade: sortGrade(right, total, out),
    });
    setStage('done');
  };

  if (!a || !b) return null;
  const marks: Record<string, NodeMark[]> = { [p.a]: ['side-a'], [p.b]: ['side-b'] };
  const chips: SortChip[] = p.chips.map((c) => ({ id: c.id, text: c.text, bin: c.side }));
  const ya = yearLabel(a);
  const yb = yearLabel(b);
  const bins: SortBin[] = [
    { id: 'a', label: `A · ${a.short}`, sub: ya ?? 'undated' },
    { id: 'b', label: `B · ${b.short}`, sub: yb ?? 'undated' },
  ];

  return (
    <div className="space-y-4">
      <GameCard className="g-enter relative space-y-2">
        {timed && stage === 'sort' && <TimerBar ms={round.timeLimitMs ?? 40000} paused={timedOut} />}
        <div className="fn-kicker">Two neighbours</div>
        <p className="g-reading">
          <span className="g-strong">A</span> {a.name} and <span className="g-strong">B</span> {b.name}. Sort each line to the one it belongs to.
        </p>
      </GameCard>

      <Tree
        data={data}
        base={base}
        lit={lit}
        focus={[p.a, p.b]}
        showAll={showAll}
        marks={marks}
        tappable={new Set<string>()}
        verb="Look inside"
        loop={{ a: p.a, b: p.b, closed: stage === 'done' }}
        caption={treeCaption('A and B are joined by the lineage between them; the arc closes when you finish.')}
      />

      <GameCard className="space-y-4">
        <SortBoard bins={bins} chips={chips} forceDone={timedOut} onComplete={complete} twoUp />
        {stage === 'done' && (
          <div className="g-enter space-y-3">
            {timedOut && <p className="fn-small g-muted">Time ran out; the rest have been put where they belong.</p>}
            <div className="fn-kicker">What separates them</div>
            {p.differences.length > 0 ? (
              <div className="space-y-2">
                {p.differences.map((d) => (
                  <p key={d} className="fn-diff">
                    {d}
                  </p>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="fn-diff">
                  <span className="g-strong">{a.short}.</span> {a.summary}
                </p>
                <p className="fn-diff">
                  <span className="g-strong">{b.short}.</span> {b.summary}
                </p>
              </div>
            )}
            <NextButton enabled last={last} onClick={onNext} />
          </div>
        )}
      </GameCard>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Phase board

/** One short rule per round this phase — pending, current, right, missed. No numbers. */
function Docket({ total, index, results }: { total: number; index: number; results: boolean[] }) {
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => {
        const bg = i < results.length ? (results[i] ? 'var(--g-green)' : 'var(--g-red)') : i === index ? 'var(--g-gold)' : 'var(--g-rule)';
        return <span key={i} className="h-1 flex-1" style={{ background: bg }} />;
      })}
    </div>
  );
}

export function FrameworkBoard({ phase, rounds, reading, corpus, onResult, onPhaseDone }: MechanicRenderProps<FnPayload>) {
  const data = frameworkData(corpus.extras);
  const base = useMemo(() => (data ? baseLayout(data.nodes, data.lineages.map((l) => l.id)) : null), [data]);
  const lit = useMemo(() => new Set(data ? readingNodes(data, reading.reading_id).map((n) => n.id) : []), [data, reading.reading_id]);
  const [showAll, setShowAll] = useState(false);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onPhaseDone();
  };

  useEffect(() => {
    if (rounds.length === 0 || !data || !base) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds.length, data, base]);

  useEffect(() => {
    window.scrollTo?.({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [index]);

  const round = rounds[index] as Round | undefined;
  if (!round || !data || !base) return null;

  const answered = (r: RoundResult) => {
    onResult(r);
    setResults((xs) => [...xs, r.correct]);
  };
  const next = () => {
    if (index + 1 < rounds.length) setIndex(index + 1);
    else finish();
  };
  const common = {
    phase,
    data,
    base,
    lit,
    showAll,
    onAnswered: answered,
    onNext: next,
    last: index + 1 === rounds.length,
  };
  const p = round.payload;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="fn-kicker">{phase === 'discovery' ? 'Explore the map' : 'Against the clock'}</div>
        <GameButton variant="quiet" selected={showAll} onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Only this round’s lineages' : 'Show every lineage'}
        </GameButton>
      </div>
      <Docket total={rounds.length} index={index} results={results} />
      {p.kind === 'place' && <PlaceRound key={round.id} round={round as MechanicRound<PlacePayload>} {...common} />}
      {p.kind === 'explore' && <ExploreRound key={round.id} round={round as MechanicRound<ExplorePayload>} {...common} />}
      {p.kind === 'compare' && <CompareRound key={round.id} round={round as MechanicRound<ComparePayload>} {...common} />}
    </div>
  );
}
