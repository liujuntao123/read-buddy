import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Bookshelf from './Bookshelf';
import { ReadestPlusDatabase } from '@/services/db/database';
import { createLibraryStore, type LibraryStoreHook } from '@/store/libraryStore';
import type { LibraryBookMeta } from '@/services/library/bookLibrary';

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

beforeEach(() => {
  db = new ReadestPlusDatabase(`bookshelf-test-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await db.delete();
});

describe('Bookshelf', () => {
  it('shows the empty-state hint and import button when the shelf has no books', () => {
    render(<Bookshelf store={makeStore()} />);
    expect(screen.getByTestId('bookshelf')).toBeTruthy();
    expect(screen.getByTestId('bookshelf-empty')).toBeTruthy();
    expect(screen.getByText('书架还是空的，导入一本 EPUB 或 TXT 开始阅读')).toBeTruthy();
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
    expect(screen.getByText('书-hash-a')).toBeTruthy();
    expect(screen.getByText('风起之地')).toBeTruthy();
    expect(screen.getByText('EPUB')).toBeTruthy();
    expect(screen.getByText('TXT')).toBeTruthy();
    expect(screen.getAllByText(/导入于 2026-01-15/)).toHaveLength(2);
    expect(screen.getByText('未知作者')).toBeTruthy();
  });

  it('opens the book when a card is clicked', () => {
    const injected = makeStore([meta('hash-a')]);
    const openSpy = vi.spyOn(injected.getState(), 'open');
    render(<Bookshelf store={injected} />);

    fireEvent.click(screen.getByRole('button', { name: '打开《书-hash-a》' }));
    expect(openSpy).toHaveBeenCalledWith('hash-a');
    openSpy.mockRestore();
  });

  it('deletes the book behind a confirm dialog via the card ✕', () => {
    const confirmSpy = vi.fn(() => true);
    Object.defineProperty(window, 'confirm', { value: confirmSpy, configurable: true, writable: true });

    const injected = makeStore([meta('hash-a')]);
    const removeSpy = vi.spyOn(injected.getState(), 'remove');
    render(<Bookshelf store={injected} />);

    fireEvent.click(screen.getByRole('button', { name: '删除书籍' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith('hash-a');
    removeSpy.mockRestore();
  });

  it('keeps the book when the confirm dialog is dismissed', () => {
    Object.defineProperty(window, 'confirm', { value: vi.fn(() => false), configurable: true, writable: true });
    const injected = makeStore([meta('hash-a')]);
    const removeSpy = vi.spyOn(injected.getState(), 'remove');
    render(<Bookshelf store={injected} />);

    fireEvent.click(screen.getByRole('button', { name: '删除书籍' }));
    expect(removeSpy).not.toHaveBeenCalled();
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
    injected.setState({ error: '「bad.mobi」暂不支持该格式（待 Foliate 引擎接入）' });
    render(<Bookshelf store={injected} />);

    expect(screen.getByTestId('bookshelf-error').textContent).toContain('暂不支持该格式（待 Foliate 引擎接入）');
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(injected.getState().error).toBeNull();
  });
});
