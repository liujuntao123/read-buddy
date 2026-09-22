'use client';

/**
 * 原文引用块 (user request: the selection-ask quote was raw text): renders
 * the quoted book fragment with Markdown parsing inside a dedicated quote
 * treatment — accent rule, muted surface, quote glyph — so reader-selected
 * prose reads like a citation instead of plain text.
 */
import { Quote } from 'lucide-react';
import { HStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import MarkdownView from './MarkdownView';

export interface QuoteBlockProps {
  /** The quoted book text (rendered as Markdown). */
  text: string;
  /** Optional source attribution, e.g. 「第 3 章《河灯迷影》」. */
  source?: string;
  /** Tighter paddings for use inside chat bubbles. */
  compact?: boolean;
  testId?: string;
}

export default function QuoteBlock({ text, source, compact = false, testId }: QuoteBlockProps) {
  return (
    <HStack
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
        padding: compact
          ? 'var(--spacing-1) var(--spacing-2)'
          : 'var(--spacing-2) var(--spacing-3)',
      }}
    >
      <Quote size={13} aria-hidden style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-accent)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div data-testid={testId ? `${testId}-content` : undefined} style={{ minWidth: 0 }}>
          <MarkdownView content={text} />
        </div>
        {source && (
          <Text type="supporting" color="secondary" style={{ marginTop: 'var(--spacing-1)' }}>
            {source}
          </Text>
        )}
      </div>
    </HStack>
  );
}
