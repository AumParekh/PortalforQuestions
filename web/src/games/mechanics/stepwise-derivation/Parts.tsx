// Renders the notes' LaTeX parts: text paragraphs (inline math via NoteText), display lines via
// KaTeX in their own horizontally scrolling box, lists and tables. Nothing is truncated.
import { memo, useMemo } from 'react';
import katex from 'katex';
import { NoteText } from '../../theme/primitives';
import type { Cell, Part } from './parse';

const cache = new Map<string, string>();

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** KaTeX display HTML; a line KaTeX cannot parse shows its error rendering, never a throw. */
export function renderDisplay(tex: string): string {
  const hit = cache.get(tex);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = katex.renderToString(tex, { displayMode: true, throwOnError: false, strict: 'ignore' });
  } catch {
    html = `<code>${escapeHtml(tex)}</code>`;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(tex, html);
  return html;
}

/** One display line, scrolling sideways inside its own box when wider than the card. */
export const MathLine = memo(function MathLine({ tex, className = '' }: { tex: string; className?: string }) {
  const html = useMemo(() => renderDisplay(tex), [tex]);
  return <span className={`sd-math ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
});

function CellView({ cell, head }: { cell: Cell; head: boolean }) {
  const Tag = head ? 'th' : 'td';
  return (
    <Tag colSpan={cell.span > 1 ? cell.span : undefined} scope={head ? 'col' : undefined}>
      <NoteText latex={cell.latex} />
    </Tag>
  );
}

export function PartView({ part }: { part: Part }) {
  switch (part.kind) {
    case 'text':
      return (
        <p className="sd-text">
          <NoteText latex={part.latex} />
        </p>
      );
    case 'math':
      return <MathLine tex={part.tex} />;
    case 'list': {
      const Tag = part.ordered ? 'ol' : 'ul';
      return (
        <Tag className={`sd-list ${part.ordered ? 'is-ordered' : ''}`}>
          {part.items.map((it, i) => (
            <li key={i}>
              <NoteText latex={it} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'table':
      return (
        <div className="sd-table-wrap">
          <table className="sd-table">
            {part.head.length > 0 && (
              <thead>
                {part.head.map((row, i) => (
                  <tr key={i}>
                    {row.map((c, j) => (
                      <CellView key={j} cell={c} head />
                    ))}
                  </tr>
                ))}
              </thead>
            )}
            <tbody>
              {part.body.map((row, i) => (
                <tr key={i}>
                  {row.map((c, j) => (
                    <CellView key={j} cell={c} head={false} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

export function Parts({ parts, className = '' }: { parts: readonly Part[]; className?: string }) {
  if (!parts.length) return null;
  return (
    <div className={`sd-parts ${className}`}>
      {parts.map((p, i) => (
        <PartView key={i} part={p} />
      ))}
    </div>
  );
}
