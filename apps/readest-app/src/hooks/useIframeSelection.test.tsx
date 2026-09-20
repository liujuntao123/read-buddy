import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultReadIframeSelection, useIframeSelection } from './useIframeSelection';
import { MIN_SELECTION_CHARS } from './useTextSelection';

const makeDoc = (): Document => {
  const doc = document.implementation.createHTMLDocument('ch');
  doc.body.innerHTML = '<p>灯火在雾中摇曳</p>';
  return doc;
};

describe('defaultReadIframeSelection', () => {
  it('returns null for a collapsed / missing selection', () => {
    const doc = makeDoc();
    // happy-dom documents expose getSelection but it starts collapsed.
    expect(defaultReadIframeSelection(doc)).toBeNull();
  });
});

describe('useIframeSelection', () => {
  it('reads the selection through the injected reader on doc events', () => {
    const read = vi.fn(() => ({ text: '灯火在雾中摇曳', rect: new DOMRect(4, 6, 100, 12) }));
    const { result } = renderHook(() => useIframeSelection(read));

    const doc = makeDoc();
    act(() => result.current.attach(doc));
    expect(result.current.selection).toBeNull();

    act(() => {
      doc.dispatchEvent(new Event('mouseup'));
    });

    expect(read).toHaveBeenCalledWith(doc);
    expect(result.current.selection).not.toBeNull();
    expect(result.current.selection!.text).toBe('灯火在雾中摇曳');
    // The iframe→page offset conversion keeps the rect when the document has
    // no accessible frameElement (happy-dom implementation documents).
    expect(result.current.selection!.rect.left).toBe(4);
    expect(result.current.selection!.rect.top).toBe(6);
  });

  it('clears the toolbar state when the selection collapses', () => {
    let has = true;
    const read = vi.fn(() => (has ? { text: 'x'.repeat(MIN_SELECTION_CHARS), rect: new DOMRect(0, 0, 1, 1) } : null));
    const { result } = renderHook(() => useIframeSelection(read));
    const doc = makeDoc();

    act(() => result.current.attach(doc));
    act(() => {
      doc.dispatchEvent(new Event('selectionchange'));
    });
    expect(result.current.selection).not.toBeNull();

    has = false;
    act(() => {
      doc.dispatchEvent(new Event('selectionchange'));
    });
    expect(result.current.selection).toBeNull();
  });

  it('switches documents on attach, detaching the previous one', () => {
    const read = vi.fn(() => ({ text: 'abc', rect: new DOMRect(0, 0, 1, 1) }));
    const { result } = renderHook(() => useIframeSelection(read));
    const first = makeDoc();
    const second = makeDoc();

    act(() => result.current.attach(first));
    act(() => result.current.attach(second));

    read.mockClear();
    act(() => {
      first.dispatchEvent(new Event('mouseup')); // old doc is detached
    });
    expect(read).not.toHaveBeenCalled();

    act(() => {
      second.dispatchEvent(new Event('keyup'));
    });
    expect(read).toHaveBeenCalledWith(second);
  });

  it('reset drops the state and clears the document selection', () => {
    const removeAllRanges = vi.fn();
    const read = vi.fn(() => ({ text: 'abc', rect: new DOMRect(0, 0, 1, 1) }));
    const { result } = renderHook(() => useIframeSelection(read));
    const doc = makeDoc();
    doc.getSelection = () =>
      ({ removeAllRanges, rangeCount: 1, isCollapsed: false }) as unknown as Selection;

    act(() => result.current.attach(doc));
    act(() => {
      doc.dispatchEvent(new Event('mouseup'));
    });
    expect(result.current.selection).not.toBeNull();

    act(() => result.current.reset());
    expect(result.current.selection).toBeNull();
    expect(removeAllRanges).toHaveBeenCalledTimes(1);
  });
});
