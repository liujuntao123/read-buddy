import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReadBuddyDatabase } from '@/services/db/database';
import { BookSegmentationRepository } from '@/services/db/repositories';
import { getOpenedBook } from '@/services/library/contentRegistry';
import type { FoliateEngineHandle } from '@/services/library/foliateEngine';
import { DEMO_MONOLITHIC_TXT } from '@/services/reader/demoBook';
import {
  flushReadingPosition,
  recordReadingPosition,
  resetReadingPosition,
} from '@/services/reader/readingPosition';
import { useReaderStore } from '@/store/readerStore';
import {
  createSegmentationStore,
  type SegmentationStoreHook,
} from '@/store/segmentationStore';
import { createLibraryStore, type LibraryStoreHook } from './libraryStore';

let db: ReadBuddyDatabase;
let store: LibraryStoreHook;
let segmentationStore: SegmentationStoreHook;

const resetStores = () => {
  useReaderStore.setState({
    bookHash: '',
    bookTitle: '',
    spineIndex: 0,
    anchor: undefined,
    nodeTitle: '',
    spineCount: 0,
  });
  segmentationStore.setState({ segmentation: null });
};

const txtFile = (name = '风起之地.txt'): File =>
  new File([new TextEncoder().encode(DEMO_MONOLITHIC_TXT)], name);

beforeEach(() => {
  db = new ReadBuddyDatabase(`library-store-test-${Math.random().toString(36).slice(2)}`);
  // The segmentation flow is a dependency of the library store, so it is built
  // against the same injected database — no module global to swap.
  segmentationStore = createSegmentationStore({
    repository: () => new BookSegmentationRepository(db),
  });
  store = createLibraryStore({ db, segmentationStore });
  resetStores();
  window.localStorage.clear();
  // ?book= state must not leak between tests (the store pushes it on open).
  window.history.replaceState({}, '', '/');
});

afterEach(async () => {
  resetReadingPosition();
  await db.delete();
});

