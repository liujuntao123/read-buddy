import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceCommands from './WorkspaceCommands';
import { useWorkspaceUI } from '@/store/workspaceUIStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { createAgentBookContext, registerAgentBookContext, clearAgentBookContext } from '@/services/agent/agentContext';
import { subscribeLocate, clearLocateListeners } from '@/services/reader/readerLink';
import { handleWorkspaceShortcut } from './workspaceShortcuts';

const text = '开始阅读。原文证据支持判断。再次检查原文证据。';
beforeEach(() => {
  useWorkspaceUI.setState({ commandOpen: false, focused: false, previousSidebar: false });
  useAISidebarStore.setState({ expanded: true });
  useLibraryStore.setState({ view: 'reader', currentHash: 'search-book', books: [] });
  registerAgentBookContext(createAgentBookContext({ bookHash: 'search-book', fullText: text, nodes: [{
    nodeId: 'search-book:n_0', bookHash: 'search-book', nodeIndex: 0, title: '阅读与理解', startOffset: 0, endOffset: text.length,
    charCount: text.length, depth: 0, indexStatus: 'pending',
  }] }));
});
afterEach(() => { clearAgentBookContext('search-book'); clearLocateListeners(); useWorkspaceUI.getState().leaveFocus(); });

describe('workspace reading commands', () => {
  it('searches offline and navigates to the selected occurrence with its exact offset', async () => {
    const locate = vi.fn(); subscribeLocate(locate);
    render(<WorkspaceCommands />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByRole('combobox', { name: '搜索书籍、原文或功能' });
    fireEvent.change(input, { target: { value: '原文证据' } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    expect(locate).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('option')[1]!);
    expect(locate).toHaveBeenCalledWith(expect.objectContaining({ bookHash: 'search-book', nodeIndex: 0, charOffset: text.lastIndexOf('原文证据'), quoteSnippet: '原文证据' }));
    expect(useWorkspaceUI.getState().commandOpen).toBe(false);
  });

  it('restores the sidebar after focus and does not consume Escape inside a dialog', () => {
    render(<WorkspaceCommands />);
    fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true });
    expect(useWorkspaceUI.getState().focused).toBe(true);
    expect(useAISidebarStore.getState().expanded).toBe(false);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useWorkspaceUI.getState().focused).toBe(true);
    act(() => useWorkspaceUI.getState().setCommandOpen(false));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useWorkspaceUI.getState().focused).toBe(false);
    expect(useAISidebarStore.getState().expanded).toBe(true);
  });

  it('supports an EPUB document without letting composition or handled events trigger commands', () => {
    const composing = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, isComposing: true, cancelable: true });
    expect(handleWorkspaceShortcut(composing)).toBe(false);
    const handled = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    handled.preventDefault();
    expect(handleWorkspaceShortcut(handled)).toBe(false);
    const frame = document.createElement('iframe'); document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.addEventListener('keydown', handleWorkspaceShortcut);
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }));
    expect(useWorkspaceUI.getState().commandOpen).toBe(true);
    doc.removeEventListener('keydown', handleWorkspaceShortcut); frame.remove();
  });
});
