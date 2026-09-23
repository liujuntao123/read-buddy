'use client';

import { useEffect, useRef, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { useLibraryStore } from '@/store/libraryStore';
import { DEMO_MONOLITHIC_TXT, type DemoSection } from '@/services/reader/demoBook';
import { type QuickAction } from '@/services/chat/quickActions';
import { fontStackByKey, useReaderSettingsStore } from '@/store/readerSettingsStore';
import { subscribeLocate } from '@/services/reader/readerLink';
import { recordReadingPosition } from '@/services/reader/readingPosition';
import { highlightSnippet } from '@/services/reader/highlight';
import SelectionToolbar from './SelectionToolbar';
import { readTextSelection, useTextSelection } from '@/hooks/useTextSelection';
import { useQuickActions } from '@/hooks/useQuickActions';

/** Article column: a capped measure keeps prose lines readable. */
const ARTICLE_MEASURE = 672;

/**
 * Scroll reading viewport for TXT / demo books. Chapter navigation lives in
 * the unified HeaderBar; this pane renders the current (virtual) section as
 * selectable text. When a segmentation exists for the active book, the
 * article is sliced from the monolithic text by charOffset (ticket 02
 * "映射进阅读进度").
 */
export default function ReaderPane({
  sections,
  monolithicText,
}: {
  sections: DemoSection[];
  monolithicText?: string;
}) {
  const bookHash = useReaderStore((s) => s.bookHash);
  const spineIndex = useReaderStore((s) => s.spineIndex);
  const loadBook = useReaderStore((s) => s.loadBook);
  const segmentation = useSegmentationStore((s) => s.segmentation);
  const typography = useReaderSettingsStore((s) => s.typography);
  const [toast, setToast] = useState<string | null>(null);
  const lastToastKey = useRef<string | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const { selection, close, reset } = useTextSelection(articleRef);
  const runQuickAction = useQuickActions();

  // Reader typography (font size / family / line height / paragraph spacing)
  // applies to the TXT scroll article just like to engine chapters.
  const typoStyle = {
    fontSize: `${typography.fontSize}px`,
    fontFamily: fontStackByKey(typography.fontFamily),
    lineHeight: typography.lineHeight,
  } as const;
  const paragraphStyle = { marginTop: `${typography.paragraphSpacing}em` } as const;

  // Virtual-section mode: the segmentation belongs to the book being read.
  const virtualSections =
    segmentation && segmentation.bookHash === bookHash ? segmentation.virtualSections : [];
  const isVirtual = virtualSections.length > 0;
  const currentVirtual = isVirtual ? (virtualSections[spineIndex] ?? null) : null;
  const section = !isVirtual ? sections[spineIndex] : undefined;

  // Virtual-section text source: the opened book's monolithic text (real TXT
  // books), falling back to the demo fixture for the dev demo flow.
  const virtualSource = monolithicText ?? DEMO_MONOLITHIC_TXT;
  const virtualText = currentVirtual
    ? virtualSource.slice(
        currentVirtual.charOffset,
        virtualSections[spineIndex + 1]?.charOffset ?? virtualSource.length,
      )
    : '';

  // Agent → reader jump (reading-agent doc §5.3 locate_in_reader): hop to the
  // target virtual section, then breathe-highlight the quoted snippet. For TXT
  // the virtual sections share the agent pipeline's node space (same layered
  // segmenter), so `request.nodeIndex` maps 1:1 onto the physical ordinal.
  const [pendingHighlight, setPendingHighlight] = useState<string | null>(null);
  useEffect(() => {
    return subscribeLocate((request) => {
      if (request.bookHash !== bookHash) return;
      const target = virtualSections[request.nodeIndex];
      if (!target) return;
      if (spineIndex !== request.nodeIndex) {
        recordReadingPosition(
          { bookHash, spineIndex: request.nodeIndex },
          { titleFallback: target.title },
        );
      }
      setPendingHighlight(request.quoteSnippet);
    });
  }, [bookHash, virtualSections, spineIndex]);

  // Highlight fires once the target section's paragraphs have painted.
  // NOTE: no cleanup here — clearing `pendingHighlight` re-renders before the
  // rAF fires, and cancelling the frame would swallow the highlight.
  useEffect(() => {
    if (!pendingHighlight || !articleRef.current) return;
    const snippet = pendingHighlight;
    setPendingHighlight(null);
    requestAnimationFrame(() => {
      highlightSnippet(articleRef.current, snippet);
    });
  }, [pendingHighlight, spineIndex, virtualText]);

  /**
   * Selection AI quick action (design doc 4.4.3, ADR 0007) — shared with the
   * Foliate engine pane via `useQuickActions` (ticket 07); see the hook for
   * the sidebar/quote/send behaviour.
   */
  const handleQuickAction = (action: QuickAction, text: string) => {
    runQuickAction(action, text, reset);
  };

  /** Clicking the article body with no live selection retracts the toolbar. */
  const handleArticlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (!readTextSelection(articleRef.current)) {
      close();
      return;
    }
    // A click that collapses the existing selection is confirmed after the
    // browser default action (mouseup/selectionchange also re-evaluate).
    window.setTimeout(() => {
      if (!readTextSelection(articleRef.current)) close();
    }, 0);
  };

  // Segmentation feedback + reading-progress mapping: `open` has already
  // auto-applied the segmentation, so switch the reader onto the generated
  // Virtual Sections and toast the count (design doc 4.2).
  useEffect(() => {
    if (!segmentation || segmentation.virtualSections.length === 0) return;
    const key = `${segmentation.bookHash}:${segmentation.strategy}:${segmentation.virtualSections.length}`;
    if (lastToastKey.current === key) return;
    lastToastKey.current = key;
    setToast(`已识别 ${segmentation.virtualSections.length} 个章节`);
    const timer = window.setTimeout(() => setToast(null), 5_000);

    const first = segmentation.virtualSections[0]!;
    // Book title comes from the library row (never the hash — the panorama
    // dialog, the agent system prompt and the chat header all read it).
    const libTitle = useLibraryStore
      .getState()
      .books.find((book) => book.hash === segmentation.bookHash)?.title;
    const bookTitle =
      libTitle ?? useReaderStore.getState().bookTitle ?? segmentation.bookHash;
    loadBook({
      bookHash: segmentation.bookHash,
      bookTitle,
      spineCount: segmentation.virtualSections.length,
    });
    recordReadingPosition(
      { bookHash: segmentation.bookHash, spineIndex: 0 },
      { titleFallback: first.title },
    );
    return () => window.clearTimeout(timer);
  }, [segmentation, loadBook]);

  if (isVirtual ? !currentVirtual : !section) {
    return (
      <VStack aria-label="阅读视窗" data-testid="reader-pane" padding={6} height="100%">
        <Text color="secondary">暂无内容</Text>
      </VStack>
    );
  }

  return (
    <VStack aria-label="阅读视窗" data-testid="reader-pane" height="100%" gap={0}>
      {toast && (
        <Banner
          data-testid="segmentation-toast"
          role="status"
          status="success"
          container="section"
          title={toast}
          isDismissable
          onDismiss={() => setToast(null)}
        />
      )}
      <article
        ref={articleRef}
        data-testid="reader-article"
        onPointerDown={handleArticlePointerDown}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          background: 'var(--color-background-surface)',
          color: 'var(--color-text-primary)',
          padding: 'var(--spacing-8) var(--spacing-6)',
        }}
      >
        <div
          style={{
            ...typoStyle,
            maxWidth: ARTICLE_MEASURE,
            marginInline: 'auto',
          }}
          data-testid="reader-typography"
        >
          {isVirtual ? (
            virtualText
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line, i) => (
                <p key={i} style={{ ...paragraphStyle, textAlign: 'justify', textIndent: '2em' }}>
                  {line}
                </p>
              ))
          ) : (
            <>
              {/* Static fixture content owned by this app (demoBook.ts), not user input. */}
              <div style={{ letterSpacing: '0.02em' }} dangerouslySetInnerHTML={{ __html: section!.html }} />
              <style>{`[data-testid="reader-typography"] p { margin-top: ${typography.paragraphSpacing}em; }`}</style>
            </>
          )}
        </div>
      </article>
      <SelectionToolbar selection={selection} onAction={handleQuickAction} onClose={reset} />
    </VStack>
  );
}
