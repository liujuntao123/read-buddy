'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  anchorForSelection,
  highlightIdAt,
  highlightRectIn,
  markReaderHighlights,
} from '@/services/reader/readerHighlight';
import { currentReadingPosition, resolveCurrentNodeView } from '@/services/bookNodes';
import { useHighlightStore, type HighlightStore } from '@/store/highlightStore';
import { useReaderStore } from '@/store/readerStore';
import type { ReaderHighlight } from '@/types/highlight';
import type { TextSelection } from './useTextSelection';

/** A 划线 the reader clicked: the row, and where its mark sits on the page. */
export interface HighlightTarget {
  highlight: ReaderHighlight;
  rect: DOMRect;
}

/** Page-space projection of a mark's rect (identity for the host document). */
export type MarkRectMapper = (rect: DOMRect) => DOMRect;

/**
 * A painted surface: the host reader's article element, or a whole chapter
 * document (the iframe case, where the reader's content *is* the document).
 */
export type MarkRoot = HTMLElement | Document;

/** The document a mark root belongs to (a document is its own). */
function documentOf(root: MarkRoot): Document {
  return root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : (root as HTMLElement).ownerDocument;
}

/**
 * The registered document a selection was made in.
 *
 * Which one matters: with several chapters mounted (continuous scroll) the quote's
 * surrounding context must be read from the document that actually holds it, or
 * the anchor would be derived from another chapter's twin sentence. Falls back to
 * the first registered document when no live range survives (a test adapter, or a
 * selection whose range the browser dropped).
 */
function rootForRange(
  targets: Map<HTMLElement, number>,
  range: Range | undefined,
): HTMLElement | null {
  const roots = [...targets.keys()];
  if (roots.length <= 1) return roots[0] ?? null;
  if (!range) return roots[0] ?? null;
  const ancestor = range.commonAncestorContainer;
  return roots.find((root) => root.contains(ancestor)) ?? roots[0] ?? null;
}

export interface ReaderHighlightsHandle {
  /**
   * Register the **only** document the marks are painted into, and the physical
   * section it is showing. Called whenever a pane (re)creates its reader
   * document: the host article after a section change, a chapter's body on every
   * engine load.
   */
  setMarkTarget: (root: HTMLElement | null, spineIndex: number) => void;
  /**
   * Register **one more** live document (continuous scroll keeps several chapters
   * mounted at once). Returns the remover, so a pruned chapter stops being
   * repainted instead of leaking its document.
   */
  addMarkTarget: (root: HTMLElement | null, spineIndex: number) => () => void;
  /** 划线 — mark the text the reader selected, at the place they selected it. */
  markSelection: (selection: TextSelection) => Promise<ReaderHighlight | null>;
  /** 取消划线 — delete a mark the reader clicked in the page. */
  removeHighlight: (id: string) => Promise<void>;
  /** Repaint the registered documents from the store's current rows. */
  repaint: () => void;
  /** The mark the reader clicked (the toolbar's 取消划线 target), or null. */
  target: HighlightTarget | null;
  /**
   * Turn clicks in one reader document into a `target`: a click on a painted mark
   * names its row, any other click dismisses. Returns the detach function.
   */
  attachClicks: (root: MarkRoot, toPage?: MarkRectMapper) => () => void;
  /** Drop the clicked-mark state without touching the page. */
  clearTarget: () => void;
}

/**
 * Reader highlights for whichever pane is mounted (划线).
 *
 * Three responsibilities, all of which must belong to the pane rather than to the
 * sidebar: the store has to be **loaded when the book opens** (a reader who never
 * opens the 划线 tab must still see their marks), the marks have to be
 * **repainted onto the live document** — the engine throws a chapter's document
 * away on every chapter change, so "paint once" is not a thing here — and a
 * **click on a mark has to be able to name its row**, which is what re-opens the
 * selection toolbar as 取消划线.
 *
 * The store is a parameter defaulted to the app singleton, the repo's convention
 * for reachable-but-injectable state; tests pass their own.
 */
