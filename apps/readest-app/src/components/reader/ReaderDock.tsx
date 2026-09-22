'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  List as ListIcon,
  Settings2,
  Square,
} from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { Popover } from '@astryxdesign/core/Popover';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/Stack';
import ReaderSettingsPanel from '@/components/settings/ReaderSettingsPanel';
import { useReaderStore } from '@/store/readerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { useReaderSettingsStore } from '@/store/readerSettingsStore';
import { useDismissOnWindowBlur } from '@/hooks/useDismissOnWindowBlur';
import {
  formatNavLabel,
  formatNodeCounts,
  formatNodeOrdinal,
  shapeOfNodes,
  stampDepths,
} from '@/services/bookNodes';
import type { EngineLocation, PageMode } from '@/services/library/foliateEngine';

/** One directory row before stamping: label + destination + declared depth. */
interface RawTocRow {
  label: string;
  href: string;
  depth: number;
}

/**
 * Floating reader dock: the reading-time controls (chapter prev/next, TOC,
 * page mode, reader settings) live in a vertical strip at the bottom-right
 * corner of the reading pane, revealed only when the pointer enters its
 * corner zone (CSS in globals.css: .reader-dock-zone / .reader-dock). The
 * header stays reserved for identity + global actions.
 *
 * `data-open` keeps the dock pinned while one of its popovers is open, so
 * the anchor never disappears under an open TOC / settings panel.
 */
