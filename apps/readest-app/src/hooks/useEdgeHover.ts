'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Which edge of the reading pane the pointer is hovering. */
export type EdgeSide = 'prev' | 'next';

/**
 * How close to an edge (px) the pointer has to be for a page-turn control to
 * appear. Wide enough to be found by moving the mouse to the edge, narrow enough
 * that it never covers a line of text the reader is working in.
 */
export const EDGE_ZONE_PX = 72;

export interface UseEdgeHoverResult {
  /** The edge under the pointer, or null when the pointer is not on one. */
  edge: EdgeSide | null;
  /**
   * Track the pointer inside one more document — a chapter iframe, whose events
   * never reach the host window. Returns the detach.
   */
  bindPointer: (doc: Document) => () => void;
}

/**
 * Which edge of the reading pane the mouse is on.
 *
 * Position, not an overlay: the reveal is driven by pointer coordinates, so
 * nothing sits between the reader and the text (an edge *strip* would swallow the
 * clicks and drags that start in the page margin, and the reader would only find
 * out when a selection refused to start).
 *
 * Chapter iframes swallow `mousemove` for the host document, so the pane binds
 * each live chapter document through `bindPointer` — the reading area is mostly
 * iframe, and a hover rule that only worked on the frame's edges would be a rule
 * that never fires.
 */
export function useEdgeHover(
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): UseEdgeHoverResult {
  const [edge, setEdge] = useState<EdgeSide | null>(null);
  /** Live documents the pane has handed over, with their bound handler. */
  const docsRef = useRef(new Map<Document, (event: MouseEvent) => void>());
  const handlerRef = useRef<((event: MouseEvent) => void) | null>(null);

  const evaluate = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setEdge(null);
        return;
      }
      const inside =
        clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom;
      // Outside the pane (the header, the sidebar, the progress strip) is not an
      // edge: `rect.right - clientX` is negative over the sidebar and would
      // otherwise read as "at the right edge".
      if (!inside) {
        setEdge(null);
        return;
      }
      if (clientX - rect.left <= EDGE_ZONE_PX) setEdge('prev');
      else if (rect.right - clientX <= EDGE_ZONE_PX) setEdge('next');
      else setEdge(null);
    },
    [containerRef],
  );

  useEffect(() => {
    if (!enabled) {
      handlerRef.current = null;
      setEdge(null);
      return;
    }
    let frame = 0;
    const onMove = (event: MouseEvent): void => {
      const { clientX, clientY } = event;
      if (frame) return;
      // One evaluation per frame: a reveal that chased every mousemove event
      // would re-render the pane dozens of times per second.
      frame = requestAnimationFrame(() => {
        frame = 0;
        evaluate(clientX, clientY);
      });
    };
    handlerRef.current = onMove;
    window.addEventListener('mousemove', onMove);
    for (const [doc, previous] of docsRef.current) {
      doc.removeEventListener('mousemove', previous);
      doc.addEventListener('mousemove', onMove);
      docsRef.current.set(doc, onMove);
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('mousemove', onMove);
      for (const [doc, handler] of docsRef.current) {
        doc.removeEventListener('mousemove', handler);
      }
      handlerRef.current = null;
    };
  }, [enabled, evaluate]);

  const bindPointer = useCallback((doc: Document): (() => void) => {
    const handler = handlerRef.current;
    const previous = docsRef.current.get(doc);
    if (previous) doc.removeEventListener('mousemove', previous);
    docsRef.current.set(doc, handler ?? (() => {}));
    if (handler) doc.addEventListener('mousemove', handler);
    return () => {
      const bound = docsRef.current.get(doc);
      if (bound) doc.removeEventListener('mousemove', bound);
      docsRef.current.delete(doc);
    };
  }, []);

  return { edge, bindPointer };
}