export function useReaderHighlights(
  store: HighlightStore = useHighlightStore,
): ReaderHighlightsHandle {
  const bookHash = useReaderStore((s) => s.bookHash);
  const highlights = store((s) => s.highlights);
  const load = store((s) => s.load);
  const add = store((s) => s.add);
  const remove = store((s) => s.remove);
  /**
   * The documents currently on screen, each with the section it shows. A **map**
   * rather than the single target this hook used to keep: continuous scroll shows
   * several chapters at once, and a mark made in any of them must appear there.
   */
  const targetsRef = useRef(new Map<HTMLElement, number>());
  const [target, setTarget] = useState<HighlightTarget | null>(null);

  // One loader for the open book. `load` is idempotent per book and guards its
  // own responses, so a re-render cannot double-apply a stale book's rows.
  useEffect(() => {
    if (!bookHash) return;
    void load(bookHash);
  }, [bookHash, load]);

  const paint = useCallback(() => {
    const rows = store.getState();
    for (const [root, spineIndex] of targetsRef.current) {
      if (spineIndex < 0) continue;
      markReaderHighlights(root, rows.forSection(spineIndex));
    }
  }, [store]);

  // Repaint on every change to the rows: a new mark appears immediately, a
  // deleted one disappears, and a freshly loaded book replaces the previous set.
  useEffect(() => {
    paint();
  }, [highlights, paint]);

  const addMarkTarget = useCallback(
    (root: HTMLElement | null, spineIndex: number): (() => void) => {
      if (!root) return () => {};
      targetsRef.current.set(root, spineIndex);
      paint();
      return () => {
        targetsRef.current.delete(root);
      };
    },
    [paint],
  );

  const setMarkTarget = useCallback(
    (root: HTMLElement | null, spineIndex: number) => {
      targetsRef.current.clear();
      if (root) targetsRef.current.set(root, spineIndex);
      // The document changed, so the previous document's marks are gone with it.
      paint();
    },
    [paint],
  );

  const clearTarget = useCallback(() => setTarget(null), []);

  const attachClicks = useCallback(
    (root: MarkRoot, toPage: MarkRectMapper = (rect) => rect): (() => void) => {
      const doc = documentOf(root);
      const onClick = (event: MouseEvent): void => {
        const id = highlightIdAt(event.target);
        if (!id) {
          // A click anywhere else is the reader dismissing the toolbar.
          setTarget(null);
          return;
        }
        const highlight = store.getState().highlights.find((row) => row.id === id);
        const rect = highlightRectIn(root, id);
        if (!highlight || !rect) {
          setTarget(null);
          return;
        }
        setTarget({ highlight, rect: toPage(rect) });
      };
      doc.addEventListener('click', onClick);
      return () => doc.removeEventListener('click', onClick);
    },
    [store],
  );

  const markSelection = useCallback(
    async (selection: TextSelection) => {
      // Marking consumes the click state: the row the reader was looking at is no
      // longer the subject of the toolbar.
      setTarget(null);
      const anchor = anchorForSelection(
        rootForRange(targetsRef.current, selection.range),
        selection.text,
        selection.range,
      );
      if (!anchor) return null;
      const position = currentReadingPosition();
      const view = resolveCurrentNodeView();
      return add({
        bookHash: position.bookHash,
        nodeIndex: view.nodeIndex,
        nodeTitle: view.title,
        spineIndex: position.spineIndex,
        ...(position.anchor ? { anchor: position.anchor } : {}),
        ...anchor,
      });
    },
    [add],
  );

  const removeHighlight = useCallback(
    async (id: string) => {
      setTarget(null);
      await remove(id);
    },
    [remove],
  );

  return {
    setMarkTarget,
    addMarkTarget,
    markSelection,
    removeHighlight,
    repaint: paint,
    target,
    attachClicks,
    clearTarget,
  };
}
