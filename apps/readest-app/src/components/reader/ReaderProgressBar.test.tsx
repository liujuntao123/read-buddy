import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReaderProgressBar from './ReaderProgressBar';
import FoliatePane from './FoliatePane';
import type { EngineLocation, FoliateEngineHandle } from '@/services/library/foliateEngine';
import {
  clearAgentBookContext,
  createAgentBookContext,
  registerAgentBookContext,
} from '@/services/agent/agentContext';
import { resetReadingPosition } from '@/services/reader/readingPosition';
import { useBookIndexStore } from '@/store/bookIndexStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { bookNodeId, type BookNode } from '@/types/readingAgent';

/**
 * 阅读进度条（设计文档 §3 FooterBar）。两条取数路径各测一遍：
 * 引擎书籍看 `relocate.fraction` 并以 `goToFraction` 跳转；TXT 看
 * `spineIndex / spineCount`（段内滚动细化）并以 Reading Position 跳转。
 * 位置那句「第 3 / 12 节」的层词一律来自节点模型。
 */

const makeEngine = (): FoliateEngineHandle => {
  const relocators = new Set<(location: EngineLocation) => void>();
  let location: EngineLocation | null = null;
  return {
    openIn: vi.fn(async () => {}),
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
    onLoad: vi.fn(() => () => {}),
    getSpineText: vi.fn(async () => ''),
    getCachedSpineHtml: vi.fn(() => ''),
    getCachedSpineText: vi.fn(() => ''),
    getSpineTitle: vi.fn(() => ''),
    spineCount: 3,
    tocEntries: vi.fn(() => []),
    getSpineAnchors: vi.fn(() => []),
    currentLocation: vi.fn(() => location),
    close: vi.fn(),
    getCover: vi.fn(async () => undefined),
    applyPresentation: vi.fn(),
    presentationDiagnostics: () => ({ viaElement: [], viaRendererFallback: [], unsupported: [] }),
    __setLocation: (next: EngineLocation) => {
      location = next;
    },
    __relocators: relocators,
  } as unknown as FoliateEngineHandle & {
    __relocators: Set<(location: EngineLocation) => void>;
  };
};

const relocate = (engine: FoliateEngineHandle, location: EngineLocation): void => {
  const handle = engine as unknown as {
    __relocators: Set<(location: EngineLocation) => void>;
    __setLocation: (location: EngineLocation) => void;
  };
  handle.__setLocation(location);
  act(() => {
    for (const cb of handle.__relocators) cb(location);
  });
};

const registerModel = (
  bookHash: string,
  rows: Array<{ title: string; depth: number; spineIndex?: number }>,
): void => {
  const nodes: BookNode[] = rows.map((row, index) => ({
    nodeId: bookNodeId(bookHash, index),
    bookHash,
    nodeIndex: index,
    title: row.title,
    depth: row.depth,
    startOffset: index * 10,
    endOffset: (index + 1) * 10,
    charCount: 10,
    ...(row.spineIndex !== undefined ? { spineIndex: row.spineIndex } : {}),
    indexStatus: 'ready',
  }));
  registerAgentBookContext(
    createAgentBookContext({ bookHash, nodes, fullText: 'x'.repeat(rows.length * 10) }),
  );
  // 节点模型落地 = 索引 store 记下这本书的形状（进度条用它当「模型已就绪」的
  // 响应式信号，模型本身从注册表读）。测试里也要照做，否则界面不会重算。
  useBookIndexStore.setState({
    bookHash,
    shape: {
      chapter: rows.filter((row) => row.depth === 0).length,
      section: rows.filter((row) => row.depth > 0).length,
      chunk: 0,
      total: rows.length,
      isNested: rows.some((row) => row.depth > 0),
      minimalKind: rows.some((row) => row.depth > 0) ? 'section' : 'chapter',
    },
  });
};

/** The track's box in tests: happy-dom lays nothing out, so the bar is told. */
const stubTrackBox = (width = 200): HTMLElement => {
  const track = screen.getByTestId('reader-progress-track');
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width,
  } as DOMRect);
  return track;
};

