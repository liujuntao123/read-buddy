import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReaderPane from './ReaderPane';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useChatStore } from '@/store/chatStore';
import { DEMO_BOOK } from '@/services/reader/demoBook';

const sidebarState = () => useAISidebarStore.getState();

const article = () => screen.getByTestId('reader-article');

/** Select the given element's contents like a native drag-selection would. */
const selectContents = (element: Node | null) => {
  const range = document.createRange();
  range.selectNodeContents(element as Node);
  const selection = window.getSelection();
  let text = '';
  act(() => {
    selection?.removeAllRanges();
    selection?.addRange(range);
    text = selection?.toString().trim() ?? '';
  });
  return text;
};

const clearSelection = () =>
  act(() => {
    window.getSelection()?.removeAllRanges();
  });

beforeEach(() => {
  useAISidebarStore.setState({ expanded: false, width: 400, activeTab: 'summary' });
  useChatStore.setState({ quoteDraft: null });
  clearSelection();
});

afterEach(() => {
  clearSelection();
});

describe('ReaderPane selection toolbar integration', () => {
  it('keeps the toolbar hidden until article text is selected', () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    expect(screen.queryByTestId('selection-toolbar')).toBeNull();
  });

  it('shows the toolbar after selecting article text and releasing the mouse', () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    selectContents(article().querySelector('p')?.firstChild ?? null);
    fireEvent.mouseUp(article());

    const toolbar = screen.getByTestId('selection-toolbar');
    expect(toolbar.getAttribute('role')).toBe('toolbar');
    expect(screen.getByRole('button', { name: '解释' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '翻译' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '追问' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '提炼' })).toBeTruthy();
  });

  it('ignores selections made outside the article (chapter title header)', () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    const title = document.querySelector('[data-testid="reader-pane"] span.truncate');
    selectContents(title?.firstChild ?? null);
    fireEvent.mouseUp(article());
    expect(screen.queryByTestId('selection-toolbar')).toBeNull();
  });

  it('追问 expands the sidebar, activates the chat tab and fills the quote draft', () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    const selected = selectContents(article().querySelector('p')?.firstChild ?? null);
    fireEvent.mouseUp(article());

    const sendSpy = vi.spyOn(useChatStore.getState(), 'send');
    fireEvent.click(screen.getByRole('button', { name: '追问' }));

    expect(sidebarState().expanded).toBe(true);
    expect(sidebarState().activeTab).toBe('chat');
    expect(useChatStore.getState().quoteDraft).toBe(selected);
    expect(sendSpy).not.toHaveBeenCalled(); // 追问 only pre-fills the quote
    sendSpy.mockRestore();

    // The toolbar and the native highlight are both dismissed (无残留).
    expect(screen.queryByTestId('selection-toolbar')).toBeNull();
    expect(window.getSelection()?.toString()).toBe('');
  });

  it('解释 sends the preset quick-action prompt with the selection quoted', () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    const selected = selectContents(article().querySelector('p')?.firstChild ?? null);
    fireEvent.mouseUp(article());

    const sendSpy = vi.spyOn(useChatStore.getState(), 'send').mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: '解释' }));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [prompt, quoteText] = sendSpy.mock.calls[0];
    expect(prompt).toContain('请解释');
    expect(prompt).toContain(selected);
    expect(quoteText).toBe(selected);
    expect(sidebarState().expanded).toBe(true);
    expect(sidebarState().activeTab).toBe('chat');
    sendSpy.mockRestore();
  });

  it('翻译 also sends a preset prompt with the selection as quote', () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    const selected = selectContents(article().querySelector('p')?.firstChild ?? null);
    fireEvent.mouseUp(article());

    const sendSpy = vi.spyOn(useChatStore.getState(), 'send').mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: '翻译' }));

    const [prompt, quoteText] = sendSpy.mock.calls[0];
    expect(prompt).toContain('翻译');
    expect(prompt).toContain(selected);
    expect(quoteText).toBe(selected);
    sendSpy.mockRestore();
  });

  it('dismisses the toolbar when clicking blank space clears the selection', async () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    selectContents(article().querySelector('p')?.firstChild ?? null);
    fireEvent.mouseUp(article());
    expect(screen.getByTestId('selection-toolbar')).toBeTruthy();

    fireEvent.pointerDown(article());
    clearSelection();
    fireEvent.mouseUp(article());

    await waitFor(() => expect(screen.queryByTestId('selection-toolbar')).toBeNull());
  });

  it('dismisses the toolbar and selection via Escape', () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    selectContents(article().querySelector('p')?.firstChild ?? null);
    fireEvent.mouseUp(article());
    expect(screen.getByTestId('selection-toolbar')).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('selection-toolbar')).toBeNull();
    expect(window.getSelection()?.toString()).toBe('');
  });

  it('still renders the chapter navigation and segmentation banner wiring', () => {
    render(<ReaderPane sections={DEMO_BOOK.sections} />);
    expect(screen.getByText('上一章')).toBeTruthy();
    expect(screen.getByText('下一章')).toBeTruthy();
    expect(screen.getByTestId('reader-pane')).toBeTruthy();
  });
});
