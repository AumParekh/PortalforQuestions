// Framework Navigator: the regulatory tree as hand-rolled responsive SVG. The layout is recomputed
// for the container's width (layout.ts), so one SVG unit is one CSS pixel and every label renders
// at 15px or more; when the tree is wider than the screen it scrolls sideways inside its own box
// and centres the round's nodes. Nodes in open lanes get 44px tap targets laid over the SVG.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { FnData } from './schema';
import { yearLabel } from './schema';
import type { BaseLayout } from './layout';
import { GEOM, arcPath, labelWidth, pathBetween, phantomPath, placeTree, scrollToFit } from './layout';

export type NodeMark = 'candidate' | 'pulse' | 'locked' | 'wrong' | 'open' | 'side-a' | 'side-b' | 'over';

export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) return true;
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface TreeProps {
  data: FnData;
  base: BaseLayout;
  /** This reading's nodes: always emphasised. */
  lit: ReadonlySet<string>;
  /** Nodes the round is about: their lanes open and the view centres on them. */
  focus: readonly string[];
  showAll: boolean;
  marks: Readonly<Record<string, readonly NodeMark[]>>;
  /** Nodes that respond to a tap ('all' = every node in an open lane). */
  tappable: ReadonlySet<string> | 'all';
  onTap?: (id: string) => void;
  /** Verb for the tap target's accessible name: "Place on", "Open", "Look inside". */
  verb: string;
  phantom?: { from: string; key: number } | null;
  loop?: { a: string; b: string; closed: boolean } | null;
  /** Registers tap targets for drag snapping. */
  registerTarget?: (id: string, el: HTMLElement | null) => void;
  scrollerRef?: MutableRefObject<HTMLDivElement | null>;
  caption: string;
}

function Check({ x, y }: { x: number; y: number }) {
  return <path className="fn-check" d={`M${x - 5},${y} l3.5,3.8 l6.5,-7.6`} />;
}

