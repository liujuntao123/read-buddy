import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReaderPane from './ReaderPane';
import { DEMO_BOOK } from '@/services/reader/demoBook';
import { getDatabase } from '@/services/db/database';
import { useChatStore } from '@/store/chatStore';
import { useHighlightStore } from '@/store/highlightStore';
import { useReaderSettingsStore } from '@/store/readerSettingsStore';
import { useReaderStore } from '@/store/readerStore';
import { READER_HIGHLIGHT_CLASS } from '@/services/reader/readerHighlight';
import { clearLocateListeners } from '@/services/reader/readerLink';

/**
 * 划线, end to end through the scroll reader: select → button → a mark that
 * stays.
 *
 * Two things this suite exists for. First, the **React-owned text node** hazard:
 * the article is rendered as an HTML string precisely so that wrapping a text
 * node in `<mark>` cannot corrupt the paragraph on the next re-render — a font
 * size change must leave the text intact, and a paragraph-spacing change (which
 * *does* replace the HTML) must repaint the mark rather than lose it. Second, the
 * store seam: the pane loads its book and paints from it, so a mark made here is
 * visible in the store that the sidebar lists.
 */
const article = () => screen.getByTestId('reader-article');
const marks = () => article().querySelectorAll(`mark.${READER_HIGHLIGHT_CLASS}`);

const selectContents = (element: Node | null) => {
  const range = document.createRange();
  range.selectNodeContents(element as Node);
  const selection = window.getSelection();
  act(() => {
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
};

const clearSelection = () =>
  act(() => {
    window.getSelection()?.removeAllRanges();
  });

beforeEach(async () => {
  await getDatabase().highlights.clear();
  useHighlightStore.setState({ bookHash: '', highlights: [], loaded: false, error: null });
  useReaderStore.setState({
    bookHash: DEMO_BOOK.bookHash,
    bookTitle: DEMO_BOOK.title,
    spineIndex: 0,
    anchor: undefined,
    nodeTitle: DEMO_BOOK.sections[0]!.title,
    spineCount: DEMO_BOOK.sections.length,
  });
  useReaderSettingsStore.getState().reset();
  clearSelection();
});

afterEach(() => {
  clearSelection();
  clearLocateListeners();
});

describe('ReaderPane 划线', () => {
  it('marks the selected text, paints it, and stores it against the node', async () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    const paragraph = article().querySelector('p')?.firstChild ?? null;
    selectContents(paragraph);
    fireEvent.mouseUp(article());

    fireEvent.click(screen.getByTestId('toolbar-highlight'));

    // A mark in the article, with the paragraph's text intact around it.
    await waitFor(() => expect(marks()).toHaveLength(1));
    const selected = paragraph?.nodeValue?.trim() ?? '';
    expect(marks()[0]!.textContent).toBe(selected);
    expect(article().textContent).toContain(selected);

    // …and a stored row for this book/node, with its text anchor.
    await waitFor(() => expect(useHighlightStore.getState().highlights).toHaveLength(1));
    const stored = useHighlightStore.getState().highlights[0]!;
    expect(stored).toMatchObject({
      bookHash: DEMO_BOOK.bookHash,
      nodeIndex: 0,
      spineIndex: 0,
      nodeTitle: DEMO_BOOK.sections[0]!.title,
      quote: selected,
    });
    expect(await getDatabase().highlights.count()).toBe(1);
  });

  it('keeps the mark and the paragraph intact when typography changes', async () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    const paragraph = article().querySelector('p')?.firstChild ?? null;
    const originalText = article().textContent ?? '';
    selectContents(paragraph);
    fireEvent.mouseUp(article());
    fireEvent.click(screen.getByTestId('toolbar-highlight'));
    await waitFor(() => expect(marks()).toHaveLength(1));

    // A font-size change re-renders the pane but not the article's HTML: React
    // must not write into the text node it no longer owns.
    act(() => {
      const { typography, setTypography } = useReaderSettingsStore.getState();
      setTypography({ ...typography, fontSize: typography.fontSize + 2 });
    });

    expect(marks()).toHaveLength(1);
    expect(article().textContent).toBe(originalText);
  });

  it('repaints the mark when the article HTML is replaced', async () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    selectContents(article().querySelector('p')?.firstChild ?? null);
    fireEvent.mouseUp(article());
    fireEvent.click(screen.getByTestId('toolbar-highlight'));
    await waitFor(() => expect(marks()).toHaveLength(1));
    const marked = marks()[0]!.textContent;

    // Paragraph spacing is baked into the HTML string, so this replaces it
    // wholesale — the mark dies with the old DOM and must be painted again.
    act(() => {
      const { typography, setTypography } = useReaderSettingsStore.getState();
      setTypography({ ...typography, paragraphSpacing: typography.paragraphSpacing + 0.4 });
    });

    await waitFor(() => expect(marks()).toHaveLength(1));
    expect(marks()[0]!.textContent).toBe(marked);
  });

  it('does not mark a selection that is not in the article', () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    expect(screen.queryByTestId('toolbar-highlight')).toBeNull();
  });

  /**
   * The other half of 划线: the mark the reader made is a handle on itself. A click
   * on it brings back the *same* toolbar over the marked passage, with 划线
   * becoming 取消划线.
   */
  it('re-opens the toolbar on a clicked mark and 取消划线 deletes it', async () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    const paragraph = article().querySelector('p')?.firstChild ?? null;
    selectContents(paragraph);
    fireEvent.mouseUp(article());
    fireEvent.click(screen.getByTestId('toolbar-highlight'));
    await waitFor(() => expect(marks()).toHaveLength(1));

    fireEvent.click(marks()[0]!);

    // Same toolbar, and the mark control now removes instead of creating.
    const remove = await screen.findByTestId('toolbar-unhighlight');
    expect(remove.textContent).toContain('取消划线');
    expect(screen.queryByTestId('toolbar-highlight')).toBeNull();
    expect(screen.getByTestId('toolbar-explain')).toBeTruthy();

    fireEvent.click(remove);

    // Gone from the page and from the store the sidebar lists.
    await waitFor(() => expect(marks()).toHaveLength(0));
    expect(useHighlightStore.getState().highlights).toHaveLength(0);
    expect(screen.queryByTestId('selection-toolbar')).toBeNull();
  });

  it('asks the companion about the clicked mark rather than about a selection', async () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    selectContents(article().querySelector('p')?.firstChild ?? null);
    fireEvent.mouseUp(article());
    fireEvent.click(screen.getByTestId('toolbar-highlight'));
    await waitFor(() => expect(marks()).toHaveLength(1));
    const quote = marks()[0]!.textContent ?? '';

    // Clicking the mark collapses the native selection, so the AI action can only
    // be reading the mark's own quote.
    clearSelection();
    fireEvent.click(marks()[0]!);
    const sendSpy = vi.spyOn(useChatStore.getState(), 'send').mockResolvedValue(undefined);
    fireEvent.click(await screen.findByTestId('toolbar-explain'));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]![1]).toBe(quote);
    sendSpy.mockRestore();
  });
});
