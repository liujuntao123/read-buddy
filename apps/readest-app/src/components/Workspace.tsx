'use client';

import { useEffect } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { DEMO_BOOK } from '@/services/reader/demoBook';
import ReaderPane from '@/components/reader/ReaderPane';
import AISidebarPlaceholder from '@/components/sidebar/AISidebarPlaceholder';

/**
 * Client shell for the split-screen reading workspace.
 * Ticket 01 replaces the placeholder sidebar with the real AISidebar
 * container (toggle + resize handle + tabs) and adds the header toggle.
 */
export default function Workspace() {
  const loadBook = useReaderStore((s) => s.loadBook);
  const setSection = useReaderStore((s) => s.setSection);

  useEffect(() => {
    loadBook({
      bookHash: DEMO_BOOK.bookHash,
      bookTitle: DEMO_BOOK.title,
      sectionCount: DEMO_BOOK.sections.length,
    });
    setSection(DEMO_BOOK.sections[0].index, DEMO_BOOK.sections[0].title);
  }, [loadBook, setSection]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-base-200">
      <main className="flex min-h-0 flex-1">
        <ReaderPane sections={DEMO_BOOK.sections} />
        <AISidebarPlaceholder />
      </main>
    </div>
  );
}
