import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

/** A row whose progress the index pipeline resolved in the node space too. */
const withNodeProgress = (hash: string, ordinal: number): LibraryBookMeta => ({
  ...meta(hash),
  lastSpineIndex: ordinal,
  lastNodeIndex: ordinal,
  nodeShape: SHAPE_11_70,
});

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
    // Nothing has been read, so there is nothing to continue.
    expect(screen.queryByTestId('shelf-hero')).toBeNull();
  });

  it('renders a card per book with title, author and format badge', () => {
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
    expect(screen.getAllByText(/未知作者/)).toHaveLength(1);
    // The grid closes with the dashed import card (same slot as a book).
    expect(screen.getByTestId('bookshelf-import-card')).toBeTruthy();
  });

  it('keeps the grid overlay to author · progress and leaves the date to list view', () => {
    render(<Bookshelf store={makeStore([withNodeProgress('hash-a', 3)])} />);

    // The grid line is clamped to one row, so it says what a shelf is scanned
    // for. The import date is not one of those things.
    expect(screen.getByTestId('book-meta-hash-a').textContent).toBe('林晚 · 读至第 4 节');
    expect(screen.queryByText(/导入于/)).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: '列表视图' }));
    expect(screen.getByText(/导入于 2026-01-15/)).toBeTruthy();
  });

  it('states reading progress neutrally when the node shape is unknown', () => {
    render(<Bookshelf store={makeStore([withProgress('hash-a', 3)])} />);
    // The shelf alone has no node shape, so it must not claim 章 or 节.
    const card = screen.getByTestId('book-card-hash-a');
    expect(within(card).getByText(/读至第 4 个位置/)).toBeTruthy();
  });

  it('names the level from the row own shape and node ordinal', () => {
    // The index pipeline recorded both on the row, so the shelf neither guesses a
    // level nor borrows the open book's shape.
    render(<Bookshelf store={makeStore([withNodeProgress('hash-b', 3)])} />);
    const card = screen.getByTestId('book-card-hash-b');
    expect(within(card).getByText(/读至第 4 节/)).toBeTruthy();
    expect(within(card).queryByText(/读至第 4 个位置/)).toBeNull();
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
    const card = screen.getByTestId('book-card-hash-a');
    expect(within(card).getByText(/读至第 13 节/)).toBeTruthy();
    expect(within(card).queryByText(/读至第 4 节/)).toBeNull();
  });

  it('falls back to the neutral wording for books other than the indexed one', () => {
    useBookIndexStore.setState({
      bookHash: 'hash-b',
      shape: { chapter: 12, section: 0, chunk: 0, total: 12, isNested: false, minimalKind: 'chapter' },
    });
    render(<Bookshelf store={makeStore([withProgress('hash-a', 3)])} />);
    // hash-b's shape (a 章-only book) says nothing about hash-a's progress.
    const card = screen.getByTestId('book-card-hash-a');
    expect(within(card).getByText(/读至第 4 个位置/)).toBeTruthy();
    expect(within(card).queryByText(/读至第 4 章/)).toBeNull();
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

  it('reveals the cover ✕ only on hover / keyboard focus, reduced motion respected', () => {
    render(<Bookshelf store={makeStore([meta('hash-a')])} />);

    // The class is the contract; globals.css owns the reveal. A permanent ✕ on
    // every cover was the shelf's noisiest control — and the one that deletes.
    const remove = screen.getByRole('button', { name: '删除书籍' });
    expect(remove.className).toContain('shelf-card-action');

    const css = readFileSync(path.resolve(import.meta.dirname, '../../app/globals.css'), 'utf8');
    expect(css).toContain('.shelf-card:hover .shelf-card-action');
    expect(css).toContain('.shelf-card:focus-within .shelf-card-action');
    // The reveal animates, so it must settle under prefers-reduced-motion.
    const reducedMotion = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reducedMotion).toContain('.shelf-card-action');
  });
});

describe('Bookshelf continue-reading hero', () => {
  it('offers the book behind the shelf, with cover, progress and one primary action', () => {
    const injected = makeStore([withNodeProgress('hash-a', 3)]);
    injected.setState({ currentHash: 'hash-a' });
    const resumeSpy = vi.spyOn(injected.getState(), 'resumeReading');
    render(<Bookshelf store={injected} />);

    const hero = screen.getByTestId('shelf-hero');
    expect(hero.textContent).toContain('上次读到');
    expect(hero.textContent).toContain('书-hash-a');
    expect(hero.textContent).toContain('林晚');
    expect(within(hero).getByTestId('shelf-hero-progress').textContent).toBe('读至第 4 节');
    expect(within(hero).getByTestId('book-cover')).toBeTruthy();

    fireEvent.click(screen.getByTestId('shelf-hero-continue'));
    // Re-entering keeps the live reader session; re-opening would rebuild it.
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    resumeSpy.mockRestore();
  });

  it('falls back to the most recently read book and opens it', () => {
    const injected = makeStore([
      meta('hash-a', { updatedAt: new Date('2026-02-01T00:00:00Z').getTime() }),
      meta('hash-b', { updatedAt: new Date('2026-01-01T00:00:00Z').getTime(), lastSpineIndex: 1 }),
    ]);
    const openSpy = vi.spyOn(injected.getState(), 'open');
    render(<Bookshelf store={injected} />);

    // hash-a is newer but was never read; the hero is about resuming, not recency.
    expect(screen.getByTestId('shelf-hero').textContent).toContain('书-hash-b');
    fireEvent.click(screen.getByTestId('shelf-hero-continue'));
    expect(openSpy).toHaveBeenCalledWith('hash-b');
    openSpy.mockRestore();
  });

  it('stands down while a search query is active', () => {
    render(<Bookshelf store={makeStore([withNodeProgress('hash-a', 3)])} />);
    expect(screen.getByTestId('shelf-hero')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('搜索书名或作者…'), { target: { value: '风' } });
    expect(screen.queryByTestId('shelf-hero')).toBeNull();
  });

  it('shows no hero when nothing has ever been read', () => {
    render(<Bookshelf store={makeStore([meta('hash-a'), meta('hash-b')])} />);
    expect(screen.queryByTestId('shelf-hero')).toBeNull();
  });
});

describe('Bookshelf cover progress bar', () => {
  it('derives the fraction from the node ordinal over the node total', () => {
    render(<Bookshelf store={makeStore([withNodeProgress('hash-a', 3)])} />);

    // Node 3 of 81 → the 4th node, i.e. 4/81.
    const fill = within(screen.getByTestId('book-card-hash-a')).getByTestId('book-cover-progress-fill');
    expect(fill.style.width).toBe('5%');
  });

  it('paints no bar from a spine ordinal, which lives in another coordinate space', () => {
    // Dividing a spine ordinal by a node total is the confusion ADR 0011 exists to
    // prevent (11 spine files, 70 节): a wrong bar is worse than no bar.
    render(<Bookshelf store={makeStore([withProgress('hash-a', 3)])} />);
    const card = screen.getByTestId('book-card-hash-a');
    expect(within(card).queryByTestId('book-cover-progress-bar')).toBeNull();
    expect(within(card).getByText(/读至第 4 个位置/)).toBeTruthy();
  });
});
