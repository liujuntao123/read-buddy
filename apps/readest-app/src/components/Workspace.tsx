'use client';

import { useEffect } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { DEMO_BOOK } from '@/services/reader/demoBook';
import ReaderPane from '@/components/reader/ReaderPane';
import HeaderBar from '@/components/HeaderBar';
import AISidebar from '@/components/sidebar/AISidebar';

/**
 * Client shell for the split-screen reading workspace (design doc 3):
 * HeaderBar (book title + AI sidebar toggle/shortcut) above the reader pane
 * and the collapsible, drag-resizable AI companion sidebar (ADR 0003).
 */
export default function Workspace() {
  const loadBook = useReaderStore((s) => s.loadBook);
  const setSection = useReaderStore((s) => s.setSection);
  const loadAISettings = useAISettingsStore((s) => s.load);

  useEffect(() => {
    loadBook({
      bookHash: DEMO_BOOK.bookHash,
      bookTitle: DEMO_BOOK.title,
      sectionCount: DEMO_BOOK.sections.length,
    });
    setSection(DEMO_BOOK.sections[0].index, DEMO_BOOK.sections[0].title);
  }, [loadBook, setSection]);

  // Restore the AI provider settings persisted in IndexedDB (ticket 01).
  useEffect(() => {
    void loadAISettings();
  }, [loadAISettings]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-base-200">
      <HeaderBar />
      <main className="flex min-h-0 flex-1">
        <ReaderPane sections={DEMO_BOOK.sections} />
        <AISidebar />
      </main>
    </div>
  );
}
