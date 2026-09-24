import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

interface Props {
  children: string;
  className?: string;
}

/** Renders a content string field: GFM markdown + tables + $...$ / $$...$$ KaTeX math. Never truncates. */
export function Markdown({ children, className = '' }: Props) {
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
        {children}
      </ReactMarkdown>
    </div>
  );
}
