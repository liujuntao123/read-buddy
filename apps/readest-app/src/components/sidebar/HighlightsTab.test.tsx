import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HighlightsTab from './HighlightsTab';
import { createHighlightStore, type HighlightRepositoryLike } from '@/store/highlightStore';
import {
  clearLocateListeners,
  subscribeLocate,
  type LocateRequest,
} from '@/services/reader/readerLink';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useChatStore } from '@/store/chatStore';
import { useReaderStore } from '@/store/readerStore';
import {
  clearAgentBookContext,
  createAgentBookContext,
  registerAgentBookContext,
} from '@/services/agent/agentContext';
import { bookNodeId, type BookNode } from '@/types/readingAgent';
import type { ReaderHighlight } from '@/types/highlight';

/**
 * 划线 Tab: what the reader sees and where a click goes.
 *
 * The click path is asserted through the real bus (`subscribeLocate`), because
 * that is the contract the reader panes rely on — a test that only checked a mock
 * would not notice the request losing its `spineIndex`, which is what lets an
 * un-indexed engine book jump straight to the right chapter.
 */
const BOOK = 'book-a';

const row = (over: Partial<ReaderHighlight> & { id: string; quote: string }): ReaderHighlight => ({
  bookHash: BOOK,
  nodeIndex: 1,
  nodeTitle: '第二章 图书馆的密语',
  spineIndex: 1,
  createdAt: 1,
  ...over,
});

const makeStore = (rows: ReaderHighlight[]) => {
  const repository: HighlightRepositoryLike = {
    put: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    listByBook: vi.fn(async (bookHash: string) => rows.filter((r) => r.bookHash === bookHash)),
  };
  return { store: createHighlightStore({ repository }), repository };
};

const registerNodes = (): void => {
  const nodes: BookNode[] = [
    {
      nodeId: bookNodeId(BOOK, 0),
      bookHash: BOOK,
      nodeIndex: 0,
      title: '第一卷 迷雾',
      startOffset: 0,
      endOffset: 50,
      charCount: 50,
      depth: 0,
      indexStatus: 'ready',
    },
    {
      nodeId: bookNodeId(BOOK, 1),
      bookHash: BOOK,
      nodeIndex: 1,
      title: '第二章 图书馆的密语',
      startOffset: 50,
      endOffset: 150,
      charCount: 100,
      depth: 1,
      parentNodeId: bookNodeId(BOOK, 0),
      indexStatus: 'ready',
    },
  ];
  registerAgentBookContext(
    createAgentBookContext({ bookHash: BOOK, nodes, fullText: 'x'.repeat(150) }),
  );
};

let requests: LocateRequest[];
let unsubscribe: () => void;

beforeEach(() => {
  useReaderStore.setState({ bookHash: BOOK, bookTitle: '灯塔之夜', spineIndex: 1 });
  useChatStore.setState({ quoteDraft: null });
  useAISidebarStore.setState({ expanded: false, width: 400, activeTab: 'summary' });
  requests = [];
  unsubscribe = subscribeLocate((request) => requests.push(request));
  registerNodes();
});

afterEach(() => {
  unsubscribe();
  clearLocateListeners();
  clearAgentBookContext(BOOK);
  useChatStore.setState({ quoteDraft: null });
  useAISidebarStore.setState({ expanded: false, activeTab: 'summary' });
  vi.useRealTimers();
  vi.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (navigator as any).clipboard;
});

