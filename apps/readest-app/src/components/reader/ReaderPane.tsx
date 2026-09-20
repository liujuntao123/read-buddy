'use client';

import { useEffect, useRef, useState } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useChatStore } from '@/store/chatStore';
import { DEMO_BOOK, DEMO_MONOLITHIC_TXT, type DemoSection } from '@/services/reader/demoBook';
import { buildQuickActionPrompt, type QuickAction } from '@/services/chat/quickActions';
import SegmentationBanner from './SegmentationBanner';
import SelectionToolbar from './SelectionToolbar';
import { readTextSelection, useTextSelection } from '@/hooks/useTextSelection';

/** Demo hash for the monolithic no-TOC TXT fixture (design doc 4.2 flow). */
const DEMO_MONOLITHIC_HASH = 'demo-monolithic';

/**
 * Placeholder reading viewport. Renders demo-book sections as selectable
 * text so tickets 02/05 can exercise extraction and selection features
 * before Foliate is wired in. When a segmentation exists for the active
 * book, navigation switches to the Virtual Section list and the article
 * is sliced from the monolithic text by charOffset (ticket 02 "映射进阅读进度").
 */
export default function ReaderPane({ sections }: { sections: DemoSection[] }) {
  const bookHash = useReaderStore((s) => s.bookHash);
  const sectionIndex = useReaderStore((s) => s.sectionIndex);
  const setSection = useReaderStore((s) => s.setSection);
  const loadBook = useReaderStore((s) => s.loadBook);
  const segmentation = useSegmentationStore((s) => s.segmentation);
  const scanAndPrompt = useSegmentationStore((s) => s.scanAndPrompt);
  const [toast, setToast] = useState<string | null>(null);
  const lastToastKey = useRef<string | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const { selection, close, reset } = useTextSelection(articleRef);

  // Virtual-section mode: the segmentation belongs to the book being read.
  const virtualSections =
    segmentation && segmentation.bookHash === bookHash ? segmentation.virtualSections : [];
  const isVirtual = virtualSections.length > 0;
  const currentVirtual = isVirtual ? (virtualSections[sectionIndex] ?? null) : null;
  const section = !isVirtual ? sections[sectionIndex] : undefined;
  const totalSections = isVirtual ? virtualSections.length : sections.length;

  const virtualText = currentVirtual
    ? DEMO_MONOLITHIC_TXT.slice(
        currentVirtual.charOffset,
        virtualSections[sectionIndex + 1]?.charOffset ?? DEMO_MONOLITHIC_TXT.length,
      )
    : '';

  /**
   * Selection AI quick action (design doc 4.4.3, ADR 0007): always expand the
   * sidebar onto the chat tab; `ask` only fills the quote draft (the user
   * types the question), the others send a preset prompt with the selection
   * quoted in the bubble.
   */
  const handleQuickAction = (action: QuickAction, text: string) => {
    const sidebar = useAISidebarStore.getState();
    if (!sidebar.expanded) sidebar.setExpanded(true);
    sidebar.setActiveTab('chat');

    if (action === 'ask') {
      useChatStore.getState().setQuoteDraft(text);
      // Progressive enhancement: ChatTab also focuses its composer when the
      // quote draft arrives (it may not be mounted yet at this instant).
      window.dispatchEvent(new CustomEvent('readest-plus:focus-chat-input'));
    } else {
      void useChatStore.getState().send(buildQuickActionPrompt(action, text).prompt, text);
    }
    // No residue: dismiss the toolbar and the native highlight together.
    reset();
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

  // Dev-demo feedback + reading-progress mapping: once the user answers the
  // segmentation banner (or the fallback applies directly), switch the reader
  // onto the generated Virtual Sections (design doc 4.2).
  useEffect(() => {
    if (!segmentation || segmentation.virtualSections.length === 0) return;
    const key = `${segmentation.bookHash}:${segmentation.strategy}:${segmentation.virtualSections.length}`;
    if (lastToastKey.current === key) return;
    lastToastKey.current = key;
    setToast(`已生成 ${segmentation.virtualSections.length} 个虚拟章节`);
    const timer = window.setTimeout(() => setToast(null), 5_000);

    const first = segmentation.virtualSections[0]!;
    loadBook({
      bookHash: segmentation.bookHash,
      bookTitle: segmentation.bookHash === DEMO_MONOLITHIC_HASH ? '风起之地（无目录 TXT）' : segmentation.bookHash,
      sectionCount: segmentation.virtualSections.length,
    });
    setSection(0, first.title);
    return () => window.clearTimeout(timer);
  }, [segmentation, loadBook, setSection]);

  const go = (delta: number) => {
    const nextIndex = sectionIndex + delta;
    if (nextIndex < 0 || nextIndex >= totalSections) return;
    if (isVirtual) setSection(nextIndex, virtualSections[nextIndex]!.title);
    else {
      const next = sections[nextIndex];
      if (next) setSection(next.index, next.title);
    }
  };

  const backToDemoBook = () => {
    loadBook({
      bookHash: DEMO_BOOK.bookHash,
      bookTitle: DEMO_BOOK.title,
      sectionCount: DEMO_BOOK.sections.length,
    });
    setSection(DEMO_BOOK.sections[0].index, DEMO_BOOK.sections[0].title);
  };

  if (isVirtual ? !currentVirtual : !section) {
    return <div className="flex-1 overflow-auto p-8 text-base-content/60">暂无内容</div>;
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="阅读视窗" data-testid="reader-pane">
      <SegmentationBanner />
      {toast && (
        <div
          role="status"
          data-testid="segmentation-toast"
          className="alert alert-success mx-4 mt-2 py-2 text-sm"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}
      <div className="flex items-center justify-between border-b border-base-300 bg-base-100 px-4 py-2">
        <span className="truncate text-sm font-medium text-base-content/80" data-testid="reader-chapter-title">
          {isVirtual ? currentVirtual!.title : section!.title}
        </span>
        <div className="flex gap-2">
          {isVirtual ? (
            <button
              type="button"
              className="btn btn-xs btn-outline"
              title="开发演示：返回结构化演示书"
              onClick={backToDemoBook}
            >
              返回演示书
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-xs btn-outline"
              title="开发演示：以无目录 TXT 触发章节探测流程"
              onClick={() => void scanAndPrompt(DEMO_MONOLITHIC_HASH, DEMO_MONOLITHIC_TXT)}
            >
              加载无目录 TXT
            </button>
          )}
          <button
            type="button"
            className="btn btn-xs"
            disabled={sectionIndex === 0}
            onClick={() => go(-1)}
          >
            上一章
          </button>
          <button
            type="button"
            className="btn btn-xs"
            disabled={sectionIndex === totalSections - 1}
            onClick={() => go(1)}
          >
            下一章
          </button>
        </div>
      </div>
      {isVirtual ? (
        <article
          ref={articleRef}
          data-testid="reader-article"
          className="flex-1 overflow-auto px-6 py-6 leading-loose text-base-content"
          onPointerDown={handleArticlePointerDown}
        >
          {virtualText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line, i) => (
              <p key={i}>{line}</p>
            ))}
        </article>
      ) : (
        <article
          ref={articleRef}
          data-testid="reader-article"
          className="flex-1 overflow-auto px-6 py-6 leading-loose text-base-content"
          onPointerDown={handleArticlePointerDown}
          // Static fixture content owned by this app (demoBook.ts), not user input.
          dangerouslySetInnerHTML={{ __html: section!.html }}
        />
      )}
      <SelectionToolbar selection={selection} onAction={handleQuickAction} onClose={reset} />
    </section>
  );
}