export default function ReaderDock() {
  const spineCount = useReaderStore((s) => s.spineCount);
  const spineIndex = useReaderStore((s) => s.spineIndex);
  const currentEngine = useLibraryStore((s) =>
    s.currentHash ? s.engines[s.currentHash] ?? null : null,
  );
  const segmentation = useSegmentationStore((s) => s.segmentation);

  const pageMode = useReaderSettingsStore((s) => s.layout.pageMode);
  const setPageMode = useReaderSettingsStore((s) => s.setPageMode);

  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tocPos, setTocPos] = useState(-1);

  // Clicks inside the chapter iframes never reach the parent document, so
  // popover light dismiss alone cannot fire there — close on window blur.
  useDismissOnWindowBlur(
    isTocOpen || isSettingsOpen,
    () => {
      setIsTocOpen(false);
      setIsSettingsOpen(false);
    },
  );

  /** Flat rows in document order; `depth` is the level the row came from. */
  const allTocItems = useMemo<RawTocRow[]>(() => {
    if (currentEngine) {
      return currentEngine.tocItems().map((item) => ({
        label: item.label,
        href: item.href,
        depth: item.depth,
      }));
    }
    if (segmentation?.virtualSections?.length) {
      return segmentation.virtualSections.map((sec, i) => ({
        label: sec.title,
        href: String(i),
        depth: 0,
      }));
    }
    return [];
  }, [currentEngine, segmentation]);

  /**
   * Rows stamped with their real level: `max(声明层深, 标题补出的层深)`. A flat
   * NCX whose hierarchy lives only in the titles (《思考快与慢》: 第一部分 →
   * 第N章) therefore renders as two levels, while a genuinely single-level book
   * stays one level. 章/节 wording and counts come from the node model only.
   */
  const tocRows = useMemo(
    () =>
      stampDepths(
        allTocItems.map((item) => ({ title: item.label, href: item.href, depth: item.depth })),
      ),
    [allTocItems],
  );

  /** The book's shape as the directory shows it (counts + minimal 节点级). */
  const tocShape = useMemo(
    () => shapeOfNodes(tocRows.map(({ row, depth }) => ({ title: row.title, depth }))),
    [tocRows],
  );

  const tocSummary = `书籍目录 · ${formatNodeCounts(tocShape)}`;
  const prevLabel = formatNavLabel(tocShape.minimalKind, 'prev');
  const nextLabel = formatNavLabel(tocShape.minimalKind, 'next');

  useEffect(() => {
    if (!currentEngine) return;
    const updateTocPos = (loc: EngineLocation) => {
      if (currentEngine.getTocIndex) {
        const idx = currentEngine.getTocIndex(loc);
        if (idx >= 0) {
          setTocPos(idx);
          return;
        }
      }
      if (loc.tocItemHref) {
        const found = allTocItems.findIndex((it) => it.href === loc.tocItemHref);
        if (found >= 0) {
          setTocPos(found);
          return;
        }
      }
      setTocPos(loc.index);
    };
    const current = currentEngine.currentLocation();
    if (current) updateTocPos(current);
    return currentEngine.onRelocate(updateTocPos);
  }, [currentEngine, allTocItems]);

  const prevToc = tocPos > 0 ? allTocItems[tocPos - 1] : undefined;
  const nextToc = tocPos >= 0 && tocPos < allTocItems.length - 1 ? allTocItems[tocPos + 1] : undefined;

  const canGoPrev = Boolean(prevToc) || spineIndex > 0 || tocPos > 0;
  const canGoNext =
    Boolean(nextToc) ||
    spineIndex < spineCount - 1 ||
    (allTocItems.length > 0 && tocPos < allTocItems.length - 1);

  const goChapter = (target: string | number) => {
    if (currentEngine) {
      void currentEngine.goTo(target);
    } else {
      const idx = typeof target === 'number' ? target : parseInt(target, 10);
      if (!Number.isNaN(idx)) {
        const title =
          segmentation?.virtualSections?.[idx]?.title ??
          formatNodeOrdinal(tocShape.minimalKind, idx + 1);
        useReaderStore.getState().setPosition(idx, title);
      }
    }
  };

  const handlePrevChapter = () => {
    if (currentEngine?.prevChapter) {
      void currentEngine.prevChapter();
    } else if (prevToc) {
      goChapter(prevToc.href);
    } else if (spineIndex > 0) {
      goChapter(spineIndex - 1);
    }
  };

  const handleNextChapter = () => {
    if (currentEngine?.nextChapter) {
      void currentEngine.nextChapter();
    } else if (nextToc) {
      goChapter(nextToc.href);
    } else if (spineIndex < spineCount - 1) {
      goChapter(spineIndex + 1);
    }
  };

  /** Page mode only applies to paginated engine books (TXT keeps scrolling). */
  const togglePageMode = () => {
    const next: PageMode = pageMode === 'double' ? 'single' : 'double';
    setPageMode(next);
  };

  return (
    <VStack className="reader-dock-zone" data-testid="reader-dock-zone">
      <VStack
        className="reader-dock"
        data-testid="reader-dock"
        data-open={isTocOpen || isSettingsOpen ? 'true' : 'false'}
      >
        <IconButton
          label={prevLabel}
          tooltip={prevLabel}
          variant="secondary"
          isDisabled={!canGoPrev}
          onClick={handlePrevChapter}
          icon={<ChevronUp size={20} aria-hidden />}
        />
        <IconButton
          label={nextLabel}
          tooltip={nextLabel}
          variant="secondary"
          isDisabled={!canGoNext}
          onClick={handleNextChapter}
          icon={<ChevronDown size={20} aria-hidden />}
        />

        {tocRows.length > 0 && (
          <Popover
            isOpen={isTocOpen}
            onOpenChange={setIsTocOpen}
            placement="above"
            alignment="end"
            label="书籍目录"
            width={300}
            content={
              <VStack gap={1} style={{ maxHeight: 'min(480px, 70vh)', overflowY: 'auto' }}>
                <Text type="supporting" weight="semibold">
                  {tocSummary}
                </Text>
                <List density="compact" data-testid="reader-dock-toc-list" style={{ flexWrap: 'nowrap' }}>
                  {tocRows.map(({ row, depth }, i) => (
                    <ListItem
                      key={`${row.href}-${i}`}
                      data-depth={String(depth)}
                      label={depth > 0 ? <Text type="supporting">{row.title}</Text> : row.title}
                      isSelected={i === tocPos}
                      style={
                        depth > 0
                          ? { paddingInlineStart: `calc(var(--spacing-3) * ${depth})` }
                          : undefined
                      }
                      onClick={() => {
                        goChapter(row.href);
                        setIsTocOpen(false);
                      }}
                    />
                  ))}
                </List>
              </VStack>
            }
          >
            <IconButton
              label="目录"
              tooltip="书籍目录"
              variant="ghost"
              data-testid="reader-dock-toc-button"
              icon={<ListIcon size={20} aria-hidden />}
            />
          </Popover>
        )}

        {currentEngine && (
          <IconButton
            label={pageMode === 'double' ? '切换为单页' : '切换为双页'}
            tooltip={pageMode === 'double' ? '双页 · 点击切至单页' : '单页 · 点击切至双页'}
            variant="ghost"
            data-testid="page-mode-toggle"
            onClick={togglePageMode}
            icon={pageMode === 'double' ? <Columns2 size={20} aria-hidden /> : <Square size={20} aria-hidden />}
          />
        )}

        <Popover
          isOpen={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          placement="above"
          alignment="end"
          label="阅读设置"
          width={320}
          content={<ReaderSettingsPanel />}
        >
          <IconButton
            label="阅读设置"
            tooltip="字号 / 字体 / 间距 设置"
            variant="ghost"
            data-testid="reader-settings-button"
            icon={<Settings2 size={20} aria-hidden />}
          />
        </Popover>
      </VStack>
    </VStack>
  );
}
