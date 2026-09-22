'use client';

import { useMemo } from 'react';
import { Marked } from 'marked';
import { sanitizeSectionHtml } from '@/services/library/sanitize';

export interface MarkdownViewProps {
  content: string;
  streaming?: boolean;
  className?: string;
  style?: React.CSSProperties;
  'data-testid'?: string;
}

// Dedicated instance with GFM defaults: line breaks render as <br> so chat
// answers typed without blank lines still keep their paragraph rhythm.
const marked = new Marked({ gfm: true, breaks: true });

/**
 * Renders rich Markdown text (GFM headers, bold/italics, bullet lists,
 * blockquotes, code blocks, tables) with Astryx design tokens.
 *
 * Styling lives in `globals.css` under `.markdown-content` so bubbles carry
 * no per-instance <style> tags (their text stays pure markdown text), and
 * the HTML itself is sanitized through the same whitelist the reader uses.
 */
export default function MarkdownView({
  content,
  streaming = false,
  className,
  style,
  'data-testid': testId,
}: MarkdownViewProps) {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      const parsed = marked.parse(content, { async: false }) as string;
      // Trim: marked leaves a newline text node after the last block
      // element, which would pollute the wrapper's textContent.
      return sanitizeSectionHtml(parsed).trim();
    } catch {
      return sanitizeSectionHtml(content).trim();
    }
  }, [content]);

  return (
    <div
      data-testid={testId}
      className={`markdown-content ${className ?? ''}`}
      style={{
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
        lineHeight: 1.6,
        fontSize: 'inherit',
        color: 'inherit',
        ...style,
      }}
    >
      <div dangerouslySetInnerHTML={{ __html: html }} style={{ display: 'contents' }} />
      {streaming && <span className="markdown-streaming-cursor" aria-hidden="true">▍</span>}
    </div>
  );
}
