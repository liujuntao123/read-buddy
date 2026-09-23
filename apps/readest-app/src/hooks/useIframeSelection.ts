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
  /** Wire a freshly loaded chapter document (engine 'load' event). */
  attach: (doc: Document) => void;
  /** Drop the toolbar state without touching the document selection. */
  close: () => void;
  /** Drop the toolbar state and clear the document selection. */
  reset: () => void;
}

/**
 * Track the selection inside the current chapter document. The Foliate paginator
 * re-creates the iframe document on every chapter change, so the pane calls
 * `attach(doc)` from its engine 'load' subscription; the old document's listeners
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
  const docRef = useRef<Document | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  /** Detach of the live listener set, owned by the shared capture module. */
  const detachRef = useRef<(() => void) | null>(null);

  const detach = useCallback(() => {
    detachRef.current?.();
    detachRef.current = null;
  }, []);

  const attach = useCallback(
    (doc: Document) => {
      detach();
      docRef.current = doc;
      detachRef.current = captureSelections({
        doc,
        read: (target) => readRef.current(target),
        toPage: toPageCoordinates,
        onChange: setSelection,
      });
      setSelection(null);
    },
    [detach],
  );

  const close = useCallback(() => setSelection(null), []);

  const reset = useCallback(() => {
    setSelection(null);
    clearSelection(docRef.current);
  }, []);

  useEffect(
    () => () => {
      // Unmount must leave no lingering toolbar state (无残留).
      detach();
      docRef.current = null;
      setSelection(null);
    },
    [detach],
  );

  return { selection, attach, close, reset };
}