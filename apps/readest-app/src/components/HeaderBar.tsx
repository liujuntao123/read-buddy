'use client';

import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useReaderStore } from '@/store/readerStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';

/**
 * Top navigation bar (design doc 3): book title plus the AI sidebar toggle.
 * Owns the global Cmd+/ (macOS) / Ctrl+/ (Windows) shortcut.
 */
export default function HeaderBar() {
  const bookTitle = useReaderStore((s) => s.bookTitle);
  const sectionCount = useReaderStore((s) => s.sectionCount);
  const toggle = useAISidebarStore((s) => s.toggle);

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
      <button
        type="button"
        className="btn btn-ghost btn-sm gap-1"
        aria-label="切换 AI 侧边栏"
        onClick={toggle}
      >
        <Sparkles className="size-4" aria-hidden="true" />
        AI 侧栏
      </button>
    </header>
  );
}