const resetStores = (engine: FoliateEngineHandle | null = null): void => {
  useReaderStore.setState({
    bookHash: engine ? 'engine-book' : 'txt-book',
    bookTitle: engine ? '迷雾之城' : '无目录之书',
    spineIndex: 0,
    anchor: undefined,
    nodeTitle: '',
    spineCount: engine ? 3 : 4,
    sectionFraction: 0,
  });
  useLibraryStore.setState({
    view: 'reader',
    currentHash: engine ? 'engine-book' : 'txt-book',
    engines: engine ? { 'engine-book': engine } : {},
  });
  useSegmentationStore.setState({ segmentation: null });
  useBookIndexStore.getState().reset();
};

beforeEach(() => {
  resetStores();
  resetReadingPosition();
});

afterEach(() => {
  resetStores();
  clearAgentBookContext('engine-book');
  clearAgentBookContext('txt-book');
  vi.restoreAllMocks();
});

describe('ReaderProgressBar', () => {
  it('reads the engine relocate fraction and seeks with goToFraction', async () => {
    const engine = makeEngine();
    resetStores(engine);
    render(<ReaderProgressBar />);

    // Opening a book seeds from the engine's current position.
    relocate(engine, { index: 1, fraction: 0.35, cfi: 'epubcfi(/6/4)' });
    expect(screen.getByTestId('reader-progress-percent').textContent).toBe('35%');
    expect(screen.getByTestId('reader-progress-fill').getAttribute('style')).toContain(
      'inline-size: 35%',
    );

    // Click at the middle of the track: half the book.
    const track = stubTrackBox(200);
    fireEvent.pointerDown(track, { clientX: 100, button: 0 });
    fireEvent.pointerUp(track, { clientX: 100, button: 0 });
    expect(engine.goToFraction).toHaveBeenCalledWith(0.5);
  });

  it('names the position with the node model and no other level word', () => {
    const engine = makeEngine();
    resetStores(engine);
    registerModel('engine-book', [
      { title: '第一章 迷雾之城', depth: 0, spineIndex: 0 },
      { title: '§1 起雾', depth: 1, spineIndex: 1 },
      { title: '§2 灯火', depth: 1, spineIndex: 2 },
    ]);
    useReaderStore.setState({ spineIndex: 2 });
    render(<ReaderProgressBar />);

    // 3rd of 3 nodes of the minimal level (节) — the word comes from `nodeKindLabel`.
    expect(screen.getByTestId('reader-progress-position').textContent).toBe('第 2 / 2 节');
    expect(screen.getByTestId('reader-progress-track').getAttribute('aria-valuetext')).toContain(
      '第 2 / 2 节',
    );
  });

  it('shows only the percentage while the book has no node model', () => {
    render(<ReaderProgressBar />);
    expect(screen.getByTestId('reader-progress-percent')).toBeTruthy();
    expect(screen.queryByTestId('reader-progress-position')).toBeNull();
  });

  it('picks the model up when the index lands (no percentage-only limbo)', async () => {
    render(<ReaderProgressBar />);
    expect(screen.queryByTestId('reader-progress-position')).toBeNull();

    act(() => {
      registerModel('txt-book', [
        { title: '第一章 起点', depth: 0, spineIndex: 0 },
        { title: '第二章 转折', depth: 0, spineIndex: 1 },
      ]);
    });

    await waitFor(() =>
      expect(screen.getByTestId('reader-progress-position').textContent).toBe('第 1 / 2 章'),
    );
  });

  it('derives TXT progress from the section ordinal plus the in-section scroll', () => {
    useReaderStore.setState({ spineIndex: 1, spineCount: 4, sectionFraction: 0.5 });
    render(<ReaderProgressBar />);

    // (1 + 0.5) / 4 half-read section = 37.5% → 38%.
    expect(screen.getByTestId('reader-progress-percent').textContent).toBe('38%');
  });

  it('seeks a segmented TXT book by recording the Reading Position of the target 节', () => {
    useSegmentationStore.setState({
      segmentation: {
        bookHash: 'txt-book',
        strategy: 'regex',
        virtualSections: [
          { virtualIndex: 0, title: '第一章 起点', charOffset: 0 },
          { virtualIndex: 1, title: '第二章 转折', charOffset: 100 },
          { virtualIndex: 2, title: '第三章 归途', charOffset: 200 },
          { virtualIndex: 3, title: '第四章 尾声', charOffset: 300 },
        ],
      },
    });
    render(<ReaderProgressBar />);

    const track = stubTrackBox(200);
    // 75% of a 4-section book → the 4th section (index 3).
    fireEvent.pointerDown(track, { clientX: 150, button: 0 });
    fireEvent.pointerUp(track, { clientX: 150, button: 0 });

    expect(useReaderStore.getState().spineIndex).toBe(3);
    expect(useReaderStore.getState().nodeTitle).toBe('第四章 尾声');
    // …and the strip follows the new position.
    expect(screen.getByTestId('reader-progress-percent').textContent).toBe('75%');
  });

  it('words a TXT position from the virtual sections before the index exists', () => {
    useReaderStore.setState({ spineIndex: 1, spineCount: 3 });
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
    render(<ReaderProgressBar />);

    expect(screen.getByTestId('reader-progress-position').textContent).toBe('第 2 / 3 章');
  });

  it('exposes a slider with the current value and the hovered target', () => {
    const engine = makeEngine();
    resetStores(engine);
    render(<ReaderProgressBar />);
    relocate(engine, { index: 0, fraction: 0.4, cfi: 'epubcfi(/6/2)' });

    const track = screen.getByTestId('reader-progress-track');
    expect(track.getAttribute('role')).toBe('slider');
    expect(track.getAttribute('aria-valuemin')).toBe('0');
    expect(track.getAttribute('aria-valuemax')).toBe('100');
    expect(track.getAttribute('aria-valuenow')).toBe('40');
    expect(track.getAttribute('aria-label')).toBe('阅读进度');
    expect(track.tabIndex).toBe(0);

    // Hovering previews the destination in the native tooltip, without moving.
    const width = stubTrackBox(200);
    fireEvent.pointerMove(width, { clientX: 180 });
    expect(track.getAttribute('title')).toBe('跳转到 90%');
  });

  it('steps with the arrow keys and jumps with Home / End', () => {
    const engine = makeEngine();
    resetStores(engine);
    render(<ReaderProgressBar />);
    relocate(engine, { index: 0, fraction: 0.4, cfi: 'epubcfi(/6/2)' });

    const track = screen.getByTestId('reader-progress-track');
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(engine.goToFraction).toHaveBeenLastCalledWith(0.41);
    fireEvent.keyDown(track, { key: 'ArrowLeft' });
    expect(engine.goToFraction).toHaveBeenLastCalledWith(0.4);
    fireEvent.keyDown(track, { key: 'End' });
    expect(engine.goToFraction).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(track, { key: 'Home' });
    expect(engine.goToFraction).toHaveBeenLastCalledWith(0);

    // Other keys belong to the reader (page turns), not to the track.
    fireEvent.keyDown(track, { key: 'a' });
    expect(engine.goToFraction).toHaveBeenCalledTimes(4);
  });

  it('keeps the reader from also turning the page on the same key', () => {
    const engine = makeEngine();
    resetStores(engine);
    render(
      <>
        <ReaderProgressBar />
        <FoliatePane engine={engine} />
      </>,
    );
    relocate(engine, { index: 0, fraction: 0.4, cfi: 'epubcfi(/6/2)' });

    // 焦点在进度轨上时，方向键是「挪进度」；阅读视窗把同一批按键绑成了翻页，
    // 所以这条事件必须止步于进度条。
    fireEvent.keyDown(screen.getByTestId('reader-progress-track'), { key: 'ArrowRight' });
    expect(engine.goToFraction).toHaveBeenLastCalledWith(0.41);
    expect(engine.next).not.toHaveBeenCalled();

    // …而同一棵树上、焦点不在进度条时，阅读视窗照常翻页（证明上一条不是空断言）。
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(engine.next).toHaveBeenCalledTimes(1);
  });
});
