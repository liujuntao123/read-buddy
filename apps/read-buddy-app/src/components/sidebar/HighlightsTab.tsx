'use client';

/**
 * 划线 Tab (CONTEXT.md 「Highlight」): every mark the reader made in this book,
 * in document order, with where it lives.
 *
 * Three things this panel deliberately does **not** own:
 *
 * - **Loading.** The store is loaded by whichever reader pane is mounted
 *   (`useReaderHighlights`), because a reader who never opens this tab must still
 *   see their marks on the page. The tab only re-reads on mount.
 * - **Painting.** Clicking a row publishes a `LocateRequest` on the reader link
 *   bus — the same seam a citation card uses — and the pane decides how to move.
 *   The row carries the physical section (`spineIndex`) the mark was made in, so
 *   an engine book jumps straight there without resolving a node or scanning the
 *   spine, and the quote's context (`anchor`) keeps the cue off a twin sentence.
 * - **The conversation.** 「问 AI」 does not open a chat of its own: it hands the
 *   quote to the selection toolbar's own 追问 path (`useQuickActions('ask')`),
 *   so a mark and a selection enter the sidebar the same way.
 */
import { useEffect, useRef, useState } from 'react';
import { Highlighter, MapPin, MessageCircle, Trash2 } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import CopyButton from '@/components/common/CopyButton';
import { getAgentBookContext } from '@/services/agent/agentContext';
import { formatHighlightsAsMarkdown, relativeTimeLabel } from '@/services/reader/highlightExport';
import { requestLocate } from '@/services/reader/readerLink';
import { useQuickActions } from '@/hooks/useQuickActions';
import { useReaderStore } from '@/store/readerStore';
import { useHighlightStore, type HighlightStore } from '@/store/highlightStore';
import type { ReaderHighlight } from '@/types/highlight';

interface HighlightsTabProps {
  /** Injectable store seam; defaults to the app-wide singleton (候选 epilogue). */
  store?: HighlightStore;
}

/** How long the 「已删除 · 撤销」 row stays. */
const UNDO_WINDOW_MS = 5_000;

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
  const bookTitle = useReaderStore((s) => s.bookTitle);
  const highlights = store((s) => s.highlights);
  const loaded = store((s) => s.loaded);
  const error = store((s) => s.error);
  const load = store((s) => s.load);
  const remove = store((s) => s.remove);
  const restore = store((s) => s.restore);
  const runQuickAction = useQuickActions();

  /**
   * The undo window's row lives in the panel, not in the store: a countdown is
   * the panel's business, and the store's seam stays one delete / one restore.
   */
  const [undoRow, setUndoRow] = useState<ReaderHighlight | null>(null);
  const undoTimer = useRef<number | null>(null);

  // The panes load on book open; this covers the tab being opened first (or a
  // pane that is not mounted yet). `load` guards its own responses by book.
  useEffect(() => {
    if (!bookHash) return;
    void load(bookHash);
  }, [bookHash, load]);

  // A pending window must not fire into an unmounted panel.
  useEffect(
    () => () => {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    },
    [],
  );

  // Nor must it outlive a switch to another book: the row it would restore
  // belongs to the book the reader just left.
  useEffect(() => {
    setUndoRow(null);
  }, [bookHash]);

  const deleteHighlight = async (highlight: ReaderHighlight) => {
    await remove(highlight.id);
    setUndoRow(highlight);
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndoRow(null), UNDO_WINDOW_MS);
  };

  const undoDelete = async () => {
    if (!undoRow) return;
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    const row = undoRow;
    setUndoRow(null);
    await restore(row);
  };

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
        gap={2}
        style={{ minWidth: 0 }}
      >
        <VStack
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
        {/* Empty *is* the state the last row's undo leaves behind, so the window
            has to survive it — otherwise deleting the only mark is final. */}
        {undoRow && (
          <UndoRow onUndo={() => void undoDelete()} />
        )}
      </VStack>
    );
  }

  return (
    <VStack data-testid="highlights-tab-panel" gap={2} style={{ minWidth: 0 }}>
      <HStack justify="between" vAlign="center" gap={2}>
        <Text type="supporting" weight="semibold" maxLines={1}>
          {`划线 · ${highlights.length} 处`}
        </Text>
        {/* The tab's whole list leaves as one Markdown block — the same content a
            reader would otherwise copy row by row. The text is assembled on click
            (the formatter is pure, but the list can be long). */}
        <CopyButton
          label="复制全部"
          isIconOnly={false}
          tooltip="复制全部划线（Markdown）"
          getText={() =>
            formatHighlightsAsMarkdown(highlights, {
              resolveLocation: locationLabel,
              ...(bookTitle ? { bookTitle } : {}),
            })
          }
          testId="copy-highlights"
        />
      </HStack>
      {/* Rows, not cards: this is a dense list of marks (AGENTS: dense data = rows). */}
      <List density="compact" data-testid="highlight-list" style={{ flexWrap: 'nowrap' }}>
        {highlights.map((highlight) => (
          <ListItem
            key={highlight.id}
            data-testid="highlight-item"
            className="highlight-row"
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
                  <Text
                    type="supporting"
                    size="2xs"
                    color="secondary"
                    style={{ flexShrink: 0, opacity: 0.7 }}
                    data-testid="highlight-created-at"
                  >
                    {`· ${relativeTimeLabel(highlight.createdAt)}`}
                  </Text>
                </HStack>
              </VStack>
            }
            endContent={
              <HStack gap={0} vAlign="center" style={{ flexShrink: 0 }}>
                {/* Revealed on row hover / focus (globals.css). */}
                <IconButton
                  label="问 AI"
                  variant="ghost"
                  size="sm"
                  tooltip="拿这条划线问 AI"
                  className="highlight-row-action"
                  data-testid="ask-highlight-ai"
                  icon={<MessageCircle size={14} aria-hidden />}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    // The selection toolbar's 追问 path: expand onto the chat tab
                    // and leave the quote in the composer as a draft. There is no
                    // toolbar to dismiss here.
                    runQuickAction('ask', highlight.quote, () => {});
                  }}
                />
                <IconButton
                  label="删除划线"
                  variant="ghost"
                  size="sm"
                  tooltip="删除这条划线"
                  data-testid="delete-highlight"
                  icon={<Trash2 size={14} aria-hidden />}
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation();
                    void deleteHighlight(highlight);
                  }}
                />
              </HStack>
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

      {/* Undo, not a confirmation dialog: deleting a mark is cheap to reverse and
          expensive to confirm. The window closes on its own. */}
      {undoRow && <UndoRow onUndo={() => void undoDelete()} />}
    </VStack>
  );
}

/**
 * The undo window's row: one line, one action, gone in five seconds (已删除 · 撤销).
 *
 * Shared by the list and the empty state on purpose — the deletion that needs
 * undo most is the one that clears the last row.
 */
function UndoRow({ onUndo }: { onUndo: () => void }) {
  return (
    <HStack
      data-testid="highlight-undo"
      justify="between"
      vAlign="center"
      gap={2}
      style={{
        padding: 'var(--spacing-2) var(--spacing-3)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-container)',
        background: 'var(--color-background-muted)',
      }}
    >
      <Text type="supporting" color="secondary" maxLines={1}>
        已删除 1 条划线
      </Text>
      <Button
        label="撤销"
        variant="ghost"
        size="sm"
        data-testid="highlight-undo-button"
        onClick={onUndo}
      />
    </HStack>
  );
}
