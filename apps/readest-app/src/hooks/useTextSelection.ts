'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';

/** A validated reader selection: trimmed text plus its viewport rect. */
export interface TextSelection {
  text: string;
  rect: DOMRect;
}

/** Selections shorter than this (after trimming) never summon the toolbar. */
export const MIN_SELECTION_CHARS = 2;

/**
 * Read the current document selection and validate it against the reader
 * container: non-collapsed, at least `MIN_SELECTION_CHARS` long after
 * trimming, and anchored inside `container` (checked via the range's
 * commonAncestorContainer). Returns null when nothing eligible is selected.
 */
export function readTextSelection(container: HTMLElement | null): TextSelection | null {
  if (!container || typeof window === 'undefined') return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().trim();
  if (text.length < MIN_SELECTION_CHARS) return null;

  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  const anchor =
    ancestor.nodeType === Node.TEXT_NODE
      ? ancestor.parentElement
      : (ancestor as HTMLElement | null);
  if (!anchor || !container.contains(anchor)) return null;

  const rect =
    typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
  return { text, rect: rect ?? new DOMRect(0, 0, 0, 0) };
}

/** Wipe the native document selection (no visual residue after an action). */
export function clearDocumentSelection(): void {
  if (typeof window === 'undefined') return;
  window.getSelection()?.removeAllRanges();
}

export interface UseTextSelectionResult {
  selection: TextSelection | null;
  /** Close the floating toolbar without touching the document selection. */
  close: () => void;
  /** Close the toolbar and clear the native selection (Escape / after action). */
  reset: () => void;
}

/**
 * Selection capture for the reader viewport (design doc 4.4.3, ADR 0007):
 * recomputes on `mouseup`/`keyup` (selection gesture finished) and hides on
 * `selectionchange` when the selection collapses, so dragging mid-gesture
 * never flickers the toolbar.
 */
export function useTextSelection(
  containerRef: RefObject<HTMLElement | null>,
): UseTextSelectionResult {
  const [selection, setSelection] = useState<TextSelection | null>(null);

  const update = useCallback(() => {
    setSelection(readTextSelection(containerRef.current));
  }, [containerRef]);

  const hideIfEmpty = useCallback(() => {
    if (!readTextSelection(containerRef.current)) setSelection(null);
  }, [containerRef]);

  const close = useCallback(() => setSelection(null), []);

  const reset = useCallback(() => {
    setSelection(null);
    clearDocumentSelection();
  }, []);

  useEffect(() => {
    document.addEventListener('mouseup', update);
    document.addEventListener('keyup', update);
    document.addEventListener('selectionchange', hideIfEmpty);
    return () => {
      document.removeEventListener('mouseup', update);
      document.removeEventListener('keyup', update);
      document.removeEventListener('selectionchange', hideIfEmpty);
      // Unmount must leave no lingering toolbar state (无残留).
      setSelection(null);
    };
  }, [update, hideIfEmpty]);

  return { selection, close, reset };
}