describe('HighlightsTab', () => {
  it('lists every mark with its quote and where it lives', async () => {
    const { store } = makeStore([
      row({ id: 'a', quote: '穹顶上的星图亮了起来', nodeIndex: 1 }),
      row({ id: 'b', quote: '图书馆的木门在她身后合上', nodeIndex: 1, spineIndex: 0 }),
    ]);
    render(<HighlightsTab store={store} />);

    const items = await screen.findAllByTestId('highlight-item');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('穹顶上的星图亮了起来');
    // The location is the node breadcrumb from the node model, 章 › 节.
    expect(items[0]!.textContent).toContain('第一卷 迷雾 › 第二章 图书馆的密语');
    expect(screen.getByTestId('highlights-tab-panel').textContent).toContain('划线 · 2 处');
  });

  it('explains the empty state instead of showing nothing', async () => {
    const { store } = makeStore([]);
    render(<HighlightsTab store={store} />);
    expect(await screen.findByTestId('highlights-empty')).toBeTruthy();
    expect(screen.getByTestId('highlights-empty').textContent).toContain('还没有划线');
  });

  it('asks for a book before it can list anything', () => {
    useReaderStore.setState({ bookHash: '', spineIndex: 0 });
    const { store } = makeStore([]);
    render(<HighlightsTab store={store} />);
    expect(screen.getByTestId('highlights-tab-panel').textContent).toContain('尚未打开书籍');
  });

  it('jumps to the mark when its row is clicked, section and context included', async () => {
    const { store } = makeStore([
      row({
        id: 'a',
        quote: '穹顶上的星图亮了起来',
        nodeIndex: 1,
        spineIndex: 4,
        prefix: '她身后合上时，',
        suffix: '，一行行微光',
      }),
    ]);
    render(<HighlightsTab store={store} />);

    fireEvent.click(await screen.findByTestId('highlight-item'));
    expect(requests).toEqual([
      {
        bookHash: BOOK,
        nodeIndex: 1,
        spineIndex: 4,
        quoteSnippet: '穹顶上的星图亮了起来',
        anchor: { prefix: '她身后合上时，', suffix: '，一行行微光' },
      },
    ]);
  });

  it('deletes a mark from its row without jumping', async () => {
    const { store, repository } = makeStore([row({ id: 'a', quote: '要删掉的一句' })]);
    render(<HighlightsTab store={store} />);

    fireEvent.click(await screen.findByTestId('delete-highlight'));
    await waitFor(() => expect(repository.remove).toHaveBeenCalledWith('a'));
    expect(requests).toEqual([]);
    await waitFor(() => expect(screen.getByTestId('highlights-empty')).toBeTruthy());
  });

  it('loads the open book on mount', async () => {
    const { store, repository } = makeStore([]);
    render(<HighlightsTab store={store} />);
    await waitFor(() => expect(repository.listByBook).toHaveBeenCalledWith(BOOK));
  });

  it('hands a mark to the chat as a quote draft, without jumping', async () => {
    const { store } = makeStore([row({ id: 'a', quote: '穹顶上的星图亮了起来' })]);
    render(<HighlightsTab store={store} />);

    fireEvent.click(await screen.findByTestId('ask-highlight-ai'));

    // The selection toolbar's own 追问 path: the sidebar expands onto the chat tab
    // and the quote waits in the composer — a mark and a selection enter the same way.
    expect(useChatStore.getState().quoteDraft).toBe('穹顶上的星图亮了起来');
    expect(useAISidebarStore.getState().expanded).toBe(true);
    expect(useAISidebarStore.getState().activeTab).toBe('chat');
    // Asking a question is not a request to move the reader.
    expect(requests).toEqual([]);
  });

  it('dates each row the way a reader would', async () => {
    const createdAt = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const { store } = makeStore([row({ id: 'a', quote: '穹顶上的星图亮了起来', createdAt })]);
    render(<HighlightsTab store={store} />);

    const item = await screen.findByTestId('highlight-item');
    expect(within(item).getByTestId('highlight-created-at').textContent).toContain('3 天前');
  });

  it('copies every mark as Markdown grouped by location', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { store } = makeStore([
      row({ id: 'a', quote: '穹顶上的星图亮了起来', nodeIndex: 1, createdAt: 1 }),
      row({ id: 'b', quote: '图书馆的木门在她身后合上', nodeIndex: 1, createdAt: 2 }),
      row({ id: 'c', quote: '灯火在雾中摇曳', nodeIndex: 2, nodeTitle: '第三章 灯塔', createdAt: 3 }),
    ]);
    render(<HighlightsTab store={store} />);

    fireEvent.click(await screen.findByTestId('copy-highlights'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toBe(
      [
        '# 《灯塔之夜》划线',
        '',
        '## 第一卷 迷雾 › 第二章 图书馆的密语',
        '',
        '> 穹顶上的星图亮了起来',
        '',
        '> 图书馆的木门在她身后合上',
        '',
        '## 第三章 灯塔',
        '',
        '> 灯火在雾中摇曳',
        '',
      ].join('\n'),
    );
    // 「已复制」 is the acknowledgement, not a silent clipboard write.
    await waitFor(() => expect(screen.getByTestId('copy-highlights').textContent).toContain('已复制'));
  });

  it('puts a deleted mark back from the undo row', async () => {
    const { store, repository } = makeStore([
      row({ id: 'a', quote: '要删掉的一句' }),
      row({ id: 'b', quote: '留下的一句', createdAt: 2 }),
    ]);
    render(<HighlightsTab store={store} />);

    fireEvent.click((await screen.findAllByTestId('delete-highlight'))[0]!);
    await waitFor(() => expect(repository.remove).toHaveBeenCalledWith('a'));
    expect(screen.getByTestId('highlight-undo')).toBeTruthy();

    fireEvent.click(screen.getByTestId('highlight-undo-button'));

    // Back under its own id and its own place — that is what makes it an undo
    // rather than a second mark.
    await waitFor(() =>
      expect(repository.put).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a', quote: '要删掉的一句' }),
      ),
    );
    await waitFor(() => expect(screen.getAllByTestId('highlight-item')).toHaveLength(2));
    expect(screen.queryByTestId('highlight-undo')).toBeNull();
  });

  it('drops a pending undo when the reader switches books', async () => {
    const { store } = makeStore([
      row({ id: 'a', quote: '要删掉的一句' }),
      row({ id: 'b', quote: '留下的一句', createdAt: 2 }),
    ]);
    render(<HighlightsTab store={store} />);

    fireEvent.click((await screen.findAllByTestId('delete-highlight'))[0]!);
    expect(await screen.findByTestId('highlight-undo')).toBeTruthy();

    act(() => {
      useReaderStore.setState({ bookHash: 'book-b' });
    });
    // The row it would restore belongs to the book the reader just left.
    await waitFor(() => expect(screen.queryByTestId('highlight-undo')).toBeNull());
  });

  it('closes the undo window on its own, so a stale row cannot come back', async () => {
    const { store } = makeStore([row({ id: 'a', quote: '要删掉的一句' })]);
    render(<HighlightsTab store={store} />);
    const item = await screen.findByTestId('highlight-item');

    vi.useFakeTimers();
    try {
      fireEvent.click(within(item).getByTestId('delete-highlight'));
      // `remove` is async: let its microtask land before looking.
      await act(async () => {});
      // The empty state is what the last row's undo leaves behind, so the window
      // has to be there too.
      expect(screen.getByTestId('highlight-undo')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(screen.queryByTestId('highlight-undo')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
