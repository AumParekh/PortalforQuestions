// Tree Racer board. A recombining tree drawn as a hand-rolled SVG whose viewBox follows the
// container width 1:1 (15px labels stay 15px on a phone). One node at a time is highlighted
// (a pulsing rail on its date for rate trees, a pulsing "?" chip for valuation lattices) and three
// candidate values are offered.
//   Correct: the value snaps onto the tree and locks; where two routes meet, the diamond
//   between them closes and stays shaded.
//   Wrong: the picked value is placed where it really lies and its phantom branch grows: for a
//   rate tree, the two children the model's rule would give it, landing off the real lattice
//   (the real tree's next nodes shown as rings); for a valuation lattice, the parent value(s)
//   it would produce, as misregistered ghost chips. The wrong branch holds for a beat, then the
//   tree's value fades in; the phantom stays faintly overlaid for the rest of the race.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MechanicRenderProps, MechanicRound } from '../../arc/plugin';
import type { PlayPhase } from '../../types';
import { GameCard, NoteText, TimerBar } from '../../theme/primitives';
import type { TreePayload } from './build';
import { dateLabel, dateWords, mistakeLine, nodeWords, paramRows, quantityWord } from './build';
import type { Candidate, Phantom, TreeItem } from './schema';
import { nodeKey } from './schema';
import { formatValue, shortDisplay } from './maths';
import type { ForwardGeom, LatticeGeom } from './layout';
import { CHIP_PAD_X, LINE, chipHeight, forwardGeometry, latticeGeometry, latticeXY, relaxLabels, textWidth, yOf } from './layout';
import './tree-racer.css';

const HOLD_MS = 800;
const FADE_MS = 520;
const SNAP_MS = 360;
const AUTO_ADVANCE_MS = 1100;
const KEYS = ['1', '2', '3'];

type Stage = 'pick' | 'snap' | 'hold' | 'reveal' | 'settled';
type NodeState = 'given' | 'pre' | 'won' | 'lost';

interface Outcome {
  picked: number | null;
  correct: boolean;
  timedOut: boolean;
}

interface PastPhantom {
  step: number;
  wrong: Candidate;
  phantom: Phantom | null;
}

interface CurrentView {
  step: number;
  t: number;
  i: number;
  stage: Stage;
  /** Glide progress of the placed value, 0..1. */
  k: number;
  picked: Candidate | null;
  correct: boolean;
  phantom: Phantom | null;
}

interface TreeView {
  item: TreeItem;
  known: Map<string, NodeState>;
  past: PastPhantom[];
  current: CurrentView;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.classList.contains('reduce-motion')) return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Width of an element, tracked with ResizeObserver (the SVG's viewBox follows it 1:1). */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const obs = useRef<ResizeObserver | null>(null);
  const setRef = useCallback((el: T | null) => {
    obs.current?.disconnect();
    obs.current = null;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    obs.current = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    obs.current.observe(el);
  }, []);
  useEffect(() => () => obs.current?.disconnect(), []);
  return [setRef, width];
}

