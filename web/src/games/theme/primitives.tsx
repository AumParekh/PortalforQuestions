import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Markdown } from '../../components/Markdown';
import { toSegments } from '../text';

type Tone = 'default' | 'soft' | 'navy';

export function GameCard({
  children,
  tone = 'default',
  className = '',
  as = 'section',
  label,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  as?: 'section' | 'div' | 'article';
  label?: string;
}) {
  const Tag = as;
  const toneClass = tone === 'soft' ? ' is-soft' : tone === 'navy' ? ' is-navy' : '';
  return (
    <Tag className={`g-card${toneClass} ${className}`} aria-label={label}>
      {children}
    </Tag>
  );
}

export function GameButton({
  children,
  onClick,
  variant = 'default',
  disabled,
  className = '',
  selected,
  ariaLabel,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'gold' | 'quiet';
  disabled?: boolean;
  className?: string;
  selected?: boolean;
  ariaLabel?: string;
  type?: 'button' | 'submit';
}) {
  const v = variant === 'default' ? '' : ` is-${variant}`;
  return (
    <button
      type={type}
      className={`g-btn${v}${selected ? ' is-selected' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

/**
 * Renders a LaTeX snippet from the notes (or display text made from one) as reading text:
 * formatting, colour, size and layout commands are dropped, accents and dashes become characters,
 * simple math becomes Unicode and anything harder goes through KaTeX. No markup reaches the screen.
 */
export function NoteText({ latex, className = '' }: { latex: string; className?: string }) {
  const segs = useMemo(() => toSegments(latex), [latex]);
  return (
    <span className={`g-inline-math ${className}`}>
      {segs.map((s, i) => (s.kind === 'text' ? <span key={i}>{s.text}</span> : <InlineMath key={i} tex={s.tex} />))}
    </span>
  );
}

export function InlineMath({ tex }: { tex: string }) {
  return (
    <span className="g-inline-math">
      <Markdown>{`$${tex}$`}</Markdown>
    </span>
  );
}

/**
 * Wrong-answer correction (§10.3): the wrong version stays for a beat (~800 ms), then the correct
 * version fades in underneath. No buzz, no red X, and no source location: the player sees only the
 * notes' own words.
 */
export function WrongHold({
  wrong,
  right,
  holdMs = 800,
  onSettled,
}: {
  wrong: ReactNode;
  right: ReactNode;
  /** Accepted for older callers and ignored: where a line came from is never shown. */
  source?: string;
  holdMs?: number;
  onSettled?: () => void;
}) {
  const settled = useRef(onSettled);
  settled.current = onSettled;
  useEffect(() => {
    // Hold + fade (520 ms) before the caller may move on.
    const t = window.setTimeout(() => settled.current?.(), holdMs + 520);
    return () => window.clearTimeout(t);
  }, [holdMs]);
  return (
    <div className="space-y-2" style={{ '--g-hold': `${holdMs}ms` } as CSSProperties}>
      <div className="g-hold-wrong g-serif">{wrong}</div>
      <div className="g-hold-right g-serif" aria-live="polite">
        {right}
      </div>
    </div>
  );
}

/** Nine gold/navy shards flying out from the centre of the nearest positioned ancestor. */
export function ShatterBurst() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(false), 700);
    return () => window.clearTimeout(t);
  }, []);
  if (!on) return null;
  return (
    <span className="g-burst" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <svg key={i} className="g-shard" viewBox="0 0 14 14">
          <polygon points={i % 3 === 0 ? '0,14 7,0 14,10' : i % 3 === 1 ? '0,4 14,0 9,14' : '2,0 14,7 0,12'} />
        </svg>
      ))}
    </span>
  );
}

/** A thin draining rule for timed rounds. Restart it by changing `key`. */
export function TimerBar({ ms, paused = false }: { ms: number; paused?: boolean }) {
  return (
    <div className="g-timer" role="presentation">
      <span style={{ animationDuration: `${ms}ms`, animationPlayState: paused ? 'paused' : 'running' }} />
    </div>
  );
}

/** Arc progress: five short rules, no numbers. */
export function PhaseDots({ index }: { index: number }) {
  return (
    <div className="g-phase-dots" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={i < index ? 'is-done' : i === index ? 'is-now' : ''} />
      ))}
    </div>
  );
}

/** Elapsed ms since mount / since `key` changes; plus a timeout callback for timed rounds. */
export function useRoundClock(limitMs: number | undefined, onTimeout: () => void, running: boolean) {
  const start = useRef(performance.now());
  const cb = useRef(onTimeout);
  cb.current = onTimeout;
  useEffect(() => {
    start.current = performance.now();
  }, []);
  useEffect(() => {
    if (!running || !limitMs) return;
    const left = Math.max(0, limitMs - (performance.now() - start.current));
    const t = window.setTimeout(() => cb.current(), left);
    return () => window.clearTimeout(t);
  }, [running, limitMs]);
  return () => Math.round(performance.now() - start.current);
}
