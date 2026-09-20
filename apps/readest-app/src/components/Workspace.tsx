'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useChatStore } from '@/store/chatStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { useLibraryStore } from '@/store/libraryStore';
import { getOpenedBook } from '@/services/library/contentRegistry';
import { DEMO_BOOK, type DemoSection } from '@/services/reader/demoBook';
import ReaderPane from '@/components/reader/ReaderPane';
import HeaderBar from '@/components/HeaderBar';
import AISidebar from '@/components/sidebar/AISidebar';
import Bookshelf from '@/components/library/Bookshelf';

/**
 * Client shell for the split-screen reading workspace (design doc 3):
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
  const sectionIndex = useReaderStore((s) => s.sectionIndex);
  const loadAISettings = useAISettingsStore((s) => s.load);
  const openChatBook = useChatStore((s) => s.openBook);

  const view = useLibraryStore((s) => s.view);
  const currentHash = useLibraryStore((s) => s.currentHash);
  const libraryBooks = useLibraryStore((s) => s.books);
  const initLibrary = useLibraryStore((s) => s.init);
  const importFiles = useLibraryStore((s) => s.importFiles);
  const saveLibraryProgress = useLibraryStore((s) => s.saveProgress);
  const segmentation = useSegmentationStore((s) => s.segmentation);

  const [dragOver, setDragOver] = useState(false);

  // Startup (ticket 06): restore the last opened book, or show the bookshelf.
  useEffect(() => {
    void initLibrary();
  }, [initLibrary]);

  // Restore the AI provider settings persisted in IndexedDB (ticket 01).
  useEffect(() => {
    void loadAISettings();
  }, [loadAISettings]);

  // Bind the companion chat to the current book (ticket 04): resume the
  // latest open topic whenever the book or active section changes.
  useEffect(() => {
    if (!bookHash) return;
    void openChatBook(bookHash, sectionIndex);
  }, [bookHash, sectionIndex, openChatBook]);

  // Persist reading progress whenever the active section changes (ticket 06).
  useEffect(() => {
    if (view !== 'reader' || !currentHash) return;
    void saveLibraryProgress();
  }, [sectionIndex, view, currentHash, saveLibraryProgress]);

  // When a segmented book mounts, ReaderPane's segmentation wiring jumps to
  // the first virtual section (its demo-flow effect). Child effects run
  // before this parent effect, so re-applying the persisted position here
  // reliably lands the reader on the last read chapter.
  useEffect(() => {
    if (view !== 'reader' || !currentHash) return;
    if (!segmentation || segmentation.bookHash !== currentHash) return;
    const target = libraryBooks.find((book) => book.hash === currentHash)?.lastSectionIndex ?? 0;
    if (target <= 0) return;
    const section = segmentation.virtualSections[target];
    if (!section) return;
    const reader = useReaderStore.getState();
    if (reader.sectionIndex !== target) reader.setSection(target, section.title);
  }, [view, currentHash, segmentation, libraryBooks]);

  const opened = bookHash ? getOpenedBook(bookHash) : undefined;

  // Spine sections of the opened book. The `html` field is a lazy getter, so
  // building the array decompresses/sanitizes only the section currently
  // rendered — the DemoSection interface is satisfied structurally.
  const sections = useMemo<DemoSection[]>(() => {
    if (!opened) return DEMO_BOOK.sections;
    return Array.from({ length: opened.sectionCount }, (_, i) => ({
      index: i,
      title: opened.getSectionTitle(i),
      get html() {
        return opened.getSectionHtml(i);
      },
    }));
  }, [opened]);
  const monolithicText = opened?.getMonolithicText?.();

  // Drag-and-drop import (ticket 06): .epub/.txt dropped anywhere imports.
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
      /\.(epub|txt)$/i.test(file.name),
    );
    if (files.length > 0) void importFiles(files);
  };

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-base-200"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <HeaderBar />
      <main className="relative flex min-h-0 flex-1">
        {view === 'shelf' ? (
          <Bookshelf />
        ) : (
          <ReaderPane sections={sections} monolithicText={monolithicText} />
        )}
        <AISidebar />
        {dragOver && (
          <div
            data-testid="drop-import-overlay"
            className="pointer-events-none absolute inset-4 z-50 flex items-center justify-center rounded-lg border-4 border-dashed border-primary bg-base-200/80 text-lg font-medium text-primary"
          >
            松开以导入书籍（.epub / .txt）
          </div>
        )}
      </main>
    </div>
  );
}
