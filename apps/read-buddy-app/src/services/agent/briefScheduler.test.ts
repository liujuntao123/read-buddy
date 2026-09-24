import { describe, expect, it, vi } from 'vitest';
import {
  BRIEF_MAX_CHARS,
  buildBriefPrompt,
  createBriefScheduler,
  parseBriefOutput,
  sliceHeadAndTail,
} from './briefScheduler';
import { BookNodeRepository } from '@/services/db/repositories';
import { ReadBuddyDatabase } from '@/services/db/database';
import { DEFAULT_AI_SETTINGS, type AISettings } from '@/types/ai';
import type { StreamTextFn } from '@/services/ai/streamClient';
import { bookNodeId, type BookNode } from '@/types/readingAgent';

const NODES: BookNode[] = Array.from({ length: 6 }, (_, index) => ({
  nodeId: bookNodeId('bk', index),
  bookHash: 'bk',
  nodeIndex: index,
  title: `第${index + 1}章 标题${index + 1}`,
  startOffset: index * 100,
  endOffset: (index + 1) * 100,
  charCount: 100,
  depth: 0,
  indexStatus: 'pending' as const,
}));

const FULL_TEXT = 'x'.repeat(600);

const makeScheduler = (
  options: {
    stream?: StreamTextFn;
    settings?: AISettings;
  } = {},
) => {
  const db = new ReadBuddyDatabase(`brief-test-${Math.random().toString(36).slice(2)}`);
  const repository = new BookNodeRepository(db);
  const order: number[] = [];
  const stream: StreamTextFn =
    options.stream ??
    (async function* (req) {
      void req;
      yield '本章推进了主线剧情，新角色登场。\n【实体】林远、灯塔';
    });
  const trackedStream: StreamTextFn = async function* (req, settings) {
    const titleMatch = req.prompt.match(/【本节点标题】第(\d+)章/);
    if (titleMatch) order.push(Number(titleMatch[1]) - 1);
    yield* stream(req, settings);
  };
  const scheduler = createBriefScheduler({
    stream: trackedStream,
    getSettings: () => options.settings ?? { ...DEFAULT_AI_SETTINGS },
    repository,
    getFullText: () => FULL_TEXT,
  });
  return { scheduler, repository, db, order };
};

describe('brief parsing', () => {
  it('slices head+tail for token control', () => {
    const text = 'a'.repeat(5_000);
    const slice = sliceHeadAndTail(text);
    expect(slice.length).toBeLessThan(5_000);
    expect(slice).toContain('……（中略）……');
    expect(sliceHeadAndTail('short')).toBe('short');
  });

  it('parses the two-line brief output', () => {
    const parsed = parseBriefOutput('守夜人发现灯塔熄灭的真相，并决定出海。\n【实体】林远、灯塔');
    expect(parsed.brief).toBe('守夜人发现灯塔熄灭的真相，并决定出海。');
    expect(parsed.keyEntities).toEqual(['林远', '灯塔']);
  });

  it('caps brief length and tolerates noise', () => {
    const parsed = parseBriefOutput('# 摘要\n```守夜人出海。```' + '很长的句子'.repeat(50));
    expect(parsed.brief.length).toBeLessThanOrEqual(BRIEF_MAX_CHARS);
  });
});

describe('createBriefScheduler', () => {
  it('generates, persists and reports progress for every pending node', async () => {
    const { scheduler, repository, db } = makeScheduler();
    const progress = vi.fn();
    await scheduler.run('bk', NODES, { signal: new AbortController().signal, currentNodeIndex: 0, onProgress: progress });

    expect(progress).toHaveBeenCalledTimes(6);
    const rows = await repository.listByBook('bk');
    expect(rows).toHaveLength(6);
    const notReady = rows.filter((row) => row.indexStatus !== 'ready' || !row.brief);
    expect(notReady.map((row) => `${row.nodeIndex}:${row.indexStatus}:${row.brief}`)).toEqual([]);
    expect(rows[0]!.keyEntities).toEqual(['林远', '灯塔']);
    // BriefProgress carries the persisted node record (not a per-spine row).
    const last = progress.mock.calls.at(-1)![0] as { done: number; total: number; node: BookNode };
    expect(last).toMatchObject({ done: 6, total: 6 });
    expect(last.node.nodeId).toBe(bookNodeId('bk', last.node.nodeIndex));
    expect(last.node.indexStatus).toBe('ready');
    await db.delete();
  });

  it('prioritizes the current node, then the opening nodes', async () => {
    const { scheduler, db, order } = makeScheduler();
    await scheduler.run('bk', NODES, { signal: new AbortController().signal, currentNodeIndex: 4 });
    // With concurrency 2 the exact interleaving is bounded, but node 4
    // (priority 0) and nodes 0~2 (priority 1) must precede 3 and 5.
    expect(order.indexOf(4)).toBeLessThan(order.indexOf(3));
    expect(order.indexOf(4)).toBeLessThan(order.indexOf(5));
    expect(order.indexOf(0)).toBeLessThan(order.indexOf(5));
    await db.delete();
  });

  it('skips nodes that are already ready (resume support)', async () => {
    const { scheduler, repository, db, order } = makeScheduler();
    const readyNode = { ...NODES[0]!, brief: '已生成', indexStatus: 'ready' as const };
    await repository.put({ ...readyNode, updatedAt: 0 });
    await scheduler.run('bk', [readyNode, ...NODES.slice(1)], {
      signal: new AbortController().signal,
      currentNodeIndex: 0,
    });
    expect(order).not.toContain(0);
    expect(order).toHaveLength(5);
    await db.delete();
  });

  it('marks nodes failed on stream errors and keeps the run alive', async () => {
    const { scheduler, repository, db } = makeScheduler({
      stream: async function* () {
        throw new Error('模型超时');
      },
    });
    const progress = vi.fn();
    await scheduler.run('bk', NODES, { signal: new AbortController().signal, currentNodeIndex: 0, onProgress: progress });
    expect(progress).toHaveBeenCalledTimes(6);
    const rows = await repository.listByBook('bk');
    expect(rows.every((row) => row.indexStatus === 'failed')).toBe(true);
    await db.delete();
  });

  it('aborts cleanly and normalizes in-flight nodes back to pending', async () => {
    const controller = new AbortController();
    const { scheduler, repository, db } = makeScheduler({
      stream: async function* () {
        controller.abort();
        yield '永远写不完的摘要';
      },
    });
    await scheduler.run('bk', NODES, { signal: controller.signal, currentNodeIndex: 0 });
    const rows = await repository.listByBook('bk');
    expect(rows.some((row) => row.indexStatus === 'indexing')).toBe(false);
    await db.delete();
  });
});

describe('buildBriefPrompt', () => {
  it('embeds the node title and slice', () => {
    const prompt = buildBriefPrompt('第一章 起源', '正文切片内容');
    expect(prompt).toContain('【本节点标题】第一章 起源');
    expect(prompt).toContain('正文切片内容');
    expect(prompt).toContain('不超过80字');
  });
});
