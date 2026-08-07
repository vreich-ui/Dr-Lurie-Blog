import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { safeMarkdownUrl } from '@core/lib/admin/markdown';

export function Markdown({ children }: { children: string }) {
  return (
    <div className="adm-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeMarkdownUrl}
        components={{
          a: ({ children: linkChildren, href }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {linkChildren}
              </a>
            ) : (
              <span>{linkChildren}</span>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
