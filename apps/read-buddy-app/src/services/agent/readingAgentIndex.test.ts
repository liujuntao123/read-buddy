import { describe, expect, it, vi } from 'vitest';
import { createAgentBookContext } from './agentContext';
import {
  createReadingAgentIndex,
  type IndexRunProgress,
  type ReadingAgentIndexDeps,
} from './readingAgentIndex';
import { DEFAULT_AI_SETTINGS } from '@/types/ai';
import type { BookNode, BookNodeRecord } from '@/types/readingAgent';
import type { NodeSummary } from '@/types/ai';

/**
 * The Reading Agent Index module (候选 epilogue). Everything is driven with plain
 * values — a node model, a fake stream, an injected settings getter — because the
 * module takes its dependencies as arguments instead of reading two stores and a
 * raw zustand setter. That is the point of the extraction, and it is what these
 * tests are shaped to prove.
 */

const FULL_TEXT = '第一章 起源\n林远走进图书馆。';

const NODES: BookNode[] = [
  {
    nodeId: 'b:n_0',
    bookHash: 'b',
    nodeIndex: 0,
    title: '第一章 起源',
    startOffset: 0,
    endOffset: FULL_TEXT.length,
    charCount: FULL_TEXT.length,
    depth: 0,
    spineIndex: 0,
    indexStatus: 'pending',
  },
];

const makeContext = (nodes = NODES, panorama?: Parameters<typeof createAgentBookContext>[0]['panorama']) =>
  createAgentBookContext({ bookHash: 'b', nodes: [...nodes], fullText: FULL_TEXT, ...(panorama ? { panorama } : {}) });

const PANORAMA_JSON = JSON.stringify({
  genre: '悬疑',
  summary: '守夜人追寻灯塔熄灭之谜。',
  worldSetting: '北海孤岛',
  mainCharacters: ['林远'],
});

/** A stream that answers the panorama call, then each brief call. */
const makeDeps = (over: Partial<ReadingAgentIndexDeps> = {}) => {
  const briefPrompts: string[] = [];
  const deps: ReadingAgentIndexDeps = {
    stream: async function* (req) {
      const system = req.system ?? '';
      if (system.includes('全景画像')) yield PANORAMA_JSON;
      else {
        briefPrompts.push(req.prompt);
        yield '林远发现无名之书。\n【实体】林远';
      }
    },
    getSettings: () => ({ ...DEFAULT_AI_SETTINGS, apiKey: 'sk-test' }),
    bookNodes: {
      put: vi.fn(async (_record: BookNodeRecord) => {}),
      listByBook: vi.fn(async () => []),
      bulkPut: vi.fn(async () => {}),
      deleteByBook: vi.fn(async () => {}),
    } as unknown as ReadingAgentIndexDeps['bookNodes'],
    panoramas: {
      get: vi.fn(async () => undefined),
      put: vi.fn(async (_record: unknown) => {}),
      delete: vi.fn(async () => {}),
    } as unknown as ReadingAgentIndexDeps['panoramas'],
    ...over,
  };
  return { deps, briefPrompts };
};

const baseInput = (context: ReturnType<typeof makeContext>) => ({
  bookHash: 'b',
  bookTitle: '灯塔之夜',
  context,
  signal: new AbortController().signal,
  currentSpineIndex: 0,
  getCurrentSpineIndex: () => 0,
});

describe('createReadingAgentIndex', () => {
  it('resolves with a settled outcome, so readiness can be awaited', async () => {
    const { deps } = makeDeps();
    const context = makeContext();
    const outcome = await createReadingAgentIndex(deps).run(baseInput(context));

    expect(outcome.phase).toBe('ready');
    expect(outcome.panoramaReady).toBe(true);
    expect(outcome.briefTotal).toBe(1);
    expect(outcome.briefedCount).toBe(1);
    // Both phases persisted.
    expect(context.getPanorama()?.summary).toContain('守夜人');
  });

  it('reports progress instead of holding a state setter', async () => {
    const { deps } = makeDeps();
    const seen: IndexRunProgress[] = [];
    await createReadingAgentIndex(deps).run({
      ...baseInput(makeContext()),
      onProgress: (progress) => seen.push(progress),
    });

    // The panorama phase, the brief phase, then the settled ready state.
    expect(seen.map((progress) => progress.phase).filter(Boolean)).toEqual([
      'panorama',
      'briefs',
      'ready',
    ]);
    expect(seen.some((progress) => progress.panoramaReady === true)).toBe(true);
    expect(seen.at(-1)).toMatchObject({ phase: 'ready', progressLabel: '' });
  });

  it('parks in awaiting-key — visibly — when no provider is configured', async () => {
    const { deps, briefPrompts } = makeDeps({
      getSettings: () => ({ ...DEFAULT_AI_SETTINGS, apiKey: '' }),
    });
    const seen: IndexRunProgress[] = [];
    const outcome = await createReadingAgentIndex(deps).run({
      ...baseInput(makeContext()),
      onProgress: (progress) => seen.push(progress),
    });

    expect(outcome.phase).toBe('awaiting-key');
    expect(outcome.panoramaReady).toBe(false);
    expect(briefPrompts).toEqual([]);
    // The state is reported, not left indistinguishable from "nothing to index".
    expect(seen.some((progress) => progress.phase === 'awaiting-key')).toBe(true);
  });

  it('skips the model entirely when every minimal node is already briefed', async () => {
    const { deps, briefPrompts } = makeDeps();
    const briefed = NODES.map((node) => ({ ...node, brief: '已有微大纲', indexStatus: 'ready' as const }));
    const context = makeContext(briefed, {
      bookHash: 'b',
      summary: '已有画像',
      totalNodes: 1,
      isFullyIndexed: true,
      createdAt: 1,
      updatedAt: 1,
    } as unknown as NodeSummary as never);

    const outcome = await createReadingAgentIndex(deps).run(baseInput(context));

    expect(outcome.phase).toBe('ready');
    expect(briefPrompts).toEqual([]);
  });

  it('settles as idle when the signal is already aborted', async () => {
    const { deps, briefPrompts } = makeDeps();
    const controller = new AbortController();
    controller.abort();

    const outcome = await createReadingAgentIndex(deps).run({
      ...baseInput(makeContext()),
      signal: controller.signal,
    });

    expect(outcome.phase).toBe('idle');
    expect(briefPrompts).toEqual([]);
  });

  it('names the brief queue with the caller-supplied label', async () => {
    const { deps } = makeDeps({ progressLabel: (done, total) => `正在建立全书微大纲 (${done}/${total} 章)` });
    const seen: IndexRunProgress[] = [];
    await createReadingAgentIndex(deps).run({
      ...baseInput(makeContext()),
      onProgress: (progress) => seen.push(progress),
    });

    expect(seen.some((progress) => progress.progressLabel === '正在建立全书微大纲 (1/1 章)')).toBe(true);
  });
});