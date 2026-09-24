'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { useReaderStore } from '@/store/readerStore';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useChatStore } from '@/store/chatStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useBookIndexStore } from '@/store/bookIndexStore';
import { useReaderSettingsStore } from '@/store/readerSettingsStore';
import { getOpenedBook } from '@/services/library/contentRegistry';
import { flushReadingPosition, recordReadingPosition } from '@/services/reader/readingPosition';
import { DEMO_BOOK, type DemoSection } from '@/services/reader/demoBook';
import ReaderPane from '@/components/reader/ReaderPane';
import FoliatePane from '@/components/reader/FoliatePane';
import ReaderDock from '@/components/reader/ReaderDock';
import ReaderProgressBar from '@/components/reader/ReaderProgressBar';
import ReaderShortcutsHint, {
  type ReaderTurnMode,
} from '@/components/reader/ReaderShortcutsHint';
import HeaderBar from '@/components/HeaderBar';
import AISidebar from '@/components/sidebar/AISidebar';
import Bookshelf from '@/components/library/Bookshelf';
import { initDesktopFileOpen } from '@/services/desktop/desktopBridge';

/** Book files accepted by drag-and-drop import. */
const IMPORT_PATTERN = /\.(epub|mobi|azw3?|prc|fb2|fbz|cbz|txt)$/i;

/**
 * Client shell for the split-screen reading workspace (ADR 0003):
 * HeaderBar (book title + library entry points + AI sidebar toggle) above the
 * reader/bookshelf pane and the collapsible, drag-resizable AI companion
 * sidebar (ADR 0003).
 *
 * Ticket 06: startup restores the last opened library book or lands on the
 * bookshelf (the demo fixtures only serve while nothing real is open), and
 * .epub/.txt files can be dragged anywhere onto the window to import.
 */
