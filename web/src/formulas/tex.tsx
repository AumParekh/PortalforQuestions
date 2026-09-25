import { memo, useMemo } from 'react';
import katex from 'katex';

// Mid-tone colours that stay legible on both the light and the dark card backgrounds.
export const TEX_RED = '#ef4444';
export const TEX_GREEN = '#10b981';
export const TEX_PRIMARY = '#6366f1';

const cache = new Map<string, string>();
const CACHE_MAX = 3000;

/** Renders LaTeX to HTML; a string KaTeX can't parse falls back to its error rendering, never a throw. */
export function renderTex(latex: string, display: boolean): string {
  const key = `${display ? 'D' : 'I'}${latex}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string;
  try {
    html = katex.renderToString(latex, { displayMode: display, throwOnError: true, strict: 'ignore' });
  } catch {
    try {
      html = katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: 'ignore' });
    } catch {
      // Only non-parse failures get here; show the source rather than take the screen down.
      html = `<code>${latex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`;
    }
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, html);
  return html;
}

/** True when KaTeX parses `latex` cleanly. Used to vet generated LaTeX (highlights, filled skeletons). */
export function texValid(latex: string): boolean {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface TexProps {
  latex: string;
  /** Display mode, in its own horizontally scrolling box so a wide formula never widens the page. */
  display?: boolean;
  className?: string;
  label?: string;
}

export const Tex = memo(function Tex({ latex, display = false, className = '', label }: TexProps) {
  const html = useMemo(() => renderTex(latex, display), [latex, display]);
  if (display) {
    return (
      // A block-level span, so a formula can sit inside a button.
      <span
        className={`block max-w-full overflow-x-auto overflow-y-hidden py-1 text-lg [&_.katex-display]:my-1 ${className}`}
        aria-label={label}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return <span className={`inline-block max-w-full overflow-x-auto overflow-y-hidden align-middle ${className}`} aria-label={label} dangerouslySetInnerHTML={{ __html: html }} />;
});
