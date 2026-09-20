'use client';

/**
 * Bookshelf view (ticket 06): lists imported books, imports new files and
 * opens/deletes them. The parent (Workspace) mounts this without props to use
 * the default `useLibraryStore` singleton; tests inject a store built by
 * `createLibraryStore`.
 */
import { useRef } from 'react';
import { BookOpen, LoaderCircle, X } from 'lucide-react';
import type { LibraryBookMeta } from '@/services/library/bookLibrary';
import { useLibraryStore, type LibraryStoreHook } from '@/store/libraryStore';

interface BookshelfProps {
  /** Injectable store seam; defaults to the app-wide singleton. */
  store?: LibraryStoreHook;
}

const FORMAT_LABEL: Record<string, string> = {
  epub: 'EPUB',
  mobi: 'MOBI',
  fb2: 'FB2',
  cbz: 'CBZ',
  txt: 'TXT',
};

const formatDate = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function Bookshelf({ store = useLibraryStore }: BookshelfProps) {
  const books = store((s) => s.books);
  const importing = store((s) => s.importing);
  const error = store((s) => s.error);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pickFiles = () => inputRef.current?.click();

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ''; // allow picking the same file again later
    if (files.length > 0) void store.getState().importFiles(files);
  };

  const openBook = (hash: string) => {
    void store.getState().open(hash);
  };

  const removeBook = (book: LibraryBookMeta) => {
    const ok =
      typeof window.confirm === 'function'
        ? window.confirm(`删除《${book.title}》？该书的总结与对话记录不会被清除。`)
        : true;
    if (ok) void store.getState().remove(book.hash);
  };

  return (
    <section
      className="flex min-w-0 flex-1 flex-col overflow-auto"
      aria-label="本地书架"
      data-testid="bookshelf"
    >
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-base-300 bg-base-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-base-content">我的书架</h2>
        <button
          type="button"
          className="btn btn-primary btn-sm gap-1"
          data-testid="bookshelf-import-button"
          disabled={importing}
          onClick={pickFiles}
        >
          {importing ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <BookOpen className="size-4" aria-hidden="true" />
          )}
          {importing ? '导入中…' : '📥 导入书籍'}
        </button>
        <input
          ref={inputRef}
          data-testid="bookshelf-file-input"
          type="file"
          accept=".epub,.mobi,.azw,.azw3,.prc,.fb2,.fbz,.cbz,.txt"
          multiple
          className="hidden"
          onChange={onInputChange}
        />
      </div>

      {error && (
        <div
          role="alert"
          data-testid="bookshelf-error"
          className="alert alert-error mx-4 mt-4 py-2 text-sm"
        >
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            aria-label="关闭提示"
            onClick={() => store.getState().clearError()}
          >
            知道了
          </button>
        </div>
      )}

      {books.length === 0 ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
          data-testid="bookshelf-empty"
        >
          <p className="text-base-content/60">书架还是空的，导入一本 EPUB 或 TXT 开始阅读</p>
          <button
            type="button"
            className="btn btn-primary btn-lg gap-2"
            data-testid="bookshelf-empty-import-button"
            disabled={importing}
            onClick={pickFiles}
          >
            {importing ? (
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            ) : (
              <BookOpen className="size-5" aria-hidden="true" />
            )}
            📥 导入书籍
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 p-4">
          {books.map((book) => (
            <article
              key={book.hash}
              data-testid={`book-card-${book.hash}`}
              className="card relative border border-base-300 bg-base-100 shadow-sm transition-shadow hover:shadow-md"
            >
              <span
                className={`badge badge-sm absolute left-3 top-3 ${
                  book.format === 'epub' ? 'badge-primary' : 'badge-secondary'
                }`}
              >
                {FORMAT_LABEL[book.format] ?? book.format}
              </span>
              <button
                type="button"
                className="card-body min-h-28 cursor-pointer gap-1 p-4 pt-9 text-left"
                aria-label={`打开《${book.title}》`}
                onClick={() => openBook(book.hash)}
              >
                <h3 className="line-clamp-2 text-sm font-semibold text-base-content">{book.title}</h3>
                <p className="truncate text-xs text-base-content/60">{book.author || '未知作者'}</p>
                <p className="mt-1 text-xs text-base-content/50">导入于 {formatDate(book.importedAt)}</p>
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs absolute right-2 top-2"
                aria-label="删除书籍"
                onClick={(event) => {
                  event.stopPropagation();
                  removeBook(book);
                }}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