export default function Workspace() {
  const bookHash = useReaderStore((s) => s.bookHash);
  const spineIndex = useReaderStore((s) => s.spineIndex);
  const loadAISettings = useAISettingsStore((s) => s.load);
  const openChatBook = useChatStore((s) => s.openBook);

  const view = useLibraryStore((s) => s.view);
  const currentHash = useLibraryStore((s) => s.currentHash);
  // Ticket 07: an engine book renders through the Foliate pane; TXT / demo
  // books keep the scroll reader.
  const currentEngine = useLibraryStore((s) => (s.currentHash ? s.engines[s.currentHash] ?? null : null));
  const libraryBooks = useLibraryStore((s) => s.books);
  const initLibrary = useLibraryStore((s) => s.init);
  const importFiles = useLibraryStore((s) => s.importFiles);
  const segmentation = useSegmentationStore((s) => s.segmentation);
  /**
   * 快捷键提示里的动词跟着阅读模式走：双页引擎书是「翻页」，单页连续滚动与 TXT
   * 阅读器是「滚动」。Workspace 已经知道这两件事（谁来渲染视窗、页面模式是什么），
   * 提示本身因此不必去读 store。
   */
  const pageMode = useReaderSettingsStore((s) => s.layout.pageMode);
  const turnMode: ReaderTurnMode = currentEngine && pageMode === 'double' ? 'page' : 'scroll';

  const [dragOver, setDragOver] = useState(false);

  // Startup (ticket 06): restore the last opened book, or show the bookshelf.
  useEffect(() => {
    void initLibrary();
  }, [initLibrary]);

  // Desktop shell (ticket 07): books launched via OS file association are
  // forwarded by src-tauri and routed into the normal import flow.
  useEffect(() => {
    void initDesktopFileOpen();
  }, []);

  // Handle browser Back / Forward buttons via URL (?book=<hash>)
  useEffect(() => {
    const onPopState = () => {
      const book = new URLSearchParams(window.location.search).get('book');
      if (book) {
        const store = useLibraryStore.getState();
        if (store.currentHash !== book || store.view !== 'reader') {
          void store.open(book);
        }
      } else {
        const store = useLibraryStore.getState();
        if (store.view !== 'shelf') {
          store.closeToShelf();
        }
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Restore the AI provider settings persisted in IndexedDB (ticket 01).
  useEffect(() => {
    void loadAISettings();
  }, [loadAISettings]);

  // Bind the companion chat to the current book (ticket 04): resume the
  // latest open topic whenever the book or active position changes.
  useEffect(() => {
    if (!bookHash) return;
    void openChatBook(bookHash, spineIndex);
  }, [bookHash, spineIndex, openChatBook]);

  // Reading-agent pipeline (doc §4.1): on book open, segment the book and
  // register the node model. The AI phases (panorama → micro-briefs) are
  // **manually triggered** (ADR 0004's manual-trigger philosophy; see
  // `startIndexing`), so this call deliberately omits `autoRunAi`.
  // Keyed on bookHash ONLY — page turns must not restart the pipeline; they
  // just boost the freshly opened node to Priority 0 in the brief queue.
  const ensureBookIndexed = useBookIndexStore((s) => s.ensureIndexed);
  const setCurrentIndexedSpine = useBookIndexStore((s) => s.setCurrentSpine);
  useEffect(() => {
    if (!bookHash) return;
    void ensureBookIndexed(bookHash, { currentSpineIndex: spineIndex });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bookHash only; spineIndex is the initial boost seed
  }, [bookHash, ensureBookIndexed]);
  useEffect(() => {
    setCurrentIndexedSpine(spineIndex);
  }, [spineIndex, setCurrentIndexedSpine]);

  // Persist reading progress whenever the active section changes (ticket 06).
  // The Reading Position owner debounces writes and owns them end to end; all
  // this shell owes it is the flush when the window goes away, so the last page
  // turn of a session is never lost (the pane's old 1500 ms throttle could drop
  // it).
  useEffect(() => {
    const flush = () => {
      void flushReadingPosition();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      void flushReadingPosition();
    };
  }, []);

  // When a segmented book mounts, ReaderPane's segmentation wiring jumps to
  // the first virtual section (its demo-flow effect). Child effects run
  // before this parent effect, so re-applying the persisted position here
  // reliably lands the reader on the last read chapter.
  useEffect(() => {
    if (view !== 'reader' || !currentHash) return;
    if (!segmentation || segmentation.bookHash !== currentHash) return;
    const target = libraryBooks.find((book) => book.hash === currentHash)?.lastSpineIndex ?? 0;
    if (target <= 0) return;
    const section = segmentation.virtualSections[target];
    if (!section) return;
    const reader = useReaderStore.getState();
    if (reader.spineIndex !== target) {
      recordReadingPosition(
        { bookHash: currentHash, spineIndex: target },
        { titleFallback: section.title },
      );
    }
  }, [view, currentHash, segmentation, libraryBooks]);

  const opened = bookHash ? getOpenedBook(bookHash) : undefined;

  // Spine sections of the opened book. The `html` field is a lazy getter, so
  // building the array decompresses/sanitizes only the section currently
  // rendered — the DemoSection interface is satisfied structurally.
  const sections = useMemo<DemoSection[]>(() => {
    if (!opened) return DEMO_BOOK.sections;
    return Array.from({ length: opened.spineCount }, (_, i) => ({
      index: i,
      title: opened.getSpineTitle(i),
      get html() {
        return opened.getSpineHtml(i);
      },
    }));
  }, [opened]);
  const monolithicText = opened?.getMonolithicText();

  // Drag-and-drop import (tickets 06/07): engine formats and txt dropped
  // anywhere onto the window get imported.
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!dragOver) setDragOver(true);
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
      IMPORT_PATTERN.test(file.name),
    );
    if (files.length > 0) void importFiles(files);
  };

  return (
    <VStack
      height="100%"
      style={{ position: 'relative', overflow: 'hidden' }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <HeaderBar />
      <HStack gap={0} height="100%" style={{ minHeight: 0 }}>
        <StackItem size="fill" style={{ minHeight: 0, position: 'relative' }}>
          {view === 'shelf' ? (
            <Bookshelf />
          ) : (
            <>
              <VStack height="100%" gap={0} style={{ minHeight: 0 }}>
                {/* 阅读进度条在视窗**顶部**：一条 28px 的细条，阅读区为它让出这段
                    高度，所以它从不压在正文上。它在上面，快捷键提示在下面——两条
                    细条分居正文两侧，彼此之间不需要任何分割线。 */}
                <ReaderProgressBar />
                {currentEngine ? (
                  <FoliatePane engine={currentEngine} />
                ) : (
                  <ReaderPane sections={sections} monolithicText={monolithicText} />
                )}
                {/* 底边一行 28px 的快捷键提示：读者不必猜方向键 / Esc / Ctrl + /
                    是做什么的（dock 的底部偏移按这一行让开，见 globals.css）。 */}
                <ReaderShortcutsHint mode={turnMode} />
              </VStack>
              {/* Hover-revealed reading controls, floating above the hint line. */}
              <ReaderDock />
            </>
          )}
        </StackItem>
        <AISidebar />
      </HStack>
      {dragOver && (
        <DropImportHint>
          <Text weight="medium" color="accent">
            松开以导入书籍
          </Text>
        </DropImportHint>
      )}
    </VStack>
  );
}

/**
 * Drag-hover import hint. Absolutely positioned above the workspace so the
 * content below stays interactive-free while a drag is in progress.
 */
function DropImportHint({ children }: { children: React.ReactNode }) {
  return (
    <VStack
      data-testid="drop-import-overlay"
      vAlign="center"
      hAlign="center"
      style={{
        position: 'absolute',
        inset: 'var(--spacing-4)',
        zIndex: 50,
        borderRadius: 'var(--radius-container)',
        border: '2px dashed var(--color-accent)',
        background: 'var(--color-background-body)',
        pointerEvents: 'none',
      }}
    >
      {children}
    </VStack>
  );
}