describe('createLibraryStore', () => {
  it('imports files, lists them and auto-opens the last successful import', async () => {
    await store.getState().importFiles([txtFile()]);

    const state = store.getState();
    expect(state.books).toHaveLength(1);
    expect(state.books[0]!.format).toBe('txt');
    expect(state.view).toBe('reader');
    expect(state.currentHash).toBe(state.books[0]!.hash);

    const hash = state.books[0]!.hash;
    expect(useReaderStore.getState().bookHash).toBe(hash);
    expect(useReaderStore.getState().bookTitle).toBe('风起之地');
    expect(getOpenedBook(hash)?.getMonolithicText()).toBe(DEMO_MONOLITHIC_TXT);
  });

  it('surfaces import problems as toast copy without blocking good files', async () => {
    await store.getState().importFiles([txtFile(), new File([new Uint8Array([1])], 'bad.pdf')]);

    const state = store.getState();
    expect(state.books).toHaveLength(1); // the txt made it in
    expect(state.error).toContain('暂不支持该文件格式');
    expect(state.view).toBe('reader'); // the good file still auto-opened
    expect(state.importing).toBe(false);
  });

  it('auto-applies the layered segmentation for a txt with detectable chapter headings', async () => {
    await store.getState().importFiles([txtFile()]);

    const segmentation = segmentationStore.getState();
    // Fully automatic: no banner, chapters ready at once.
    expect(segmentation.segmentation?.strategy).toBe('regex');
    expect(segmentation.segmentation?.virtualSections.length).toBe(5);
    expect(useReaderStore.getState().spineCount).toBe(5);
  });

  it('reuses a persisted segmentation as virtual chapters without re-prompting', async () => {
    await store.getState().importFiles([txtFile()]);
    const hash = store.getState().books[0]!.hash;
    await segmentationStore.getState().scanAndPrompt(hash, DEMO_MONOLITHIC_TXT);
    store.getState().closeToShelf();
    expect(store.getState().view).toBe('shelf');
    expect(useReaderStore.getState().bookHash).toBe(hash); // reader context kept

    await store.getState().open(hash);

    expect(segmentationStore.getState().segmentation?.strategy).toBe('regex');
    expect(useReaderStore.getState().spineCount).toBe(5);
    expect(store.getState().view).toBe('reader');
  });

  it('removes a book, clears the registry and returns to the shelf when it was open', async () => {
    await store.getState().importFiles([txtFile()]);
    const hash = store.getState().books[0]!.hash;

    await store.getState().remove(hash);

    const state = store.getState();
    expect(state.books).toHaveLength(0);
    expect(state.currentHash).toBeNull();
    expect(state.view).toBe('shelf');
    expect(getOpenedBook(hash)).toBeUndefined();
    expect(await db.books.get(hash)).toBeUndefined();
  });

  it('records the Reading Position and persists it on flush', async () => {
    await store.getState().importFiles([txtFile()]);
    const hash = store.getState().books[0]!.hash;
    await segmentationStore.getState().scanAndPrompt(hash, DEMO_MONOLITHIC_TXT);
    await store.getState().open(hash);

    // One call: the caller supplies the physical position, not a title. The title
    // here comes from the caller's fallback because this suite drives an *injected*
    // segmentation store, while the Node View's app-edge binding reads the app
    // singleton — in production those are the same object. Title derivation from
    // the node model is covered by `nodeView.test.ts` and
    // `readingPosition.test.ts`, where the model is reachable through the binding.
    const title = recordReadingPosition(
      { bookHash: hash, spineIndex: 3 },
      { titleFallback: '第四章 风起之地4' },
    );
    await flushReadingPosition();

    expect(title).toBe('第四章 风起之地4');
    expect(useReaderStore.getState().nodeTitle).toBe('第四章 风起之地4');
    expect((await db.books.get(hash))?.lastSpineIndex).toBe(3);
    expect(JSON.parse(window.localStorage.getItem('read-buddy:last-book')!)).toEqual({
      hash,
      spineIndex: 3,
    });
  });

  it('persists the Node Anchor so a resumed session resolves the same Book Node', async () => {
    await store.getState().importFiles([txtFile()]);
    const hash = store.getState().books[0]!.hash;
    await segmentationStore.getState().scanAndPrompt(hash, DEMO_MONOLITHIC_TXT);
    await store.getState().open(hash);

    recordReadingPosition({ bookHash: hash, spineIndex: 2, anchor: 'sigil_toc_id_7' });
    await flushReadingPosition();

    const row = await db.books.get(hash);
    expect(row?.lastSpineIndex).toBe(2);
    expect(row?.lastAnchor).toBe('sigil_toc_id_7');

    // Re-open restores the anchor into the reading context, so the Node View
    // resolves the anchored node rather than the section's first one.
    resetStores();
    store = createLibraryStore({ db });
    await store.getState().open(hash);
    expect(useReaderStore.getState().spineIndex).toBe(2);
    expect(useReaderStore.getState().anchor).toBe('sigil_toc_id_7');
  });

  it('still honours a pre-v6 last-book pointer written with the legacy nodeIndex key', async () => {
    await store.getState().importFiles([txtFile()]);
    const hash = store.getState().books[0]!.hash;
    await segmentationStore.getState().scanAndPrompt(hash, DEMO_MONOLITHIC_TXT);
    await db.books.update(hash, { lastSpineIndex: 2 });
    resetStores();
    store = createLibraryStore({ db });

    // ADR 0011: the pointer's field was renamed, but an existing install must
    // not lose its 继续阅读 entry. The pointer supplies the *book*; the restored
    // position comes from the book row itself.
    window.localStorage.setItem(
      'read-buddy:last-book',
      JSON.stringify({ hash, nodeIndex: 2 }),
    );
    await store.getState().init();

    expect(store.getState().view).toBe('reader');
    expect(store.getState().currentHash).toBe(hash);
    expect(useReaderStore.getState().spineIndex).toBe(2);
  });

  it('init restores the last opened book at its saved node', async () => {
    await store.getState().importFiles([txtFile()]);
    const hash = store.getState().books[0]!.hash;
    await segmentationStore.getState().scanAndPrompt(hash, DEMO_MONOLITHIC_TXT);
    await db.books.update(hash, { lastSpineIndex: 3 });
    resetStores(); // simulate an app restart
    store = createLibraryStore({ db });

    window.localStorage.setItem('read-buddy:last-book', JSON.stringify({ hash, spineIndex: 3 }));
    await store.getState().init();

    expect(store.getState().view).toBe('reader');
    expect(store.getState().currentHash).toBe(hash);
    expect(useReaderStore.getState().spineCount).toBe(5);
    expect(useReaderStore.getState().spineIndex).toBe(3);
    expect(useReaderStore.getState().nodeTitle).toBe('第四章 风起之地4');
  });

  it('init falls back to the shelf when no book was opened before', async () => {
    await store.getState().importFiles([txtFile()]);
    window.localStorage.clear();
    window.history.replaceState({}, '', '/'); // refresh with a bookless URL
    resetStores();
    store = createLibraryStore({ db });

    await store.getState().init();

    expect(store.getState().view).toBe('shelf');
    expect(store.getState().books).toHaveLength(1); // shelf still lists the library
    expect(useReaderStore.getState().bookHash).toBe('');
  });

  it('open mirrors the selected book into the ?book= URL param', async () => {
    await store.getState().importFiles([txtFile()]);
    const hash = store.getState().currentHash!;

    expect(new URLSearchParams(window.location.search).get('book')).toBe(hash);

    store.getState().closeToShelf();
    expect(new URLSearchParams(window.location.search).get('book')).toBeNull();

    await store.getState().open(hash);
    expect(new URLSearchParams(window.location.search).get('book')).toBe(hash);
  });

  it('init restores the book encoded in the URL (refresh keeps the reader)', async () => {
    await store.getState().importFiles([txtFile()]);
    const hash = store.getState().books[0]!.hash;
    await segmentationStore.getState().scanAndPrompt(hash, DEMO_MONOLITHIC_TXT);
    await db.books.update(hash, { lastSpineIndex: 2 });

    // Simulate a refresh on the reader: URL still carries ?book=<hash>, and
    // the URL wins over any stale localStorage pointer.
    window.localStorage.setItem('read-buddy:last-book', JSON.stringify({ hash: 'other', spineIndex: 0 }));
    resetStores();
    store = createLibraryStore({ db });
    await store.getState().init();

    expect(store.getState().view).toBe('reader');
    expect(store.getState().currentHash).toBe(hash);
    expect(useReaderStore.getState().spineIndex).toBe(2); // persisted node
  });

  it('closeToShelf drops the last-book pointer so a refresh stays on the shelf', async () => {
    await store.getState().importFiles([txtFile()]);
    expect(window.localStorage.getItem('read-buddy:last-book')).toBeTruthy();

    store.getState().closeToShelf();
    expect(window.localStorage.getItem('read-buddy:last-book')).toBeNull();

    resetStores();
    store = createLibraryStore({ db });
    await store.getState().init();
    expect(store.getState().view).toBe('shelf');
  });

  it('resumeReading re-enters the kept-open book and restores the ?book= URL', async () => {
    await store.getState().importFiles([txtFile()]);
    const hash = store.getState().currentHash!;
    store.getState().closeToShelf();
    expect(new URLSearchParams(window.location.search).get('book')).toBeNull();

    store.getState().resumeReading();

    expect(store.getState().view).toBe('reader');
    expect(store.getState().currentHash).toBe(hash);
    expect(new URLSearchParams(window.location.search).get('book')).toBe(hash);
  });

  it('open reports a missing book instead of throwing', async () => {
    await store.getState().open('no-such-hash');
    expect(store.getState().error).toBe('书籍不存在或已被删除');
    expect(store.getState().view).toBe('shelf');
  });

  // ── Ticket 07: Foliate engine books ─────────────────────────────────────

  const makeEngine = (opts: { spineCount?: number; cfi?: string; cover?: string } = {}) => {
    let current = opts.cfi ?? null;
    return {
      openIn: vi.fn(async () => {}),
      prepare: vi.fn(async () => {}),
      goToCfi: vi.fn(async () => {}),
      next: vi.fn(async () => {}),
      prev: vi.fn(async () => {}),
      goTo: vi.fn(async () => {}),
      goToFraction: vi.fn(async () => {}),
      onRelocate: vi.fn(() => () => {}),
      onLoad: vi.fn(() => () => {}),
      getSpineText: vi.fn(async () => ''),
      getCachedSpineHtml: vi.fn(() => ''),
      getCachedSpineText: vi.fn(() => ''),
      getSpineTitle: vi.fn((index: number) => `第 ${index + 1} 章`),
      spineCount: opts.spineCount ?? 3,
      currentLocation: vi.fn(() => (current ? { index: 1, fraction: 0.5, cfi: current } : null)),
      getCover: vi.fn(async () => opts.cover),
      close: vi.fn(() => {
        current = null;
      }),
      __setCfi: (cfi: string | null) => {
        current = cfi;
      },
    };
  };
  type EngineDouble = ReturnType<typeof makeEngine>;

  const engineStore = (engine: EngineDouble): LibraryStoreHook =>
    createLibraryStore({
      db,
      createEngine: () => engine as unknown as FoliateEngineHandle,
      // Keep unit tests hermetic: never import the vendored foliate view.
      extractCover: async () => undefined,
    });

  const mobiFile = (): File => new File([new Uint8Array([1, 2, 3, 4])], '冰与火之诗.mobi');

  it('opens an engine book: reader context, engine registry, resume CFI', async () => {
    const engine = makeEngine();
    store = engineStore(engine);
    resetStores();
    await store.getState().importFiles([mobiFile()]);

    const state = store.getState();
    expect(state.books).toHaveLength(1);
    expect(state.books[0]!.format).toBe('mobi');
    expect(state.view).toBe('reader');
    const hash = state.currentHash!;
    expect(hash).toBe(state.books[0]!.hash);
    expect(state.engines[hash]).toBe(engine);

    expect(useReaderStore.getState().bookHash).toBe(hash);
    expect(useReaderStore.getState().spineCount).toBe(3); // engine spine
    expect(useReaderStore.getState().nodeTitle).toBe('第 1 章');
    expect(getOpenedBook(hash)?.spineCount).toBe(3);
    expect(state.resumeCfi).toBeNull(); // never read before
    expect(state.consumeResumeCfi()).toBeNull();
  });

  it('saves engine progress including the CFI and restores it on re-open', async () => {
    const engine = makeEngine();
    store = engineStore(engine);
    resetStores();
    await store.getState().importFiles([mobiFile()]);
    const hash = store.getState().currentHash!;

    engine.__setCfi('epubcfi(/6/8!/2/2)');
    // No CFI in hand: the owner falls back to the live engine's location at
    // write time, exactly as the store used to.
    recordReadingPosition({ bookHash: hash, spineIndex: 1 });
    await flushReadingPosition();

    expect((await db.books.get(hash))?.lastSpineIndex).toBe(1);
    expect((await db.books.get(hash))?.lastCfi).toBe('epubcfi(/6/8!/2/2)');

    // Re-open (fresh store, same fake engine) resumes from the stored CFI.
    resetStores();
    store = engineStore(engine);
    await store.getState().open(hash);
    expect(useReaderStore.getState().spineIndex).toBe(1);
    expect(useReaderStore.getState().nodeTitle).toBe('第 2 章');
    expect(store.getState().resumeCfi).toBe('epubcfi(/6/8!/2/2)');
    expect(store.getState().consumeResumeCfi()).toBe('epubcfi(/6/8!/2/2)');
    expect(store.getState().consumeResumeCfi()).toBeNull(); // one-shot
  });

  it('syncs a lazily extracted cover into the shelf list without a restart', async () => {
    const cover = 'data:image/jpeg;base64,QUJD';
    const engine = makeEngine({ cover });
    store = engineStore(engine);
    resetStores();
    await store.getState().importFiles([mobiFile()]);
    const hash = store.getState().currentHash!;
    expect(store.getState().books[0]!.cover).toBeUndefined(); // not at import

    // openBook's lazy engine.getCover() path resolves after open; wait for
    // the store to fold the extracted cover into the shelf list.
    await vi.waitFor(() => {
      expect(store.getState().books.find((b) => b.hash === hash)?.cover).toBe(cover);
    });
    expect((await db.books.get(hash))?.cover).toBe(cover); // persisted too
  });

  it('closes the previous engine when opening or deleting another book', async () => {    const engineA = makeEngine();
    store = engineStore(engineA);
    resetStores();
    await store.getState().importFiles([mobiFile()]);
    const hashA = store.getState().currentHash!;
    expect(store.getState().engines[hashA]).toBe(engineA);

    // Opening the TXT switches books: engine A must be closed and dropped.
    await store.getState().importFiles([txtFile()]);
    expect(engineA.close).toHaveBeenCalledTimes(1);
    expect(store.getState().engines[hashA]).toBeUndefined();

    // Opening a book and deleting it closes its engine too.
    const engineB = makeEngine();
    store = engineStore(engineB);
    resetStores();
    await store.getState().importFiles([new File([new Uint8Array([9, 9])], '第二本.mobi')]);
    const hashB = store.getState().currentHash!;
    await store.getState().remove(hashB);
    expect(engineB.close).toHaveBeenCalledTimes(1);
    expect(store.getState().view).toBe('shelf');
    expect(store.getState().engines[hashB]).toBeUndefined();
  });
});
