// Close (§8.5): one screen — the reading, the objectives covered (by their wording), the concept
// named, trap categories drawn on, and caught/missed by category as a stability measurement. The
// §9.7 session-log lines can be copied; they are not printed, since they carry block and objective
// IDs that mean nothing on screen.
// No points, streaks, XP, confetti or emoji (§10.6, §11).
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Reading, SessionLog } from '../types';
import { TRAP_CATEGORIES } from '../types';
import type { ConceptNaming } from './plugin';
import type { NarrativeFrame } from './frames';
import { GameButton, GameCard, NoteText } from '../theme/primitives';
import { useGameProgress } from '../progress';
import { learningObjectives } from '../corpus';

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / insecure contexts: a hidden textarea and execCommand.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <GameButton
      onClick={() => {
        copyText(text).then((ok) => {
          if (!ok) return;
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        });
      }}
    >
      {done ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      {done ? 'Copied' : label}
    </GameButton>
  );
}

export function StabilityRows({ byCategory }: { byCategory: SessionLog['byCategory'] }) {
  const rows = TRAP_CATEGORIES.filter((c) => byCategory[c]);
  if (rows.length === 0) return <p className="g-small g-muted">No trap categories drawn on.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((c) => {
        const t = byCategory[c]!;
        const total = t.caught + t.missed;
        return (
          <li key={c}>
            <div className="flex items-baseline justify-between gap-3 g-small">
              <span className="g-strong">{c}</span>
              <span className="g-muted">
                {t.caught} caught · {t.missed} missed
              </span>
            </div>
            <div className="g-bar mt-1" role="img" aria-label={`${c}: ${t.caught} of ${total} caught`}>
              <span className="is-caught" style={{ width: `${(t.caught / total) * 100}%` }} />
              <span className="is-missed" style={{ width: `${(t.missed / total) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function CloseScreen({
  log,
  reading,
  frame,
  naming,
  onExit,
  onPlayNext,
}: {
  log: SessionLog;
  reading: Reading;
  frame: NarrativeFrame;
  naming: ConceptNaming;
  onExit: () => void;
  onPlayNext?: () => void;
}) {
  const saved = useGameProgress((s) => s.status);
  const objectives = learningObjectives(reading);
  const closed = new Set(log.objectivesClosed);
  const text = log.lines.join('\n');
  return (
    <div className="g-enter space-y-6">
      <GameCard tone="navy" className="py-8 text-center">
        <div className="g-kicker" style={{ color: 'inherit', opacity: 0.8 }}>
          {frame.title}
        </div>
        <p className="g-serif mx-auto mt-2 max-w-[52ch] text-lg">{frame.close}</p>
      </GameCard>

      <GameCard className="space-y-6">
        <div>
          <div className="g-kicker">Reading</div>
          <p className="g-title mt-1">
            {reading.reading_id} <span className="g-muted text-lg font-normal">· {reading.title}</span>
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="g-kicker">Concept named</div>
            <p className="g-serif mt-1 text-lg">
              <NoteText latex={naming.term} />
            </p>
          </div>
          <div>
            <div className="g-kicker">Objectives</div>
            {log.completed ? (
              <ul className="mt-1 space-y-2 g-small">
                {objectives
                  .filter((o) => o.text?.trim())
                  .map((o) => (
                    <li key={o.id} className={closed.has(o.id) ? '' : 'g-muted'}>
                      <span className="g-strong">{closed.has(o.id) ? 'Closed' : 'Carries over'}</span>{' '}
                      <NoteText latex={o.text ?? ''} className="g-serif" />
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="mt-1 g-small g-muted">The arc ended early, so no objective is marked closed.</p>
            )}
          </div>
        </div>

        <div>
          <div className="g-kicker">Trap categories drawn on</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {log.categoriesDrawn.length ? (
              log.categoriesDrawn.map((c) => (
                <span key={c} className={`g-chip${log.missCategories.includes(c) ? ' is-red' : ' is-green'}`}>
                  {c}
                </span>
              ))
            ) : (
              <span className="g-small g-muted">None</span>
            )}
          </div>
        </div>

        <div>
          <div className="g-kicker">Stability</div>
          <p className="g-small g-muted mb-3">
            Caught {log.caught} of {log.rounds.length}
          </p>
          <StabilityRows byCategory={log.byCategory} />
        </div>
      </GameCard>

      <GameCard tone="soft" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="g-kicker">Session log</div>
          {log.rounds.length > 0 && <CopyButton text={text} label="Copy session log" />}
        </div>
        {saved === 'unavailable' && (
          <p className="g-small g-muted">Browser storage is unavailable here, so this log lives only until the page closes. Copy it.</p>
        )}
        {log.rounds.length === 0 && <p className="g-small g-muted">Nothing was answered, so nothing was logged.</p>}
      </GameCard>

      <div className="flex flex-wrap justify-center gap-3">
        <GameButton onClick={onExit}>Back to games</GameButton>
        {onPlayNext && (
          <GameButton variant="primary" onClick={onPlayNext}>
            Next session
          </GameButton>
        )}
      </div>
    </div>
  );
}
