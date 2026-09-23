import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeaderBar from './HeaderBar';
import type { EngineLocation, FoliateEngineHandle } from '@/services/library/foliateEngine';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useLibraryStore } from '@/store/libraryStore';

const makeEngine = (): FoliateEngineHandle =>
  ({
    openIn: vi.fn(async () => {}),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    goTo: vi.fn(async () => {}),
    goToCfi: vi.fn(async () => {}),
    goToFraction: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    onRelocate: vi.fn(() => () => {}),
    onLoad: vi.fn(() => () => {}),
    getSpineText: vi.fn(async () => ''),
    getCachedSpineHtml: vi.fn(() => ''),
    getCachedSpineText: vi.fn(() => ''),
    getSpineTitle: vi.fn(() => ''),
    spineCount: 3,

    currentLocation: vi.fn((): EngineLocation | null => null),
    close: vi.fn(),
  }) as unknown as FoliateEngineHandle;

const resetStores = (engine: FoliateEngineHandle | null = null): void => {
  useLibraryStore.setState({
    books: [],
    view: engine ? 'reader' : 'shelf',
    importing: false,
    error: null,
    currentHash: engine ? 'engine-book' : null,
    engines: engine ? { 'engine-book': engine } : {},
    resumeCfi: null,
  });
  useAISidebarStore.setState({ expanded: false, width: 400, activeTab: 'summary' });
};

beforeEach(() => {
  resetStores();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  resetStores();
});

describe('HeaderBar', () => {
  it('renders the shelf header: brand, title + count, and the icon-only import action', () => {
    useLibraryStore.setState({
      books: [
        {
          hash: 'h1',
          title: '书一',
          author: undefined,
          format: 'txt',
          size: 1,
          importedAt: 0,
          updatedAt: 0,
        },
      ],
    });
    render(<HeaderBar />);

    expect(screen.getByTestId('header-bar')).toBeTruthy();
    expect(screen.getAllByText('我的书架').length).toBeGreaterThan(0);
    expect(screen.getByText('1 本藏书')).toBeTruthy();
    expect(screen.getByRole('button', { name: '导入书籍' })).toBeTruthy();
    expect(screen.getByTestId('header-import-input')).toBeTruthy();
    // Reading controls have moved to the ReaderDock — none live in the header.
    expect(screen.queryByRole('button', { name: '上一章' })).toBeNull();
    expect(screen.queryByRole('button', { name: '目录' })).toBeNull();
    expect(screen.queryByRole('button', { name: '阅读设置' })).toBeNull();
  });

  it('routes picked files through importFiles', () => {
    const importSpy = vi.spyOn(useLibraryStore.getState(), 'importFiles').mockResolvedValue(undefined);
    render(<HeaderBar />);

    const file = new File([new TextEncoder().encode('第一章 风起之地')], '风起之地.txt');
    const input = screen.getByTestId('header-import-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    expect(importSpy).toHaveBeenCalledWith([file]);
    importSpy.mockRestore();
  });

  it('offers 继续阅读 for a kept-open book and returns to the shelf via 返回书架', () => {
    const engine = makeEngine();
    resetStores(engine);
    render(<HeaderBar />);

    // Reader mode: back button is icon-only but keeps its accessible name.
    fireEvent.click(screen.getByRole('button', { name: '返回书架' }));
    expect(useLibraryStore.getState().view).toBe('shelf');
    expect(useAISidebarStore.getState().expanded).toBe(false);

    // A kept-open book can be resumed directly from the shelf header.
    fireEvent.click(screen.getByRole('button', { name: '继续阅读' }));
    expect(useLibraryStore.getState().view).toBe('reader');
    expect(new URLSearchParams(window.location.search).get('book')).toBe('engine-book');
  });

  it('toggles the AI sidebar (icon-only, same accessible name + shortcut)', () => {
    render(<HeaderBar />);
    fireEvent.click(screen.getByRole('button', { name: '切换 AI 侧边栏' }));
    expect(useAISidebarStore.getState().expanded).toBe(true);
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect(useAISidebarStore.getState().expanded).toBe(false);
  });
});
