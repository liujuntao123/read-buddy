/**
 * Highlight store — the reader's 划线 marks for the book that is open.
 *
 * The seam follows the repo convention (`summaryStore`, `chatStore`): a factory
 * takes its dependencies so tests run hermetically against an injected
 * repository, id factory and clock, and the app-level singleton lives at the
 * bottom. Components reach it through a **prop defaulted to the singleton**, so
 * a test never has to mutate a module global.
 *
 * The store owns exactly one book's highlights: it loads them when a book is
 * opened, appends and removes as the reader marks, and hands the panes the slice
 * belonging to the chapter they are painting. Finding the marks again in the DOM
 * is not its business — that is `services/reader/readerHighlight`'s job, and it
 * works off the text anchor these rows carry.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  compareHighlights,
  highlightId,
  type NewReaderHighlight,
  type ReaderHighlight,
} from '@/types/highlight';
import { HighlightRepository } from '@/services/db/repositories';

/** The slice of the repository this store needs (so tests can inject a fake). */
export interface HighlightRepositoryLike {
  put(highlight: ReaderHighlight): Promise<void>;
  remove(id: string): Promise<void>;
  listByBook(bookHash: string): Promise<ReaderHighlight[]>;
}

export interface HighlightState {
  /** The book these highlights belong to; '' before any book is opened. */
  bookHash: string;
  /** Document order (`compareHighlights`). */
  highlights: ReaderHighlight[];
  /** True once a load for `bookHash` finished (drives empty states). */
  loaded: boolean;
  error: string | null;
  /** Load (or reload) one book's highlights. */
  load: (bookHash: string) => Promise<void>;
  /**
   * Mark a selection. Returns the stored row, or the **existing** row when this
   * exact place was already marked (marking the same sentence twice must not
   * create a second row: two rows on one range would paint two different
   * sentences, see `readerHighlight`'s occurrence matching).
   */
  add: (input: NewReaderHighlight) => Promise<ReaderHighlight | null>;
  remove: (id: string) => Promise<void>;
  /**
   * Put a deleted row back (the 划线 tab's undo). Not `add`: an undo must keep the
   * row's identity and its place in document order, and `add` would mint a new id
   * and re-derive the anchor from whatever is at hand.
   */
  restore: (row: ReaderHighlight) => Promise<void>;
  /** The rows belonging to one physical section, in document order. */
  forSection: (spineIndex: number) => ReaderHighlight[];
}

export type HighlightStore = UseBoundStore<StoreApi<HighlightState>>;

export interface HighlightStoreDeps {
  repository: HighlightRepositoryLike;
  /** Injectable identity/time seams (repo convention: `idFactory` / `now`). */
  idFactory?: () => string;
  now?: () => number;
}

const randomId = (): string => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** The same place: same node, same quote, same left-hand context. */
const isSamePlace = (existing: ReaderHighlight, input: NewReaderHighlight): boolean =>
  existing.nodeIndex === input.nodeIndex &&
  existing.quote === input.quote &&
  (existing.prefix ?? '') === (input.prefix ?? '');

export function createHighlightStore({
  repository,
  idFactory = randomId,
  now = Date.now,
}: HighlightStoreDeps): HighlightStore {
  /** Guards `load` against out-of-order responses when the reader switches books. */
  let loadToken = 0;

  return create<HighlightState>()((set, get) => ({
    bookHash: '',
    highlights: [],
    loaded: false,
    error: null,

    load: async (bookHash) => {
      const token = (loadToken += 1);
      if (get().bookHash !== bookHash) {
        // Switching books must not briefly show the previous book's marks.
        set({ bookHash, highlights: [], loaded: false, error: null });
      }
      try {
        const rows = await repository.listByBook(bookHash);
        if (token !== loadToken) return;
        set({ bookHash, highlights: [...rows].sort(compareHighlights), loaded: true, error: null });
      } catch (error) {
        if (token !== loadToken) return;
        set({
          bookHash,
          highlights: [],
          loaded: true,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    add: async (input) => {
      const quote = input.quote.trim();
      if (!input.bookHash || !quote) return null;
      const normalized: NewReaderHighlight = { ...input, quote };
      const existing = get().highlights.find((row) => isSamePlace(row, normalized));
      if (existing) return existing;

      const row: ReaderHighlight = {
        id: highlightId(input.bookHash, idFactory()),
        bookHash: input.bookHash,
        nodeIndex: input.nodeIndex,
        nodeTitle: input.nodeTitle,
        spineIndex: input.spineIndex,
        ...(input.anchor ? { anchor: input.anchor } : {}),
        quote,
        ...(input.prefix ? { prefix: input.prefix } : {}),
        ...(input.suffix ? { suffix: input.suffix } : {}),
        createdAt: now(),
      };
      await repository.put(row);
      // Only the open book's list is on screen; a row for another book is stored
      // and picked up by that book's own `load`.
      if (get().bookHash === row.bookHash) {
        set((state) => ({
          highlights: [...state.highlights, row].sort(compareHighlights),
          error: null,
        }));
      }
      return row;
    },

    remove: async (id) => {
      await repository.remove(id);
      set((state) => ({ highlights: state.highlights.filter((row) => row.id !== id) }));
    },

    restore: async (row) => {
      await repository.put(row);
      // Another book's row is stored and picked up by that book's own `load`,
      // exactly as `add` does. The id is dropped first so an undo after a double
      // delete cannot list the same mark twice.
      if (get().bookHash !== row.bookHash) return;
      set((state) => ({
        highlights: [...state.highlights.filter((existing) => existing.id !== row.id), row].sort(
          compareHighlights,
        ),
        error: null,
      }));
    },

    forSection: (spineIndex) => get().highlights.filter((row) => row.spineIndex === spineIndex),
  }));
}

/**
 * App-wide singleton: the Dexie-backed repository. Components take it as a prop
 * defaulted to this value (`SummaryTab`/`ChatTab` convention).
 */
export const useHighlightStore: HighlightStore = createHighlightStore({
  repository: new HighlightRepository(),
});
