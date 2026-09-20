'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { EngineLocation, FoliateEngineHandle } from '@/services/library/foliateEngine';
import { useQuickActions } from '@/hooks/useQuickActions';
import { useIframeSelection, type IframeSelectionReader } from '@/hooks/useIframeSelection';
import SelectionToolbar from './SelectionToolbar';

/** Relocate-driven progress saves are throttled (page turns are frequent). */
const PROGRESS_SAVE_THROTTLE_MS = 1500;

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
 * The engine's lifecycle belongs to the library store — unmounting the pane
 * only detaches the DOM and listeners; switching or deleting the book closes
 * the engine there.
 */
export default function FoliatePane({ engine, readSelection }: FoliatePaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chapterTitle = useReaderStore((s) => s.chapterTitle);
  const [tocPos, setTocPos] = useState(-1);
  const [openError, setOpenError] = useState<string | null>(null);
  const { selection, attach, close, reset } = useIframeSelection(readSelection);
  const runQuickAction = useQuickActions();
  const lastSaveRef = useRef(0);

  const tocItems = useMemo(() => (engine ? engine.tocItems() : []), [engine]);
  const tocItemsRef = useRef(tocItems);
  tocItemsRef.current = tocItems;

  /** Apply a relocation: reading context + chapter-nav position + progress. */
  const applyLocation = (location: EngineLocation): void => {
    const title = location.tocItemLabel ?? engine?.getSectionTitle(location.index) ?? '';
    useReaderStore.getState().setSection(location.index, title);
    setTocPos((current) => {
      if (location.tocItemHref) {
        const found = tocItemsRef.current.findIndex((item) => item.href === location.tocItemHref);
        if (found >= 0) return found;
      }
      return current;
    });
    const now = Date.now();
    if (now - lastSaveRef.current >= PROGRESS_SAVE_THROTTLE_MS) {
      lastSaveRef.current = now;
      void useLibraryStore.getState().saveProgress();
    }
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

  // Chapter loads → wire the selection capture onto the fresh iframe doc.
  useEffect(() => {
    if (!engine) return;
    return engine.onLoad(({ doc }) => attach(doc));
  }, [engine, attach]);

  // Mount / engine switch: attach the view element and consume the pending
  // resume CFI exactly once (first open of a previously read book).
  useEffect(() => {
    const container = containerRef.current;
    if (!engine || !container) return;
    let disposed = false;
    setOpenError(null);
    const run = async () => {
      // Drop anything left by a previous engine; the engine itself stays
      // alive (store-owned), its element simply re-attaches.
      container.replaceChildren();
      try {
        await engine.openIn(container);
        if (disposed) return;
        const cfi = useLibraryStore.getState().consumeResumeCfi();
        if (cfi) await engine.goToCfi(cfi);
      } catch {
        if (!disposed) setOpenError('打开书籍失败，请重试');
      }
    };
    void run();
    return () => {
      disposed = true;
      container.replaceChildren();
    };
  }, [engine]);

  // Keyboard: ←/→ page turns (foliate next/prev are page turns, not
  // chapters); Escape retracts the selection toolbar. Skips inputs so the
  // chat composer keeps its caret behaviour.
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
      if (event.key === 'ArrowRight') void engine.next();
      else if (event.key === 'ArrowLeft') void engine.prev();
      else if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine, close]);

  if (!engine) {
    return (
      <section
        className="flex min-w-0 flex-1 items-center justify-center p-8 text-base-content/60"
        aria-label="阅读视窗"
        data-testid="foliate-pane"
      >
        未加载引擎书籍
      </section>
    );
  }

  const prevToc = tocPos > 0 ? tocItems[tocPos - 1] : undefined;
  const nextToc = tocPos >= 0 && tocPos < tocItems.length - 1 ? tocItems[tocPos + 1] : undefined;

  const goChapter = (href: string): void => {
    void engine.goTo(href);
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="阅读视窗" data-testid="foliate-pane">
      <div className="flex items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-4 py-2">
        <span
          className="truncate text-sm font-medium text-base-content/80"
          data-testid="foliate-chapter-title"
        >
          {chapterTitle || '…'}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-xs text-base-content/50 md:inline">（←/→ 翻页）</span>
          {tocItems.length > 0 && (
            <div className="dropdown dropdown-end">
              <div
                tabIndex={0}
                role="button"
                className="btn btn-xs btn-outline"
                data-testid="foliate-toc-button"
              >
                目录
              </div>
              <ul
                tabIndex={0}
                data-testid="foliate-toc-list"
                className="menu dropdown-content z-30 max-h-72 w-60 overflow-auto rounded-box border border-base-300 bg-base-100 p-2 text-sm shadow-lg"
              >
                {tocItems.map((item, i) => (
                  <li key={`${item.href}-${i}`}>
                    <button
                      type="button"
                      className={i === tocPos ? 'active' : undefined}
                      onClick={() => goChapter(item.href)}
                    >
                      <span className="block truncate">{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            className="btn btn-xs"
            disabled={!prevToc}
            onClick={() => prevToc && goChapter(prevToc.href)}
          >
            上一章
          </button>
          <button
            type="button"
            className="btn btn-xs"
            disabled={!nextToc}
            onClick={() => nextToc && goChapter(nextToc.href)}
          >
            下一章
          </button>
        </div>
      </div>

      {openError && (
        <div role="alert" className="alert alert-error mx-4 mt-2 py-2 text-sm">
          {openError}
        </div>
      )}

      {/* The Foliate web component renders here; unmount clears the DOM but
          never closes the engine (its lifecycle belongs to the library store). */}
      <div
        ref={containerRef}
        data-testid="foliate-container"
        className="min-h-0 flex-1 overflow-hidden"
      />

      <SelectionToolbar
        selection={selection}
        onAction={(action, text) => runQuickAction(action, text, reset)}
        onClose={close}
      />
    </section>
  );
}
