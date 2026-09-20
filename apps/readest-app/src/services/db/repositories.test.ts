import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReadestPlusDatabase } from './database';
import {
  AISettingsRepository,
  ChapterSummaryRepository,
  ConversationRepository,
} from './repositories';
import { DEFAULT_AI_SETTINGS, chapterSummaryId } from '@/types/ai';

/**
 * Foundation smoke test: proves the Dexie + fake-indexeddb harness works
 * and the repository seam persists every entity family as designed.
 */
let db: ReadestPlusDatabase;

beforeAll(() => {
  db = new ReadestPlusDatabase(`readest-plus-test-${Math.random().toString(36).slice(2)}`);
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

describe('ChapterSummaryRepository', () => {
  it('keys summaries by `${bookHash}:${sectionIndex}`', async () => {
    const repo = new ChapterSummaryRepository(db);
    const now = Date.now();
    await repo.put({
      id: chapterSummaryId('book-a', 2),
      bookHash: 'book-a',
      sectionIndex: 2,
      chapterTitle: '第三章',
      modelUsed: 'deepseek-chat',
      summaryContent: '### 📌 章节核心要义\n...',
      pipeline: 'single',
      createdAt: now,
      updatedAt: now,
    });
    expect((await repo.get('book-a', 2))?.id).toBe('book-a:2');
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
