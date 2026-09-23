import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Bookshelf from './Bookshelf';
import { ReadestPlusDatabase } from '@/services/db/database';
import { createLibraryStore, type LibraryStoreHook } from '@/store/libraryStore';
import { useBookIndexStore } from '@/store/bookIndexStore';
import type { LibraryBookMeta } from '@/services/library/bookLibrary';
import type { BookNodeShape } from '@/services/bookNodes';

let db: ReadestPlusDatabase;
let store: LibraryStoreHook;

const makeStore = (books: LibraryBookMeta[] = []): LibraryStoreHook => {
  const created = createLibraryStore({ db });
  created.setState({ books });
  return created;
};

const meta = (hash: string, overrides: Partial<LibraryBookMeta> = {}): LibraryBookMeta => ({
  hash,
  title: `书-${hash}`,
  author: '林晚',
  format: 'epub',
  size: 1024,
  importedAt: new Date('2026-01-15T10:00:00Z').getTime(),
  updatedAt: new Date('2026-01-15T10:00:00Z').getTime(),
  ...overrides,
});

/** 11 章 · 70 节 — the 《何为良好生活》 shape. */
const SHAPE_11_70: BookNodeShape = {
  chapter: 11,
  section: 70,
  chunk: 0,
  total: 81,
  isNested: true,
  minimalKind: 'section',
};

/** A shelf row that carries reading progress. */
const withProgress = (hash: string, ordinal: number): LibraryBookMeta =>
  ({
    ...meta(hash),
    lastSpineIndex: ordinal,
  }) as unknown as LibraryBookMeta;

beforeEach(() => {
  db = new ReadestPlusDatabase(`bookshelf-test-${Math.random().toString(36).slice(2)}`);
  // The shelf reads the node shape of the currently indexed book only.
  useBookIndexStore.getState().reset();
});

afterEach(async () => {
  useBookIndexStore.getState().reset();
  await db.delete();
});

