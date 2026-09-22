import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReadestPlusDatabase } from '@/services/db/database';
import { ConversationRepository } from '@/services/db/repositories';
import { createConversationManager } from './conversationManager';

let db: ReadestPlusDatabase;
let managerSeq = 0;

beforeAll(() => {
  db = new ReadestPlusDatabase(`conversation-manager-test-${Math.random().toString(36).slice(2)}`);
});

afterAll(async () => {
  await db.delete();
});

/** Deterministic ids + clock so ordering assertions never depend on timing. */
const makeManager = () => {
  const prefix = `m${++managerSeq}`;
  let seq = 0;
  let tick = 1_000;
  return createConversationManager({
    repository: new ConversationRepository(db),
    idFactory: () => `${prefix}-${++seq}`,
    now: () => (tick += 10),
  });
};

describe('startConversation', () => {
  it('creates a fresh topic with zero turns, open state and normalized title', async () => {
    const manager = makeManager();
    const conversation = await manager.startConversation({ bookHash: 'book-a', nodeIndex: 2 });

    expect(conversation).toMatchObject({
      id: 'm1-1',
      bookHash: 'book-a',
      nodeIndex: 2,
      turnCount: 0,
      isClosed: false,
      createdAt: 1010,
      updatedAt: 1010,
    });
    expect(await manager.getConversation(conversation.id)).toEqual(conversation);
  });

  it('truncates long titles to 30 chars and defaults empty titles to 新话题', async () => {
    const manager = makeManager();
    const long = await manager.startConversation({ bookHash: 'book-a', title: '题'.repeat(40) });
    expect(long.title).toBe('题'.repeat(30));

    const untitled = await manager.startConversation({ bookHash: 'book-a' });
    expect(untitled.title).toBe('新话题');
    expect(untitled.nodeIndex).toBeUndefined();
  });
});

describe('sendMessage', () => {
  it('persists user + assistant messages with quotes and bumps conversation.updatedAt', async () => {
    const manager = makeManager();
    const conversation = await manager.startConversation({ bookHash: 'book-b', nodeIndex: 0 });

    const user = await manager.sendMessage(conversation, {
      role: 'user',
      content: '问题',
      quoteText: '引文',
    });
    const assistant = await manager.sendMessage(conversation, { role: 'assistant', content: '回答' });

    expect(user).toMatchObject({ conversationId: conversation.id, role: 'user', quoteText: '引文' });
    expect(assistant.role).toBe('assistant');

    const messages = await manager.loadMessages(conversation.id);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', '问题'],
      ['assistant', '回答'],
    ]);

    const stored = await manager.getConversation(conversation.id);
    expect(stored!.updatedAt).toBeGreaterThan(conversation.updatedAt);
  });
});

describe('completeTurn / canSend', () => {
  it('closes the topic exactly when the turn count reaches the quota', async () => {
    const manager = makeManager();
    const conversation = await manager.startConversation({ bookHash: 'book-c' });

    const afterTwo = await manager.completeTurn({ ...conversation, turnCount: 1 }, 3);
    expect(afterTwo.turnCount).toBe(2);
    expect(afterTwo.isClosed).toBe(false);
    expect(manager.canSend(afterTwo)).toBe(true);

    const afterThree = await manager.completeTurn(afterTwo, 3);
    expect(afterThree.turnCount).toBe(3);
    expect(afterThree.isClosed).toBe(true);
    expect(manager.canSend(afterThree)).toBe(false);
    // Returns a NEW object and does not mutate the input.
    expect(afterThree).not.toBe(afterTwo);
    expect(afterTwo.isClosed).toBe(false);

    // The closed state is persisted, not just in-memory.
    expect((await manager.getConversation(conversation.id))?.isClosed).toBe(true);
  });
});

describe('listTopics', () => {
  it('lists the book topics newest-first by updatedAt', async () => {
    const manager = makeManager();
    const older = await manager.startConversation({ bookHash: 'book-d', title: '旧话题' });
    await manager.sendMessage(older, { role: 'user', content: 'hi' });
    const newer = await manager.startConversation({ bookHash: 'book-d', title: '新话题' });

    const topics = await manager.listTopics('book-d');
    expect(topics.map((t) => t.id)).toEqual([newer.id, older.id]);

    // Other books stay isolated.
    const other = await manager.startConversation({ bookHash: 'book-e' });
    expect((await manager.listTopics('book-e')).map((t) => t.id)).toEqual([other.id]);
  });
});
