'use client';

import { useEffect, useRef, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Spinner } from '@astryxdesign/core/Spinner';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { useReaderStore } from '@/store/readerStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { EngineLocation, FoliateEngineHandle } from '@/services/library/foliateEngine';
import { tocAnchorOf } from '@/services/library/foliateEngine';
import { getAgentBookContext } from '@/services/agent/agentContext';
import { subscribeLocate, type LocateRequest } from '@/services/reader/readerLink';
import { recordReadingPosition } from '@/services/reader/readingPosition';
import { highlightSnippet } from '@/services/reader/highlight';
import { useReadingTheme } from '@/theme/readingTheme';
import {
  typographyCss,
  toEngineLayout,
  useReaderSettingsStore,
} from '@/store/readerSettingsStore';
import { useQuickActions } from '@/hooks/useQuickActions';
import { useIframeSelection, type IframeSelectionReader } from '@/hooks/useIframeSelection';
import { useReaderHighlights } from '@/hooks/useReaderHighlights';
import SelectionToolbar from './SelectionToolbar';

/** Relocate-driven position records are debounced inside the position owner. */

/**
 * 目录 href 的段内锚点（`"ch1.xhtml#sigil_toc_id_1"` → `"sigil_toc_id_1"`）。
 * 复用引擎的 `tocAnchorOf`：这里曾经有一份写法不同的私有副本，同一件事两个答案。
 */
const anchorOfHref = (href: string | undefined): string | undefined =>
  href ? tocAnchorOf(href) : undefined;

export interface FoliatePaneProps {
  /** Engine of the opened book (store-owned lifecycle; null renders a hint). */
  engine: FoliateEngineHandle | null;
  /**
   * Injectable selection reader for tests: happy-dom cannot run real iframe
   * selections, so tests feed {text, rect} directly (see ticket 07 spec 5).
   */
  readSelection?: IframeSelectionReader;
}

/**
 * Paginated reader viewport for engine books (ticket 07): mounts the Foliate
 * `<foliate-view>` element, keeps the reading context in sync (chapter title,
 * section ordinal, CFI progress) and reuses the shared selection toolbar
 * (ADR 0007) over the chapter iframe's document.
 *
 * All reading controls (chapter nav, TOC, page mode, typography) live in the
 * unified HeaderBar; this pane only applies them. Page mode comes from
 * `readerSettingsStore` (single source of truth):
 * - 单页 = single-column infinite scroll (`flow=scrolled`, native wheel);
 * - 双页 = paginated two-column book spread with keyboard/wheel page turns.
 */
