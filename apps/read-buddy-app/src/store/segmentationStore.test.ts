import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BookSegmentationRepository } from '@/services/db/repositories';
import { ReadBuddyDatabase } from '@/services/db/database';
import { DEMO_MONOLITHIC_TXT, DEMO_UNSTRUCTURED_TXT } from '@/services/reader/demoBook';
import { createSegmentationStore, type SegmentationStoreHook } from './segmentationStore';

let db: ReadBuddyDatabase;
let repo: BookSegmentationRepository;
let store: SegmentationStoreHook;

beforeAll(() => {
  db = new ReadBuddyDatabase(`segmentation-store-test-${Math.random().toString(36).slice(2)}`);
  repo = new BookSegmentationRepository(db);
  // A store built for this suite alone — no module global to swap (候选 epilogue).
  store = createSegmentationStore({ repository: () => repo });
});

afterAll(async () => {
  await db.delete();
});

beforeEach(() => {
  store.setState({ segmentation: null });
});

/**
 * `scanAndPrompt` is the store's only entry point (候选 10): the legacy
 * interactive confirm flow (`applyRegex` / `rejectAndFallback` / `dismiss` and
 * the banner state behind them) was unreachable in production and is gone, along
 * with the second detector and 段 cutter it kept alive.
 */
describe('scanAndPrompt', () => {
  it('auto-applies the layered regex segmentation (reading-agent pipeline)', async () => {
    await store.getState().scanAndPrompt('book-mono', DEMO_MONOLITHIC_TXT);

    const state = store.getState();
    expect(state.segmentation?.strategy).toBe('regex');
    expect(state.segmentation?.virtualSections.map((s) => s.title)).toEqual([
      '第一章 风起之地1',
      '第二章 风起之地2',
      '第三章 风起之地3',
      '第四章 风起之地4',
      '第五章 风起之地5',
    ]);
    expect(state.segmentation?.virtualSections.map((s) => s.virtualIndex)).toEqual([0, 1, 2, 3, 4]);

    const saved = await repo.load('book-mono');
    expect(saved?.strategy).toBe('regex');
    expect(saved?.virtualSections[0]!.charOffset).toBe(0);
    // Offsets tile the text in ascending order.
    const offsets = saved?.virtualSections.map((s) => s.charOffset) ?? [];
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it('records the strategy that actually ran, and no stale pattern or target length', async () => {
    await store.getState().scanAndPrompt('book-honest', DEMO_MONOLITHIC_TXT);

    const saved = await repo.load('book-honest');
    expect(saved?.strategy).toBe('regex');
    // The old record stamped the legacy `NODE_HEADING_PATTERN` even when the
    // layered segmenter's own pattern set had matched, so the artifact could not
    // say which rule produced it. `strategy` now carries that fact alone.
    expect(saved).not.toHaveProperty('regexPattern');
    expect(saved).not.toHaveProperty('chunkLength');
  });

  it('falls back to fixed-length sections when no headings exist', async () => {
    await store.getState().scanAndPrompt('book-unstructured', DEMO_UNSTRUCTURED_TXT);

    const state = store.getState();
    expect(state.segmentation?.strategy).toBe('fixed-length');

    const saved = await repo.load('book-unstructured');
    expect(saved?.strategy).toBe('fixed-length');
    expect(saved?.virtualSections.length).toBeGreaterThanOrEqual(1);
    // Offsets tile the text: first at 0, each past the previous.
    const offsets = saved?.virtualSections.map((s) => s.charOffset) ?? [];
    expect(offsets[0]).toBe(0);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]!).toBeGreaterThan(offsets[i - 1]!);
    }
  });

  it('loads an already persisted segmentation instead of re-scanning', async () => {
    const persisted = {
      bookHash: 'book-cached',
      strategy: 'fixed-length' as const,
      virtualSections: [{ virtualIndex: 0, title: '第 1/1 部分', charOffset: 0 }],
    };
    await repo.save(persisted);

    await store.getState().scanAndPrompt('book-cached', DEMO_MONOLITHIC_TXT);

    // The stored row wins: re-scanning would replace a segmentation the reader
    // already has (and is reading through).
    expect(store.getState().segmentation).toEqual(persisted);
    expect((await repo.load('book-cached'))?.virtualSections).toEqual(persisted.virtualSections);
  });
});
