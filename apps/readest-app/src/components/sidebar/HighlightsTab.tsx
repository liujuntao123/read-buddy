'use client';

/**
 * 划线 Tab (CONTEXT.md 「Highlight」): every mark the reader made in this book,
 * in document order, with where it lives.
 *
 * Two things this panel deliberately does **not** own:
 *
 * - **Loading.** The store is loaded by whichever reader pane is mounted
 *   (`useReaderHighlights`), because a reader who never opens this tab must still
 *   see their marks on the page. The tab only re-reads on mount.
 * - **Painting.** Clicking a row publishes a `LocateRequest` on the reader link
 *   bus — the same seam a citation card uses — and the pane decides how to move.
 *   The row carries the physical section (`spineIndex`) the mark was made in, so
 *   an engine book jumps straight there without resolving a node or scanning the
 *   spine, and the quote's context (`anchor`) keeps the cue off a twin sentence.
 */
import { useEffect } from 'react';
import { Highlighter, MapPin, Trash2 } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { getAgentBookContext } from '@/services/agent/agentContext';
import { requestLocate } from '@/services/reader/readerLink';
import { useReaderStore } from '@/store/readerStore';
import { useHighlightStore, type HighlightStore } from '@/store/highlightStore';
import type { ReaderHighlight } from '@/types/highlight';

interface HighlightsTabProps {
  /** Injectable store seam; defaults to the app-wide singleton (候选 epilogue). */
  store?: HighlightStore;
}

/** 「章 › 节」 when the node model knows the ancestor, else the stored title. */
function locationLabel(highlight: ReaderHighlight): string {
  const context = getAgentBookContext(highlight.bookHash);
  const node = context?.getNode(highlight.nodeIndex);
  const parent = node?.parentNodeId
    ? context?.getNodeTree().byId.get(node.parentNodeId)
    : undefined;
  const title = node?.title || highlight.nodeTitle || '当前位置';
  return parent?.title ? `${parent.title} › ${title}` : title;
}

export default function HighlightsTab({ store = useHighlightStore }: HighlightsTabProps = {}) {
  const bookHash = useReaderStore((s) => s.bookHash);
  const highlights = store((s) => s.highlights);
  const loaded = store((s) => s.loaded);
  const error = store((s) => s.error);
  const load = store((s) => s.load);
  const remove = store((s) => s.remove);

  // The panes load on book open; this covers the tab being opened first (or a
  // pane that is not mounted yet). `load` guards its own responses by book.
  useEffect(() => {
    if (!bookHash) return;
    void load(bookHash);
  }, [bookHash, load]);

  if (!bookHash) {
    return (
      <VStack
        data-testid="highlights-tab-panel"
        padding={4}
        style={{ border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-container)' }}
      >
        <Text color="secondary">尚未打开书籍，先在阅读器中选择一本书吧。</Text>
      </VStack>
    );
  }

  if (highlights.length === 0) {
    return (
      <VStack
        data-testid="highlights-tab-panel"
        gap={3}
        vAlign="center"
        hAlign="center"
        style={{ padding: 'var(--spacing-6) var(--spacing-4)', textAlign: 'center' }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-background-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Highlighter size={22} aria-hidden />
        </div>
        <Text type="supporting" color="secondary" data-testid="highlights-empty">
          {error
            ? `划线加载失败：${error}`
            : loaded
              ? '还没有划线。选中正文后点「划线」，就能在这里看到它。'
              : '正在加载划线…'}
        </Text>
      </VStack>
    );
  }

  return (
    <VStack data-testid="highlights-tab-panel" gap={2} style={{ minWidth: 0 }}>
      <HStack justify="between" vAlign="center">
        <Text type="supporting" weight="semibold">
          {`划线 · ${highlights.length} 处`}
        </Text>
      </HStack>
      {/* Rows, not cards: this is a dense list of marks (AGENTS: dense data = rows). */}
      <List density="compact" data-testid="highlight-list" style={{ flexWrap: 'nowrap' }}>
        {highlights.map((highlight) => (
          <ListItem
            key={highlight.id}
            data-testid="highlight-item"
            label={
              <VStack gap={1} style={{ minWidth: 0, textAlign: 'start' }}>
                <Text maxLines={3}>{highlight.quote}</Text>
                <HStack gap={1} vAlign="center" style={{ minWidth: 0 }}>
                  <MapPin
                    size={11}
                    aria-hidden
                    style={{ flexShrink: 0, color: 'var(--color-text-secondary)', opacity: 0.75 }}
                  />
                  <Text
                    type="supporting"
                    color="secondary"
                    maxLines={1}
                    style={{ minWidth: 0 }}
                    data-testid="highlight-location"
                  >
                    {locationLabel(highlight)}
                  </Text>
                </HStack>
              </VStack>
            }
            endContent={
              <IconButton
                label="删除划线"
                variant="ghost"
                size="sm"
                tooltip="删除这条划线"
                data-testid="delete-highlight"
                icon={<Trash2 size={14} aria-hidden />}
                onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation();
                  void remove(highlight.id);
                }}
              />
            }
            onClick={() =>
              requestLocate({
                bookHash: highlight.bookHash,
                nodeIndex: highlight.nodeIndex,
                spineIndex: highlight.spineIndex,
                quoteSnippet: highlight.quote,
                ...((highlight.prefix || highlight.suffix) && {
                  anchor: {
                    ...(highlight.prefix ? { prefix: highlight.prefix } : {}),
                    ...(highlight.suffix ? { suffix: highlight.suffix } : {}),
                  },
                }),
              })
            }
          />
        ))}
      </List>
    </VStack>
  );
}
