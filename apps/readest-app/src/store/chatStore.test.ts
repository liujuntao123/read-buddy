import { afterAll, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { ReadestPlusDatabase } from '@/services/db/database';
import { ConversationRepository } from '@/services/db/repositories';
import { createConversationManager } from '@/services/chat/conversationManager';
import type { StreamRequest, StreamTextFn } from '@/services/ai/streamClient';
import { DEFAULT_AI_SETTINGS, type AISettings } from '@/types/ai';
import { createChatStore, turnLabel } from './chatStore';

const databases: ReadestPlusDatabase[] = [];

afterAll(async () => {
  await Promise.all(databases.map((db) => db.delete()));
});

interface Harness {
  store: ReturnType<typeof createChatStore>;
  manager: ReturnType<typeof createConversationManager>;
  requests: StreamRequest[];
  setSettings: (settings: AISettings) => void;
}

const makeStore = (options: { settings?: Partial<AISettings>; stream?: StreamTextFn; now?: () => number } = {}): Harness => {
  const db = new ReadestPlusDatabase(`chat-store-test-${Math.random().toString(36).slice(2)}`);
  databases.push(db);
  const manager = createConversationManager({ repository: new ConversationRepository(db), now: options.now });
  const requests: StreamRequest[] = [];
  const inner: StreamTextFn =
    options.stream ??
    (async function* () {
      yield '回答';
      yield '继续';
    });
  const stream: StreamTextFn = async function* (req, settings) {
    requests.push(req);
    yield* inner(req, settings);
  };
  let settings: AISettings = { ...DEFAULT_AI_SETTINGS, ...options.settings };
  const store = createChatStore({
    manager,
    stream,
    getSettings: () => settings,
    getChapterText: () => ({ title: '第一章 迷雾之城', text: '灯火在雾中摇曳。' }),
  });
  return { store, manager, requests, setSettings: (next) => { settings = next; } };
};

describe('send', () => {
  it('streams the answer, persists user+assistant messages and advances the turn count', async () => {
    const h = makeStore();
    await h.store.getState().openBook('book-a', 1);
    await h.store.getState().send('第一章讲了什么？', '灯火在雾中摇曳');

    const state = h.store.getState();
    expect(state.phase).toBe('idle');
    expect(state.error).toBeNull();
    expect(state.streamingText).toBe('');
    expect(state.conversation?.turnCount).toBe(1);
    expect(state.conversation?.title).toBe('第一章讲了什么？');
    expect(state.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(state.messages[0]).toMatchObject({ content: '第一章讲了什么？', quoteText: '灯火在雾中摇曳' });
    expect(state.messages[1]).toMatchObject({ role: 'assistant', content: '回答继续' });
    expect(turnLabel(state.conversation, 10)).toBe('1 / 10');

    const persisted = await h.manager.loadMessages(state.conversation!.id);
    expect(persisted.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('builds the prompt from the chapter text, anti-spoiler system prompt and FULL history', async () => {
    const h = makeStore();
    await h.store.getState().openBook('book-a', 0);
    await h.store.getState().send('问题一');
    await h.store.getState().send('问题二');

    expect(h.requests.length).toBe(2);
    expect(h.requests[1]!.system).toContain('伴读助手');
    expect(h.requests[1]!.system).toContain('严禁主动剧透后续章节内容');
    expect(h.requests[1]!.prompt).toContain('【本章正文】\n灯火在雾中摇曳。');
    // Every previous turn is in the second prompt — no sliding window.
    expect(h.requests[1]!.prompt).toContain('读者：问题一');
    expect(h.requests[1]!.prompt).toContain('助手：回答继续');
    expect(h.requests[1]!.prompt).toContain('【本轮提问】\n问题二');
  });

  it('locks the topic at the quota and rejects further sends', async () => {
    const h = makeStore({ settings: { maxTurnsPerTopic: 2 } });
    await h.store.getState().openBook('book-a', 0);
    await h.store.getState().send('问题一');
    await h.store.getState().send('问题二');

    const closed = h.store.getState();
    expect(closed.phase).toBe('closed');
    expect(closed.conversation?.isClosed).toBe(true);
    expect(closed.conversation?.turnCount).toBe(2);
    expect(closed.inputDisabled).toBe(true);
    expect(h.requests.length).toBe(2);

    // The third send is rejected: no new model call, no new message.
    await h.store.getState().send('问题三');
    expect(h.requests.length).toBe(2);
    expect(h.store.getState().phase).toBe('closed');
    const persisted = await h.manager.loadMessages(h.store.getState().conversation!.id);
    expect(persisted.length).toBe(4);
  });

  it('keeps the partial answer but persists no assistant message when stopped', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: StreamTextFn = async function* (req) {
      yield '部分回答';
      await gate;
      if (req.signal?.aborted) {
        throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
      }
      yield '后半段';
    };
    const h = makeStore({ stream: slow });
    await h.store.getState().openBook('book-a', 0);

    const pending = h.store.getState().send('请停一下');
    await waitFor(() => expect(h.store.getState().phase).toBe('streaming'));
    h.store.getState().stop();
    release();
    await pending;

    const state = h.store.getState();
    expect(state.phase).toBe('idle');
    expect(state.error).toBeNull();
    expect(state.streamingText).toBe('部分回答');
    expect(state.conversation?.turnCount).toBe(0);
    expect(state.inputDisabled).toBe(false);
    const persisted = await h.manager.loadMessages(state.conversation!.id);
    expect(persisted.map((m) => m.role)).toEqual(['user']);
  });

  it('surfaces stream failures as phase=error without consuming a turn', async () => {
    const failing: StreamTextFn = async function* () {
      yield '开头';
      throw new Error('provider unreachable');
    };
    const h = makeStore({ stream: failing });
    await h.store.getState().openBook('book-a', 0);
    await h.store.getState().send('会失败的问题');

    const state = h.store.getState();
    expect(state.phase).toBe('error');
    expect(state.error).toContain('provider unreachable');
    expect(state.conversation?.turnCount).toBe(0);
    expect(state.inputDisabled).toBe(false);
  });
});

describe('topic lifecycle', () => {
  it('openBook resumes the newest still-open conversation and replays its messages', async () => {
    const h = makeStore({ now: (() => { let tick = 0; return () => ++tick; })() });
    const older = await h.manager.startConversation({ bookHash: 'book-f', sectionIndex: 0, title: '旧话题' });
    await h.manager.sendMessage(older, { role: 'user', content: '旧问题' });
    const newer = await h.manager.startConversation({ bookHash: 'book-f', sectionIndex: 1, title: '新话题' });
    await h.manager.sendMessage(newer, { role: 'user', content: '新问题' });

    await h.store.getState().openBook('book-f', 0);
    const state = h.store.getState();
    expect(state.conversation?.id).toBe(newer.id);
    expect(state.messages.map((m) => m.content)).toEqual(['新问题']);
    expect(state.topics.map((t) => t.id)).toEqual([newer.id, older.id]);
  });

  it('openBook does not auto-create a conversation when all topics are closed', async () => {
    const h = makeStore({ settings: { maxTurnsPerTopic: 1 } });
    await h.store.getState().openBook('book-b', 0);
    await h.store.getState().send('唯一一问');
    expect(h.store.getState().phase).toBe('closed');

    await h.store.getState().openBook('book-b', 0);
    const state = h.store.getState();
    expect(state.conversation).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.phase).toBe('idle');
    expect(state.topics.length).toBe(1);
    expect(state.topics[0].isClosed).toBe(true);
  });

  it('startNewTopic clears the view but keeps the old topic archived in topics', async () => {
    const h = makeStore();
    await h.store.getState().openBook('book-c', 0);
    await h.store.getState().send('旧话题问题');
    const oldId = h.store.getState().conversation!.id;

    h.store.getState().startNewTopic();
    await waitFor(() => expect(h.store.getState().topics.some((t) => t.id === oldId)).toBe(true));

    const state = h.store.getState();
    expect(state.conversation).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.phase).toBe('idle');
  });

  it('selectTopic replays the full archived history and marks closed topics', async () => {
    const h = makeStore({ settings: { maxTurnsPerTopic: 1 }, now: (() => { let tick = 0; return () => ++tick; })() });
    await h.store.getState().openBook('book-d', 0);
    await h.store.getState().send('历史问题');
    const archivedId = h.store.getState().conversation!.id;

    h.store.getState().startNewTopic();
    await h.store.getState().selectTopic(archivedId);

    const state = h.store.getState();
    expect(state.conversation?.id).toBe(archivedId);
    expect(state.messages.map((m) => m.content)).toEqual(['历史问题', '回答继续']);
    expect(state.phase).toBe('closed');
    expect(state.inputDisabled).toBe(true);
  });
});

describe('quoteDraft + transcript', () => {
  it('sets and clears the quote draft (ticket 05 entry point)', () => {
    const h = makeStore();
    h.store.getState().setQuoteDraft('古老的钟楼敲响了第三声');
    expect(h.store.getState().quoteDraft).toBe('古老的钟楼敲响了第三声');
    h.store.getState().setQuoteDraft(null);
    expect(h.store.getState().quoteDraft).toBeNull();
  });

  it('exports the transcript with the title, roles, quote blocks and every message', async () => {
    const h = makeStore();
    await h.store.getState().openBook('book-e', 0);
    await h.store.getState().send('引用提问', '灯火在雾中摇曳');

    const transcript = h.store.getState().exportTranscript();
    expect(transcript.startsWith('# 引用提问')).toBe(true);
    expect(transcript).toContain('> 灯火在雾中摇曳');
    expect(transcript).toContain('[读者] 引用提问');
    expect(transcript).toContain('[助手] 回答继续');
  });
});
