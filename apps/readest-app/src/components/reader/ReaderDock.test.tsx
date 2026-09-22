import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReaderDock from './ReaderDock';
import FoliatePane from '@/components/reader/FoliatePane';
import type { EngineLocation, FoliateEngineHandle } from '@/services/library/foliateEngine';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useReaderSettingsStore } from '@/store/readerSettingsStore';
import { useSegmentationStore } from '@/store/segmentationStore';

const TOC = [
  { label: '第一章 迷雾之城', href: 'ch1.xhtml' },
  { label: '第二章 图书馆的密语', href: 'ch2.xhtml' },
  { label: '第三章 长夜漫漫', href: 'ch3.xhtml' },
];

/** 《何为良好生活》 shape: 章 rows with §节 nested under them. */
const NESTED_TOC = [
  { label: '第一章 伦理与伦理学', href: 'ch1.xhtml', depth: 0 },
  { label: '§1 伦理学这个名称', href: 'ch1.xhtml#s1', depth: 1 },
  { label: '§2 伦理与道德', href: 'ch1.xhtml#s2', depth: 1 },
  { label: '第二章 功效主义与自私的基因', href: 'ch2.xhtml', depth: 0 },
  { label: '§1 功效主义简介', href: 'ch2.xhtml#s3', depth: 1 },
];

/**
 * 《思考快与慢》 shape: a FLAT NCX (every row declares depth 0) whose
 * hierarchy lives only in the titles — 第一部分 containers the 第N章 rows
 * that follow it.
 */
const FLAT_NCX_TOC = [
  { label: '第一部分 系统1，系统2', href: 'part1.xhtml', depth: 0 },
  { label: '第1章 一张愤怒的脸', href: 'ch1.xhtml', depth: 0 },
  { label: '第2章 电影的主角与配角', href: 'ch2.xhtml', depth: 0 },
];

const makeEngine = (
  toc: { label: string; href: string; depth?: number }[] = TOC,
): FoliateEngineHandle => {
  const relocators = new Set<(location: EngineLocation) => void>();
  const loaders = new Set<(payload: { doc: Document; index: number }) => void>();
  return {
    openIn: vi.fn(async (container: HTMLElement) => {
      container.appendChild(document.createElement('div'));
    }),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    goTo: vi.fn(async () => {}),
    goToCfi: vi.fn(async () => {}),
    goToFraction: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    onRelocate: vi.fn((cb) => {
      relocators.add(cb);
      return () => relocators.delete(cb);
    }),
    onLoad: vi.fn((cb) => {
      loaders.add(cb);
      return () => loaders.delete(cb);
    }),
    getSpineText: vi.fn(async () => ''),
    getCachedSpineHtml: vi.fn(() => ''),
    getCachedSpineText: vi.fn(() => ''),
    getSpineTitle: vi.fn((index: number) => toc[index]?.label ?? ''),
    get spineCount() {
      return toc.length;
    },
    tocItems: vi.fn(() => toc.map((item) => ({ ...item, depth: item.depth ?? 0 }))),
    tocEntries: vi.fn(() =>
      toc.map((item, index) => ({
        label: item.label,
        href: item.href,
        depth: item.depth ?? 0,
        spineIndex: index,
      })),
    ),
    getSpineAnchors: vi.fn(() => []),
    currentLocation: vi.fn((): EngineLocation | null => null),
    close: vi.fn(),
    setTheme: vi.fn(),
    setLayout: vi.fn(),
    setTypography: vi.fn(),
    getTocIndex: vi.fn((loc: EngineLocation) => {
      const found = toc.findIndex((t) => t.href === loc.tocItemHref);
      return found >= 0 ? found : loc.index;
    }),
    __relocators: relocators,
    __loaders: loaders,
  } as unknown as FoliateEngineHandle & {
    __relocators: Set<(location: EngineLocation) => void>;
  };
};

const relocate = (engine: FoliateEngineHandle, index: number): void => {
  const handle = engine as unknown as {
    __relocators: Set<(location: EngineLocation) => void>;
  };
  const location: EngineLocation = {
    index,
    fraction: (index + 1) / 3,
    cfi: `epubcfi(/6/${index + 1})`,
    tocItemLabel: TOC[index]?.label,
    tocItemHref: TOC[index]?.href,
  };
  for (const cb of handle.__relocators) cb(location);
};

const resetStores = (engine: FoliateEngineHandle | null = null): void => {
  useReaderStore.setState({
    bookHash: engine ? 'engine-book' : 'txt-book',
    bookTitle: engine ? '迷雾之城' : '无目录之书',
    spineIndex: 0,
    anchor: undefined,
    nodeTitle: '',
    spineCount: engine ? TOC.length : 3,
  });
  useLibraryStore.setState({
    books: [],
    view: 'reader',
    importing: false,
    error: null,
    currentHash: engine ? 'engine-book' : 'txt-book',
    engines: engine ? { 'engine-book': engine } : {},
    resumeCfi: null,
  });
  useAISidebarStore.setState({ expanded: false, width: 400, activeTab: 'summary' });
  useSegmentationStore.setState({
    segmentation: null,
    banner: { visible: false, detectedCount: 0 },
    applyDecision: null,
    scanContext: null,
  });
};

