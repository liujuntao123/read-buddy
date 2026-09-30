'use client';

import { useEffect, useRef } from 'react';
import { BookMarked, ChevronLeft, History, Sparkles, Upload, Scan, Search } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { TopNav } from '@astryxdesign/core/TopNav';
import ThemeToggle from '@/components/ThemeToggle';
import { useReaderStore } from '@/store/readerStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useWorkspaceUI } from '@/store/workspaceUIStore';
import { useViewportWidth } from '@/hooks/useViewportWidth';

/**
 * Unified top navigation bar — identity + global actions only.
 * In Shelf mode: brand (non-interactive), shelf title + count, continue-reading, import.
 * In Reader mode: back-to-shelf, book title & chapter.
 * Reading-time controls (chapters, TOC, page mode, typography) live in the
 * hover-revealed ReaderDock at the reading pane's bottom-right corner.
 */
export default function HeaderBar() {
  const { isCompact } = useViewportWidth();
  const bookTitle = useReaderStore((s) => s.bookTitle);
  const nodeTitle = useReaderStore((s) => s.nodeTitle);
  const toggle = useAISidebarStore((s) => s.toggle);
  const sidebarExpanded = useAISidebarStore((s) => s.expanded);
  const closeToShelf = useLibraryStore((s) => s.closeToShelf);
  const resumeReading = useLibraryStore((s) => s.resumeReading);
  const importFiles = useLibraryStore((s) => s.importFiles);
  const importing = useLibraryStore((s) => s.importing);
  const view = useLibraryStore((s) => s.view);
  const currentHash = useLibraryStore((s) => s.currentHash);
  const books = useLibraryStore((s) => s.books);

  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Ctrl+/ toggles the companion sidebar. Chapter iframes are separate
    // documents — keydowns inside them never bubble to this window listener —
    // so FoliatePane repeats the binding on each live chapter document; focus
    // in the host fires here only, so the two never double-toggle.
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

  const isReading = view === 'reader';

  return (
    <TopNav
      data-testid="header-bar"
      label="应用主导航"
      heading={
        isReading ? (
          <Button
            label="返回书架"
            variant="ghost"
            size="sm"
            tooltip="返回书架"
            isIconOnly
            onClick={closeToShelf}
            icon={<ChevronLeft size={16} aria-hidden />}
          />
        ) : (
          /* Branding, not a control: the shelf's 继续阅读 action lives on the shelf
             itself now (Bookshelf's hero band), so this no longer pretends to be a
             button that does nothing — and it is out of the tab order. */
          <HStack gap={2} vAlign="center" data-testid="header-brand" style={{ flexShrink: 0 }}>
            <BookMarked size={18} aria-hidden style={{ color: 'var(--color-accent)' }} />
            {!isCompact && <Text weight="semibold" style={{ letterSpacing: '0.02em' }}>
              Read Buddy
            </Text>}
          </HStack>
        )
      }
      startContent={
        !isReading ? (
          <HStack gap={2} vAlign="center" style={{ flexShrink: 0, flexWrap: 'nowrap' }}>
            <Text weight="semibold">我的书架</Text>
            {!isCompact && books.length > 0 && <Token label={`${books.length} 本藏书`} size="sm" />}
          </HStack>
        ) : (
          <HStack gap={2} vAlign="center" style={{ minWidth: 0, flexWrap: 'nowrap' }}>
            <VStack style={{ minWidth: 0, maxWidth: isCompact ? '28vw' : 360 }}>
              <Text weight="semibold" maxLines={1}>
                {bookTitle || '未加载书籍'}
              </Text>
            </VStack>
            {!isCompact && nodeTitle && (
              <VStack style={{ minWidth: 0, maxWidth: 240 }}>
                <Text type="supporting" color="secondary" maxLines={1}>
                  · {nodeTitle}
                </Text>
              </VStack>
            )}
          </HStack>
        )
      }
      endContent={
        <HStack gap={1} vAlign="center" style={{ flexShrink: 0, flexWrap: 'nowrap' }}>
          <Button label="搜索与快捷操作" tooltip="搜索原文、藏书与功能（Ctrl / ⌘ + K）" variant="ghost" size="sm" isIconOnly icon={<Search size={16} />} onClick={() => useWorkspaceUI.getState().setCommandOpen(true)} />
          {isReading && <Button label="专注阅读" tooltip="专注阅读（Ctrl / ⌘ + Shift + F）" variant="ghost" size="sm" isIconOnly icon={<Scan size={16} />} onClick={() => useWorkspaceUI.getState().enterFocus()} />}
          {!isReading ? (
            <>
              {!isCompact && currentHash && (
                <Button
                  label="继续阅读"
                  tooltip="继续阅读上次打开的书"
                  variant="secondary"
                  size="sm"
                  isIconOnly
                  icon={<History size={16} aria-hidden />}
                  onClick={resumeReading}
                />
              )}
              <Button
                label={importing ? '导入中…' : '导入书籍'}
                variant="primary"
                size="sm"
                aria-label="导入书籍"
                isIconOnly
                isDisabled={importing}
                tooltip="导入书籍（也可直接拖入文件）"
                icon={<Upload size={16} aria-hidden />}
                onClick={() => fileRef.current?.click()}
              />
              <input
                ref={fileRef}
                data-testid="header-import-input"
                type="file"
                accept=".epub,.txt,.mobi,.azw,.azw3,.prc,.fb2,.fbz,.cbz"
                multiple
                hidden
                onChange={onImportChange}
              />
            </>
          ) : null}

          <Divider orientation="vertical" />
          <ThemeToggle compact={isCompact} />
          <Divider orientation="vertical" />
          <Button
            label="切换 AI 侧边栏"
            variant={sidebarExpanded ? 'secondary' : 'ghost'}
            size="sm"
            isIconOnly
            tooltip="AI 伴读侧边栏（Ctrl + /）"
            onClick={toggle}
            icon={<Sparkles size={16} aria-hidden />}
          />
        </HStack>
      }
    />
  );
}
