/**
 * Library store (ticket 06): bookshelf state + the import → open → read flow.
 *
 * - `init` restores the last opened book (localStorage pointer + persisted
 *   `lastSectionIndex`/`lastCfi`) or lands on the shelf;
 * - `importFiles` persists each file and auto-opens the last success;
 * - `open` re-parses the stored bytes, registers the content, wires the
 *   reader store (TXT books go through the segmentation scan/prompt flow;
 *   engine books (ticket 07) keep their Foliate engine alive in `engines`
 *   so shelf round-trips don't reload the book, and expose the persisted
 *   `lastCfi` via `consumeResumeCfi` for the pane to apply after openIn);
 * - `closeToShelf` keeps the reader store and engines intact so the AI
 *   sidebar keeps its context while browsing the shelf.
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

const LAST_BOOK_KEY = 'readest-plus:last-book';

interface LastBookRecord {
  hash: string;
  sectionIndex: number;
}

const readLastBook = (): LastBookRecord | null => {
  try {
    const raw = window.localStorage.getItem(LAST_BOOK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastBookRecord>;
    if (typeof parsed.hash !== 'string' || !parsed.hash) return null;
    return { hash: parsed.hash, sectionIndex: parsed.sectionIndex ?? 0 };
  } catch {
    return null;
  }
};

const writeLastBook = (record: LastBookRecord): void => {
  try {
    window.localStorage.setItem(LAST_BOOK_KEY, JSON.stringify(record));
  } catch {
    /* Storage unavailable (private mode): non-fatal, the book row still
       keeps lastSectionIndex for the next open. */
  }
};

export type LibraryView = 'shelf' | 'reader';

export interface LibraryState {
  books: LibraryBookMeta[];
  view: LibraryView;
  importing: boolean;
  /** User-visible failure copy for import/open problems (alert-error). */
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
      const last = readLastBook();
      if (last) {
        const row = await db().books.get(last.hash);
        if (row) {
          try {
            await get().open(last.hash);
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
          const result = await importBookFile(file, { db: db() });
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
        const content = await openBook(row, { db: db(), createEngine: deps.createEngine });
        let sectionCount = content.sectionCount;

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
          const target = Math.min(Math.max(row.lastSectionIndex ?? 0, 0), Math.max(sectionCount - 1, 0));
          const reader = useReaderStore.getState();
          reader.loadBook({ bookHash: hash, bookTitle: row.title, sectionCount });
          reader.setSection(target, engine.getSectionTitle(target));

          set({
            view: 'reader',
            currentHash: hash,
            error: null,
            engines: nextEngines,
            resumeCfi: row.lastCfi ?? null,
          });
          writeLastBook({ hash, sectionIndex: target });
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
            sectionCount = segmentation.virtualSections.length;
          }
        }

        const reader = useReaderStore.getState();
        reader.loadBook({ bookHash: hash, bookTitle: row.title, sectionCount });
        const target = Math.min(Math.max(row.lastSectionIndex ?? 0, 0), Math.max(sectionCount - 1, 0));
        const segmentation = useSegmentationStore.getState().segmentation;
        const virtualTitle =
          segmentation?.bookHash === hash ? segmentation.virtualSections[target]?.title : undefined;
        reader.setSection(target, virtualTitle ?? content.getSectionTitle(target));

        set({ view: 'reader', currentHash: hash, error: null, engines: nextEngines, resumeCfi: null });
        writeLastBook({ hash, sectionIndex: target });
      } catch (err) {
        set({ error: toMessage(err) });
      }
    },

    closeToShelf: () => set({ view: 'shelf' }),

    remove: async (hash) => {
      await removeBook(hash, { db: db() });
      const engine = get().engines[hash];
      engine?.close();
      const { [hash]: _closed, ...remainingEngines } = get().engines;
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
      const { sectionIndex } = useReaderStore.getState();
      // Engine books persist the exact position CFI alongside the section.
      const cfi = engines[currentHash]?.currentLocation()?.cfi;
      await saveProgress(currentHash, sectionIndex, { db: db(), cfi });
      writeLastBook({ hash: currentHash, sectionIndex });
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
