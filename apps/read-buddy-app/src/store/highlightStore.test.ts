import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHighlightStore, type HighlightRepositoryLike } from './highlightStore';
import { highlightId, type NewReaderHighlight, type ReaderHighlight } from '@/types/highlight';

/**
 * The highlight store's contract.
 *
 * Repository, id factory and clock are injected, so every case is plain values —
 * the same seam `summaryStore` / `conversationManager` use. Two behaviours are
 * worth more than the rest: a book switch must never show the previous book's
 * marks, and marking the same place twice must not create a second row (two rows
 * on one range would paint two *different* sentences; see `readerHighlight`).
 */
const fakeRepository = (seed: ReaderHighlight[] = []) => {
  const rows = new Map(seed.map((row) => [row.id, row]));
  const repository: HighlightRepositoryLike = {
    put: vi.fn(async (row: ReaderHighlight) => {
      rows.set(row.id, row);
    }),
    remove: vi.fn(async (id: string) => {
      rows.delete(id);
    }),
    listByBook: vi.fn(async (bookHash: string) =>
      [...rows.values()].filter((row) => row.bookHash === bookHash),
    ),
  };
  return { repository, rows };
};

const row = (over: Partial<ReaderHighlight> & { id: string; quote: string }): ReaderHighlight => ({
  bookHash: 'book-a',
  nodeIndex: 0,
  nodeTitle: '第一章',
  spineIndex: 0,
  createdAt: 1,
  ...over,
});

const input = (over: Partial<NewReaderHighlight> = {}): NewReaderHighlight => ({
  bookHash: 'book-a',
  nodeIndex: 3,
  nodeTitle: '第二章 图书馆',
  spineIndex: 1,
  quote: '穹顶上的星图亮了起来',
  prefix: '她身后合上时，',
  suffix: '，一行行微光',
  ...over,
});

