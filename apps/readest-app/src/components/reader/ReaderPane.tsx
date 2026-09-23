'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { useLibraryStore } from '@/store/libraryStore';
import { DEMO_MONOLITHIC_TXT, type DemoSection } from '@/services/reader/demoBook';
import { type QuickAction } from '@/services/chat/quickActions';
import { fontStackByKey, useReaderSettingsStore } from '@/store/readerSettingsStore';
import { subscribeLocate, type LocateRequest } from '@/services/reader/readerLink';
import { recordReadingPosition } from '@/services/reader/readingPosition';
import { highlightSnippet } from '@/services/reader/highlight';
import { getAgentBookContext } from '@/services/agent/agentContext';
import {
  formatNavLabel,
  resolveNodeKind,
  shapeOfNodes,
  stampDepths,
} from '@/services/bookNodes';
import type { NodeKind } from '@/types/readingAgent';
import SelectionToolbar from './SelectionToolbar';
import { readTextSelection, useTextSelection, type TextSelection } from '@/hooks/useTextSelection';
import { useQuickActions } from '@/hooks/useQuickActions';
import { useReaderHighlights } from '@/hooks/useReaderHighlights';

/** Article column: a capped measure keeps prose lines readable. */
const ARTICLE_MEASURE = 672;

/**
 * Escape the one thing a book's text can contain that HTML would read as markup.
 *
 * The scroll article is handed to React as an **HTML string** rather than as
 * `<p>{line}</p>` children on purpose: reader highlights wrap text nodes in
 * `<mark>` elements, and a text node React believes it owns is a text node React
 * will overwrite with `nodeValue` on the next re-render (a font-size change, a
 * theme switch) — corrupting the line and orphaning the mark. `innerHTML` is
 * outside React's diffing, which is why the demo branch below has always used it.
 */
