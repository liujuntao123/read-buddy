import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import Workspace from './Workspace';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useReaderStore } from '@/store/readerStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { FoliateEngineHandle } from '@/services/library/foliateEngine';

const sidebarState = () => useAISidebarStore.getState();

beforeEach(() => {
  useAISidebarStore.setState({ expanded: false, width: 400, activeTab: 'summary' });
  // The library store pushes ?book=<hash> on open; keep tests isolated.
  window.history.replaceState({}, '', '/');
});

const expand = () => fireEvent.click(screen.getByRole('button', { name: '切换 AI 侧边栏' }));

describe('Workspace split-screen shell', () => {
  it('renders the header and the empty bookshelf before any book is opened', () => {
    render(<Workspace />);
    expect(screen.getAllByText('我的书架').length).toBeGreaterThan(0);
    expect(screen.getByTestId('bookshelf')).toBeTruthy();
    // Ticket 06: startup no longer auto-loads the demo book; the reader pane
    // only appears once a library book is opened.
    expect(screen.queryByTestId('reader-pane')).toBeNull();
    expect(screen.queryByTestId('ai-sidebar')).toBeNull();
    expect(screen.queryByTestId('summary-tab-panel')).toBeNull();
  });

  it('shows and hides the sidebar via the header toggle button', () => {
    render(<Workspace />);
    expand();
    expect(screen.getByTestId('ai-sidebar')).toBeTruthy();
    expect(screen.getByTestId('summary-tab-panel')).toBeTruthy();
    expect(screen.getByTestId('sidebar-resize-handle')).toBeTruthy();
    expand();
    expect(screen.queryByTestId('ai-sidebar')).toBeNull();
  });

  it('collapses the sidebar via its close button', () => {
    render(<Workspace />);
    expand();
    fireEvent.click(screen.getByRole('button', { name: '关闭 AI 侧边栏' }));
    expect(screen.queryByTestId('ai-sidebar')).toBeNull();
    expect(sidebarState().expanded).toBe(false);
  });

  it('toggles the sidebar with Ctrl+/ and Cmd+/', () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect(sidebarState().expanded).toBe(true);
    fireEvent.keyDown(window, { key: '/', metaKey: true });
    expect(sidebarState().expanded).toBe(false);
    // Plain "/" without modifier must not toggle.
    fireEvent.keyDown(window, { key: '/' });
    expect(sidebarState().expanded).toBe(false);
  });

  it('switches between the summary and chat tabs', () => {
    render(<Workspace />);
    expand();
    expect(screen.getByTestId('summary-tab-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '伴读' }));
    expect(screen.getByTestId('chat-tab-panel')).toBeTruthy();
    expect(screen.queryByTestId('summary-tab-panel')).toBeNull();
    expect(sidebarState().activeTab).toBe('chat');
    fireEvent.click(screen.getByRole('tab', { name: '总结' }));
    expect(screen.getByTestId('summary-tab-panel')).toBeTruthy();
    expect(sidebarState().activeTab).toBe('summary');
  });

  it('clamps a left drag past 600px down to the sidebar max width', () => {
    render(<Workspace />);
    expand();
    const handle = screen.getByTestId('sidebar-resize-handle');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(sidebarState().width).toBe(600);
    expect((screen.getByTestId('ai-sidebar') as HTMLElement).style.width).toBe('600px');
  });

  it('clamps a right drag below 320px up to the sidebar min width', () => {
    render(<Workspace />);
    expand();
    const handle = screen.getByTestId('sidebar-resize-handle');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1100 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(sidebarState().width).toBe(320);
  });

  it('applies intermediate drag positions without clamping inside the range', () => {
    render(<Workspace />);
    expand();
    const handle = screen.getByTestId('sidebar-resize-handle');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    expect(sidebarState().width).toBe(500);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 750 });
    expect(sidebarState().width).toBe(450);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(sidebarState().width).toBe(450);
  });

  it('opens the AI settings panel from the sidebar header', () => {
    render(<Workspace />);
    expand();
    fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
    expect(screen.getByTestId('ai-settings-panel')).toBeTruthy();
  });

  it('imports a dropped txt file (drop overlay included) and opens the reader', async () => {
    const { container } = render(<Workspace />);
    const root = container.firstElementChild as HTMLElement;

    // Drag-hover overlay appears, and disappears again on drag-leave.
    fireEvent.dragOver(root);
    expect(screen.getByTestId('drop-import-overlay').textContent).toContain('松开以导入书籍');
    fireEvent.dragLeave(root, { relatedTarget: null });
    expect(screen.queryByTestId('drop-import-overlay')).toBeNull();

    const file = new File([new TextEncoder().encode('第一章 起点\n\n第一段正文。')], '落书.txt');
    fireEvent.drop(root, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByTestId('reader-pane')).toBeTruthy());
    expect(useLibraryStore.getState().view).toBe('reader');
    expect(useLibraryStore.getState().books).toHaveLength(1);
    expect(useReaderStore.getState().bookHash).toBe(useLibraryStore.getState().books[0]!.hash);
  });

  it('returns to the shelf via the header 书库 button and keeps the reader context', async () => {
    const { container } = render(<Workspace />);
    const root = container.firstElementChild as HTMLElement;
    const file = new File([new TextEncoder().encode('第二章 不同的内容\n\n第二段正文。')], '落书二.txt');
    fireEvent.drop(root, { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId('reader-pane')).toBeTruthy());
    const hash = useReaderStore.getState().bookHash;

    // Expand sidebar while reading
    act(() => {
      useAISidebarStore.setState({ expanded: true });
    });
    expect(useAISidebarStore.getState().expanded).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '返回书架' }));

    expect(screen.getByTestId('bookshelf')).toBeTruthy();
    expect(screen.queryByTestId('reader-pane')).toBeNull();
    // Breadcrumbs switched to shelf!
    expect(screen.getAllByText('我的书架').length).toBeGreaterThan(0);
    // Auxiliary sidebar collapsed on returning to shelf!
    expect(useAISidebarStore.getState().expanded).toBe(false);
    expect(useReaderStore.getState().bookHash).toBe(hash);
    // "继续阅读" button is available
    expect(screen.getByRole('button', { name: '继续阅读' })).toBeTruthy();
  });

  it('renders engine books through the Foliate pane instead of the scroll reader', async () => {
    window.localStorage.removeItem('readest-plus:last-book');
    render(<Workspace />);

    // Ticket 07: an engine registered for the current book switches the
    // reading viewport to the paginated pane (TXT/demo keep ReaderPane).
    const engine = {
      openIn: async (el: HTMLElement) => {
        el.appendChild(document.createElement('div'));
      },
      prepare: async () => {},
      goToCfi: async () => {},
      next: async () => {},
      prev: async () => {},
      goTo: async () => {},
      goToFraction: async () => {},
      onRelocate: () => () => {},
      onLoad: () => () => {},
      getSpineText: async () => '',
      getCachedSpineHtml: () => '',
      getCachedSpineText: () => '',
      getSpineTitle: () => '第一章',
      spineCount: 1,
      tocItems: () => [],
      tocEntries: () => [],
      getSpineAnchors: () => [],
      currentLocation: () => null,
      close: () => {},
    } as unknown as FoliateEngineHandle;

    act(() => {
      useLibraryStore.setState({
        view: 'reader',
        currentHash: 'engine-book',
        engines: { 'engine-book': engine },
      });
    });

    expect(await screen.findByTestId('foliate-pane')).toBeTruthy();
    expect(screen.queryByTestId('reader-pane')).toBeNull();

    useLibraryStore.setState({ view: 'shelf', currentHash: null, engines: {} });
  });
});
