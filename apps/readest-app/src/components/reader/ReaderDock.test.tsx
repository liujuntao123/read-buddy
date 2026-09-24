import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReaderDock, { DOCK_PEEK_MS } from './ReaderDock';
import FoliatePane from '@/components/reader/FoliatePane';
import type { EngineLocation, FoliateEngineHandle } from '@/services/library/foliateEngine';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useReaderSettingsStore } from '@/store/readerSettingsStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import {
  clearAgentBookContext,
  createAgentBookContext,
  registerAgentBookContext,
} from '@/services/agent/agentContext';
import { bookNodeId, type BookNode } from '@/types/readingAgent';

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
  /** Where the fake viewport is; `currentLocation()` reports it. */
  let location: EngineLocation | null = null;
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
    onUnload: vi.fn(() => () => {}),
    getSpineText: vi.fn(async () => ''),
    getCachedSpineHtml: vi.fn(() => ''),
    getCachedSpineText: vi.fn(() => ''),
    getSpineTitle: vi.fn((index: number) => toc[index]?.label ?? ''),
    get spineCount() {
      return toc.length;
    },
    tocEntries: vi.fn(() =>
      toc.map((item, index) => ({
        label: item.label,
        href: item.href,
        depth: item.depth ?? 0,
        spineIndex: index,
      })),
    ),
    getSpineAnchors: vi.fn(() => []),
    // A real engine reports where the viewport actually is. This fake used to
    // return null forever while still firing relocate events, which let the dock's
    // own `tocPos` and the engine's position disagree — exactly the split 候选 7
    // removed, so the fixture now keeps them consistent.
    currentLocation: vi.fn((): EngineLocation | null => location),
    close: vi.fn(),
    applyPresentation: vi.fn(),
    __relocators: relocators,
    __loaders: loaders,
    __setLocation: (next: EngineLocation) => {
      location = next;
    },
  } as unknown as FoliateEngineHandle & {
    __relocators: Set<(location: EngineLocation) => void>;
  };
};

const relocate = (
  engine: FoliateEngineHandle,
  index: number,
  locationOverride?: Partial<EngineLocation>,
): void => {
  const handle = engine as unknown as {
    __relocators: Set<(location: EngineLocation) => void>;
    __setLocation: (location: EngineLocation) => void;
  };
  const location: EngineLocation = {
    index,
    fraction: (index + 1) / 3,
    cfi: `epubcfi(/6/${index + 1})`,
    tocItemLabel: TOC[index]?.label,
    tocItemHref: TOC[index]?.href,
    ...locationOverride,
  };
  handle.__setLocation(location);
  for (const cb of handle.__relocators) cb(location);
};

/**
 * The book's node model as the index would produce it: rows in document order
 * carrying their **stamped** depth, parent links included. The dock takes its
 * counts from this list — and from nothing else (候选 6).
 */
