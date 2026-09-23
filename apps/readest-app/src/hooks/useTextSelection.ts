'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';
import {
  MIN_SELECTION_CHARS,
  captureSelections,
  clearSelection,
  readSelection,
  type RawSelection,
} from '@/services/reader/selectionCapture';

/** A validated reader selection: trimmed text plus its viewport rect. */
export type TextSelection = RawSelection;

export { MIN_SELECTION_CHARS };

/**
 * Adapter: a selection in the **host** document, restricted to `container`.
 *
 * The eligibility rule lives in `selectionCapture`; this wrapper only supplies the
 * host document and the containment check that keeps a selection inside the reader
 * article from being mistaken for one elsewhere on the page.
 */
export function readTextSelection(container: HTMLElement | null): TextSelection | null {
  if (!container || typeof window === 'undefined') return null;
  return readSelection(window.document, container);
}

/** Wipe the host document's selection (no visual residue after an action). */
export function clearDocumentSelection(): void {
  if (typeof window === 'undefined') return;
  clearSelection(window.document);
}

export interface UseTextSelectionResult {
  selection: TextSelection | null;
  /** Close the floating toolbar without touching the document selection. */
  close: () => void;
  /** Close the toolbar and clear the native selection (Escape / after action). */
  reset: () => void;
}

/**
 * Selection capture for the scroll reader's article (design doc 4.4.3, ADR 0007).
 * A thin React wrapper: the gesture events and the eligibility rule are shared with
 * the iframe adapter.
 */
export function useTextSelection(
  containerRef: RefObject<HTMLElement | null>,
): UseTextSelectionResult {
  const [selection, setSelection] = useState<TextSelection | null>(null);

  const close = useCallback(() => setSelection(null), []);

  const reset = useCallback(() => {
    setSelection(null);
    clearDocumentSelection();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // A gesture event reports the selection; a mid-drag `selectionchange` reports
    // null and therefore hides the toolbar until the gesture finishes.
    const detach = captureSelections({
      doc: window.document,
      read: (doc) => readSelection(doc, containerRef.current),
      onChange: setSelection,
    });
    return () => {
      detach();
      // Unmount must leave no lingering toolbar state (无残留).
      setSelection(null);
    };
  }, [containerRef]);

  return { selection, close, reset };
}