export default function FoliatePane({ engine, readSelection }: FoliatePaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  /**
   * 引擎就绪前的加载态。`openIn` 要先解压、解析并渲染整章才 resolve，这期间
   * 阅读区是白的——读者看不出是在加载还是这本书没内容（初始为 true：第一次
   * 渲染时 effect 还没跑，空白最先出现的那一刻也必须在加载态里）。
   */
  const [isOpening, setIsOpening] = useState(true);
  const { selection, attach, close, reset } = useIframeSelection(readSelection);
  const runQuickAction = useQuickActions();
  const { setMarkTarget, markSelection } = useReaderHighlights();
  /** Locate request awaiting the chapter's iframe (queued before `goTo`). */
  const pendingHighlightRef = useRef<LocateRequest | null>(null);
  /** Most recently loaded chapter document (same-section highlight path). */
  const latestDocRef = useRef<Document | null>(null);

  const readingTheme = useReadingTheme();

  const typography = useReaderSettingsStore((s) => s.typography);
  const layoutSettings = useReaderSettingsStore((s) => s.layout);
  const pageMode = useReaderSettingsStore((s) => s.layout.pageMode);
  const isScrolled = pageMode === 'single';

  /**
   * Present the reader's settings in **one** call (候选 4). This used to be three
   * effects — typography, layout, theme — each probing its own optional setter, so
   * a settings change could render twice with the theme applied and the typography
   * not; and whether the vendored view honoured a knob was this component's problem
   * to hedge with `?.`.
   */
  useEffect(() => {
    engine?.applyPresentation({
      layout: toEngineLayout(layoutSettings),
      typographyCss: typographyCss(typography),
      theme: readingTheme,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutSettings identity carries the values
  }, [engine, typography, layoutSettings, readingTheme]);

  /** Apply a relocation: record the Reading Position (physical position +
   *  intra-section anchor + CFI). The position owner derives the title from the
   *  node model and owns persistence — this pane no longer throttles its own
   *  save, which could drop the last page turn of a session. */
  const applyLocation = (location: EngineLocation): void => {
    recordReadingPosition(
      {
        bookHash: useReaderStore.getState().bookHash,
        spineIndex: location.index,
        ...(anchorOfHref(location.tocItemHref)
          ? { anchor: anchorOfHref(location.tocItemHref)! }
          : {}),
      },
      {
        cfi: location.cfi,
        ...(location.tocItemLabel ? { titleFallback: location.tocItemLabel } : {}),
      },
    );
  };

  // Relocations → reader context (chapter title / section index) and a
  // throttled progress save (section + CFI, via the store action).
  useEffect(() => {
    if (!engine) return;
    // Re-attached engine (shelf round-trip): no fresh relocate event fires,
    // so seed from the engine's current position.
    const current = engine.currentLocation();
    if (current) applyLocation(current);
    return engine.onRelocate(applyLocation);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engine identity is the only dependency
  }, [engine]);

  // Chapter loads → wire the selection capture onto the fresh iframe doc, and
  // repaint the reader's own 划线 marks: the engine throws the previous chapter's
  // document away, so a mark painted once would be gone forever.
  useEffect(() => {
    if (!engine) return;
    return engine.onLoad(({ doc, index }) => {
      latestDocRef.current = doc;
      attach(doc);
      setMarkTarget(doc.body, index);
      // Apply a located highlight onto the freshly painted chapter.
      const pending = pendingHighlightRef.current;
      if (pending) {
        pendingHighlightRef.current = null;
        window.setTimeout(() => {
          highlightSnippet(doc.body, pending.quoteSnippet, pending.anchor ? { anchor: pending.anchor } : {});
        }, 60);
      }
    });
  }, [engine, attach, setMarkTarget]);

  // Agent → reader jump (reading-agent doc §5.3 locate_in_reader): the request
  // names a book node, so the node model resolves the destination first — its
  // href (目录锚点 included) or physical spine. Only when the book has no
  // context / no such node do we fall back to scanning every spine by text.
  // Either way the breathing highlight is queued for the load event below (or
  // applied straight onto the already-loaded document when the section does
  // not change).
  useEffect(() => {
    if (!engine) return;
    return subscribeLocate((request) => {
      const { bookHash } = useReaderStore.getState();
      if (request.bookHash !== bookHash) return;
      void (async () => {
        const highlightHereAndNow = (): boolean => {
          if (!latestDocRef.current) return false;
          highlightSnippet(
            latestDocRef.current.body,
            request.quoteSnippet,
            request.anchor ? { anchor: request.anchor } : {},
          );
          return true;
        };

        const current = engine.currentLocation();

        // Path 0: the request already knows its physical section. A reader
        // highlight records the section it was made in, so this needs neither the
        // node model nor the "scan every spine for the quote" fallback — and an
        // un-indexed book jumps just as precisely as an indexed one.
        if (request.spineIndex !== undefined) {
          if (current && current.index === request.spineIndex && highlightHereAndNow()) return;
          pendingHighlightRef.current = request;
          await engine.goTo(request.spineIndex);
          return;
        }

        // Path 1: the node model (authoritative — 章/节 with 目录锚点).
        const node = getAgentBookContext(request.bookHash)?.getNode(request.nodeIndex);
        if (node) {
          const target = node.href ?? node.spineIndex ?? request.nodeIndex;
          if (current && node.spineIndex !== undefined && current.index === node.spineIndex) {
            // Same physical section: no fresh load event will fire.
            if (node.href) await engine.goTo(target);
            if (highlightHereAndNow()) return;
          }
          // Queue BEFORE navigating: the load event may fire mid-goTo.
          pendingHighlightRef.current = request;
          await engine.goTo(target);
          return;
        }

        // Path 2 (fallback): no node model — scan the spine texts.
        for (let index = 0; index < engine.spineCount; index++) {
          const text = await engine.getSpineText(index);
          if (text && text.includes(request.quoteSnippet)) {
            if (current && current.index === index && latestDocRef.current) {
              // Same section: no fresh load event will fire — highlight now.
              highlightHereAndNow();
              return;
            }
            // Queue BEFORE navigating: the load event may fire mid-goTo.
            pendingHighlightRef.current = request;
            await engine.goTo(index);
            return;
          }
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engine identity is the only dependency
  }, [engine]);

  // Mount / engine switch: attach the view element and consume the pending
  // resume CFI exactly once (first open of a previously read book).
  useEffect(() => {
    const container = containerRef.current;
    if (!engine || !container) return;
    let disposed = false;
    setOpenError(null);
    setIsOpening(true);
    const run = async () => {
      container.replaceChildren();
      try {
        await engine.openIn(container);
        if (disposed) return;
        setIsOpening(false);
        const cfi = useLibraryStore.getState().consumeResumeCfi();
        if (cfi) await engine.goToCfi(cfi);
      } catch {
        if (!disposed) {
          // The Banner says what went wrong; the loading overlay must not keep
          // claiming the book is still on its way.
          setIsOpening(false);
          setOpenError('打开书籍失败，请重试');
        }
      }
    };
    void run();
    return () => {
      disposed = true;
      container.replaceChildren();
    };
  }, [engine]);

  // Keyboard navigation: PageDown/Space/ArrowRight/ArrowDown → next page;
  // PageUp/Shift+Space/ArrowLeft/ArrowUp → prev page; Escape → close selection toolbar.
  // Bound to both window and the chapter iframe document. In scrolled mode
  // next/prev scroll the continuous column (the paginator handles it).
  useEffect(() => {
    if (!engine) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (
        event.key === 'ArrowRight' ||
        event.key === 'ArrowDown' ||
        event.key === 'PageDown' ||
        (event.key === ' ' && !event.shiftKey)
      ) {
        event.preventDefault();
        event.stopPropagation();
        void engine.next();
      } else if (
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowUp' ||
        event.key === 'PageUp' ||
        (event.key === ' ' && event.shiftKey)
      ) {
        event.preventDefault();
        event.stopPropagation();
        void engine.prev();
      } else if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    const unbindLoad = engine.onLoad(({ doc }) => {
      doc.addEventListener('keydown', onKeyDown);
    });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unbindLoad();
    };
  }, [engine, close]);

  // Mouse wheel page turns — paginated (双页) mode only. In single-page
  // (scrolled) mode the paginator's own container scrolls natively, so the
  // wheel must not be intercepted.
  useEffect(() => {
    if (!engine || isScrolled) return;

    let accumulatedDelta = 0;
    let lastTurnTime = 0;
    const WHEEL_THRESHOLD = 50;
    const COOLDOWN_MS = 250;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // allow pinch zoom
      event.preventDefault();

      const now = Date.now();
      if (now - lastTurnTime < COOLDOWN_MS) {
        accumulatedDelta = 0;
        return;
      }

      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      accumulatedDelta += delta;

      if (Math.abs(accumulatedDelta) >= WHEEL_THRESHOLD) {
        if (accumulatedDelta > 0) {
          void engine.next();
        } else {
          void engine.prev();
        }
        accumulatedDelta = 0;
        lastTurnTime = now;
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', onWheel, { passive: false });
    }

    const boundDocs = new Set<Document>();
    const bindDoc = ({ doc }: { doc: Document }) => {
      boundDocs.add(doc);
      doc.addEventListener('wheel', onWheel, { passive: false });
    };

    const unbindLoad = engine.onLoad(bindDoc);

    return () => {
      if (container) {
        container.removeEventListener('wheel', onWheel);
      }
      for (const doc of boundDocs) {
        try {
          doc.removeEventListener('wheel', onWheel);
        } catch {
          /* ignore */
        }
      }
      unbindLoad();
    };
  }, [engine, isScrolled]);

  if (!engine) {
    return (
      <VStack
        aria-label="阅读视窗"
        data-testid="foliate-pane"
        style={{ flex: 1, minHeight: 0 }}
        vAlign="center"
        hAlign="center"
        padding={8}
      >
        <Text color="secondary">未加载引擎书籍</Text>
      </VStack>
    );
  }

  return (
    <VStack
      aria-label="阅读视窗"
      data-testid="foliate-pane"
      gap={0}
      style={{
        flex: 1,
        minHeight: 0,
        position: 'relative',
        background: 'var(--color-background-surface)',
      }}
    >
      {openError && (
        <Banner status="error" container="section" title={openError} />
      )}

      {/* The Foliate web component renders here; unmount clears the DOM but
          never closes the engine (its lifecycle belongs to the library store). */}
      <div
        ref={containerRef}
        data-testid="foliate-container"
        style={{ flex: 1, minHeight: 0, overflow: 'hidden', background: 'var(--color-background-surface)' }}
      />

      {/* Not a skeleton but a statement: 打开中，请稍候。 Absolutely positioned so
          the engine mounts into its final box underneath (the chapters paint
          once it resolves, and the overlay is what is covering them until then). */}
      {isOpening && (
        <VStack
          data-testid="foliate-opening"
          vAlign="center"
          hAlign="center"
          gap={3}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 10,
            background: 'var(--color-background-surface)',
          }}
        >
          <Spinner size="lg" label="正在打开书籍…" />
        </VStack>
      )}

      <SelectionToolbar
        selection={selection}
        onAction={(action, text) => runQuickAction(action, text, reset)}
        onHighlight={(selected) => {
          void markSelection(selected).then(reset);
        }}
        onClose={close}
      />
    </VStack>
  );
}
