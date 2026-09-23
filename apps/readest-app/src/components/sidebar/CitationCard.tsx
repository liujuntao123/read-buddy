'use client';

/**
 * 全书证据卡片 (reading-agent architecture doc §7.1/§7.2): renders one
 * `locate_in_reader` citation as a structured evidence card; clicking
 * [📍 跳转至该章节] re-dispatches the reader jump (the original locate
 * already drove the reader once — this lets the reader hop back after
 * scrolling away).
 *
 * The title line names the node itself plus its level (章 / 节 / 段, from the
 * node model) and its 章 ancestor — the node's global ordinal is NOT a chapter
 * number (CONTEXT.md / ADR 0010), so it is never printed as one.
 */
import { MapPin, ScrollText } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { requestLocate } from '@/services/reader/readerLink';
import { nodeKindLabel } from '@/services/bookNodes';
import type { AgentCitation } from '@/types/readingAgent';

export interface CitationCardProps {
  citation: AgentCitation;
}

export default function CitationCard({ citation }: CitationCardProps) {
  const jump = () => {
    requestLocate({
      bookHash: citation.bookHash,
      nodeIndex: citation.nodeIndex,
      charOffset: citation.charOffset,
      quoteSnippet: citation.quoteSnippet,
    });
  };

  return (
    <Card data-testid="citation-card" variant="blue" padding={3}>
      <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          <ScrollText size={14} aria-hidden />
          <Token
            size="sm"
            label={nodeKindLabel(citation.nodeKind)}
            data-testid="citation-node-kind"
          />
          {citation.parentNodeTitle && (
            <Text type="supporting" color="secondary" maxLines={1} style={{ flexShrink: 0 }}>
              {/* 「」 quotes the node title; 《》 belongs to book titles alone. */}
              {`「${citation.parentNodeTitle}」 ›`}
            </Text>
          )}
          <Text type="supporting" weight="medium" maxLines={1} style={{ minWidth: 0 }}>
            {citation.nodeTitle}
          </Text>
          {typeof citation.charOffset === 'number' && (
            <Text
              type="supporting"
              color="secondary"
              hasTabularNumbers
              style={{ flexShrink: 0, marginLeft: 'auto' }}
            >
              {`约第 ${citation.charOffset.toLocaleString()} 字`}
            </Text>
          )}
        </HStack>
        <Text
          type="supporting"
          color="secondary"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {`"${citation.quoteSnippet}"`}
        </Text>
        <HStack justify="end">
          {/* No 📍 in the label: the button already carries a MapPin icon, and
              a second location glyph next to the first one is just noise. */}
          <Button
            label="定位到原文"
            variant="secondary"
            size="sm"
            data-testid="citation-jump"
            icon={<MapPin size={14} aria-hidden />}
            onClick={jump}
          />
        </HStack>
      </VStack>
    </Card>
  );
}
