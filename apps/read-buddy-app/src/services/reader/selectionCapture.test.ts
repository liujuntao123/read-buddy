import { describe, expect, it, vi } from 'vitest';
import {
  MIN_SELECTION_CHARS,
  SELECTION_EVENTS,
  captureSelections,
  clearSelection,
  readSelection,
  toPageCoordinates,
} from './selectionCapture';

/**
 * The shared selection rules (候选 epilogue). Before this module the eligibility
 * rule, the gesture triple and the clear mechanic were written twice — once for the
 * host article, once for a chapter iframe — so a rule change could land in one copy
 * and silently diverge from the other. These tests assert the rules **once**;
 * each hook's own suite keeps only its genuinely varying part.
 */

/** Build a document whose selection the fake `getSelection` reports. */
const docWithSelection = (
  selection: { isCollapsed?: boolean; rangeCount?: number; text?: string; range?: Partial<Range> } | null,
): Document => {
  const doc = document.implementation.createHTMLDocument('chapter');
  const fullRange = {
    commonAncestorContainer: doc.body,
    getBoundingClientRect: () => new DOMRect(10, 20, 30, 8),
    ...selection?.range,
  } as unknown as Range;
  (doc as unknown as { getSelection: () => unknown }).getSelection = () =>
    selection === null
      ? null
      : {
          isCollapsed: selection.isCollapsed ?? false,
          rangeCount: selection.rangeCount ?? 1,
          toString: () => selection.text ?? '',
          getRangeAt: () => fullRange,
        };
  return doc;
};

describe('readSelection — the one eligibility rule', () => {
  it('accepts a non-collapsed selection of at least the minimum length, range included', () => {
    const doc = docWithSelection({ text: '灯火在雾中' });
    const selection = readSelection(doc);
    expect(selection).toMatchObject({ text: '灯火在雾中', rect: expect.any(DOMRect) });
    // The live range travels with the selection: a reader highlight needs it to
    // tell two identical sentences apart (which occurrence was marked).
    expect(selection?.range).toBe(doc.getSelection()?.getRangeAt(0));
  });

  it('rejects a collapsed selection, an empty range, and no selection at all', () => {
    expect(readSelection(docWithSelection({ isCollapsed: true, text: '灯火' }))).toBeNull();
    expect(readSelection(docWithSelection({ rangeCount: 0, text: '灯火' }))).toBeNull();
    expect(readSelection(docWithSelection(null))).toBeNull();
  });

  it('trims before measuring, so whitespace alone never qualifies', () => {
    const doc = docWithSelection({ text: `  ${'x'.repeat(MIN_SELECTION_CHARS - 1)}  ` });
    expect(readSelection(doc)).toBeNull();
    expect(readSelection(docWithSelection({ text: `  ${'x'.repeat(MIN_SELECTION_CHARS)}  ` }))).toMatchObject({
      text: 'x'.repeat(MIN_SELECTION_CHARS),
    });
  });

  it('falls back to a zero rect when the range has no bounding rect', () => {
    const doc = docWithSelection({ text: '灯火', range: { getBoundingClientRect: undefined } });
    expect(readSelection(doc)?.rect).toEqual(new DOMRect(0, 0, 0, 0));
  });

  it('requires containment when `within` is given — the host-document adapter', () => {
    // `within` and the range's anchor must live in the same tree for `contains` to
    // answer meaningfully (a cross-document contains is always false).
    const doc = document.implementation.createHTMLDocument('host');
    const within = doc.createElement('article');
    const anchor = doc.createElement('p');
    within.appendChild(anchor);
    doc.body.appendChild(within);

    (doc as unknown as { getSelection: () => unknown }).getSelection = () => ({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => '灯火在雾中',
      getRangeAt: () =>
        ({
          commonAncestorContainer: anchor,
          getBoundingClientRect: () => new DOMRect(1, 2, 3, 4),
        }) as unknown as Range,
    });

    expect(readSelection(doc, within)).not.toBeNull();
    // The same selection is rejected when the container does not hold it, which is
    // what keeps a selection elsewhere on the page from summoning the toolbar.
    const elsewhere = doc.createElement('article');
    doc.body.appendChild(elsewhere);
    expect(readSelection(doc, elsewhere)).toBeNull();
  });

  it('accepts without a containment check — the iframe adapter', () => {
    const doc = docWithSelection({ text: '灯火在雾中' });
    expect(readSelection(doc)).not.toBeNull();
  });
});

