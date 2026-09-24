import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface Props {
  children: string;
  className?: string;
}

/** Renders a content string field: GFM markdown + tables + $...$ / $$...$$ KaTeX math. Never truncates. */
// remark-math only treats $$ as display math when the fences sit on their own lines;
// the content writes display math as a single "$$...$$" line.
function fenceDisplayMath(src: string): string {
  return src.replace(/^[ \t]*\$\$(.+?)\$\$[ \t]*$/gm, '\n$$$$\n$1\n$$$$\n');
}

export function Markdown({ children, className = '' }: Props) {
  const source = useMemo(() => fenceDisplayMath(children), [children]);
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}
        components={{
          table: ({ node: _node, ...props }) => (
            <div className="table-scroll">
              <table {...props} />
            </div>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
