/**
 * Library store (ticket 06): bookshelf state + the import → open → read flow.
 *
 * - the navigation URL (`?book=<hash>`) is the source of truth for which
 *   book is open, so a refresh (or a shared link) restores the reader;
 *   `init` honours the URL first and only falls back to the localStorage
 *   last-book pointer on a clean launch (the pointer is dropped on
 *   `closeToShelf` so refreshing the shelf stays on the shelf);
 * - `importFiles` persists each file and auto-opens the last success;
 * - `open` re-parses the stored bytes, registers the content, wires the
 *   reader store (TXT books go through the segmentation scan/prompt flow;
 *   engine books (ticket 07) keep their Foliate engine alive in `engines`
 *   so shelf round-trips don't reload the book, and expose the persisted
 *   `lastCfi` via `consumeResumeCfi` for the pane to apply after openIn);
 * - `closeToShelf` keeps the reader store and engines intact so the AI
 *   sidebar keeps its context while browsing the shelf, and
 *   `resumeReading` re-enters the kept-open book (继续阅读).
 *
 * Factory `createLibraryStore` takes an injectable database; the app uses the
 * `useLibraryStore` singleton bound to the app-wide Dexie instance.
 */
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { getDatabase, type ReadestPlusDatabase } from '@/services/db/database';
import {
  importBookFile,
  openBook,
  readLibrary,
  removeBook,
  saveProgress,
  type LibraryBookMeta,
} from '@/services/library/bookLibrary';
import { createFoliateEngine, type FoliateEngineHandle } from '@/services/library/foliateEngine';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';
const LAST_BOOK_KEY = 'readest-plus:last-book';

interface LastBookRecord {
  hash: string;
  nodeIndex: number;
}

const readLastBook = (): LastBookRecord | null => {
  try {
    const raw = window.localStorage.getItem(LAST_BOOK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastBookRecord>;
    if (typeof parsed.hash !== 'string' || !parsed.hash) return null;
    return { hash: parsed.hash, nodeIndex: parsed.nodeIndex ?? 0 };
  } catch {
    return null;
  }
};

const writeLastBook = (record: LastBookRecord): void => {
  try {
    window.localStorage.setItem(LAST_BOOK_KEY, JSON.stringify(record));
  } catch {
    /* Storage unavailable (private mode): non-fatal, the book row still
       keeps lastNodeIndex for the next open. */
  }
};

const clearLastBook = (): void => {
  try {
    window.localStorage.removeItem(LAST_BOOK_KEY);
  } catch {
    /* ignore */
  }
};

/** Sync current book hash into the window location URL (?book=<hash>) so refresh keeps state. */
const syncUrl = (hash: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (hash) {
      if (url.searchParams.get('book') !== hash) {
        url.searchParams.set('book', hash);
        window.history.pushState({ book: hash }, '', url.toString());
      }
    } else {
      if (url.searchParams.has('book')) {
        url.searchParams.delete('book');
        window.history.pushState({}, '', url.pathname + (url.search ? url.search : ''));
      }
    }
  } catch {
    /* ignore in test or restricted environments */
  }
};

export type LibraryView = 'shelf' | 'reader';

export interface LibraryState {
  books: LibraryBookMeta[];
  view: LibraryView;
  importing: boolean;
  /** User-visible failure copy for import/open problems (error banner). */
  error: string | null;
  currentHash: string | null;
  /** Live Foliate engines by book hash (ticket 07); closed on remove/switch. */
  engines: Record<string, FoliateEngineHandle>;
  /** CFI to restore once the engine pane has attached (one-shot). */
  resumeCfi: string | null;
  init(): Promise<void>;
  importFiles(files: File[]): Promise<void>;
  open(hash: string): Promise<void>;
  closeToShelf(): void;
  /** Re-enter the reader for the kept-open book (继续阅读): syncs the URL. */
  resumeReading(): void;
  remove(hash: string): Promise<void>;
  saveProgress(): Promise<void>;
  /** Hand the pending resume CFI to the reader pane exactly once. */
  consumeResumeCfi(): string | null;
  clearError(): void;
}