export function Tree({
  data,
  base,
  lit,
  focus,
  showAll,
  marks,
  tappable,
  onTap,
  verb,
  phantom,
  loop,
  registerTarget,
  scrollerRef,
  caption,
}: TreeProps) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ownRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Callers pass fresh `focus` arrays each render; key memos on their content, not identity.
  const focusKey = focus.join('|');
  const open = useMemo(() => {
    const s = new Set<string>();
    if (showAll) for (const l of data.lineages) s.add(l.id);
    for (const id of focus) {
      const n = data.nodeById[id];
      if (n) s.add(n.lineage);
    }
    // With nothing to focus, open the reading's own lanes.
    if (s.size === 0) for (const id of lit) if (data.nodeById[id]) s.add(data.nodeById[id].lineage);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll, focusKey, lit, data]);

  const layout = useMemo(() => (width > 0 ? placeTree(data.nodes, base, width, open) : null), [data, base, width, open]);

  const loopPath = useMemo(() => (loop ? pathBetween(data.nodes, loop.a, loop.b) : []), [data, loop]);
  const loopEdges = useMemo(() => {
    const s = new Set<string>();
    for (let i = 1; i < loopPath.length; i++) {
      s.add(`${loopPath[i - 1]}>${loopPath[i]}`);
      s.add(`${loopPath[i]}>${loopPath[i - 1]}`);
    }
    return s;
  }, [loopPath]);

  // Centre the round's nodes whenever they (or the width) change.
  useEffect(() => {
    const el = ownRef.current;
    if (!el || !layout) return;
    const xs = focus.map((id) => layout.nodes[id]?.x).filter((x): x is number => typeof x === 'number');
    const left = scrollToFit(xs, el.clientWidth, layout.width);
    if (Math.abs(el.scrollLeft - left) > 2) {
      if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      else el.scrollLeft = left;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, layout?.width]);

  const setScroller = (el: HTMLDivElement | null) => {
    ownRef.current = el;
    if (scrollerRef) scrollerRef.current = el;
  };

  const strong = new Set<string>([...lit, ...focus]);
  const laneLabel = new Map(data.lineages.map((l) => [l.id, l.label]));

  return (
    <figure className="fn-figure space-y-2">
      <div ref={setScroller} className="fn-scroller" role="group" aria-label="Regulatory frameworks, oldest on the left, one row per lineage">
        {layout && (
          <div className="fn-canvas" style={{ width: layout.width, height: layout.height }}>
            <svg
              className="fn-svg"
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              role="img"
              aria-label={caption}
            >
              {/* Time axis: year span of each column; an undated zone at the right. */}
              {layout.cols.map((c, i) =>
                c.label ? (
                  <g key={`c${i}`}>
                    <line className="fn-guide" x1={c.x} x2={c.x} y1={GEOM.axisH - 6} y2={layout.height - 4} />
                    <text className="fn-axis-text" x={c.x} y={20} textAnchor="middle">
                      {c.label}
                    </text>
                  </g>
                ) : null,
              )}
              {layout.undatedX !== null && (
                <g>
                  <line className="fn-undated" x1={layout.undatedX} x2={layout.undatedX} y1={6} y2={layout.height - 4} />
                  <text className="fn-axis-text" x={layout.undatedX + 8} y={20}>
                    undated in the notes
                  </text>
                </g>
              )}

              {/* Lanes */}
              {layout.lanes.map((l) => {
                const title = laneLabel.get(l.id) ?? l.id;
                const tx = Math.max(6, Math.min(l.x0 - 24, layout.width - labelWidth(title) - 8));
                return (
                  <g key={l.id}>
                    {l.expanded && (
                      <text className="fn-lane-title" x={tx} y={l.y + 16}>
                        {title}
                      </text>
                    )}
                    <line
                      className={`fn-rail${l.expanded ? '' : ' is-collapsed'}`}
                      x1={l.x0 - (l.expanded ? 22 : 8)}
                      x2={l.x1 + (l.expanded ? 22 : 8)}
                      y1={l.railY}
                      y2={l.railY}
                    />
                  </g>
                );
              })}

              {/* Parent → child edges */}
              {layout.edges.map((e) => {
                const onLoop = loopEdges.has(`${e.from}>${e.to}`);
                const cls = onLoop ? ' is-loop' : strong.has(e.from) && strong.has(e.to) ? ' is-strong' : '';
                return <path key={`${e.from}>${e.to}`} className={`fn-edge${cls}`} d={e.d} />;
              })}

              {/* The compare link: dashed while open, drawn solid when the loop closes. */}
              {loop && layout.nodes[loop.a] && layout.nodes[loop.b] && (
                <path
                  key={loop.closed ? 'closed' : 'open'}
                  className={`fn-arc${loop.closed ? ' is-closed' : ''}`}
                  pathLength={100}
                  d={arcPath(layout.nodes[loop.a].x, layout.nodes[loop.a].y - GEOM.nodeR, layout.nodes[loop.b].x, layout.nodes[loop.b].y - GEOM.nodeR)}
                />
              )}

              {/* Nodes */}
              {data.nodes.map((n) => {
                const p = layout.nodes[n.id];
                if (!p) return null;
                const m = marks[n.id] ?? [];
                const isLit = lit.has(n.id);
                if (!p.expanded) {
                  return <circle key={n.id} className={`fn-dot${isLit ? ' is-lit' : ''}`} cx={p.x} cy={p.y} r={isLit ? GEOM.dotR + 1.5 : GEOM.dotR} />;
                }
                const side = m.includes('side-a') ? 'A' : m.includes('side-b') ? 'B' : null;
                const cls = [
                  'fn-node',
                  isLit ? 'is-lit' : '',
                  m.includes('candidate') ? 'is-candidate' : '',
                  m.includes('pulse') ? 'is-pulse' : '',
                  m.includes('locked') ? 'is-locked' : '',
                  m.includes('wrong') ? 'is-wrong' : '',
                  m.includes('open') ? 'is-open' : '',
                  m.includes('over') ? 'is-over' : '',
                  side ? 'is-side' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <g key={n.id} className={cls}>
                    <g className="fn-body">
                      <circle className="fn-ring" cx={p.x} cy={p.y} r={GEOM.nodeR + 6} pathLength={100} />
                      <circle className="fn-core" cx={p.x} cy={p.y} r={GEOM.nodeR} />
                      {m.includes('locked') && <Check x={p.x} y={p.y} />}
                      {side && !m.includes('locked') && (
                        <text className="fn-letter" x={p.x} y={p.y + 5.5} textAnchor="middle">
                          {side}
                        </text>
                      )}
                    </g>
                    {p.lines.map((line, i) => (
                      <text key={i} className="fn-label" x={p.x} y={p.y + GEOM.labelDy + i * GEOM.lineH} textAnchor="middle">
                        {line}
                      </text>
                    ))}
                  </g>
                );
              })}

              {/* A wrong placement grows a branch that leads nowhere, then fades. */}
              {phantom && layout.nodes[phantom.from]?.expanded && (
                <g key={phantom.key}>
                  <path className="fn-phantom" pathLength={100} d={phantomPath(layout.nodes[phantom.from].x + GEOM.nodeR, layout.nodes[phantom.from].y, layout.step)} />
                  <circle
                    className="fn-phantom-end"
                    cx={layout.nodes[phantom.from].x + GEOM.nodeR + Math.max(40, layout.step * 0.62)}
                    cy={layout.nodes[phantom.from].y - 30}
                    r={6}
                  />
                </g>
              )}
            </svg>

            {/* Tap targets (44px) over nodes in open lanes. */}
            {data.nodes.map((n) => {
              const p = layout.nodes[n.id];
              if (!p || !p.expanded) return null;
              const can = tappable === 'all' || tappable.has(n.id);
              if (!can || !onTap) return null;
              const year = yearLabel(n);
              return (
                <button
                  key={n.id}
                  ref={(el: HTMLButtonElement | null) => registerTarget?.(n.id, el)}
                  type="button"
                  className="fn-hit"
                  style={{ left: p.x, top: p.y }}
                  aria-label={`${verb} ${n.name}${year ? `, ${year}` : ', undated'}`}
                  onClick={() => onTap(n.id)}
                />
              );
            })}
          </div>
        )}
      </div>
      <figcaption className="fn-source">{caption}</figcaption>
    </figure>
  );
}
