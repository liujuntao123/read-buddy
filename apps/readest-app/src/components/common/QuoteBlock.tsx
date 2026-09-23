'use client';

/**
 * 原文引用块 (user request: the selection-ask quote was raw text): renders
 * the quoted book fragment with Markdown parsing inside a dedicated quote
 * treatment — accent rule, muted surface, quote glyph — so reader-selected
 * prose reads like a citation instead of plain text.
 *
 * `collapsible` exists for the chat stream (user review): a quoted paragraph
 * can be longer than the question and the answer together, so a **message**
 * quote folds behind a 「引用原文 · N 字 · 出处」 trigger once it is long
 * enough to dominate the bubble. Short quotes stay open — folding two lines
 * behind a header costs more than it saves. The composer's pending draft never
 * folds: there the reader is about to send it and wants to see it.
 */
import { Quote } from 'lucide-react';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { HStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import MarkdownView from './MarkdownView';

/** Quotes longer than this fold by default when `collapsible` is set. */
export const QUOTE_AUTO_COLLAPSE_CHARS = 60;

export interface QuoteBlockProps {
  /** The quoted book text (rendered as Markdown). */
  text: string;
  /** Optional source attribution, e.g. 节「河灯迷影」 约 128 字符处. */
  source?: string;
  /** Tighter paddings for use inside chat bubbles. */
  compact?: boolean;
  /** Fold the quote body behind a trigger row (chat message quotes). */
  collapsible?: boolean;
  testId?: string;
}

export default function QuoteBlock({
  text,
  source,
  compact = false,
  collapsible = false,
  testId,
}: QuoteBlockProps) {
  const padding = compact
    ? 'var(--spacing-1) var(--spacing-2)'
    : 'var(--spacing-2) var(--spacing-3)';

  const sourceLine = source ? (
    <Text type="supporting" color="secondary" maxLines={1} style={{ minWidth: 0 }}>
      {source}
    </Text>
  ) : null;

  return (
    <HStack
      // `quote-block` is the styling hook for 「这是书里的原文」: serif reading
      // face + a size below the chat body, set in globals.css.
      className="quote-block"
      data-testid={testId}
      gap={2}
      vAlign="start"
      style={{
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        borderInlineStart: '3px solid var(--color-accent)',
        background: 'var(--color-background-muted)',
        borderRadius: 'var(--radius-tile)',
        padding,
      }}
    >
      {collapsible ? (
        <Collapsible
          data-testid={testId ? `${testId}-collapsible` : undefined}
          defaultIsOpen={text.length <= QUOTE_AUTO_COLLAPSE_CHARS}
          trigger={
            <HStack gap={1} vAlign="center" style={{ minWidth: 0 }}>
              <Quote size={13} aria-hidden style={{ flexShrink: 0, color: 'var(--color-accent)' }} />
              <Text type="supporting" weight="medium" style={{ flexShrink: 0 }}>
                引用原文
              </Text>
              <Text type="supporting" color="secondary" style={{ flexShrink: 0 }}>
                {`· ${text.length.toLocaleString()} 字`}
              </Text>
              {sourceLine}
            </HStack>
          }
        >
          <QuoteBody text={text} testId={testId} />
        </Collapsible>
      ) : (
        <>
          <Quote size={13} aria-hidden style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-accent)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <QuoteBody text={text} testId={testId} />
            {sourceLine && <div style={{ marginTop: 'var(--spacing-1)' }}>{sourceLine}</div>}
          </div>
        </>
      )}
    </HStack>
  );
}

/** The quoted markdown itself; `testId-content` is the long-standing test hook. */
function QuoteBody({ text, testId }: { text: string; testId?: string }) {
  return (
    <div data-testid={testId ? `${testId}-content` : undefined} style={{ minWidth: 0 }}>
      <MarkdownView content={text} />
    </div>
  );
}