beforeEach(() => {
  resetStores();
  window.history.replaceState({}, '', '/');
  window.localStorage.setItem('readest-plus:page-mode', 'double');
  useReaderSettingsStore.getState().reset();
});

afterEach(() => {
  resetStores();
});

describe('ReaderDock', () => {
  it('navigates chapters via the dock buttons and the TOC popover', () => {
    const engine = makeEngine();
    resetStores(engine);
    render(<ReaderDock />);

    act(() => relocate(engine, 1));

    const prev = screen.getByRole('button', { name: '上一章' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: '下一章' }) as HTMLButtonElement;
    expect(prev.disabled || prev.getAttribute('aria-disabled')).toBeFalsy();
    expect(next.disabled || next.getAttribute('aria-disabled')).toBeFalsy();
    fireEvent.click(next);
    expect(engine.goTo).toHaveBeenCalledWith('ch3.xhtml');
    fireEvent.click(prev);
    expect(engine.goTo).toHaveBeenCalledWith('ch1.xhtml');

    // The popover lists every toc entry and navigates on click.
    fireEvent.click(screen.getByTestId('reader-dock-toc-button'));
    const list = screen.getByTestId('reader-dock-toc-list');
    expect(list.textContent).toContain('第二章 图书馆的密语');
    fireEvent.click(screen.getByRole('button', { name: '第三章 长夜漫漫' }));
    expect(engine.goTo).toHaveBeenCalledWith('ch3.xhtml');
  });

  it('disables chapter navigation at the ends of the toc', () => {
    const engine = makeEngine();
    resetStores(engine);
    render(<ReaderDock />);

    act(() => relocate(engine, 0));

    expect(screen.getByRole('button', { name: '上一章' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: '下一章' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('pins the dock while its popover is open (data-open)', () => {
    const engine = makeEngine();
    resetStores(engine);
    render(<ReaderDock />);

    const dock = screen.getByTestId('reader-dock');
    expect(dock.getAttribute('data-open')).toBe('false');

    fireEvent.click(screen.getByTestId('reader-dock-toc-button'));
    expect(dock.getAttribute('data-open')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '第三章 长夜漫漫' }));
    expect(dock.getAttribute('data-open')).toBe('false'); // selection closes it
  });

  it('dismisses open popovers when focus moves into a book iframe (window blur)', () => {
    const engine = makeEngine();
    resetStores(engine);
    render(<ReaderDock />);

    fireEvent.click(screen.getByTestId('reader-dock-toc-button'));
    expect(screen.getByTestId('reader-dock').getAttribute('data-open')).toBe('true');

    // Clicking a chapter iframe blurs the top window: popovers must close.
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(screen.getByTestId('reader-dock').getAttribute('data-open')).toBe('false');
  });

  it('indents nested 节 rows and jumps to their intra-chapter anchor', () => {
    const engine = makeEngine(NESTED_TOC);
    resetStores(engine);
    render(<ReaderDock />);

    fireEvent.click(screen.getByTestId('reader-dock-toc-button'));

    // The declared nesting is preserved: the summary counts both levels.
    expect(screen.getByTestId('reader-dock-toc-list').parentElement!.textContent).toContain(
      '书籍目录 · 2 章 · 3 节',
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-depth'))).toEqual([
      '0',
      '1',
      '1',
      '0',
      '1',
    ]);
    // Only the 节 rows carry the depth indentation.
    expect(rows[0]!.getAttribute('style') ?? '').not.toContain('padding-inline-start');
    expect(rows[1]!.getAttribute('style')).toContain('padding-inline-start');

    // A §节 row navigates to its own anchor, not just the chapter head.
    fireEvent.click(screen.getByRole('button', { name: '§2 伦理与道德' }));
    expect(engine.goTo).toHaveBeenCalledWith('ch1.xhtml#s2');

    // Nav buttons speak the minimal node level: this book has 节.
    expect(screen.getByRole('button', { name: '上一节' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一节' })).toBeTruthy();
  });

  it('stamps the hierarchy of a flat NCX from the titles themselves', () => {
    const engine = makeEngine(FLAT_NCX_TOC);
    resetStores(engine);
    render(<ReaderDock />);

    fireEvent.click(screen.getByTestId('reader-dock-toc-button'));

    // Every row declares depth 0, but 第一部分 containers the 第N章 rows that
    // follow it — so the directory still renders as one 章 and two 节.
    expect(screen.getByTestId('reader-dock-toc-list').parentElement!.textContent).toContain(
      '书籍目录 · 1 章 · 2 节',
    );

    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-depth'))).toEqual(['0', '1', '1']);
    // Row indentation follows the STAMPED depth, not the (flat) declared one.
    expect(rows[0]!.getAttribute('style') ?? '').not.toContain('padding-inline-start');
    expect(rows[1]!.getAttribute('style')).toContain('padding-inline-start');

    // Nav wording follows the minimal node level (has 节 → 上一节 / 下一节).
    expect(screen.getByRole('button', { name: '上一节' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一节' })).toBeTruthy();

    // The flat rows still navigate to their own destinations.
    fireEvent.click(screen.getByRole('button', { name: '第2章 电影的主角与配角' }));
    expect(engine.goTo).toHaveBeenCalledWith('ch2.xhtml');
  });

  it('renders a genuinely single-level book without 节 wording', () => {
    const engine = makeEngine();
    resetStores(engine);
    render(<ReaderDock />);

    fireEvent.click(screen.getByTestId('reader-dock-toc-button'));
    expect(screen.getByTestId('reader-dock-toc-list').parentElement!.textContent).toContain(
      '书籍目录 · 3 章',
    );
    expect(screen.getByRole('button', { name: '上一章' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '下一章' })).toBeTruthy();
  });

  it('lists virtual sections as the TOC for segmented TXT books', () => {
    resetStores(); // no engine: TXT reader
    useSegmentationStore.setState({
      segmentation: {
        bookHash: 'txt-book',
        strategy: 'regex',
        virtualSections: [
          { virtualIndex: 0, title: '第一章 起点', charOffset: 0 },
          { virtualIndex: 1, title: '第二章 转折', charOffset: 100 },
          { virtualIndex: 2, title: '第三章 归途', charOffset: 200 },
        ],
      },
    });

    render(<ReaderDock />);
    // Scroll readers have no page mode: the toggle stays hidden.
    expect(screen.queryByTestId('page-mode-toggle')).toBeNull();

    fireEvent.click(screen.getByTestId('reader-dock-toc-button'));
    expect(screen.getByTestId('reader-dock-toc-list').textContent).toContain('第二章 转折');
    // Virtual sections carry the hierarchy in their titles: 3 章, no 节.
    expect(screen.getByTestId('reader-dock-toc-list').parentElement!.textContent).toContain(
      '书籍目录 · 3 章',
    );

    fireEvent.click(screen.getByRole('button', { name: '第三章 归途' }));
    expect(useReaderStore.getState().spineIndex).toBe(2);
    expect(useReaderStore.getState().nodeTitle).toBe('第三章 归途');
  });

  it('toggles page mode through the store and the pane applies it to the engine', async () => {
    const engine = makeEngine();
    resetStores(engine);
    render(
      <>
        <ReaderDock />
        <FoliatePane engine={engine} />
      </>,
    );
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    // 双页 (default) → 单页: the toggle relabels itself and the pane follows.
    fireEvent.click(screen.getByTestId('page-mode-toggle'));
    expect(useReaderSettingsStore.getState().layout.pageMode).toBe('single');
    expect(window.localStorage.getItem('readest-plus:page-mode')).toBe('single');
    expect(screen.getByTestId('page-mode-toggle').getAttribute('aria-label')).toBe('切换为双页');
    await waitFor(() =>
      expect(engine.setLayout).toHaveBeenLastCalledWith(
        expect.objectContaining({ pageMode: 'single' }),
      ),
    );

    fireEvent.click(screen.getByTestId('page-mode-toggle'));
    expect(useReaderSettingsStore.getState().layout.pageMode).toBe('double');
    expect(window.localStorage.getItem('readest-plus:page-mode')).toBe('double');
    await waitFor(() =>
      expect(engine.setLayout).toHaveBeenLastCalledWith(
        expect.objectContaining({ pageMode: 'double' }),
      ),
    );
  });

  it('exposes reader settings and applies changes live to the engine', async () => {
    const engine = makeEngine();
    resetStores(engine);
    render(
      <>
        <ReaderDock />
        <FoliatePane engine={engine} />
      </>,
    );
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId('reader-settings-button'));
    expect(screen.getByTestId('reader-settings-panel')).toBeTruthy();
    // The dock stays pinned while the settings popover is open.
    expect(screen.getByTestId('reader-dock').getAttribute('data-open')).toBe('true');

    fireEvent.click(screen.getByTestId('font-size-increase'));
    expect(screen.getByTestId('font-size-value').textContent).toBe('18px');
    await waitFor(() =>
      expect(engine.setTypography).toHaveBeenCalledWith(expect.stringContaining('font-size: 18px')),
    );

    fireEvent.click(screen.getByTestId('reader-settings-reset'));
    await waitFor(() =>
      expect(engine.setTypography).toHaveBeenCalledWith(expect.not.stringContaining('18px')),
    );
  });
});
