import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReadBuddyDatabase } from './database';
import {
  AISettingsRepository,
  BookNodeRepository,
  HighlightRepository,
  NodeSummaryRepository,
  ConversationRepository,
} from './repositories';
import { DEFAULT_AI_SETTINGS, nodeSummaryId } from '@/types/ai';
import { bookNodeId, type BookNodeRecord } from '@/types/readingAgent';
import type { ReaderHighlight } from '@/types/highlight';

/**
 * Foundation smoke test: proves the Dexie + fake-indexeddb harness works
 * and the repository seam persists every entity family as designed.
 */
let db: ReadBuddyDatabase;

beforeAll(() => {
  db = new ReadBuddyDatabase(`read-buddy-test-${Math.random().toString(36).slice(2)}`);
});

afterAll(async () => {
  await db.delete();
});

describe('AISettingsRepository', () => {
  it('returns defaults when nothing is stored', async () => {
    const repo = new AISettingsRepository(db);
    await expect(repo.load()).resolves.toEqual(DEFAULT_AI_SETTINGS);
  });

  it('round-trips settings and strips the storage row key', async () => {
    const repo = new AISettingsRepository(db);
    await repo.save({
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      temperature: 0.3,
      maxTurnsPerTopic: 12,
    });
    const loaded = await repo.load();
    expect(loaded.provider).toBe('deepseek');
    expect(loaded.apiKey).toBe('sk-test');
    expect(loaded).not.toHaveProperty('id');
  });
});

describe('BookNodeRepository', () => {
  const node = (bookHash: string, index: number, depth = 0): BookNodeRecord => ({
    nodeId: bookNodeId(bookHash, index),
    bookHash,
    nodeIndex: index,
    title: `节点 ${index + 1}`,
    depth,
    startOffset: index * 100,
    endOffset: (index + 1) * 100,
    charCount: 100,
    spineIndex: index,
    indexStatus: 'pending',
    updatedAt: 1,
  });

  it('keys nodes by `${bookHash}:n_${nodeIndex}` and lists them in document order', async () => {
    const repo = new BookNodeRepository(db);
    // Written out of order: the bookHash index must come back sorted.
    await repo.bulkPut([node('book-b', 2, 1), node('book-b', 0), node('book-b', 1, 1)]);

    expect((await repo.listByBook('book-b')).map((row) => row.nodeIndex)).toEqual([0, 1, 2]);
    await expect(repo.get('book-b', 1)).resolves.toMatchObject({
      nodeId: 'book-b:n_1',
      title: '节点 2',
      depth: 1,
    });
    expect(await repo.get('book-b', 9)).toBeUndefined();
    // Rows of another book never leak into the listing.
    await repo.put(node('book-c', 0));
    expect((await repo.listByBook('book-b')).map((row) => row.bookHash)).toEqual([
      'book-b',
      'book-b',
      'book-b',
    ]);
  });

  it('updates a node in place by its computed primary key (brief scheduler path)', async () => {
    const repo = new BookNodeRepository(db);
    await repo.put({ ...node('book-b', 1, 1), brief: '本节微简介', indexStatus: 'ready', updatedAt: 2 });
    await expect(repo.get('book-b', 1)).resolves.toMatchObject({
      brief: '本节微简介',
      indexStatus: 'ready',
    });
  });

  it('deleteByBook drops every node of one book only', async () => {
    const repo = new BookNodeRepository(db);
    await repo.deleteByBook('book-b');
    expect(await repo.listByBook('book-b')).toEqual([]);
    expect(await repo.listByBook('book-c')).toHaveLength(1);
    await repo.deleteByBook('book-c');
  });
});

describe('NodeSummaryRepository', () => {
  it('keys summaries by `${bookHash}:${nodeIndex}` in node_summaries', async () => {
    const repo = new NodeSummaryRepository(db);
    const now = Date.now();
    await repo.put({
      id: nodeSummaryId('book-a', 2),
      bookHash: 'book-a',
      nodeIndex: 2,
      nodeTitle: '第三章',
      modelUsed: 'deepseek-chat',
      summaryContent: '### 📌 章节核心要义\n...',
      pipeline: 'single',
      createdAt: now,
      updatedAt: now,
    });
    expect((await repo.get('book-a', 2))?.id).toBe('book-a:2');
    // The row really lands in the v5 `node_summaries` store (not a v1 leftover).
    await expect(db.node_summaries.get(nodeSummaryId('book-a', 2))).resolves.toMatchObject({
      nodeIndex: 2,
      nodeTitle: '第三章',
    });
    expect(await repo.get('book-a', 3)).toBeUndefined();
    expect((await repo.listByBook('book-a')).length).toBe(1);
    await repo.remove('book-a', 2);
    expect(await repo.get('book-a', 2)).toBeUndefined();
  });
});

describe('ConversationRepository', () => {
  it('lists conversations newest-first and messages oldest-first', async () => {
    const repo = new ConversationRepository(db);
    await repo.put({
      id: 'c-old',
      bookHash: 'book-a',
      title: '第一轮话题',
      turnCount: 2,
      isClosed: false,
      createdAt: 1,
      updatedAt: 100,
    });
    await repo.put({
      id: 'c-new',
      bookHash: 'book-a',
      title: '第二轮话题',
      turnCount: 1,
      isClosed: false,
      createdAt: 2,
      updatedAt: 200,
    });
    expect((await repo.listByBook('book-a')).map((c) => c.id)).toEqual(['c-new', 'c-old']);

    await repo.appendMessage({
      id: 'm2',
      conversationId: 'c-old',
      role: 'assistant',
      content: '答案',
      createdAt: 20,
    });
    await repo.appendMessage({
      id: 'm1',
      conversationId: 'c-old',
      role: 'user',
      content: '问题',
      quoteText: '引用',
      createdAt: 10,
    });
    const messages = await repo.listMessages('c-old');
    expect(messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(messages[0].quoteText).toBe('引用');

    await repo.remove('c-old');
    expect(await repo.listMessages('c-old')).toEqual([]);
    expect((await repo.listByBook('book-a')).map((c) => c.id)).toEqual(['c-new']);
  });
});

describe('HighlightRepository', () => {
  it('lists one book’s marks in document order and removes by id', async () => {
    const repo = new HighlightRepository(db);
    const mark = (
      id: string,
      nodeIndex: number,
      createdAt: number,
      bookHash = 'hl-book',
    ): ReaderHighlight => ({
      id,
      bookHash,
      nodeIndex,
      nodeTitle: `第${nodeIndex + 1}节`,
      spineIndex: nodeIndex,
      quote: `第 ${nodeIndex} 处划线`,
      createdAt,
    });

    // Written out of order on purpose: the list is document order, not insert order.
    await repo.put(mark('hl-book:h_c', 5, 1));
    await repo.put(mark('hl-book:h_a', 1, 9));
    await repo.put(mark('hl-book:h_b', 1, 4));
    await repo.put(mark('other:h_x', 0, 1, 'other-book'));

    expect((await repo.listByBook('hl-book')).map((row) => row.id)).toEqual([
      'hl-book:h_b',
      'hl-book:h_a',
      'hl-book:h_c',
    ]);
    expect((await repo.listByBook('other-book')).map((row) => row.id)).toEqual(['other:h_x']);

    await repo.remove('hl-book:h_a');
    expect((await repo.listByBook('hl-book')).map((row) => row.id)).toEqual([
      'hl-book:h_b',
      'hl-book:h_c',
    ]);
  });
});
