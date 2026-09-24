import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReadBuddyDatabase } from '@/services/db/database';
import { ConversationRepository } from '@/services/db/repositories';
import type { ChatRole, Message } from '@/types/ai';
import { createConversationManager, retryTargetIndex } from './conversationManager';

let db: ReadBuddyDatabase;
let managerSeq = 0;

beforeAll(() => {
  db = new ReadBuddyDatabase(`conversation-manager-test-${Math.random().toString(36).slice(2)}`);
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
    const conversation = await manager.startConversation({ bookHash: 'book-a', spineIndex: 2 });

    expect(conversation).toMatchObject({
      id: 'm1-1',
      bookHash: 'book-a',
      spineIndex: 2,
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
    expect(untitled.spineIndex).toBeUndefined();
  });
});

describe('sendMessage', () => {
  it('persists user + assistant messages with quotes and bumps conversation.updatedAt', async () => {
    const manager = makeManager();
    const conversation = await manager.startConversation({ bookHash: 'book-b', spineIndex: 0 });

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

describe('message ordering', () => {
  it('keeps same-millisecond messages in order instead of falling back to random ids', async () => {
    // A frozen clock is the worst case: without a monotonic stamp the two
    // messages share a `createdAt`, and `listMessages`' tie-break (id) decides
    // the order — a coin flip on a topic whose order is the whole point.
    const frozen = createConversationManager({
      repository: new ConversationRepository(db),
      idFactory: (() => {
        let seq = 0;
        return () => `frozen-${++seq}`;
      })(),
      now: () => 5_000,
    });
    const conversation = await frozen.startConversation({ bookHash: 'book-f' });
    await frozen.sendMessage(conversation, { role: 'user', content: '问题' });
    await frozen.sendMessage(conversation, { role: 'assistant', content: '回答' });

    const messages = await frozen.loadMessages(conversation.id);
    expect(messages.map((m) => m.content)).toEqual(['问题', '回答']);
    expect(messages[1]!.createdAt).toBeGreaterThan(messages[0]!.createdAt);
  });
});

describe('retryTargetIndex', () => {
  const message = (role: ChatRole, id: string): Message => ({
    id,
    conversationId: 'c1',
    role,
    content: role === 'user' ? '问题' : '回答',
    createdAt: 1,
  });

  it('points at the tail user message, and at nothing else', () => {
    expect(retryTargetIndex([])).toBe(-1);
    expect(retryTargetIndex([message('user', 'u1')])).toBe(0);
    // A reply after the question means the turn completed — nothing to retry.
    expect(retryTargetIndex([message('user', 'u1'), message('assistant', 'a1')])).toBe(-1);
    // …but a *new* question after a reply is retryable again.
    expect(
      retryTargetIndex([message('user', 'u1'), message('assistant', 'a1'), message('user', 'u2')]),
    ).toBe(2);
  });
});