describe('createHighlightStore', () => {
  let harness: ReturnType<typeof fakeRepository>;
  let store: ReturnType<typeof createHighlightStore>;
  let nextId: number;

  beforeEach(() => {
    nextId = 0;
    harness = fakeRepository([
      row({ id: 'book-a:h_old', quote: '旧的划线', nodeIndex: 2, createdAt: 5 }),
      row({ id: 'book-b:h_other', bookHash: 'book-b', quote: '别的书', createdAt: 1 }),
    ]);
    store = createHighlightStore({
      repository: harness.repository,
      idFactory: () => `u${(nextId += 1)}`,
      now: () => 100,
    });
  });

  it('loads one book, in document order, and never another book’s rows', async () => {
    await store.getState().load('book-a');
    const state = store.getState();
    expect(state.bookHash).toBe('book-a');
    expect(state.highlights.map((r) => r.id)).toEqual(['book-a:h_old']);
    expect(state.loaded).toBe(true);
    expect(state.error).toBeNull();
  });

  it('clears the previous book’s marks the moment another book is opened', async () => {
    await store.getState().load('book-a');
    const pending = store.getState().load('book-b');
    // Synchronously, before the read resolves: nothing stale on screen.
    expect(store.getState().bookHash).toBe('book-b');
    expect(store.getState().highlights).toEqual([]);
    await pending;
    expect(store.getState().highlights.map((r) => r.id)).toEqual(['book-b:h_other']);
  });

  it('adds a mark with its text anchor and identity', async () => {
    await store.getState().load('book-a');
    const created = await store.getState().add(input());

    expect(created).not.toBeNull();
    expect(created!.id).toBe(highlightId('book-a', 'u1'));
    expect(created).toMatchObject({
      bookHash: 'book-a',
      nodeIndex: 3,
      nodeTitle: '第二章 图书馆',
      spineIndex: 1,
      quote: '穹顶上的星图亮了起来',
      prefix: '她身后合上时，',
      suffix: '，一行行微光',
      createdAt: 100,
    });
    expect(harness.repository.put).toHaveBeenCalledWith(created);
    expect(store.getState().highlights.map((r) => r.id)).toEqual(['book-a:h_old', created!.id]);
  });

  it('does not mark the same place twice', async () => {
    await store.getState().load('book-a');
    const first = await store.getState().add(input());
    const again = await store.getState().add(input());

    expect(again!.id).toBe(first!.id);
    expect(store.getState().highlights).toHaveLength(2); // the seeded row + one new
    expect(harness.repository.put).toHaveBeenCalledTimes(1);

    // A different sentence in the same node IS a new row.
    const other = await store.getState().add(input({ quote: '另一句被划的话' }));
    expect(other!.id).not.toBe(first!.id);
  });

  it('trims the quote and refuses a blank one', async () => {
    await store.getState().load('book-a');
    const created = await store.getState().add(input({ quote: '  有内容  ' }));
    expect(created!.quote).toBe('有内容');
    expect(await store.getState().add(input({ quote: '   ' }))).toBeNull();
    expect(await store.getState().add(input({ bookHash: '' }))).toBeNull();
  });

  it('stores another book’s row without showing it', async () => {
    await store.getState().load('book-a');
    const created = await store.getState().add(input({ bookHash: 'book-c', quote: '别的书的话' }));
    expect(created).not.toBeNull();
    expect(store.getState().highlights.map((r) => r.id)).toEqual(['book-a:h_old']);
    expect(harness.repository.put).toHaveBeenCalledTimes(1);
  });

  it('removes a mark from the list as well as the table', async () => {
    await store.getState().load('book-a');
    await store.getState().remove('book-a:h_old');
    expect(store.getState().highlights).toEqual([]);
    expect(harness.repository.remove).toHaveBeenCalledWith('book-a:h_old');
  });

  it('hands the panes only the rows of the section they are painting', async () => {
    await store.getState().load('book-a');
    await store.getState().add(input({ spineIndex: 1, quote: '第一节的一句' }));
    await store.getState().add(input({ spineIndex: 7, quote: '第七节的一句' }));

    expect(store.getState().forSection(1).map((r) => r.quote)).toEqual(['第一节的一句']);
    expect(store.getState().forSection(7).map((r) => r.quote)).toEqual(['第七节的一句']);
    expect(store.getState().forSection(99)).toEqual([]);
  });

  it('reports a read failure instead of pretending the book has no marks', async () => {
    harness.repository.listByBook = vi.fn(async () => {
      throw new Error('IndexedDB 不可用');
    });
    await store.getState().load('book-a');
    expect(store.getState().error).toBe('IndexedDB 不可用');
    expect(store.getState().loaded).toBe(true);
    expect(store.getState().highlights).toEqual([]);
  });

  it('drops a stale response when the reader switched books mid-read', async () => {
    const resolvers: Array<(rows: ReaderHighlight[]) => void> = [];
    harness.repository.listByBook = vi.fn(
      () =>
        new Promise<ReaderHighlight[]>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const first = store.getState().load('book-a');
    const second = store.getState().load('book-b');
    // book-a answers *after* the switch; book-b answers with nothing.
    resolvers[0]!([row({ id: 'late', bookHash: 'book-a', quote: '迟到的行' })]);
    resolvers[1]!([]);
    await Promise.all([first, second]);
    // The late answer belongs to book-a and must not land in book-b's list.
    expect(store.getState().bookHash).toBe('book-b');
    expect(store.getState().highlights).toEqual([]);
  });

  it('restores a deleted row under its own id, back in document order', async () => {
    await store.getState().load('book-a');
    const added = await store.getState().add(input({ quote: '中间的一句', nodeIndex: 5 }));
    await store.getState().remove(added!.id);
    expect(store.getState().highlights.map((r) => r.id)).toEqual(['book-a:h_old']);

    await store.getState().restore(added!);

    // Same id, same place — that is what makes it an undo rather than a second
    // mark on the same sentence.
    expect(store.getState().highlights.map((r) => r.id)).toEqual(['book-a:h_old', added!.id]);
    expect(await harness.repository.listByBook('book-a')).toHaveLength(2);
  });

  it('stores another book’s restored row without showing it', async () => {
    await store.getState().load('book-a');
    await store.getState().restore(
      row({ id: 'book-b:h_other', bookHash: 'book-b', quote: '别的书' }),
    );
    expect(store.getState().highlights.map((r) => r.id)).toEqual(['book-a:h_old']);
    expect(await harness.repository.listByBook('book-b')).toHaveLength(1);
  });

  it('never lists the same row twice when an undo repeats', async () => {
    await store.getState().load('book-a');
    const existing = row({ id: 'book-a:h_old', quote: '旧的划线', nodeIndex: 2, createdAt: 5 });

    await store.getState().restore(existing);
    await store.getState().restore(existing);

    expect(store.getState().highlights.filter((r) => r.id === 'book-a:h_old')).toHaveLength(1);
  });
});
