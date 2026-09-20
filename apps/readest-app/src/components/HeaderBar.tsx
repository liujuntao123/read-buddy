'use client';

import { useEffect, useRef } from 'react';
import { Library, Sparkles, Upload } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { useReaderStore } from '@/store/readerStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useLibraryStore } from '@/store/libraryStore';

/**
 * Top navigation bar (design doc 3): book title plus the AI sidebar toggle.
 * Owns the global Cmd+/ (macOS) / Ctrl+/ (Windows) shortcut. Ticket 06 adds
 * the 书库 (back-to-shelf) and 导入书籍 entry points; the hidden file input
 * routes picked files through the shared library store.
 */
export default function HeaderBar() {
  const bookTitle = useReaderStore((s) => s.bookTitle);
  const sectionCount = useReaderStore((s) => s.sectionCount);
  const toggle = useAISidebarStore((s) => s.toggle);
  const closeToShelf = useLibraryStore((s) => s.closeToShelf);
  const importFiles = useLibraryStore((s) => s.importFiles);
  const importing = useLibraryStore((s) => s.importing);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === '/') {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  const onImportChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ''; // allow picking the same file again later
    if (files.length > 0) void importFiles(files);
  };

  return (
    <header
      data-testid="header-bar"
      className="flex shrink-0 items-center justify-between gap-4 border-b border-base-300 bg-base-100 px-4 py-2"
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate text-sm font-semibold text-base-content">
          {bookTitle || '未加载书籍'}
        </h1>
        {sectionCount > 0 && (
          <span className="shrink-0 text-xs text-base-content/50">{sectionCount} 章</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-1"
          aria-label="打开书架"
          onClick={closeToShelf}
        >
          <Library className="size-4" aria-hidden="true" />
          书库
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-1"
          aria-label="导入书籍"
          disabled={importing}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="size-4" aria-hidden="true" />
          {importing ? '导入中…' : '导入书籍'}
        </button>
        <input
          ref={fileRef}
          data-testid="header-import-input"
          type="file"
          accept=".epub,.txt"
          multiple
          className="hidden"
          onChange={onImportChange}
        />
        <ThemeToggle />
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-1"
          aria-label="切换 AI 侧边栏"
          onClick={toggle}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          AI 侧栏
        </button>
      </div>
    </header>
  );
}