const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
/** A small overshoot, so a correct value lands with a snap. */
const easeOutBack = (x: number) => {
  const c1 = 1.1;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function phantomOf(item: TreeItem, step: number, c: Candidate | null): Phantom | null {
  if (!c || c.correct) return null;
  return item.phantom[step].find((p) => p.mistakeCode === c.mistakeCode) ?? null;
}

function rateText(item: TreeItem, t: number, i: number): string | null {
  if (item.spec.direction !== 'backward') return null;
  const r = item.spec.params.rates[t]?.[i];
  if (r === undefined) return null;
  const withPremium = t >= 1 && item.spec.params.premium ? r + item.spec.params.premium : r;
  return `r ${Number(withPremium.toFixed(4))}%`;
}

/** Second line of a lattice chip: the node's rate, or at an option's expiry the bond price the payoff reads. */
function chipSub(item: TreeItem, t: number, i: number): string | null {
  const E = item.spec.direction === 'backward' ? item.spec.params.expiryStep : undefined;
  if (item.underlying && E === t) {
    const b = item.underlying[t]?.[i];
    return b ? `B ${b.display}` : null;
  }
  return rateText(item, t, i);
}

// ---------------------------------------------------------------------------------------------
// Forward trees: rates on a value axis

interface Label {
  key: string;
  col: number;
  x: number;
  dotY: number;
  text: string;
  cls: string;
}

function ForwardTree({ view, width }: { view: TreeView; width: number }) {
  const { item, known, past, current } = view;
  const labelW = useMemo(() => {
    const texts: string[] = [];
    for (const row of item.nodes) for (const n of row) texts.push(n.display);
    for (const cs of item.candidates) for (const c of cs) texts.push(c.display);
    for (const ps of item.phantom) for (const p of ps) texts.push(...p.displays, ...p.real.map((v) => formatValue(item.unit, item.decimals, v)));
    return Math.max(...texts.map((s) => textWidth(shortDisplay(s))));
  }, [item]);
  const g: ForwardGeom = useMemo(
    () => forwardGeometry({ width, steps: item.steps, lo: item.range[0], hi: item.range[1], minSep: item.minSep, labelW }),
    [width, item, labelW],
  );
  const X = (t: number) => g.xs[t];
  const Y = (v: number) => yOf(g, v);
  const val = (t: number, i: number) => item.nodes[t][i].value;
  const isKnown = (t: number, i: number) => known.has(nodeKey(t, i));
  const { t: ct, i: ci, stage } = current;
  const answered = stage !== 'pick';
  const showCorrect = current.correct || stage === 'reveal' || stage === 'settled';

  // Parents of the raced node and the ends of their pulsing stubs.
  const parents: { t: number; i: number; move: 1 | -1 }[] = [];
  if (ct > 0 && ci - 1 >= 0) parents.push({ t: ct - 1, i: ci - 1, move: 1 });
  if (ct > 0 && ci <= ct - 1) parents.push({ t: ct - 1, i: ci, move: -1 });
  const stubEnd = (p: { t: number; i: number; move: 1 | -1 }): [number, number] => [X(p.t) + g.gap * 0.5, Y(val(p.t, p.i)) - p.move * 22];
  const ends = parents.map(stubEnd);
  const entry: [number, number] = ends.length
    ? [ends.reduce((s, e) => s + e[0], 0) / ends.length, ends.reduce((s, e) => s + e[1], 0) / ends.length]
    : [X(ct), Y(val(ct, ci))];
  const finalPos: [number, number] = [X(ct), Y(val(ct, ci))];
  const correctPos: [number, number] = current.correct
    ? [lerp(entry[0], finalPos[0], easeOutBack(current.k)), lerp(entry[1], finalPos[1], easeOutBack(current.k))]
    : finalPos;
  const wrong = current.picked && !current.correct ? current.picked : null;
  const wrongPos: [number, number] | null = wrong
    ? [lerp(entry[0], X(ct), easeOutCubic(current.k)), lerp(entry[1], Y(wrong.value), easeOutCubic(current.k))]
    : null;
  const phantomOn = !!wrong && current.k >= 1;

  // Known edges and closed loops (up-then-down meets down-then-up).
  const edges: ReactNode[] = [];
  const loops: ReactNode[] = [];
  for (let t = 0; t < item.nodes.length - 1; t++) {
    for (let i = 0; i <= t; i++) {
      if (!isKnown(t, i)) continue;
      for (const j of [i + 1, i]) {
        if (isKnown(t + 1, j)) edges.push(<line key={`e${t}.${i}-${j}`} className="tr-edge" x1={X(t)} y1={Y(val(t, i))} x2={X(t + 1)} y2={Y(val(t + 1, j))} />);
      }
    }
  }
  const diamond = (t: number, i: number) =>
    [
      [X(t - 2), Y(val(t - 2, i - 1))],
      [X(t - 1), Y(val(t - 1, i))],
      [X(t), Y(val(t, i))],
      [X(t - 1), Y(val(t - 1, i - 1))],
    ]
      .map((p) => p.join(','))
      .join(' ');
  const closes = (t: number, i: number) => t >= 2 && i >= 1 && i <= t - 1 && isKnown(t - 1, i - 1) && isKnown(t - 1, i) && isKnown(t - 2, i - 1);
  for (let t = 2; t < item.nodes.length; t++) {
    for (let i = 1; i < t; i++) if (isKnown(t, i) && closes(t, i)) loops.push(<polygon key={`l${t}.${i}`} className="tr-loop" points={diamond(t, i)} />);
  }
  if (answered && showCorrect && closes(ct, ci)) {
    loops.push(<polygon key="l-now" className={`tr-loop${current.correct ? ' is-new' : ' is-fade'}`} points={diamond(ct, ci)} />);
  }

  const labels: Label[] = [];
  const dots: ReactNode[] = [];
  for (const [key, state] of known) {
    const [t, i] = key.split(',').map(Number);
    const n = item.nodes[t][i];
    dots.push(<circle key={`d${key}`} className={`tr-dot is-${state}`} cx={X(t)} cy={Y(n.value)} r={6} />);
    labels.push({ key: `n${key}`, col: t, x: X(t), dotY: Y(n.value), text: shortDisplay(n.display), cls: 'tr-label' });
  }

  // Past wrong branches, faint.
  const ghosts: ReactNode[] = [];
  const drawPhantom = (tag: string, step: number, w: Candidate, ph: Phantom | null, pos: [number, number], isPast: boolean, showKids: boolean, showRings: boolean) => {
    const [t, i] = item.order[step];
    const cls = `tr-phantom${isPast ? ' is-past' : ''}`;
    const pars: { t: number; i: number }[] = [];
    if (i - 1 >= 0) pars.push({ t: t - 1, i: i - 1 });
    if (i <= t - 1) pars.push({ t: t - 1, i });
    ghosts.push(
      <g key={`g${tag}`} className={cls}>
        {pars.map((p) => (
          <line key={`p${p.t}.${p.i}`} className="tr-ph-edge" x1={X(p.t)} y1={Y(val(p.t, p.i))} x2={pos[0]} y2={pos[1]} />
        ))}
        {showKids &&
          ph?.kind === 'children' &&
          ph.values.map((v, j) => (
            <g key={`k${j}`} className={isPast ? '' : 'tr-appear'}>
              {showRings && <line className="tr-gap" x1={X(t + 1)} y1={Y(v)} x2={X(t + 1)} y2={Y(ph.real[j])} />}
              <line className="tr-ph-edge" x1={pos[0]} y1={pos[1]} x2={X(t + 1)} y2={Y(v)} />
              <circle className="tr-ph-dot is-child" cx={X(t + 1)} cy={Y(v)} r={5} />
            </g>
          ))}
        <circle className="tr-ph-dot" cx={pos[0]} cy={pos[1]} r={7} />
      </g>,
    );
    labels.push({ key: `w${tag}`, col: t, x: pos[0], dotY: pos[1], text: shortDisplay(w.display), cls: `tr-label is-phantom${isPast ? ' is-past' : ''}` });
    if (showKids && ph?.kind === 'children') {
      ph.values.forEach((v, j) =>
        labels.push({ key: `c${tag}.${j}`, col: t + 1, x: X(t + 1), dotY: Y(v), text: shortDisplay(ph.displays[j]), cls: `tr-label is-phantom${isPast ? ' is-past' : ''}` }),
      );
    }
    if (showRings && ph?.kind === 'children') {
      ph.real.forEach((v, j) => {
        ghosts.push(<circle key={`r${tag}.${j}`} className="tr-ring tr-appear" cx={X(t + 1)} cy={Y(v)} r={7} />);
        // Past the last date the rings are never raced, so they can carry their values.
        if (ph.beyondTree) {
          labels.push({ key: `rl${tag}.${j}`, col: t + 1, x: X(t + 1), dotY: Y(v), text: shortDisplay(formatValue(item.unit, item.decimals, v)), cls: 'tr-label is-ghost' });
        }
      });
    }
  };
  past.forEach((p) => drawPhantom(`p${p.step}`, p.step, p.wrong, p.phantom, [X(item.order[p.step][0]), Y(p.wrong.value)], true, true, false));
  if (wrong && wrongPos) drawPhantom('now', current.step, wrong, current.phantom, wrongPos, false, phantomOn, phantomOn);

  const nextCol = item.steps + 1;
  const beyond = (wrong && phantomOn && current.phantom?.beyondTree) || past.some((p) => p.phantom?.beyondTree);

  // The raced node: rail + stubs while picking; the value snapping (or fading) in once answered.
  const racer: ReactNode[] = [];
  const rail = answered ? null : <rect className="tr-rail" x={X(ct) - 15} y={g.top - 6} width={30} height={g.plotH + 12} rx={15} />;
  if (!answered) {
    parents.forEach((p, k) =>
      racer.push(<line key={`s${k}`} className="tr-stub" x1={X(p.t)} y1={Y(val(p.t, p.i))} x2={ends[k][0]} y2={ends[k][1]} />),
    );
    racer.push(
      <text key="q" className="tr-rail-q" x={X(ct)} y={g.top - 14} textAnchor="middle">
        ?
      </text>,
    );
  } else if (showCorrect) {
    const cls = current.correct ? 'tr-now is-won' : 'tr-now is-lost tr-appear';
    racer.push(
      <g key="now" className={cls}>
        {parents.map((p, k) => (
          <line key={`c${k}`} className="tr-edge is-now" x1={X(p.t)} y1={Y(val(p.t, p.i))} x2={correctPos[0]} y2={correctPos[1]} />
        ))}
        {current.correct && current.k >= 1 && <circle className="tr-lock-ring" cx={finalPos[0]} cy={finalPos[1]} r={7} />}
        <circle className={`tr-dot is-${current.correct ? 'won' : 'lost'}`} cx={correctPos[0]} cy={correctPos[1]} r={6.5} />
      </g>,
    );
    labels.push({
      key: 'now',
      col: ct,
      x: correctPos[0],
      dotY: correctPos[1],
      text: shortDisplay(item.nodes[ct][ci].display),
      cls: `tr-label is-now${current.correct ? '' : ' tr-appear'}`,
    });
  }

  // Labels: centred above their dot, nudged apart per column; a leader line if moved.
  const placed: ReactNode[] = [];
  const cols = new Map<number, Label[]>();
  for (const l of labels) cols.set(l.col, [...(cols.get(l.col) ?? []), l]);
  for (const list of cols.values()) {
    const pos = relaxLabels(
      list.map((l) => ({ key: l.key, y: l.dotY - 17 })),
      LINE,
      g.top - 18,
      g.top + g.plotH + 4,
    );
    for (const l of list) {
      const ly = pos.get(l.key) ?? l.dotY - 17;
      const moved = Math.abs(ly - (l.dotY - 17)) > 6;
      placed.push(
        <g key={`L${l.key}`} className={l.cls}>
          {moved && <line className="tr-leader" x1={l.x} y1={l.dotY} x2={l.x} y2={ly + (ly < l.dotY ? 6 : -12)} />}
          <text x={l.x} y={ly} textAnchor="middle" dominantBaseline="middle">
            {l.text}
          </text>
        </g>,
      );
    }
  }

  return (
    <svg viewBox={`0 0 ${g.width} ${g.height}`} width={g.width} height={g.height} className="tr-svg" role="img" aria-label={`Rate tree, ${item.steps} steps`}>
      {g.ticks.map((tk) => (
        <g key={`t${tk.v}`}>
          <line className="tr-grid" x1={g.left} x2={g.width - 2} y1={tk.y} y2={tk.y} />
          <text className="tr-tick" x={g.left - 8} y={tk.y} textAnchor="end" dominantBaseline="middle">
            {tk.label}
          </text>
        </g>
      ))}
      <line className="tr-axis" x1={g.left} x2={g.left} y1={g.top - 6} y2={g.top + g.plotH + 6} />
      {Array.from({ length: item.steps + 1 }, (_, t) => (
        <text key={`x${t}`} className={`tr-tick${t === ct && !answered ? ' is-now' : ''}`} x={X(t)} y={g.top + g.plotH + 26} textAnchor="middle">
          {dateLabel(item, t)}
        </text>
      ))}
      {beyond && (
        <g className="tr-appear">
          <line className="tr-next-col" x1={X(nextCol)} x2={X(nextCol)} y1={g.top - 6} y2={g.top + g.plotH + 6} />
          <text className="tr-tick is-ghost" x={X(nextCol)} y={g.top + g.plotH + 26} textAnchor="middle">
            Next
          </text>
        </g>
      )}
      {loops}
      {rail}
      {edges}
      {ghosts}
      {racer}
      {dots}
      {placed}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Backward trees: a lattice of value chips

const GHOST_DX = -12;
const GHOST_DY = -15;

function BackwardTree({ view, width }: { view: TreeView; width: number }) {
  const { item, known, past, current } = view;
  const T = item.nodes.length - 1;
  const chipW = useMemo(() => {
    const texts: string[] = [];
    for (const row of item.nodes) for (const n of row) texts.push(n.display, chipSub(item, n.t, n.i) ?? '');
    for (const cs of item.candidates) for (const c of cs) texts.push(c.display);
    for (const ps of item.phantom) for (const p of ps) texts.push(...p.displays);
    return Math.max(56, ...texts.map(textWidth)) + CHIP_PAD_X;
  }, [item]);
  const chipH = chipHeight(2);
  const g: LatticeGeom = useMemo(() => latticeGeometry({ width, T, chipW, chipH }), [width, T, chipW, chipH]);
  const P = (t: number, i: number) => latticeXY(g, t, i);
  const isKnown = (t: number, i: number) => known.has(nodeKey(t, i));
  const { t: ct, i: ci, stage } = current;
  const answered = stage !== 'pick';
  const showCorrect = current.correct || stage === 'reveal' || stage === 'settled';
  const wrong = current.picked && !current.correct ? current.picked : null;
  const q = item.spec.direction === 'backward' ? item.spec.params.q : [];

  const lattice: ReactNode[] = [];
  const loops: ReactNode[] = [];
  for (let t = 0; t < T; t++) {
    for (let i = 0; i <= t; i++) {
      for (const j of [i + 1, i]) {
        const [x1, y1] = P(t, i);
        const [x2, y2] = P(t + 1, j);
        const on = isKnown(t, i) && isKnown(t + 1, j);
        lattice.push(<line key={`e${t}.${i}-${j}`} className={`tr-lat-edge${on ? ' is-on' : ''}`} x1={x1} y1={y1} x2={x2} y2={y2} />);
      }
    }
  }
  const diamond = (t: number, i: number) => [P(t, i), P(t + 1, i + 1), P(t + 2, i + 1), P(t + 1, i)].map((p) => p.join(',')).join(' ');
  const closes = (t: number, i: number) => t + 2 <= T && isKnown(t + 1, i) && isKnown(t + 1, i + 1) && isKnown(t + 2, i + 1);
  for (let t = 0; t + 2 <= T; t++) {
    for (let i = 0; i <= t; i++) if (isKnown(t, i) && closes(t, i)) loops.push(<polygon key={`l${t}.${i}`} className="tr-loop" points={diamond(t, i)} />);
  }
  if (answered && showCorrect && closes(ct, ci)) {
    loops.push(<polygon key="l-now" className={`tr-loop${current.correct ? ' is-new' : ' is-fade'}`} points={diamond(ct, ci)} />);
  }

  const chip = (key: string, t: number, i: number, main: string, sub: string | null, cls: string, dx = 0, dy = 0, single = false) => {
    const [cx, cy] = P(t, i);
    const h = single ? chipHeight(1) : chipH;
    const x = cx + dx - chipW / 2;
    const y = cy + dy - h / 2;
    return (
      <g key={key} className={cls}>
        <rect className="tr-chip-box" x={x} y={y} width={chipW} height={h} rx={9} />
        <text className="tr-chip-main" x={cx + dx} y={sub ? y + 6 + LINE / 2 : cy + dy} textAnchor="middle" dominantBaseline="middle">
          {main}
        </text>
        {sub && (
          <text className="tr-chip-sub" x={cx + dx} y={y + 6 + LINE * 1.5} textAnchor="middle" dominantBaseline="middle">
            {sub}
          </text>
        )}
      </g>
    );
  };

  const chips: ReactNode[] = [];
  for (let t = 0; t <= T; t++) {
    for (let i = 0; i <= t; i++) {
      const key = nodeKey(t, i);
      const state = known.get(key);
      const sub = chipSub(item, t, i);
      if (state) chips.push(chip(`n${key}`, t, i, item.nodes[t][i].display, sub, `tr-chip is-${state}`));
      else if (t === ct && i === ci) continue;
      else chips.push(chip(`n${key}`, t, i, '·', sub, 'tr-chip is-empty'));
    }
  }

  // Phantom layer: the wrong value, misregistered off its node, and the parent values it would make.
  const ghosts: ReactNode[] = [];
  const drawPhantom = (tag: string, step: number, w: Candidate, ph: Phantom | null, isPast: boolean, onNode: boolean) => {
    const [t, i] = item.order[step];
    const [wx, wy] = P(t, i);
    const from: [number, number] = onNode ? [wx, wy] : [wx + GHOST_DX, wy + GHOST_DY];
    const cls = `tr-phantom${isPast ? ' is-past' : ' tr-appear'}`;
    ghosts.push(
      <g key={`g${tag}`} className={cls}>
        {ph?.kind === 'parents' &&
          ph.at.map(([pt, pi], j) => {
            const [px, py] = P(pt, pi);
            return <line key={`pe${j}`} className="tr-ph-edge" x1={from[0]} y1={from[1]} x2={px + GHOST_DX} y2={py + GHOST_DY} />;
          })}
        {ph?.kind === 'parents' && ph.at.map(([pt, pi], j) => chip(`pc${j}`, pt, pi, ph.displays[j], null, 'tr-ghost-chip', GHOST_DX, GHOST_DY, true))}
        {!onNode && chip('w', t, i, w.display, null, 'tr-ghost-chip', GHOST_DX, GHOST_DY, true)}
      </g>,
    );
  };
  past.forEach((p) => drawPhantom(`p${p.step}`, p.step, p.wrong, p.phantom, true, false));

  const racer: ReactNode[] = [];
  const sub = chipSub(item, ct, ci);
  if (!answered) racer.push(chip('now', ct, ci, '?', sub, 'tr-chip is-target'));
  else if (wrong && stage === 'hold') {
    drawPhantom('now', current.step, wrong, current.phantom, false, true);
    racer.push(chip('now', ct, ci, wrong.display, sub, 'tr-chip is-wrong'));
  } else {
    if (wrong) drawPhantom('now', current.step, wrong, current.phantom, false, false);
    if (showCorrect) {
      racer.push(chip('now', ct, ci, item.nodes[ct][ci].display, sub, current.correct ? 'tr-chip is-won is-lock' : 'tr-chip is-lost tr-appear'));
    } else racer.push(chip('now', ct, ci, '?', sub, 'tr-chip is-target is-frozen'));
  }

  return (
    <svg viewBox={`0 0 ${g.width} ${g.height}`} width={g.width} height={g.height} className="tr-svg" role="img" aria-label={`Valuation lattice, ${T} steps`}>
      {Array.from({ length: T }, (_, t) =>
        q[t] === null || q[t] === undefined ? null : (
          <text key={`q${t}`} className="tr-tick" x={(g.xs[t] + g.xs[t + 1]) / 2} y={16} textAnchor="middle">
            q = {q[t]}
          </text>
        ),
      )}
      {Array.from({ length: T + 1 }, (_, t) => (
        <text key={`x${t}`} className={`tr-tick${t === ct && !answered ? ' is-now' : ''}`} x={g.xs[t]} y={g.height - 12} textAnchor="middle">
          {dateLabel(item, t)}
        </text>
      ))}
      {loops}
      {lattice}
      {chips}
      {ghosts}
      {racer}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------
// Header: what the tree is built from

function TreeHeader({ item, phase }: { item: TreeItem; phase: PlayPhase }) {
  const rows = useMemo(() => paramRows(item), [item]);
  return (
    <div className="space-y-3">
      {phase === 'pressure' ? (
        <div className="space-y-1">
          <p className="tr-title">{item.title}</p>
          <p className="tr-note">{item.model}</p>
        </div>
      ) : (
        <p className="tr-title">{item.direction === 'forward' ? 'Build the rate tree forward' : `Value the tree back from the last date`}</p>
      )}
      <p className="tr-rule">
        <NoteText latex={item.rule} />
      </p>
      {rows.length > 0 && (
        <dl className="tr-params">
          {rows.map((r) => (
            <div key={r.label} className="tr-param">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Legend({ item, wrongShown, ringsShown }: { item: TreeItem; wrongShown: boolean; ringsShown: boolean }) {
  const fwd = item.direction === 'forward';
  return (
    <ul className="tr-legend" aria-label="Legend">
      <li>
        <svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true">
          {fwd ? <circle className="tr-dot is-won" cx="13" cy="8" r="6" /> : <rect className="tr-legend-chip" x="2" y="2" width="22" height="12" rx="4" />}
        </svg>
        <span>The tree</span>
      </li>
      <li>
        <svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true">
          <polygon className="tr-loop" points="2,8 13,2 24,8 13,14" />
        </svg>
        <span>Two routes meet</span>
      </li>
      {wrongShown && (
        <li>
          <svg width="30" height="16" viewBox="0 0 30 16" aria-hidden="true">
            <line className="tr-ph-edge" x1="2" y1="8" x2="28" y2="8" />
          </svg>
          <span>Wrong branch</span>
        </li>
      )}
      {ringsShown && (
        <li>
          <svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true">
            <circle className="tr-ring" cx="13" cy="8" r="6" />
          </svg>
          <span>Where the tree goes</span>
        </li>
      )}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------
// Feedback text

function describeNode(item: TreeItem, t: number, i: number): string {
  const d = dateWords(item, t);
  return t === 0 ? 'today’s node' : `the ${d} ${nodeWords(t, i)}`;
}

function PhantomLine({ item, step, ph }: { item: TreeItem; step: number; ph: Phantom | null }) {
  if (!ph) return null;
  const [t] = item.order[step];
  if (ph.kind === 'children') {
    const real = ph.real.map((v) => formatValue(item.unit, item.decimals, v));
    return (
      <p className="tr-text">
        From there the next step goes to <span className="tr-num is-red">{ph.displays[0]}</span> and <span className="tr-num is-red">{ph.displays[1]}</span>
        {ph.beyondTree ? (
          <>
            ; the tree’s next nodes from this one are <span className="tr-num">{real[0]}</span> and <span className="tr-num">{real[1]}</span>.
          </>
        ) : (
          <>, which are not nodes of the tree: the wrong branch never rejoins it.</>
        )}
      </p>
    );
  }
  if (!ph.at.length || t === 0) return <p className="tr-text">That would be the value today, so the whole tree would price wrong.</p>;
  return (
    <p className="tr-text">
      Worked back, it makes{' '}
      {ph.at.map(([pt, pi], j) => (
        <span key={j}>
          {j > 0 && ' and '}
          {describeNode(item, pt, pi)} <span className="tr-num is-red">{ph.displays[j]}</span>
        </span>
      ))}
      {ph.at.length > 1 ? ': one node feeds both branches above it.' : '.'}
    </p>
  );
}

function routesNote(item: TreeItem, t: number, i: number): string | null {
  if (item.direction !== 'forward' || t < 2 || i < 1 || i > t - 1) return null;
  const rt = item.routes?.[t]?.[i];
  if (!rt || rt[0] === null || rt[1] === null) return null;
  const fmt = (v: number) => formatValue(item.unit, item.decimals, v);
  if (item.recombining) return `Up-then-down and down-then-up both land on ${fmt(rt[0])}: the two routes meet here.`;
  return `Up-then-down gives ${fmt(rt[1])} and down-then-up gives ${fmt(rt[0])}; the tree keeps their average, ${item.nodes[t][i].display}, so the two routes share one node.`;
}

// ---------------------------------------------------------------------------------------------
// Board

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

/** First and last round index of the uninterrupted run on one tree that contains `index`. */
function runBounds(rounds: readonly MechanicRound<TreePayload>[], index: number): [number, number] {
  const same = (a: number, b: number) => rounds[a].payload.item.id === rounds[b].payload.item.id && rounds[b].payload.step === rounds[a].payload.step + 1;
  let lo = index;
  while (lo > 0 && same(lo - 1, lo)) lo--;
  let hi = index;
  while (hi + 1 < rounds.length && same(hi, hi + 1)) hi++;
  return [lo, hi];
}

export function TreeBoard({ phase, rounds, onResult, onPhaseDone }: MechanicRenderProps<TreePayload>) {
  const [index, setIndex] = useState(0);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [stage, setStage] = useState<Stage>('pick');
  const [k, setK] = useState(1);
  const [boxRef, width] = useWidth<HTMLDivElement>();
  const done = useRef(false);
  const answeredRef = useRef(false);
  const started = useRef(performance.now());
  const raf = useRef<number | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const timed = phase === 'pressure';

  useEffect(() => {
    if (rounds.length === 0 && !done.current) {
      done.current = true;
      onPhaseDone();
    }
  }, [rounds.length, onPhaseDone]);
  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  const round = rounds[index] as MechanicRound<TreePayload> | undefined;
  const outcome = round ? outcomes[round.id] : undefined;

  const answer = (picked: number | null, byTimer: boolean) => {
    if (!round || answeredRef.current) return;
    answeredRef.current = true;
    const c = picked === null ? null : round.payload.candidates[picked];
    const correct = !!c?.correct;
    onResult({ roundId: round.id, correct, timeMs: performance.now() - started.current, timedOut: byTimer });
    setOutcomes((o) => ({ ...o, [round.id]: { picked, correct, timedOut: byTimer } }));
    setStage(correct ? 'snap' : 'hold');
    if (prefersReducedMotion() || picked === null) {
      setK(1);
      if (correct) setStage('settled');
      return;
    }
    setK(0);
    const t0 = performance.now();
    const step = (now: number) => {
      const x = Math.min(1, (now - t0) / SNAP_MS);
      setK(x);
      if (x < 1) raf.current = requestAnimationFrame(step);
      else {
        raf.current = null;
        if (correct) setStage('settled');
      }
    };
    raf.current = requestAnimationFrame(step);
  };

  // Pressure clock.
  useEffect(() => {
    if (!timed || stage !== 'pick' || !round?.timeLimitMs) return;
    const left = Math.max(0, round.timeLimitMs - (performance.now() - started.current));
    const t = window.setTimeout(() => answer(null, true), left);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, stage, index]);

  // A miss holds the wrong branch for a beat, then the tree's value fades in.
  useEffect(() => {
    if (stage === 'hold') {
      const t = window.setTimeout(() => setStage('reveal'), HOLD_MS);
      return () => window.clearTimeout(t);
    }
    if (stage === 'reveal') {
      const t = window.setTimeout(() => setStage('settled'), prefersReducedMotion() ? 0 : FADE_MS);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [stage]);

  const next = () => {
    if (stage !== 'settled') return;
    if (index + 1 < rounds.length) {
      answeredRef.current = false;
      started.current = performance.now();
      setStage('pick');
      setK(1);
      setIndex(index + 1);
    } else if (!done.current) {
      done.current = true;
      onPhaseDone();
    }
  };
  const nextLatest = useRef(next);
  nextLatest.current = next;

  useEffect(() => {
    if (stage !== 'settled') return;
    nextRef.current?.focus({ preventScroll: true } as FocusOptions);
    if (timed && outcome?.correct) {
      const t = window.setTimeout(() => nextLatest.current(), AUTO_ADVANCE_MS);
      return () => window.clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Keyboard: 1 / 2 / 3 pick a candidate.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || stage !== 'pick') return;
      const k2 = KEYS.indexOf(e.key);
      if (k2 >= 0) {
        e.preventDefault();
        answer(k2, false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const results = rounds.slice(0, index + (outcome ? 1 : 0)).map((r) => outcomes[r.id]?.correct ?? false);

  const view: TreeView | null = useMemo(() => {
    if (!round) return null;
    const { item, step, segmentStart } = round.payload;
    const [lo] = runBounds(rounds, index);
    const known = new Map<string, NodeState>();
    for (const row of item.nodes) for (const n of row) if (n.given) known.set(nodeKey(n.t, n.i), 'given');
    for (let s = 0; s < segmentStart; s++) known.set(nodeKey(...item.order[s]), 'pre');
    const past: PastPhantom[] = [];
    for (let j = lo; j < index; j++) {
      const r = rounds[j];
      const o = outcomes[r.id];
      known.set(nodeKey(...item.order[r.payload.step]), o?.correct ? 'won' : 'lost');
      const c = o && o.picked !== null ? r.payload.candidates[o.picked] : null;
      if (c && !c.correct) past.push({ step: r.payload.step, wrong: c, phantom: phantomOf(item, r.payload.step, c) });
    }
    const o = outcomes[round.id];
    const picked = o && o.picked !== null ? round.payload.candidates[o.picked] : null;
    const [t, i] = item.order[step];
    return {
      item,
      known,
      past,
      current: { step, t, i, stage, k, picked, correct: !!o?.correct, phantom: phantomOf(item, step, picked) },
    };
  }, [round, rounds, index, outcomes, stage, k]);

  if (!round || !view) return null;
  const p = round.payload;
  const { item } = p;
  const [t, i] = item.order[p.step];
  const node = item.nodes[t][i];
  const [, runEnd] = runBounds(rounds, index);
  const answered = !!outcome;
  const settled = stage === 'settled';
  const picked = outcome && outcome.picked !== null ? p.candidates[outcome.picked] : null;
  const treeDone = p.step === item.order.length - 1;
  const source = `block ${round.blockId}`;
  const svgWidth = Math.max(280, width || 320);
  const note = routesNote(item, t, i);
  const qword = quantityWord(item);

  return (
    <div className="space-y-5">
      <div className="tr-phase-label">{phase === 'discovery' ? 'On the grid' : 'Under pressure'}</div>
      <Docket total={rounds.length} index={index} results={results} />

      <GameCard key={`${item.id}@${runBounds(rounds, index)[0]}`} className="g-enter relative space-y-5 !px-4 sm:!px-6">
        {timed && !answered && round.timeLimitMs && <TimerBar key={round.id} ms={round.timeLimitMs} />}
        <TreeHeader item={item} phase={phase} />

        <figure className="space-y-2">
          <figcaption className="tr-question" aria-live="polite">
            {answered ? (
              <>
                {describeNode(item, t, i).replace(/^./, (c) => c.toUpperCase())}: <span className="tr-num">{settled || outcome?.correct ? node.display : '…'}</span>
              </>
            ) : (
              <>
                {t === 0 ? 'Today' : dateWords(item, t).replace(/^./, (c) => c.toUpperCase())}, {nodeWords(t, i)}: which {qword}?
              </>
            )}
          </figcaption>
          {item.direction === 'forward' && <div className="tr-axis-title">↑ Short rate (%)</div>}
          <div ref={boxRef} className="tr-chart w-full">
            {item.direction === 'forward' ? <ForwardTree view={view} width={svgWidth} /> : <BackwardTree view={view} width={svgWidth} />}
          </div>
          <Legend item={item} wrongShown={view.past.length > 0 || !!(picked && !picked.correct)} ringsShown={item.direction === 'forward' && !!(picked && !picked.correct) && !settled} />
        </figure>

        <div className="tr-cands" role="group" aria-label={`Candidate ${qword}s`}>
          {p.candidates.map((c, j) => {
            const state = !answered ? '' : c.correct ? ' is-correct' : outcome?.picked === j ? ' is-wrong' : ' is-dim';
            return (
              <button
                key={c.display}
                type="button"
                className={`tr-cand${state}`}
                onClick={() => answer(j, false)}
                disabled={answered}
                aria-keyshortcuts={KEYS[j]}
              >
                <span className="tr-cand-value">{c.display}</span>
                <span className="tr-cand-key" aria-hidden="true">
                  {KEYS[j]}
                </span>
              </button>
            );
          })}
        </div>

        {answered && outcome && (
          <div className="space-y-3" aria-live="polite">
            {outcome.correct ? (
              <div className="tr-good space-y-2">
                <p className="tr-text">
                  <span className="g-strong">Locked.</span> {describeNode(item, t, i).replace(/^./, (c) => c.toUpperCase())} is <span className="tr-num">{node.display}</span>.
                </p>
                {note && <p className="tr-text">{note}</p>}
              </div>
            ) : (
              <>
                {picked ? (
                  <div className="tr-bad space-y-2">
                    <p className="tr-text">
                      <span className="tr-num is-red">{picked.display}</span>: {mistakeLine(picked.mistake ?? '', phase)}.
                    </p>
                    <PhantomLine item={item} step={p.step} ph={phantomOf(item, p.step, picked)} />
                  </div>
                ) : (
                  <p className="tr-note">Time ran out.</p>
                )}
                {(stage === 'reveal' || settled) && (
                  <div className="tr-good tr-appear space-y-2">
                    <p className="tr-text">
                      The tree has <span className="tr-num">{node.display}</span> here.
                    </p>
                    {note && <p className="tr-text">{note}</p>}
                  </div>
                )}
              </>
            )}
            {phase === 'discovery' && (stage === 'reveal' || settled) && (
              <ul className="tr-why space-y-1">
                {p.candidates.map((c) => (
                  <li key={c.display}>
                    <span className={`tr-num${c.correct ? '' : ' is-red'}`}>{c.display}</span>
                    {c.correct ? ' is the tree’s own rule.' : `: ${mistakeLine(c.mistake ?? '', phase)}.`}
                  </li>
                ))}
              </ul>
            )}
            {(stage === 'reveal' || settled) && <p className="tr-source">{source}</p>}
            {settled && treeDone && (
              <div className="tr-complete g-assemble">
                <p className="tr-text">
                  <span className="g-strong">Tree complete.</span> {item.teaches}
                </p>
              </div>
            )}
          </div>
        )}

        {answered && (
          <div className="flex justify-end">
            <button ref={nextRef} type="button" className="g-btn is-primary" onClick={next} disabled={!settled}>
              {index + 1 === rounds.length ? 'Continue' : index === runEnd ? 'Next tree' : 'Next node'}
            </button>
          </div>
        )}
      </GameCard>
    </div>
  );
}

