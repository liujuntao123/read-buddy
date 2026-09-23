'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns2,
  List as ListIcon,
  RectangleVertical,
  Settings2,
} from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { Popover } from '@astryxdesign/core/Popover';
import { Text } from '@astryxdesign/core/Text';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import ReaderSettingsPanel from '@/components/settings/ReaderSettingsPanel';
import { useReaderStore } from '@/store/readerStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { useReaderSettingsStore } from '@/store/readerSettingsStore';
import { useDismissOnWindowBlur } from '@/hooks/useDismissOnWindowBlur';
import { recordReadingPosition } from '@/services/reader/readingPosition';
import {
  createChapterNavigator,
  resolveCurrentEntryIndex,
  type NavEntry,
} from '@/services/reader/chapterNavigation';
import { getAgentBookContext } from '@/services/agent/agentContext';
import type { NodeKind } from '@/types/readingAgent';
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
  /** Physical section this row starts at, when the source knows it. */
  spineIndex?: number;
}

/**
 * 打开书籍时 dock 自己现身的长短（毫秒）。够读者看清「这里有几个按钮」，
 * 又短到不影响阅读——它只是**指路**，不是常驻控件。
 */
export const DOCK_PEEK_MS = 2_500;

/**
 * Floating reader dock: the reading-time controls (chapter prev/next, TOC,
 * page mode, reader settings) live in a vertical strip at the bottom-right
 * corner of the reading pane, revealed only when the pointer enters its
 * corner zone (CSS in globals.css: .reader-dock-zone / .reader-dock). The
 * header stays reserved for identity + global actions.
 *
 * `data-open` keeps the dock pinned while one of its popovers is open, so
 * the anchor never disappears under an open TOC / settings panel; `data-peek`
 * shows it once when a book is opened (see `DOCK_PEEK_MS`).
 */
