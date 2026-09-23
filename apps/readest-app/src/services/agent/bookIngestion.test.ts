import { describe, expect, it, vi } from 'vitest';
import { createBookIngestion, type BookIngestionDeps } from './bookIngestion';
import type { BookNode, BookNodeRecord } from '@/types/readingAgent';
import type { BookNodeShape } from '@/services/bookNodes';
import type { SegmentStrategy } from '@/types/readingAgent';

/**
 * Book Ingestion — Phases 1–2 (候选 epilogue). Every case is driven with plain
 * values through the injected sources: no Dexie, no engine, no store. Before the
 * extraction this branch tree lived inside `ensureIndexed`, so reaching it at all
 * required constructing a database, a fake stream and hand-made sections, and the
 * real source resolution was never exercised by the store's suite.
 */

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const paragraph = (seed: string): string =>
  Array.from(
    { length: 60 },
    (_, i) => `${seed}段落${i + 1}：夜色中的城市依旧喧嚣，灯火沿着河岸铺陈开来。`,
  ).join('\n');
/** A well-formed 12-chapter monolithic TXT. */
const MONO_TEXT = NUMERALS.map((n, i) => `第${n}章 标题${i}\n${paragraph(`c${i}`)}`).join('\n');

const node = (bookHash: string, index: number, over: Partial<BookNode> = {}): BookNode => ({
  nodeId: `${bookHash}:n_${index}`,
  bookHash,
  nodeIndex: index,
  title: `第 ${index + 1} 章`,
  startOffset: index * 100,
  endOffset: (index + 1) * 100,
  charCount: 100,
  depth: 0,
  indexStatus: 'pending',
  ...over,
});

const makeDeps = (over: Partial<BookIngestionDeps> = {}) => {
  const bulkPut = vi.fn(async (_records: BookNodeRecord[]) => {});
  const saveBookIndexSummary = vi.fn(
    async (_hash: string, _summary: { shape: BookNodeShape; strategy: SegmentStrategy }) => {},
  );
  const deps: BookIngestionDeps = {
    bookNodes: {
      listByBook: vi.fn(async () => []),
      bulkPut,
    } as unknown as BookIngestionDeps['bookNodes'],
    getMonolithicText: () => undefined,
    getSegmentationSource: () => undefined,
    saveBookIndexSummary,
    now: () => 1_000,
    ...over,
  };
  return { deps, bulkPut, saveBookIndexSummary };
};

