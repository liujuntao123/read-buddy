'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  captureSelections,
  clearSelection,
  readSelection,
  toPageCoordinates,
  type RawSelection,
} from '@/services/reader/selectionCapture';
import type { TextSelection } from './useTextSelection';

/**
 * Adapter: a selection inside a chapter iframe (Foliate engine, ADR 0007).
 *
 * The eligibility rule and the gesture events are shared with the host-document
 * adapter (`services/reader/selectionCapture`); what varies here is the *document*
 * — the engine recreates the chapter document on every chapter change — and the
 * coordinate translation into page space.
 */
export type IframeSelectionReader = (doc: Document) => RawSelection | null;

/** Read and validate the selection inside a chapter document. */
export const defaultReadIframeSelection: IframeSelectionReader = (doc) => readSelection(doc);

export interface UseIframeSelectionResult {
  selection: TextSelection | null;
  /**
   * Listen in one more live chapter document, and return the detach. The reader
   * can select in **any** chapter that is on screen: paginated mode replaces the
   * document on every chapter change (the caller detaches on the engine's
   * `unload`), while continuous scroll keeps several mounted at once.
   */
  attach: (doc: Document) => () => void;
  /** Drop the toolbar state without touching the document selection. */
  close: () => void;
  /** Drop the toolbar state and clear the selection in every live document. */
  reset: () => void;
}

/**
 * Track the selection inside the live chapter document(s). The Foliate paginator
 * re-creates the iframe document on every chapter change, so the pane calls
 * `attach(doc)` from its engine 'load' subscription; an old document's listeners
 * die with its iframe.
 *
 * `read` is injectable: happy-dom cannot run real iframe selections, so the pane
 * tests feed a fake reader that returns a ready-made {text, rect}. The real browser
 * path is `defaultReadIframeSelection`.
 */
export function useIframeSelection(
  read: IframeSelectionReader = defaultReadIframeSelection,
): UseIframeSelectionResult {
  const [selection, setSelection] = useState<TextSelection | null>(null);
  /** Live chapter documents → their detach function. */
  const docsRef = useRef(new Map<Document, () => void>());
  const readRef = useRef(read);
  readRef.current = read;

  const attach = useCallback((doc: Document): (() => void) => {
    // Re-attaching the same document (a reload) must not stack listeners.
    docsRef.current.get(doc)?.();
    const detach = captureSelections({
      doc,
      read: (target) => readRef.current(target),
      toPage: toPageCoordinates,
      onChange: setSelection,
    });
    docsRef.current.set(doc, detach);
    return () => {
      docsRef.current.get(doc)?.();
      docsRef.current.delete(doc);
    };
  }, []);

  const close = useCallback(() => setSelection(null), []);

  const reset = useCallback(() => {
    setSelection(null);
    for (const doc of docsRef.current.keys()) clearSelection(doc);
  }, []);

  // Unmount must leave no lingering toolbar state (无残留).
  useEffect(
    () => () => {
      for (const detach of docsRef.current.values()) detach();
      docsRef.current.clear();
      setSelection(null);
    },
    [],
  );

  return { selection, attach, close, reset };
}