describe('captureSelections', () => {
  it('listens for exactly the shared gesture triple', () => {
    const doc = document.implementation.createHTMLDocument('chapter');
    const add = vi.spyOn(doc, 'addEventListener');
    const detach = captureSelections({ doc, onChange: () => {} });

    expect(add.mock.calls.map(([event]) => event).sort()).toEqual([...SELECTION_EVENTS].sort());
    detach();
  });

  it('reports the eligible selection and null when there is none', () => {
    const doc = docWithSelection({ text: '灯火在雾中' });
    const seen: Array<{ text: string } | null> = [];
    const detach = captureSelections({ doc, onChange: (found) => seen.push(found) });

    doc.dispatchEvent(new Event('mouseup'));
    (doc as unknown as { getSelection: () => unknown }).getSelection = () => null;
    doc.dispatchEvent(new Event('selectionchange'));

    expect(seen[0]).toMatchObject({ text: '灯火在雾中' });
    expect(seen[1]).toBeNull();
    detach();
  });

  it('stops listening after detach, and never fires on teardown', () => {
    const doc = docWithSelection({ text: '灯火在雾中' });
    const onChange = vi.fn();
    const detach = captureSelections({ doc, onChange });

    detach();
    doc.dispatchEvent(new Event('mouseup'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('applies the adapter translation before reporting', () => {
    const doc = docWithSelection({ text: '灯火在雾中' });
    const seen: Array<{ rect: DOMRect } | null> = [];
    const detach = captureSelections({
      doc,
      toPage: (raw) => ({ text: raw.text, rect: new DOMRect(raw.rect.left + 100, raw.rect.top, 1, 1) }),
      onChange: (found) => seen.push(found),
    });

    doc.dispatchEvent(new Event('mouseup'));
    expect(seen[0]?.rect.left).toBe(110);
    detach();
  });
});

describe('clearSelection', () => {
  it('clears through the document itself, whichever document that is', () => {
    const removeAllRanges = vi.fn();
    const doc = document.implementation.createHTMLDocument('chapter');
    (doc as unknown as { getSelection: () => unknown }).getSelection = () => ({ removeAllRanges });

    clearSelection(doc);
    expect(removeAllRanges).toHaveBeenCalledTimes(1);
    // A missing document is a no-op, not a crash.
    expect(() => clearSelection(null)).not.toThrow();
  });
});

describe('toPageCoordinates', () => {
  it('adds the framing iframe offset when the document is framed', () => {
    // A created document's `defaultView` is read-only, so the frame is supplied
    // through a minimal cast: the module only reads `defaultView.frameElement`.
    const doc = {
      defaultView: { frameElement: { getBoundingClientRect: () => new DOMRect(50, 60, 0, 0) } },
    } as unknown as Document;
    const translated = toPageCoordinates({ text: 'x', rect: new DOMRect(10, 20, 5, 6) }, doc);
    expect(translated.rect.left).toBe(60);
    expect(translated.rect.top).toBe(80);
    expect(translated.rect.width).toBe(5);
    expect(translated.text).toBe('x');
  });

  it('returns the rect unchanged for an unframed document', () => {
    const doc = { defaultView: null } as unknown as Document;
    const raw = { text: 'x', rect: new DOMRect(10, 20, 5, 6) };
    expect(toPageCoordinates(raw, doc)).toBe(raw);
  });
});