export type LibraryStoreHook = UseBoundStore<StoreApi<LibraryState>>;

export interface LibraryStoreDeps {
  /** Injectable database (tests); defaults to the app singleton. */
  db?: ReadestPlusDatabase;
  /** Engine factory seam (tests inject a fake view module bound factory). */
  createEngine?: typeof createFoliateEngine;
  /** Foliate cover extraction seam forwarded to imports (tests stub it). */
  extractCover?: (file: File) => Promise<string | undefined>;
}

const toMessage = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : '操作失败，请稍后重试';

export function createLibraryStore(deps: LibraryStoreDeps = {}): LibraryStoreHook {
  const db = (): ReadestPlusDatabase => deps.db ?? getDatabase();

  return create<LibraryState>()((set, get) => ({
    books: [],
    view: 'shelf',
    importing: false,
    error: null,
    currentHash: null,
    engines: {},
    resumeCfi: null,

    init: async () => {
      set({ books: await readLibrary({ db: db() }) });
      let targetHash: string | null = null;
      if (typeof window !== 'undefined') {
        try {
          targetHash = new URLSearchParams(window.location.search).get('book');
        } catch {
          targetHash = null;
        }
      }
      if (!targetHash) {
        const last = readLastBook();
        if (last) {
          targetHash = last.hash;
          // Seed the URL in place (replace, not push): restoring the last
          // book is the same logical page as startup, so Back must not gain
          // a bookless entry. `open` then sees the URL already correct.
          try {
            const url = new URL(window.location.href);
            url.searchParams.set('book', targetHash);
            window.history.replaceState({ book: targetHash }, '', url.toString());
          } catch {
            /* ignore in test or restricted environments */
          }
        }
      }
      if (targetHash) {
        const row = await db().books.get(targetHash);
        if (row) {
          try {
            await get().open(targetHash);
            return;
          } catch (err) {
            set({ error: toMessage(err), view: 'shelf' });
          }
        }
      }
      set({ view: 'shelf' });
    },

    importFiles: async (files) => {
      if (files.length === 0) return;
      set({ importing: true, error: null });
      let lastImportedHash: string | null = null;
      const problems: string[] = [];
      try {
        for (const file of files) {
          const result = await importBookFile(file, {
            db: db(),
            extractCover: deps.extractCover,
          });
          if (result.status === 'ok') lastImportedHash = result.book.hash;
          else problems.push(result.message);
        }
        set({ books: await readLibrary({ db: db() }) });
        // Open before surfacing problems: `open` clears the error field on
        // success, which would otherwise swallow the import toast.
        if (lastImportedHash) await get().open(lastImportedHash);
        if (problems.length > 0) set({ error: problems.join('；') });
      } catch (err) {
        set({ error: toMessage(err) });
      } finally {
        set({ importing: false });
      }
    },

    open: async (hash) => {
      const row = await db().books.get(hash);
      if (!row) {
        set({ error: '书籍不存在或已被删除' });
        return;
      }
      try {
        const content = await openBook(row, {
          db: db(),
          createEngine: deps.createEngine,
          // Lazy cover extraction (pre-existing rows): persist + refresh the
          // in-memory shelf so the cover appears without an app restart.
          onCoverExtracted: (cover) => {
            set((state) => ({
              books: state.books.map((book) =>
                book.hash === hash ? { ...book, cover } : book,
              ),
            }));
          },
        });
        let spineCount = content.spineCount;

        // Engines live in this store (ticket 07): opening any other book —
        // engine or TXT — closes the previous engine so blobs/iframes are
        // released. The engine itself survives shelf round-trips.
        for (const [otherHash, otherEngine] of Object.entries(get().engines)) {
          if (otherHash !== hash) otherEngine.close();
        }
        const nextEngines: Record<string, FoliateEngineHandle> = content.engine
          ? { [hash]: content.engine }
          : {};

        // Engine book: no segmentation flow — the spine is real. The pane
        // attaches the view and consumes `resumeCfi` after openIn.
        if (content.engine) {
          const engine = content.engine;
          const target = Math.min(Math.max(row.lastNodeIndex ?? 0, 0), Math.max(spineCount - 1, 0));
          const reader = useReaderStore.getState();
          reader.loadBook({ bookHash: hash, bookTitle: row.title, spineCount });
          reader.setPosition(target, engine.getSpineTitle(target));

          set({
            view: 'reader',
            currentHash: hash,
            error: null,
            engines: nextEngines,
            resumeCfi: row.lastCfi ?? null,
          });
          writeLastBook({ hash, nodeIndex: target });
          syncUrl(hash);
          return;
        }

        // Monolithic TXT: run the segmentation flow. `scanAndPrompt` loads a
        // persisted segmentation (→ virtual chapter count) or shows the
        // detection banner / applies the fixed-length fallback.
        if (row.format === 'txt') {
          const fullText = content.getMonolithicText?.() ?? '';
          await useSegmentationStore.getState().scanAndPrompt(hash, fullText);
          const segmentation = useSegmentationStore.getState().segmentation;
          if (segmentation?.bookHash === hash && segmentation.virtualSections.length > 0) {
            spineCount = segmentation.virtualSections.length;
          }
        }

        const reader = useReaderStore.getState();
        reader.loadBook({ bookHash: hash, bookTitle: row.title, spineCount });
        const target = Math.min(Math.max(row.lastNodeIndex ?? 0, 0), Math.max(spineCount - 1, 0));
        const segmentation = useSegmentationStore.getState().segmentation;
        const virtualTitle =
          segmentation?.bookHash === hash ? segmentation.virtualSections[target]?.title : undefined;
        reader.setPosition(target, virtualTitle ?? content.getSpineTitle(target));

        set({ view: 'reader', currentHash: hash, error: null, engines: nextEngines, resumeCfi: null });
        writeLastBook({ hash, nodeIndex: target });
        syncUrl(hash);
      } catch (err) {
        set({ error: toMessage(err) });
      }
    },

    closeToShelf: () => {
      syncUrl(null);
      // The URL is now bookless: drop the last-book pointer too, so a
      // refresh restores the shelf rather than silently reopening the book
      // the reader just closed.
      clearLastBook();
      useAISidebarStore.getState().setExpanded(false);
      set({ view: 'shelf' });
    },

    /** Return to the currently open book (header 继续阅读): view + URL together. */
    resumeReading: () => {
      const { currentHash } = get();
      if (!currentHash) return;
      set({ view: 'reader' });
      writeLastBook({ hash: currentHash, nodeIndex: useReaderStore.getState().spineIndex });
      syncUrl(currentHash);
    },

    remove: async (hash) => {
      await removeBook(hash, { db: db() });
      const engine = get().engines[hash];
      engine?.close();
      const { [hash]: _closed, ...remainingEngines } = get().engines;
      if (get().currentHash === hash) {
        syncUrl(null);
      }
      set((state) => ({
        books: state.books.filter((book) => book.hash !== hash),
        // Deleting the open book returns to the shelf (registry cache cleared
        // by removeBook); deleting another book keeps the current view.
        currentHash: state.currentHash === hash ? null : state.currentHash,
        view: state.currentHash === hash ? 'shelf' : state.view,
        engines: state.currentHash === hash ? remainingEngines : get().engines,
        resumeCfi: state.currentHash === hash ? null : state.resumeCfi,
      }));
    },

    saveProgress: async () => {
      const { currentHash, engines } = get();
      if (!currentHash) return;
      const { spineIndex } = useReaderStore.getState();
      // Engine books persist the exact position CFI alongside the section.
      const cfi = engines[currentHash]?.currentLocation()?.cfi;
      await saveProgress(currentHash, spineIndex, { db: db(), cfi });
      writeLastBook({ hash: currentHash, nodeIndex: spineIndex });
    },

    consumeResumeCfi: () => {
      const cfi = get().resumeCfi;
      if (cfi) set({ resumeCfi: null });
      return cfi;
    },

    clearError: () => set({ error: null }),
  }));
}

/** App-wide singleton (Workspace / HeaderBar / Bookshelf default binding). */
export const useLibraryStore: LibraryStoreHook = createLibraryStore();