const registerModel = (
  bookHash: string,
  rows: Array<{ title: string; depth: number; href?: string }>,
): void => {
  let lastChapterId: string | undefined;
  const nodes: BookNode[] = rows.map((row, index) => {
    const nodeId = bookNodeId(bookHash, index);
    const node: BookNode = {
      nodeId,
      bookHash,
      nodeIndex: index,
      title: row.title,
      depth: row.depth,
      startOffset: index * 10,
      endOffset: (index + 1) * 10,
      charCount: 10,
      ...(row.href ? { href: row.href } : {}),
      indexStatus: 'ready',
      ...(row.depth > 0 && lastChapterId ? { parentNodeId: lastChapterId } : {}),
    };
    if (row.depth === 0) lastChapterId = nodeId;
    return node;
  });
  registerAgentBookContext(
    createAgentBookContext({ bookHash, nodes, fullText: 'x'.repeat(rows.length * 10) }),
  );
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
  clearAgentBookContext('engine-book');
  clearAgentBookContext('txt-book');
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

  it('peeks once when a book opens, then fades back on its own', () => {
    vi.useFakeTimers();
    try {
      const engine = makeEngine();
      resetStores(engine);
      render(<ReaderDock />);

      // 开书（bookHash 落地）就让 dock 现身一次：目录 / 排版住在这个角落，只靠
      // 悬停的话新读者根本找不到它们。
      const dock = screen.getByTestId('reader-dock');
      expect(dock.getAttribute('data-peek')).toBe('true');

      act(() => {
        vi.advanceTimersByTime(DOCK_PEEK_MS);
      });
      expect(dock.getAttribute('data-peek')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-peek while the same book stays open', () => {
    vi.useFakeTimers();
    try {
      const engine = makeEngine();
      resetStores(engine);
      const { rerender } = render(<ReaderDock />);
      const dock = screen.getByTestId('reader-dock');
      act(() => {
        vi.advanceTimersByTime(DOCK_PEEK_MS);
      });
      expect(dock.getAttribute('data-peek')).toBe('false');

      // A page turn is not an open: the peek belongs to opening a book.
      rerender(<ReaderDock />);
      expect(dock.getAttribute('data-peek')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
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
    registerModel('engine-book', NESTED_TOC.map((row) => ({ title: row.label, depth: row.depth, href: row.href })));
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

  it('steps 「上一节」 out of a chapter’s first 节 instead of re-rendering its own 章 row', () => {
    // 《说理》 shape (用户反馈): each chapter's file is named twice — the 章 row with
    // no anchor, its first 节 with one. The engine reports whichever matches the
    // viewport, and both must land the reader on the previous 节, never on the
    // page they are already looking at.
    const engine = makeEngine(TOC);
    resetStores(engine);
    registerModel('engine-book', [
      { title: '第1章 迷雾之城', depth: 0, href: 'ch1.xhtml' },
      { title: '§1.1 起雾', depth: 1, href: 'ch1.xhtml#s1' },
      { title: '第2章 图书馆的密语', depth: 0, href: 'ch2.xhtml' },
      { title: '§2.1 星图', depth: 1, href: 'ch2.xhtml#s1' },
    ]);
    render(<ReaderDock />);

    // (a) The viewport sits at the 节's anchor.
    act(() => relocate(engine, 1, { tocItemHref: 'ch2.xhtml#s1', tocItemLabel: '§2.1 星图' }));
    fireEvent.click(screen.getByRole('button', { name: '上一节' }));
    expect(engine.goTo).toHaveBeenLastCalledWith('ch1.xhtml#s1');

    // (b) Same place, reported as the plain file: the 章 row is still not a step.
    vi.mocked(engine.goTo).mockClear();
    act(() => relocate(engine, 1, { tocItemHref: 'ch2.xhtml', tocItemLabel: '第2章 图书馆的密语' }));
    fireEvent.click(screen.getByRole('button', { name: '上一节' }));
    expect(engine.goTo).toHaveBeenLastCalledWith('ch1.xhtml#s1');

    // … and 「下一节」 must not step backwards onto the heading just passed.
    vi.mocked(engine.goTo).mockClear();
    fireEvent.click(screen.getByRole('button', { name: '下一节' }));
    expect(engine.goTo).not.toHaveBeenCalledWith('ch2.xhtml#s1');
  });

  it('stamps the hierarchy of a flat NCX from the titles themselves', () => {
    const engine = makeEngine(FLAT_NCX_TOC);
    resetStores(engine);
    // The model carries the STAMPED depth; the flat directory rows are only the
    // engine's view of it.
    registerModel('engine-book', FLAT_NCX_TOC.map((row, i) => ({ title: row.label, depth: i === 0 ? 0 : 1, href: row.href })));
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
    registerModel('engine-book', TOC.map((row) => ({ title: row.label, depth: 0, href: row.href })));
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

    // The index builds the model from those sections: three first-level nodes.
    registerModel('txt-book', [
      { title: '第一章 起点', depth: 0 },
      { title: '第二章 转折', depth: 0 },
      { title: '第三章 归途', depth: 0 },
    ]);

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

  it('publishes no 章/节 counts before the node model exists', () => {
    // Counting the engine's directory *rows* is what let the same book show two
    // different shapes: the dock counted rows, the companion index counts nodes
    // (same-anchor duplicates collapse). Until the model can answer, the popover
    // lists the directory and claims nothing.
    const engine = makeEngine(NESTED_TOC);
    resetStores(engine);
    render(<ReaderDock />);

    fireEvent.click(screen.getByTestId('reader-dock-toc-button'));

    const summary = screen.getByTestId('reader-dock-toc-list').parentElement!.textContent ?? '';
    expect(summary).toContain('书籍目录');
    expect(summary).not.toContain('2 章');
    expect(summary).not.toContain('3 节');
    // The rows themselves are still complete and indented.
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getAllByRole('listitem')[1]!.getAttribute('style')).toContain(
      'padding-inline-start',
    );
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
      expect(engine.applyPresentation).toHaveBeenLastCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ pageMode: 'single' }) }),
      ),
    );

    fireEvent.click(screen.getByTestId('page-mode-toggle'));
    expect(useReaderSettingsStore.getState().layout.pageMode).toBe('double');
    expect(window.localStorage.getItem('readest-plus:page-mode')).toBe('double');
    await waitFor(() =>
      expect(engine.applyPresentation).toHaveBeenLastCalledWith(
        expect.objectContaining({ layout: expect.objectContaining({ pageMode: 'double' }) }),
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
      expect(engine.applyPresentation).toHaveBeenCalledWith(expect.objectContaining({ typographyCss: expect.stringContaining('font-size: 18px') })),
    );

    fireEvent.click(screen.getByTestId('reader-settings-reset'));
    await waitFor(() =>
      expect(engine.applyPresentation).toHaveBeenCalledWith(expect.objectContaining({ typographyCss: expect.not.stringContaining('18px') })),
    );
  });

  it('allows folding and unfolding individual chapters as well as all chapters', () => {
    const engine = makeEngine(NESTED_TOC);
    resetStores(engine);
    // Deliberately NO node model: this suite keeps covering the pre-index window,
    // where the dock falls back to the engine's directory rows.
    render(<ReaderDock />);

    fireEvent.click(screen.getByTestId('reader-dock-toc-button'));

    // Initially all 5 rows are visible
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('§1 伦理学这个名称')).toBeTruthy();

    // Toggle fold on chapter 0
    const foldToggle0 = screen.getByTestId('chapter-fold-toggle-0');
    fireEvent.click(foldToggle0);

    // Chapter 0's children (§1, §2) are now hidden; chapter 1 and its child (§1) remain visible
    const itemsAfterFold = screen.getAllByRole('listitem');
    expect(itemsAfterFold).toHaveLength(3);
    expect(screen.queryByText('§1 伦理学这个名称')).toBeNull();
    expect(screen.getByText('第二章 功效主义与自私的基因')).toBeTruthy();

    // Toggle "全部折叠"
    const toggleAllBtn = screen.getByTestId('toggle-all-chapters');
    expect(toggleAllBtn.textContent).toBe('全部折叠');
    fireEvent.click(toggleAllBtn);

    // All chapters are folded: only the 2 chapter headers remain visible
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    // Toggle "全部展开"
    expect(toggleAllBtn.textContent).toBe('全部展开');
    fireEvent.click(toggleAllBtn);

    // All 5 rows are visible again
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('§1 伦理学这个名称')).toBeTruthy();
  });
});
