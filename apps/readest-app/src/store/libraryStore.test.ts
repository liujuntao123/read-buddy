import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReadestPlusDatabase } from '@/services/db/database';
import { BookSegmentationRepository } from '@/services/db/repositories';
import { getOpenedBook } from '@/services/library/contentRegistry';
import type { FoliateEngineHandle } from '@/services/library/foliateEngine';
import { DEMO_MONOLITHIC_TXT } from '@/services/reader/demoBook';
import { useReaderStore } from '@/store/readerStore';
import { setSegmentationRepository, useSegmentationStore } from '@/store/segmentationStore';
import { createLibraryStore, type LibraryStoreHook } from './libraryStore';

let db: ReadestPlusDatabase;
let store: LibraryStoreHook;

const resetStores = () => {
  useReaderStore.setState({
    bookHash: '',
    bookTitle: '',
    sectionIndex: 0,
    chapterTitle: '',
    sectionCount: 0,
  });
  useSegmentationStore.setState({
    segmentation: null,
    banner: { visible: false, detectedCount: 0 },
    applyDecision: null,
    scanContext: null,
  });
};

const txtFile = (name = '风起之地.txt'): File =>
  new File([new TextEncoder().encode(DEMO_MONOLITHIC_TXT)], name);

beforeEach(() => {
  db = new ReadestPlusDatabase(`library-store-test-${Math.random().toString(36).slice(2)}`);
  // The segmentation flow persists through the shared segmentationStore seam;
  // point it at the same injected database so the whole flow is isolated.
  setSegmentationRepository(new BookSegmentationRepository(db));
  store = createLibraryStore({ db });
  resetStores();
  window.localStorage.clear();
});

afterEach(async () => {
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
    expect(getOpenedBook(hash)?.getMonolithicText?.()).toBe(DEMO_MONOLITHIC_TXT);
  });

  it('surfaces import problems as toast copy without blocking good files', async () => {
    await store.getState().importFiles([txtFile(), new File([new Uint8Array([1])], 'bad.pdf')]);

    const state = store.getState();
    expect(state.books).toHaveLength(1); // the txt made it in
    expect(state.error).toContain('暂不支持该格式（待 Foliate 引擎接入）');
    expect(state.view).toBe('reader'); // the good file still auto-opened
    expect(state.importing).toBe(false);
  });

  it('prompts segmentation for a txt with detectable chapter headings', async () => {
    await store.getState().importFiles([txtFile()]);

    const segmentation = useSegmentationStore.getState();
    expect(segmentation.banner.visible).toBe(true);
    expect(segmentation.banner.detectedCount).toBe(5);
    expect(useReaderStore.getState().sectionCount).toBe(1); // before the user decides
  });

  it('reuses a persisted segmentation as virtual chapters without re-prompting', async () => {
    await store.getState().importFiles([txtFile()]);
    const hash = store.getState().books[0]!.hash;
    await useSegmentationStore.getState().applyRegex(hash, DEMO_MONOLITHIC_TXT);
    store.getState().closeToShelf();
    expect(store.getState().view).toBe('shelf');
    expect(useReaderStore.getState().bookHash).toBe(hash); // reader context kept

    await store.getState().open(hash);

    expect(useSegmentationStore.getState().banner.visible).toBe(false);
    expect(useSegmentationStore.getState().segmentation?.strategy).toBe('regex');
    expect(useReaderStore.getState().sectionCount).toBe(5);
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

  it('saves the current section as reading progress', async () => {
    await store.getState().importFiles([txtFile()]);
    const hash = store.getState().books[0]!.hash;
    await useSegmentationStore.getState().applyRegex(hash, DEMO_MONOLITHIC_TXT);
    await store.getState().open(hash);

    useReaderStore.getState().setSection(3, '第四章 风起之地4');
    await store.getState().saveProgress();

    expect((await db.books.get(hash))?.lastSectionIndex).toBe(3);
    expect(JSON.parse(window.localStorage.getItem('readest-plus:last-book')!)).toEqual({
      hash,
      sectionIndex: 3,
    });
  });

  it('init restores the last opened book at its saved section', async () => {
    await store.getState().importFiles([txtFile()]);
    const hash = store.getState().books[0]!.hash;
    await useSegmentationStore.getState().applyRegex(hash, DEMO_MONOLITHIC_TXT);
    await db.books.update(hash, { lastSectionIndex: 3 });
    resetStores(); // simulate an app restart
    store = createLibraryStore({ db });

    window.localStorage.setItem('readest-plus:last-book', JSON.stringify({ hash, sectionIndex: 3 }));
    await store.getState().init();

    expect(store.getState().view).toBe('reader');
    expect(store.getState().currentHash).toBe(hash);
    expect(useReaderStore.getState().sectionCount).toBe(5);
    expect(useReaderStore.getState().sectionIndex).toBe(3);
    expect(useReaderStore.getState().chapterTitle).toBe('第四章 风起之地4');
  });

  it('init falls back to the shelf when no book was opened before', async () => {
    await store.getState().importFiles([txtFile()]);
    window.localStorage.clear();
    resetStores();
    store = createLibraryStore({ db });

    await store.getState().init();

    expect(store.getState().view).toBe('shelf');
    expect(store.getState().books).toHaveLength(1); // shelf still lists the library
    expect(useReaderStore.getState().bookHash).toBe('');
  });

  it('open reports a missing book instead of throwing', async () => {
    await store.getState().open('no-such-hash');
    expect(store.getState().error).toBe('书籍不存在或已被删除');
    expect(store.getState().view).toBe('shelf');
  });

  // ── Ticket 07: Foliate engine books ─────────────────────────────────────

  const makeEngine = (opts: { sectionCount?: number; cfi?: string } = {}) => {
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
      getSectionText: vi.fn(async () => ''),
      getCachedSectionHtml: vi.fn(() => ''),
      getCachedSectionText: vi.fn(() => ''),
      getSectionTitle: vi.fn((index: number) => `第 ${index + 1} 章`),
      sectionCount: opts.sectionCount ?? 3,
      tocItems: vi.fn(() => []),
      currentLocation: vi.fn(() => (current ? { index: 1, fraction: 0.5, cfi: current } : null)),
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
    expect(useReaderStore.getState().sectionCount).toBe(3); // engine spine
    expect(useReaderStore.getState().chapterTitle).toBe('第 1 章');
    expect(getOpenedBook(hash)?.sectionCount).toBe(3);
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
    useReaderStore.getState().setSection(1, '第 2 章');
    await store.getState().saveProgress();

    expect((await db.books.get(hash))?.lastSectionIndex).toBe(1);
    expect((await db.books.get(hash))?.lastCfi).toBe('epubcfi(/6/8!/2/2)');

    // Re-open (fresh store, same fake engine) resumes from the stored CFI.
    resetStores();
    store = engineStore(engine);
    await store.getState().open(hash);
    expect(useReaderStore.getState().sectionIndex).toBe(1);
    expect(useReaderStore.getState().chapterTitle).toBe('第 2 章');
    expect(store.getState().resumeCfi).toBe('epubcfi(/6/8!/2/2)');
    expect(store.getState().consumeResumeCfi()).toBe('epubcfi(/6/8!/2/2)');
    expect(store.getState().consumeResumeCfi()).toBeNull(); // one-shot
  });

  it('closes the previous engine when opening or deleting another book', async () => {
    const engineA = makeEngine();
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