describe('Bookshelf', () => {
  it('shows the empty-state hint and import button when the shelf has no books', () => {
    render(<Bookshelf store={makeStore()} />);
    expect(screen.getByTestId('bookshelf')).toBeTruthy();
    expect(screen.getByTestId('bookshelf-empty')).toBeTruthy();
    expect(screen.getByText('导入电子书或直接将文件拖入此处开始阅读')).toBeTruthy();
    expect(screen.getByTestId('bookshelf-empty-import-button')).toBeTruthy();
  });

  it('renders a card per book with title, author, format badge and import date', () => {
    render(
      <Bookshelf
        store={makeStore([meta('hash-a'), meta('hash-b', { title: '风起之地', format: 'txt', author: undefined })])}
      />,
    );
    expect(screen.getByTestId('book-card-hash-a')).toBeTruthy();
    expect(screen.getByTestId('book-card-hash-b')).toBeTruthy();
    expect(screen.getByTestId('book-format-hash-a').textContent).toBe('EPUB');
    expect(screen.getByTestId('book-format-hash-b').textContent).toBe('TXT');
    // Coverless books carry the title inside the typographic 《》 cover art.
    expect(screen.getByText(/书-hash-a/)).toBeTruthy();
    expect(screen.getByText(/风起之地/)).toBeTruthy();
    // Author · import date share one overlaid meta line per card.
    expect(screen.getAllByText(/导入于 2026-01-15/)).toHaveLength(2);
    expect(screen.getByText(/未知作者/)).toBeTruthy();
    // The grid closes with the dashed import card (same slot as a book).
    expect(screen.getByTestId('bookshelf-import-card')).toBeTruthy();
  });

  it('states reading progress neutrally when the node shape is unknown', () => {
    render(<Bookshelf store={makeStore([withProgress('hash-a', 3)])} />);
    // The shelf alone has no node shape, so it must not claim 章 or 节.
    expect(screen.getByText(/读至第 4 个位置/)).toBeTruthy();
  });

  it('names the level from the row own shape and node ordinal', () => {
    // The index pipeline recorded both on the row, so the shelf neither guesses a
    // level nor borrows the open book's shape.
    render(
      <Bookshelf
        store={makeStore([
          {
            ...meta('hash-b', { format: 'txt' }),
            lastSpineIndex: 3,
            lastNodeIndex: 3,
            nodeShape: SHAPE_11_70,
          },
        ])}
      />,
    );
    expect(screen.getByText(/读至第 4 节/)).toBeTruthy();
    expect(screen.queryByText(/读至第 4 个位置/)).toBeNull();
  });

  it('reports the NODE ordinal, not the spine ordinal, for an engine book', () => {
    // The regression: 《何为良好生活》 ships 11 spine files and 70 节, so spine 3 is
    // not node 3. The shelf used to print 「读至第 4 节」 for it because it fed a
    // spine ordinal into node-model wording.
    render(
      <Bookshelf
        store={makeStore([{ ...withProgress('hash-a', 3), lastNodeIndex: 12, nodeShape: SHAPE_11_70 }])}
      />,
    );

    // Spine 3, node 12 → the 13th 节, never 「第 4 节」.
    expect(screen.getByText(/读至第 13 节/)).toBeTruthy();
    expect(screen.queryByText(/读至第 4 节/)).toBeNull();
  });

  it('falls back to the neutral wording for books other than the indexed one', () => {
    useBookIndexStore.setState({
      bookHash: 'hash-b',
      shape: { chapter: 12, section: 0, chunk: 0, total: 12, isNested: false, minimalKind: 'chapter' },
    });
    render(<Bookshelf store={makeStore([withProgress('hash-a', 3)])} />);
    // hash-b's shape (a 章-only book) says nothing about hash-a's progress.
    expect(screen.getByText(/读至第 4 个位置/)).toBeTruthy();
    expect(screen.queryByText(/读至第 4 章/)).toBeNull();
  });

  it('opens the book when a card is clicked', () => {
    const injected = makeStore([meta('hash-a')]);
    const openSpy = vi.spyOn(injected.getState(), 'open');
    render(<Bookshelf store={injected} />);

    fireEvent.click(screen.getByRole('button', { name: '打开《书-hash-a》' }));
    expect(openSpy).toHaveBeenCalledWith('hash-a');
    openSpy.mockRestore();
  });

  it('opens the book when the card body (cover area) itself is clicked', () => {
    const injected = makeStore([meta('hash-a')]);
    const openSpy = vi.spyOn(injected.getState(), 'open');
    render(<Bookshelf store={injected} />);

    // The article (cover + margins included) must be an open trigger too —
    // regression: clicking the cover did nothing and readers got stuck on
    // the shelf.
    fireEvent.click(screen.getByTestId('book-card-hash-a'));
    expect(openSpy).toHaveBeenCalledWith('hash-a');
    openSpy.mockRestore();
  });

  it('opens the book from list view and reacts to row clicks', () => {
    const injected = makeStore([meta('hash-a')]);
    const openSpy = vi.spyOn(injected.getState(), 'open');
    render(<Bookshelf store={injected} />);

    fireEvent.click(screen.getByRole('radio', { name: '列表视图' }));
    fireEvent.click(screen.getByRole('button', { name: '打开《书-hash-a》' }));
    expect(openSpy).toHaveBeenCalledWith('hash-a');

    openSpy.mockClear();
    fireEvent.click(screen.getByTestId('book-card-hash-a'));
    expect(openSpy).toHaveBeenCalledWith('hash-a');
    openSpy.mockRestore();
  });

  it('deletes the book behind a custom dialog via the card ✕ with artifact deletion option', () => {
    const injected = makeStore([meta('hash-a')]);
    const removeSpy = vi.spyOn(injected.getState(), 'remove').mockResolvedValue(undefined);
    render(<Bookshelf store={injected} />);

    fireEvent.click(screen.getByRole('button', { name: '删除书籍' }));
    expect(screen.getByTestId('delete-book-dialog')).toBeTruthy();
    expect(screen.getByText('同时删除阅读记录与 AI 伴读数据')).toBeTruthy();

    // Check the checkbox to also delete artifacts
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByTestId('confirm-delete-button'));
    expect(removeSpy).toHaveBeenCalledWith('hash-a', { deleteArtifacts: true });
    removeSpy.mockRestore();
  });

  it('keeps the book when the custom confirm dialog is dismissed', () => {
    const injected = makeStore([meta('hash-a')]);
    const removeSpy = vi.spyOn(injected.getState(), 'remove').mockResolvedValue(undefined);
    render(<Bookshelf store={injected} />);

    fireEvent.click(screen.getByRole('button', { name: '删除书籍' }));
    expect(screen.getByTestId('delete-book-dialog')).toBeTruthy();

    fireEvent.click(screen.getByTestId('cancel-delete-button'));
    expect(removeSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('delete-book-dialog')).toBeNull();
    removeSpy.mockRestore();
  });

  it('routes picked files through importFiles', () => {
    const injected = makeStore();
    const importSpy = vi.spyOn(injected.getState(), 'importFiles').mockResolvedValue(undefined);
    render(<Bookshelf store={injected} />);

    const file = new File([new TextEncoder().encode('第一章 风起之地')], '风起之地.txt');
    const input = screen.getByTestId('bookshelf-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    expect(importSpy).toHaveBeenCalledTimes(1);
    expect(importSpy.mock.calls[0]![0]).toEqual([file]);
    importSpy.mockRestore();
  });

  it('renders the error toast with a dismiss action', () => {
    const injected = makeStore([meta('hash-a')]);
    injected.setState({ error: '「bad.mobi」暂不支持该文件格式' });
    render(<Bookshelf store={injected} />);

    expect(screen.getByTestId('bookshelf-error').textContent).toContain('暂不支持该文件格式');
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(injected.getState().error).toBeNull();
  });
});
