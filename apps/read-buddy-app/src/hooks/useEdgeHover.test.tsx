import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { EDGE_ZONE_PX, useEdgeHover } from './useEdgeHover';

/**
 * Edge hover for 双页 page turns. Two things this suite exists for: the reveal is
 * driven by pointer *coordinates* over the reading pane (not by an overlay strip,
 * which would swallow the clicks and drags starting in the page margin), and a
 * chapter iframe — where the pointer spends nearly all of its time — reports too.
 */
const PANE = new DOMRect(100, 50, 1000, 800);

const makeRef = (): RefObject<HTMLElement | null> => {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => PANE;
  return { current: element } as RefObject<HTMLElement | null>;
};

const moveTo = (target: Window | Document, clientX: number, clientY: number) => {
  act(() => {
    target.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY, bubbles: true }));
  });
};

describe('useEdgeHover', () => {
  it('reports the edge the pointer is on, and nothing else', async () => {
    const { result } = renderHook(() => useEdgeHover(makeRef(), true));

    moveTo(window, PANE.left + 10, 400);
    await waitFor(() => expect(result.current.edge).toBe('prev'));

    moveTo(window, PANE.right - 10, 400);
    await waitFor(() => expect(result.current.edge).toBe('next'));

    // The middle of the page is not an edge.
    moveTo(window, PANE.left + PANE.width / 2, 400);
    await waitFor(() => expect(result.current.edge).toBeNull());

    // Just outside the zone stays quiet.
    moveTo(window, PANE.left + EDGE_ZONE_PX + 4, 400);
    await waitFor(() => expect(result.current.edge).toBeNull());
  });

  it('is not fooled by a pointer beyond the pane (the AI sidebar sits there)', async () => {
    const { result } = renderHook(() => useEdgeHover(makeRef(), true));

    moveTo(window, PANE.right - 5, 400);
    await waitFor(() => expect(result.current.edge).toBe('next'));

    // `rect.right - clientX` is negative here: still "<= the zone", but the
    // pointer is not in the reading pane at all.
    moveTo(window, PANE.right + 300, 400);
    await waitFor(() => expect(result.current.edge).toBeNull());

    // Above the pane (the header) is outside too.
    moveTo(window, PANE.left + 5, PANE.top - 20);
    await waitFor(() => expect(result.current.edge).toBeNull());
  });

  it('stays quiet while disabled (single-page scrolling has no edge turns)', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useEdgeHover(makeRef(), enabled), {
      initialProps: { enabled: false },
    });
    moveTo(window, PANE.left + 4, 400);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(result.current.edge).toBeNull();

    rerender({ enabled: true });
    moveTo(window, PANE.left + 4, 400);
    await waitFor(() => expect(result.current.edge).toBe('prev'));
  });

  it('tracks the pointer inside a chapter iframe, and unbinds on detach', async () => {
    const { result } = renderHook(() => useEdgeHover(makeRef(), true));
    const chapter = document.implementation.createHTMLDocument('ch1');
    const removed = vi.spyOn(chapter, 'removeEventListener');

    let detach: () => void = () => {};
    act(() => {
      detach = result.current.bindPointer(chapter);
    });

    // The iframe's own viewport is the chapter document, but the pane's rect is in
    // page coordinates — the pointer's page position is what counts.
    moveTo(chapter, PANE.right - 8, 400);
    await waitFor(() => expect(result.current.edge).toBe('next'));

    // Unbinding has to take the listener off *this* document: a pruned chapter
    // must stop reporting (happy-dom shares one window across documents, so the
    // window-level listener alone cannot show this).
    act(() => detach());
    expect(removed).toHaveBeenCalledWith('mousemove', expect.any(Function));
  });
});
