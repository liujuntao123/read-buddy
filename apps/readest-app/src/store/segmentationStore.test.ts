import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BookSegmentationRepository } from '@/services/db/repositories';
import { ReadestPlusDatabase } from '@/services/db/database';
import { DEMO_MONOLITHIC_TXT, DEMO_UNSTRUCTURED_TXT } from '@/services/reader/demoBook';
import { CHAPTER_HEADING_PATTERN } from '@/types/ai';
import { setSegmentationRepository, useSegmentationStore } from './segmentationStore';

let db: ReadestPlusDatabase;
let repo: BookSegmentationRepository;

beforeAll(() => {
  db = new ReadestPlusDatabase(`segmentation-store-test-${Math.random().toString(36).slice(2)}`);
  repo = new BookSegmentationRepository(db);
  setSegmentationRepository(repo);
});

afterAll(async () => {
  await db.delete();
});

beforeEach(() => {
  useSegmentationStore.setState({
    segmentation: null,
    banner: { visible: false, detectedCount: 0 },
    applyDecision: null,
    scanContext: null,
  });
});

describe('scanAndPrompt', () => {
  it('shows the banner (pending) when regex detection succeeds, without persisting yet', async () => {
    await useSegmentationStore.getState().scanAndPrompt('book-mono', DEMO_MONOLITHIC_TXT);

    const state = useSegmentationStore.getState();
    expect(state.banner).toEqual({ visible: true, detectedCount: 5 });
    expect(state.applyDecision).toBe('pending');
    expect(state.segmentation).toBeNull();
    expect(state.scanContext).toEqual({ bookHash: 'book-mono', fullText: DEMO_MONOLITHIC_TXT });
    await expect(repo.load('book-mono')).resolves.toBeUndefined();
  });

  it('skips the prompt and persists fixed-length sections when no headings exist', async () => {
    await useSegmentationStore.getState().scanAndPrompt('book-unstructured', DEMO_UNSTRUCTURED_TXT);

    const state = useSegmentationStore.getState();
    expect(state.banner.visible).toBe(false);
    expect(state.applyDecision).toBe('applied');
    expect(state.segmentation?.strategy).toBe('fixed-length');
    expect(state.segmentation?.chunkLength).toBe(7_000);

    const saved = await repo.load('book-unstructured');
    expect(saved?.strategy).toBe('fixed-length');
    expect(saved?.virtualSections.length).toBeGreaterThanOrEqual(1);
    const offsets = saved?.virtualSections.map((s) => s.charOffset) ?? [];
    expect(offsets[0]).toBe(0);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it('loads an already persisted segmentation instead of re-scanning', async () => {
    const persisted = {
      bookHash: 'book-cached',
      strategy: 'fixed-length' as const,
      chunkLength: 7_000,
      virtualSections: [{ virtualIndex: 0, title: '第 1/1 部分', charOffset: 0 }],
    };
    await repo.save(persisted);

    await useSegmentationStore.getState().scanAndPrompt('book-cached', DEMO_MONOLITHIC_TXT);

    const state = useSegmentationStore.getState();
    expect(state.segmentation).toEqual(persisted);
    expect(state.banner.visible).toBe(false);
    expect(state.applyDecision).toBe('applied');
    expect(state.scanContext).toBeNull();
  });
});

describe('applyRegex', () => {
  it('persists a regex segmentation and closes the banner', async () => {
    useSegmentationStore.setState({ banner: { visible: true, detectedCount: 5 } });
    await useSegmentationStore.getState().applyRegex('book-apply', DEMO_MONOLITHIC_TXT);

    const state = useSegmentationStore.getState();
    expect(state.applyDecision).toBe('applied');
    expect(state.banner.visible).toBe(false);

    const saved = await repo.load('book-apply');
    expect(saved?.strategy).toBe('regex');
    expect(saved?.regexPattern).toBe(CHAPTER_HEADING_PATTERN.source);
    expect(saved?.virtualSections.map((s) => s.title)).toEqual([
      '第一章 风起之地1',
      '第二章 风起之地2',
      '第三章 风起之地3',
      '第四章 风起之地4',
      '第五章 风起之地5',
    ]);
    expect(saved?.virtualSections.map((s) => s.virtualIndex)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('rejectAndFallback', () => {
  it('persists a fixed-length segmentation and closes the banner', async () => {
    useSegmentationStore.setState({ banner: { visible: true, detectedCount: 5 } });
    await useSegmentationStore.getState().rejectAndFallback('book-reject', DEMO_MONOLITHIC_TXT);

    const state = useSegmentationStore.getState();
    expect(state.applyDecision).toBe('rejected');
    expect(state.banner.visible).toBe(false);

    const saved = await repo.load('book-reject');
    expect(saved?.strategy).toBe('fixed-length');
    expect(saved?.chunkLength).toBe(7_000);
    const sections = saved?.virtualSections ?? [];
    expect(sections.length).toBeGreaterThanOrEqual(2);
    // Offsets tile the text: first at 0, each past the previous, last inside the text.
    expect(sections[0]!.charOffset).toBe(0);
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i]!.charOffset).toBeGreaterThan(sections[i - 1]!.charOffset);
    }
    expect(sections[sections.length - 1]!.charOffset).toBeLessThan(DEMO_MONOLITHIC_TXT.length);
  });
});

describe('dismiss', () => {
  it('hides the banner without touching other state', () => {
    useSegmentationStore.setState({
      banner: { visible: true, detectedCount: 3 },
      applyDecision: 'pending',
    });
    useSegmentationStore.getState().dismiss();
    const state = useSegmentationStore.getState();
    expect(state.banner).toEqual({ visible: false, detectedCount: 3 });
    expect(state.applyDecision).toBe('pending');
  });
});
