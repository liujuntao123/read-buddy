'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MIN_SELECTION_CHARS, type TextSelection } from './useTextSelection';

/**
 * Selection capture for documents rendered inside iframes (Foliate engine,
 * ticket 07 / ADR 0007). Same rules as the DOM variant (`readTextSelection`):
 * a non-collapsed selection of at least MIN_SELECTION_CHARS trimmed chars —
 * but read from the *chapter document* the engine hands us on every `load`,
 * not from the host window.
 */
export type IframeSelectionReader = (doc: Document) => { text: string; rect: DOMRect } | null;

/** Read and validate the selection inside an iframe document. */
export const defaultReadIframeSelection: IframeSelectionReader = (doc) => {
  const selection = doc.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().trim();
  if (text.length < MIN_SELECTION_CHARS) return null;

  const range = selection.getRangeAt(0);
  const rect =
    typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
  return { text, rect: rect ?? new DOMRect(0, 0, 0, 0) };
};

/**
 * Convert iframe-viewport coordinates to page coordinates by adding the host
 * rect of the iframe that owns the document (ticket 07: range coordinates
 * inside the iframe + container iframe offset → page coordinates).
 */
function toPageSelection(found: { text: string; rect: DOMRect }, doc: Document): TextSelection {
  const frame = doc.defaultView?.frameElement;
  if (frame && typeof frame.getBoundingClientRect === 'function') {
    const offset = frame.getBoundingClientRect();
    return {
      text: found.text,
      rect: new DOMRect(
        found.rect.left + offset.left,
        found.rect.top + offset.top,
        found.rect.width,
        found.rect.height,
      ),
    };
  }
  return { text: found.text, rect: found.rect };
}

export interface UseIframeSelectionResult {
  selection: TextSelection | null;
  /** Wire a freshly loaded chapter document (engine 'load' event). */
  attach: (doc: Document) => void;
  /** Drop the toolbar state without touching the document selection. */
  close: () => void;
  /** Drop the toolbar state and clear the document selection. */
  reset: () => void;
}

/**
 * Track the selection inside the current chapter document. The Foliate
 * paginator re-creates the iframe document on every chapter change, so the
 * pane calls `attach(doc)` from its engine 'load' subscription; the old
 * document's listeners die with its iframe.
 *
 * `read` is injectable: happy-dom cannot run real iframe selections, so the
 * pane tests feed a fake reader that returns a ready-made {text, rect}. The
 * real browser path is covered by `defaultReadIframeSelection` (untested —
 * see the known-limitations note in the ticket 07 report).
 */
export function useIframeSelection(
  read: IframeSelectionReader = defaultReadIframeSelection,
): UseIframeSelectionResult {
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const docRef = useRef<Document | null>(null);
  const readRef = useRef(read);
  readRef.current = read;

  const detach = useCallback((doc: Document | null) => {
    if (!doc) return;
    doc.removeEventListener('mouseup', onDocEvent);
    doc.removeEventListener('keyup', onDocEvent);
    doc.removeEventListener('selectionchange', onDocEvent);
  }, []);

  const onDocEvent = useCallback(() => {
    const doc = docRef.current;
    if (!doc) return;
    const found = readRef.current(doc);
    setSelection(found ? toPageSelection(found, doc) : null);
  }, []);

  const attach = useCallback(
    (doc: Document) => {
      detach(docRef.current);
      docRef.current = doc;
      // mouseup/keyup finish a selection gesture; selectionchange catches
      // collapses (click on blank text, programmatic clears).
      doc.addEventListener('mouseup', onDocEvent);
      doc.addEventListener('keyup', onDocEvent);
      doc.addEventListener('selectionchange', onDocEvent);
      setSelection(null);
    },
    [detach, onDocEvent],
  );

  const close = useCallback(() => setSelection(null), []);

  const reset = useCallback(() => {
    setSelection(null);
    docRef.current?.getSelection?.()?.removeAllRanges();
  }, []);

  useEffect(
    () => () => {
      // Unmount must leave no lingering toolbar state (无残留).
      detach(docRef.current);
      docRef.current = null;
      setSelection(null);
    },
    [detach],
  );

  return { selection, attach, close, reset };
}
