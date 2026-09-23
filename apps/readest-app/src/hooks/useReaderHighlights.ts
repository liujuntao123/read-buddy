'use client';

import { useCallback, useEffect, useRef } from 'react';
import { anchorForSelection, markReaderHighlights } from '@/services/reader/readerHighlight';
import { currentReadingPosition, resolveCurrentNodeView } from '@/services/bookNodes';
import { useHighlightStore, type HighlightStore } from '@/store/highlightStore';
import { useReaderStore } from '@/store/readerStore';
import type { ReaderHighlight } from '@/types/highlight';
import type { TextSelection } from './useTextSelection';

export interface ReaderHighlightsHandle {
  /**
   * Register the document the marks are painted into, and the physical section it
   * is showing. Called whenever a pane (re)creates its reader document: the host
   * article after a section change, a chapter's body on every engine load.
   */
  setMarkTarget: (root: HTMLElement | null, spineIndex: number) => void;
  /** 划线 — mark the text the reader selected, at the place they selected it. */
  markSelection: (selection: TextSelection) => Promise<ReaderHighlight | null>;
  /** Repaint the registered document from the store's current rows. */
  repaint: () => void;
}

/**
 * Reader highlights for whichever pane is mounted (划线).
 *
 * Two responsibilities, both of which must belong to the pane rather than to the
 * sidebar: the store has to be **loaded when the book opens** (a reader who never
 * opens the 划线 tab must still see their marks), and the marks have to be
 * **repainted onto the live document** — the engine throws a chapter's document
 * away on every chapter change, so "paint once" is not a thing here.
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
  /** The document currently on screen, and which section it shows. */
  const targetRef = useRef<{ root: HTMLElement | null; spineIndex: number }>({
    root: null,
    spineIndex: -1,
  });

  // One loader for the open book. `load` is idempotent per book and guards its
  // own responses, so a re-render cannot double-apply a stale book's rows.
  useEffect(() => {
    if (!bookHash) return;
    void load(bookHash);
  }, [bookHash, load]);

  const paint = useCallback(() => {
    const { root, spineIndex } = targetRef.current;
    if (!root || spineIndex < 0) return;
    markReaderHighlights(root, store.getState().forSection(spineIndex));
  }, [store]);

  // Repaint on every change to the rows: a new mark appears immediately, a
  // deleted one disappears, and a freshly loaded book replaces the previous set.
  useEffect(() => {
    paint();
  }, [highlights, paint]);

  const setMarkTarget = useCallback(
    (root: HTMLElement | null, spineIndex: number) => {
      targetRef.current = { root, spineIndex };
      // The document changed, so the previous document's marks are gone with it.
      paint();
    },
    [paint],
  );

  const markSelection = useCallback(
    async (selection: TextSelection) => {
      const anchor = anchorForSelection(
        targetRef.current.root,
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

  return { setMarkTarget, markSelection, repaint: paint };
}