describe('createBookIngestion', () => {
  it('segments a monolithic book and records its shape and rule', async () => {
    const { deps, bulkPut, saveBookIndexSummary } = makeDeps({
      getMonolithicText: (hash) => (hash === 'mono' ? MONO_TEXT : undefined),
    });

    const outcome = await createBookIngestion(deps).ingest('mono');

    expect(outcome.status).toBe('indexed');
    if (outcome.status !== 'indexed') return;
    expect(outcome.strategy).toBe('regex');
    expect(outcome.rehydrated).toBe(false);
    expect(outcome.shape.total).toBe(12);
    expect(outcome.fullText).toBe(MONO_TEXT);
    // Nodes are persisted, not merely returned.
    expect(bulkPut).toHaveBeenCalledTimes(1);
    expect(saveBookIndexSummary).toHaveBeenCalledWith('mono', {
      shape: outcome.shape,
      strategy: 'regex',
    });
  });

  it('segments a spine book from its sections and Directory', async () => {
    const { deps } = makeDeps({
      getSegmentationSource: () => ({
        sections: [
          { title: '第一章', text: paragraph('a'), spineIndex: 0 },
          { title: '第二章', text: paragraph('b'), spineIndex: 1 },
        ],
        tocEntries: [],
      }),
    });

    const outcome = await createBookIngestion(deps).ingest('spine');

    expect(outcome.status).toBe('indexed');
    if (outcome.status !== 'indexed') return;
    expect(outcome.strategy).toBe('native');
    expect(outcome.shape.total).toBe(2);
  });

  it('joins spine sections with the segmenter SPINE_JOIN — the offset-space invariant', async () => {
    // The store used to re-create this join with a literal '\n\n', so a caller
    // restated the invariant the node offsets depend on. Recomputing it here means
    // the joined text provably matches what `segmentSpineBook` indexed.
    const sections = [
      { title: '第一章', text: paragraph('a'), spineIndex: 0 },
      { title: '第二章', text: paragraph('b'), spineIndex: 1 },
    ];
    const { deps } = makeDeps({
      getSegmentationSource: () => ({ sections, tocEntries: [] }),
      // Resume path: nodes already persisted, live text present.
      bookNodes: {
        listByBook: vi.fn(async () => [node('spine', 0), node('spine', 1)]),
        bulkPut: vi.fn(async () => {}),
      } as unknown as BookIngestionDeps['bookNodes'],
    });

    const outcome = await createBookIngestion(deps).ingest('spine');

    expect(outcome.status).toBe('indexed');
    if (outcome.status !== 'indexed') return;
    expect(outcome.fullText).toBe(`${sections[0]!.text}\n\n${sections[1]!.text}`);
  });

  it('reads the recorded Segmentation Rule back rather than inferring it', async () => {
    // A persisted fixed-length index must not be relabelled as heading-detected,
    // which is what `spineIndex !== undefined ? 'native' : 'regex'` did.
    const { deps } = makeDeps({
      getMonolithicText: () => MONO_TEXT,
      bookNodes: {
        listByBook: vi.fn(async () => [node('txt', 0), node('txt', 1)]),
        bulkPut: vi.fn(async () => {}),
      } as unknown as BookIngestionDeps['bookNodes'],
      readBookIndexSummary: vi.fn(async () => ({
        shape: { chapter: 2, section: 0, chunk: 0, total: 2, isNested: false, minimalKind: 'chapter' as const },
        strategy: 'fixed-length' as const,
      })),
    });

    const outcome = await createBookIngestion(deps).ingest('txt');

    expect(outcome.status).toBe('indexed');
    if (outcome.status !== 'indexed') return;
    expect(outcome.strategy).toBe('fixed-length');
    expect(outcome.rehydrated).toBe(true);
    // A resume must not re-segment: no writes.
    expect(deps.bookNodes.bulkPut).not.toHaveBeenCalled();
  });

  it('falls back to native when nothing was recorded', async () => {
    const { deps } = makeDeps({
      getMonolithicText: () => MONO_TEXT,
      bookNodes: {
        listByBook: vi.fn(async () => [node('txt', 0)]),
        bulkPut: vi.fn(async () => {}),
      } as unknown as BookIngestionDeps['bookNodes'],
    });

    const outcome = await createBookIngestion(deps).ingest('txt');
    expect(outcome.status).toBe('indexed');
    if (outcome.status !== 'indexed') return;
    // `native` is the only safe reading: a node carrying a physical section came
    // from the Directory or the spine, so `regex` would claim detection that may
    // never have run.
    expect(outcome.strategy).toBe('native');
  });

  it('reports index-only when nodes exist but no text source is live', async () => {
    const { deps } = makeDeps({
      bookNodes: {
        listByBook: vi.fn(async () => [node('gone', 0), node('gone', 1)]),
        bulkPut: vi.fn(async () => {}),
      } as unknown as BookIngestionDeps['bookNodes'],
    });

    const outcome = await createBookIngestion(deps).ingest('gone');

    expect(outcome.status).toBe('index-only');
    if (outcome.status !== 'index-only') return;
    expect(outcome.nodes).toHaveLength(2);
    expect(outcome.shape.total).toBe(2);
  });

  it('reports nothing when neither text source resolves', async () => {
    const { deps, saveBookIndexSummary } = makeDeps();
    const outcome = await createBookIngestion(deps).ingest('demo-fixture');

    expect(outcome.status).toBe('nothing');
    expect(saveBookIndexSummary).not.toHaveBeenCalled();
  });

  it('awaits an async spine source (the engine loads sections lazily)', async () => {
    const { deps } = makeDeps({
      getSegmentationSource: async () => ({
        sections: [{ title: '第一章', text: paragraph('a'), spineIndex: 0 }],
        tocEntries: [],
      }),
    });

    const outcome = await createBookIngestion(deps).ingest('spine');
    expect(outcome.status).toBe('indexed');
    if (outcome.status !== 'indexed') return;
    expect(outcome.shape.total).toBe(1);
  });
});