export default function ReaderDock() {
  const spineCount = useReaderStore((s) => s.spineCount);
  const spineIndex = useReaderStore((s) => s.spineIndex);
  const bookHash = useReaderStore((s) => s.bookHash);
  const currentEngine = useLibraryStore((s) =>
    s.currentHash ? s.engines[s.currentHash] ?? null : null,
  );
  const segmentation = useSegmentationStore((s) => s.segmentation);

  const pageMode = useReaderSettingsStore((s) => s.layout.pageMode);
  const setPageMode = useReaderSettingsStore((s) => s.setPageMode);

  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [tocPos, setTocPos] = useState(-1);
  /**
   * 开书时的「现身」：目录、翻章、排版都住在这个角落，可它们只在鼠标移入时
   * 出现——第一次打开一本书的读者根本不知道它们在哪。于是开书（bookHash 变化）
   * 让 dock 亮出来一次，然后自己隐回去（CSS 与 `data-open` 共用一条显示规则）。
   */
  const [isPeeking, setIsPeeking] = useState(false);

  useEffect(() => {
    if (!bookHash) return;
    setIsPeeking(true);
    const timer = window.setTimeout(() => setIsPeeking(false), DOCK_PEEK_MS);
    return () => window.clearTimeout(timer);
  }, [bookHash]);

  // Clicks inside the chapter iframes never reach the parent document, so
  // popover light dismiss alone cannot fire there — close on window blur.
  useDismissOnWindowBlur(
    isTocOpen || isSettingsOpen,
    () => {
      setIsTocOpen(false);
      setIsSettingsOpen(false);
    },
  );

  /**
   * The directory rows.
   *
   * The **node model is the authority** (候选 6): when the book is indexed the
   * popover renders the model's own rows, so 「N 章 · M 节」 cannot disagree with
   * the companion index. Only until the index lands does it fall back to the
   * engine's flat directory — and in that window it publishes **no counts**,
   * because the dock used to count directory *rows* while the model counts
   * *nodes* (ADR 0010 ¶31 collapses same-anchor duplicates), so the same book
   * could show two different shapes.
   */
  const modelRows = useMemo<RawTocRow[] | null>(() => {
    const context = bookHash ? getAgentBookContext(bookHash) : undefined;
    if (!context || context.nodes.length === 0) return null;
    return context.nodes.map((node) => ({
      label: node.title,
      href: node.href ?? String(node.spineIndex ?? node.nodeIndex),
      depth: node.depth,
      ...(node.spineIndex !== undefined ? { spineIndex: node.spineIndex } : {}),
    }));
  }, [bookHash]);

  /** Flat rows in document order; `depth` is the level the row came from. */
  const allTocItems = useMemo<RawTocRow[]>(() => {
    if (modelRows) return modelRows;
    if (currentEngine) {
      // The engine's `tocEntries` carry the section each row resolved onto, which
      // is what the navigation rule compares — `tocItems` does not.
      return currentEngine.tocEntries().map((entry) => ({
        label: entry.label,
        href: entry.href ?? String(entry.spineIndex),
        depth: entry.depth,
        ...(entry.spineIndex >= 0 ? { spineIndex: entry.spineIndex } : {}),
      }));
    }
    if (segmentation?.virtualSections?.length) {
      return segmentation.virtualSections.map((sec, i) => ({
        label: sec.title,
        href: String(i),
        depth: 0,
        spineIndex: i,
      }));
    }
    return [];
  }, [modelRows, currentEngine, segmentation]);

  /**
   * The rows the navigation rule walks — the same rows the popover renders, so the
   * list a reader clicks and the steps the buttons take cannot describe different
   * books (候选 7).
   */
  const navEntries = useMemo<NavEntry[]>(
    () =>
      allTocItems.map((item) => ({
        title: item.label,
        target: item.href,
        ...(item.spineIndex !== undefined ? { spineIndex: item.spineIndex } : {}),
      })),
    [allTocItems],
  );

  /**
   * Rows stamped with their real level: `max(声明层深, 标题补出的层深)`. A flat
   * NCX whose hierarchy lives only in the titles (《思考快与慢》: 第一部分 →
   * 第N章) therefore renders as two levels, while a genuinely single-level book
   * stays one level. The model's rows already carry their level, so stamping is a
   * no-op for them — and the fallback uses the same rule the model does, so the
   * indent and the nav words can be less informed but never contradictory.
   */
  const tocRows = useMemo(
    () =>
      stampDepths(
        allTocItems.map((item) => ({ title: item.label, href: item.href, depth: item.depth })),
      ),
    [allTocItems],
  );

  /** The book's shape — only the node model may answer this. */
  const modelShape = useMemo(() => {
    const context = bookHash ? getAgentBookContext(bookHash) : undefined;
    return context && context.nodes.length > 0 ? shapeOfNodes(context.nodes) : null;
  }, [bookHash]);

  const tocSummary = modelShape
    ? `书籍目录 · ${formatNodeCounts(modelShape)}`
    : '书籍目录';
  /** Nav wording: the model's level when known, else the fallback rows' own. */
  const navKind: NodeKind = modelShape?.minimalKind
    ?? (tocRows.some(({ depth }) => depth > 0) ? 'section' : 'chapter');
  const prevLabel = formatNavLabel(navKind, 'prev');
  const nextLabel = formatNavLabel(navKind, 'next');

  // Track which parent chapters are collapsed (keyed by original row index)
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(new Set());

  // Map each row index to its parent chapter index, and determine which chapters have children
  const { rowParentMap, chaptersWithChildren } = useMemo(() => {
    const parentMap: number[] = [];
    const withChildren = new Set<number>();
    let currentParent = -1;

    tocRows.forEach(({ depth }, idx) => {
      if (depth === 0) {
        currentParent = idx;
        parentMap[idx] = idx;
      } else {
        parentMap[idx] = currentParent;
        if (currentParent >= 0) {
          withChildren.add(currentParent);
        }
      }
    });

    return { rowParentMap: parentMap, chaptersWithChildren: withChildren };
  }, [tocRows]);

  const toggleChapter = (chapterIdx: number) => {
    setCollapsedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chapterIdx)) {
        next.delete(chapterIdx);
      } else {
        next.add(chapterIdx);
      }
      return next;
    });
  };

  const hasAnyChildren = chaptersWithChildren.size > 0;
  const allCollapsed = hasAnyChildren && chaptersWithChildren.size === collapsedChapters.size;

  const toggleAllChapters = () => {
    if (allCollapsed) {
      setCollapsedChapters(new Set());
    } else {
      setCollapsedChapters(new Set(chaptersWithChildren));
    }
  };

  // Filter visible rows based on collapsed state:
  // An item with depth > 0 is hidden if its parent chapter is collapsed.
  const visibleTocRows = useMemo(() => {
    return tocRows
      .map((item, originalIndex) => ({ ...item, originalIndex }))
      .filter(({ depth, originalIndex }) => {
        if (depth === 0) return true;
        const parent = rowParentMap[originalIndex];
        return parent !== undefined && !collapsedChapters.has(parent);
      });
  }, [tocRows, rowParentMap, collapsedChapters]);

  useEffect(() => {
    if (!currentEngine) return;
    const updateTocPos = (loc: EngineLocation) => {
      setTocPos(
        resolveCurrentEntryIndex(navEntries, {
          spineIndex: loc.index,
          ...(loc.tocItemHref ? { href: loc.tocItemHref } : {}),
        }),
      );
    };
    const current = currentEngine.currentLocation();
    if (current) updateTocPos(current);
    return currentEngine.onRelocate(updateTocPos);
  }, [currentEngine, navEntries]);

  /** Jump to a directory href (engine) or a virtual-section ordinal (TXT). */
  const goChapter = (target: string | number) => {
    if (currentEngine) {
      void currentEngine.goTo(target);
    } else {
      const idx = typeof target === 'number' ? target : parseInt(target, 10);
      if (!Number.isNaN(idx)) {
        const title =
          segmentation?.virtualSections?.[idx]?.title ?? formatNodeOrdinal(navKind, idx + 1);
        recordReadingPosition(
          { bookHash: useReaderStore.getState().bookHash, spineIndex: idx },
          { titleFallback: title },
        );
      }
    }
  };

  /**
   * Chapter stepping: **one** navigator, built from whichever adapter applies
   * (候选 7). The disabled state (`canStep`) and the click (`step`) are answered by
   * the same function, so a button can no longer be enabled by one rule and do
   * nothing under another.
   */
  const navigator = useMemo(
    () =>
      createChapterNavigator({
        entries: navEntries,
        totalSections: currentEngine ? currentEngine.spineCount : spineCount,
        current: {
          spineIndex: currentEngine?.currentLocation()?.index ?? spineIndex,
          ...(currentEngine?.currentLocation()?.tocItemHref
            ? { href: currentEngine.currentLocation()!.tocItemHref! }
            : {}),
        },
        goTo: goChapter,
      }),
    // `goChapter` is recreated per render by design: the navigator only reads it
    // when a step is actually taken.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navEntries, currentEngine, spineIndex, spineCount, tocPos, segmentation],
  );

  const canGoPrev = navigator.canStep('prev');
  const canGoNext = navigator.canStep('next');

  const handlePrevChapter = () => {
    void navigator.step('prev');
  };

  const handleNextChapter = () => {
    void navigator.step('next');
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
        data-peek={isPeeking ? 'true' : 'false'}
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
                <HStack justify="between" vAlign="center" style={{ paddingBottom: 'var(--spacing-1)' }}>
                  <Text type="supporting" weight="semibold">
                    {tocSummary}
                  </Text>
                  {hasAnyChildren && (
                    <Button
                      label={allCollapsed ? '全部展开' : '全部折叠'}
                      variant="ghost"
                      size="sm"
                      data-testid="toggle-all-chapters"
                      onClick={toggleAllChapters}
                    />
                  )}
                </HStack>
                <List density="compact" data-testid="reader-dock-toc-list" style={{ flexWrap: 'nowrap' }}>
                  {visibleTocRows.map(({ row, depth, originalIndex }) => {
                    const hasChildren = chaptersWithChildren.has(originalIndex);
                    const isCollapsed = collapsedChapters.has(originalIndex);
                    return (
                      <ListItem
                        key={`${row.href}-${originalIndex}`}
                        data-depth={String(depth)}
                        label={depth > 0 ? <Text type="supporting">{row.title}</Text> : row.title}
                        isSelected={originalIndex === tocPos}
                        style={
                          depth > 0
                            ? { paddingInlineStart: `calc(var(--spacing-3) * ${depth})` }
                            : undefined
                        }
                        endContent={
                          depth === 0 && hasChildren ? (
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label={isCollapsed ? '展开小节' : '折叠小节'}
                              data-testid={`chapter-fold-toggle-${originalIndex}`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 'var(--spacing-1)',
                                cursor: 'pointer',
                                color: 'var(--color-text-secondary)',
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleChapter(originalIndex);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  toggleChapter(originalIndex);
                                }
                              }}
                            >
                              {isCollapsed ? (
                                <ChevronRight size={14} aria-hidden />
                              ) : (
                                <ChevronDown size={14} aria-hidden />
                              )}
                            </span>
                          ) : undefined
                        }
                        onClick={() => {
                          goChapter(row.href);
                          setIsTocOpen(false);
                        }}
                      />
                    );
                  })}
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
            tooltip={pageMode === 'double' ? '切换为单页' : '切换为双页'}
            variant="ghost"
            data-testid="page-mode-toggle"
            onClick={togglePageMode}
            icon={pageMode === 'double' ? <Columns2 size={20} aria-hidden /> : <RectangleVertical size={20} aria-hidden />}
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
            tooltip="阅读设置"
            variant="ghost"
            data-testid="reader-settings-button"
            icon={<Settings2 size={20} aria-hidden />}
          />
        </Popover>
      </VStack>
    </VStack>
  );
}