const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

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
  const setSectionFraction = useReaderStore((s) => s.setSectionFraction);
  const segmentation = useSegmentationStore((s) => s.segmentation);
  const typography = useReaderSettingsStore((s) => s.typography);
  const [toast, setToast] = useState<string | null>(null);
  const lastToastKey = useRef<string | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const { selection, close, reset } = useTextSelection(articleRef);
  const runQuickAction = useQuickActions();
  const { setMarkTarget, markSelection } = useReaderHighlights();

  // Reader typography (font size / family / line height / paragraph spacing)
  // applies to the TXT scroll article just like to engine chapters.
  const typoStyle = {
    fontSize: `${typography.fontSize}px`,
    fontFamily: fontStackByKey(typography.fontFamily),
    lineHeight: typography.lineHeight,
  } as const;

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

  /**
   * The article's paragraphs as HTML (one `<p>` per non-blank line). Built as a
   * string, not as React children, so highlight marks survive re-renders — see
   * `escapeHtml`.
   */
  const paragraphsHtml = useMemo(() => {
    const margin = `margin-top:${typography.paragraphSpacing}em;text-align:justify;text-indent:2em`;
    return virtualText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p style="${margin}">${escapeHtml(line)}</p>`)
      .join('');
  }, [virtualText, typography.paragraphSpacing]);

  /** 当前节点之后的下一个节点（段）；没有下一个就是全书末尾。 */
  const nextNode = useMemo<{ index: number; title: string } | null>(() => {
    const index = spineIndex + 1;
    const titles = isVirtual
      ? virtualSections.map((section) => section.title)
      : sections.map((section) => section.title);
    if (index >= titles.length) return null;
    return { index, title: titles[index] ?? '' };
  }, [spineIndex, isVirtual, virtualSections, sections]);

  /**
   * 导航文案的层词：节点模型说了算（`minimalKind`）；模型还没建好时，用同一套
   * 标题规则从目录行补出层级（`stampDepths` + `resolveNodeKind`）——与 ReaderDock
   * 的目录弹窗同源，所以同一本书的两个入口不会说出不同的「章 / 节 / 段」。
   */
  const navKind: NodeKind = useMemo(() => {
    const context = bookHash ? getAgentBookContext(bookHash) : undefined;
    if (context && context.nodes.length > 0) return shapeOfNodes(context.nodes).minimalKind;
    const titles = isVirtual
      ? virtualSections.map((section) => section.title)
      : sections.map((section) => section.title);
    const stamped = stampDepths(titles.map((title) => ({ title, depth: 0 })));
    if (stamped.some(({ depth }) => depth > 0)) return 'section';
    return resolveNodeKind(0, titles[spineIndex] ?? '');
  }, [bookHash, isVirtual, virtualSections, sections, spineIndex]);

  // 段切换：新的 section 必须从顶部开始。
  // 此前 article 保留着上一节的 scrollTop，读者翻到下一节会落在半空中。复位放在
  // 定位高亮 effect **之前**：`highlightSnippet` 在 rAF 里才滚动到命中处，晚于
  // 这一次复位，所以定位／划线跳转仍然会停在正文片段上。
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    article.scrollTop = 0;
    setSectionFraction(0);
  }, [spineIndex, setSectionFraction]);

  // 段内滚动 → 进度条。滚动事件按帧合并（一次滚动只写一次 store）：进度条要的
  // 是「这一节里走了多远」，而这件事只有视口知道。
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    let frame = 0;
    const report = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const scrollable = article.scrollHeight - article.clientHeight;
        setSectionFraction(scrollable > 0 ? article.scrollTop / scrollable : 0);
      });
    };
    article.addEventListener('scroll', report, { passive: true });
    return () => {
      article.removeEventListener('scroll', report);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
    // `section` / `spineIndex` 进依赖是为了在文章挂载之后重新绑定（首帧可能是
    // 「暂无内容」，那时没有 scroll 容器可听）。
  }, [setSectionFraction, spineIndex, section]);

  // Agent → reader jump (reading-agent doc §5.3 locate_in_reader): hop to the
  // target virtual section, then breathe-highlight the quoted snippet. For TXT
  // the virtual sections share the agent pipeline's node space (same layered
  // segmenter), so `request.nodeIndex` maps 1:1 onto the physical ordinal.
  const [pendingHighlight, setPendingHighlight] = useState<LocateRequest | null>(null);
  useEffect(() => {
    return subscribeLocate((request) => {
      if (request.bookHash !== bookHash) return;
      // A reader highlight carries the physical section it was made in; an agent
      // citation carries only a node ordinal. For a TXT book the two coincide.
      const target = request.spineIndex ?? request.nodeIndex;
      const section = virtualSections[target];
      if (section) {
        if (spineIndex !== target) {
          recordReadingPosition({ bookHash, spineIndex: target }, { titleFallback: section.title });
        }
      } else if (spineIndex !== target) {
        // No segmentation for this book (demo / native TXT): the ordinal *is* the
        // section, so the reader can still be moved there.
        recordReadingPosition({ bookHash, spineIndex: target }, {});
      }
      setPendingHighlight(request);
    });
  }, [bookHash, virtualSections, spineIndex]);

  // Highlight fires once the target section's paragraphs have painted.
  // NOTE: no cleanup here — clearing `pendingHighlight` re-renders before the
  // rAF fires, and cancelling the frame would swallow the highlight.
  useEffect(() => {
    if (!pendingHighlight || !articleRef.current) return;
    const snippet = pendingHighlight.quoteSnippet;
    const anchor = pendingHighlight.anchor;
    setPendingHighlight(null);
    requestAnimationFrame(() => {
      highlightSnippet(articleRef.current, snippet, anchor ? { anchor } : {});
    });
  }, [pendingHighlight, spineIndex, virtualText]);

  /**
   * Reader highlights (划线) are painted onto the article's HTML — never onto
   * React's own text nodes (see `escapeHtml`). Repainting is therefore tied to
   * the HTML string: React replaces it whenever the section or the typography
   * changes, and the hook's store subscription repaints when the marks do.
   */
  useEffect(() => {
    setMarkTarget(articleRef.current, spineIndex);
  }, [setMarkTarget, spineIndex, paragraphsHtml, section]);

  /** 跳到下一个节点：与 ReaderDock 的目录点击同一条路（Reading Position）。 */
  const goToNode = (index: number, title: string) => {
    recordReadingPosition(
      { bookHash, spineIndex: index },
      title ? { titleFallback: title } : {},
    );
  };

  /** Selection 划线 — the mark belongs to this article's document. */
  const handleHighlight = (selected: TextSelection) => {
    void markSelection(selected).then(reset);
  };

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
      <VStack
        aria-label="阅读视窗"
        data-testid="reader-pane"
        padding={6}
        style={{ flex: 1, minHeight: 0 }}
      >
        <Text color="secondary">暂无内容</Text>
      </VStack>
    );
  }

  return (
    <VStack
      aria-label="阅读视窗"
      data-testid="reader-pane"
      gap={0}
      style={{ flex: 1, minHeight: 0 }}
    >      {toast && (
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
          {/* Both branches render as HTML strings, never as React children: 划线
              marks live inside this subtree and React must not own its text nodes
              (see `escapeHtml`). */}
          {isVirtual ? (
            <div
              data-testid="reader-paragraphs"
              dangerouslySetInnerHTML={{ __html: paragraphsHtml }}
            />
          ) : (
            <>
              {/* Static fixture content owned by this app (demoBook.ts), not user input. */}
              <div
                data-testid="reader-paragraphs"
                style={{ letterSpacing: '0.02em' }}
                dangerouslySetInnerHTML={{ __html: section!.html }}
              />
              <style>{`[data-testid="reader-typography"] p { margin-top: ${typography.paragraphSpacing}em; }`}</style>
            </>
          )}
          {/* 一节读完不该是死路：TXT 的滚动阅读器只在视窗里，没有引擎的翻页手势，
              读到末尾必须有个出口。层词来自 `formatNavLabel`，标题来自目录行 /
              节点模型，最末尾则是一句「全书完」。 */}
          <footer className="reader-section-end" data-testid="reader-section-end">
            {nextNode ? (
              <Button
                size="sm"
                variant="secondary"
                data-testid="reader-next-section"
                label={
                  nextNode.title
                    ? `${formatNavLabel(navKind, 'next')}：${nextNode.title}`
                    : formatNavLabel(navKind, 'next')
                }
                onClick={() => goToNode(nextNode.index, nextNode.title)}
              />
            ) : (
              <Text type="supporting" color="secondary" data-testid="reader-book-end">
                全书完
              </Text>
            )}
          </footer>
        </div>
      </article>
      <SelectionToolbar
        selection={selection}
        onAction={handleQuickAction}
        onHighlight={handleHighlight}
        onClose={reset}
      />
    </VStack>
  );
}
