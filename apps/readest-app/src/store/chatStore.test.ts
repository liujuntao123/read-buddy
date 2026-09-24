import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { waitFor } from '@testing-library/react';
import { ReadestPlusDatabase } from '@/services/db/database';
import {
  AgentTraceRepository,
  ConversationRepository,
} from '@/services/db/repositories';
import { createConversationManager } from '@/services/chat/conversationManager';
import type { RunTurnInput, RunTurnResult } from '@/services/agent/agentOrchestrator';
import type { AgentTurnEvent } from '@/services/agent/agentOrchestrator';
import { DEFAULT_AI_SETTINGS, type AISettings } from '@/types/ai';
import type { NodeKind, ToolCallTrace } from '@/types/readingAgent';
import { createChatStore, type RunTurnFn } from './chatStore';
import { turnQuotaLabel } from '@/services/chat/conversationManager';
import { describeAIError } from '@/services/ai/errorMessages';
import { useReaderStore } from './readerStore';

const databases: ReadestPlusDatabase[] = [];

afterAll(async () => {
  await Promise.all(databases.map((db) => db.delete()));
});

afterEach(() => {
  // The reader store is a module singleton shared by every test here.
  useReaderStore.setState({
    bookHash: '',
    bookTitle: '',
    spineIndex: 0,
    anchor: undefined,
    nodeTitle: '',
    spineCount: 0,
  });
});

interface Harness {
  store: ReturnType<typeof createChatStore>;
  manager: ReturnType<typeof createConversationManager>;
  requests: RunTurnInput[];
  setSettings: (settings: AISettings) => void;
  traces: AgentTraceRepository;
}

const TRACE: ToolCallTrace = {
  id: 'call-1',
  toolName: 'search_book_text',
  args: { query: '灯塔' },
  resultSnippet: '{"matches":[...]}',
  durationMs: 30,
};

/**
 * Fake orchestrator seam: records the run input and replays a scripted
 * event trail before resolving with the aggregated result. `failures` are
 * thrown by the first N turns, in order (error/retry tests).
 */
const makeRunTurn = (
  requests: RunTurnInput[],
  script?: (input: RunTurnInput) => Array<AgentTurnEvent | Promise<void>>,
  failures: unknown[] = [],
): RunTurnFn => {
  return async (input) => {
    requests.push(input);
    const failure = failures.shift();
    if (failure !== undefined) throw failure;
    const steps = script?.(input) ?? [];
    let content = '';
    const toolCalls: ToolCallTrace[] = [];
    const citations: RunTurnResult['citations'] = [];
    for (const step of steps) {
      if (step instanceof Promise) {
        await step;
        continue;
      }
      if (step.type === 'delta') {
        content += step.text;
        input.onEvent(step);
      } else if (step.type === 'tool-call') {
        toolCalls.push(step.trace);
        input.onEvent(step);
      } else if (step.type === 'tool-result') {
        input.onEvent(step);
      } else if (step.type === 'citation') {
        citations.push(step.citation);
        input.onEvent(step);
      }
    }
    return { content: content || '回答继续', toolCalls, citations };
  };
};

const makeStore = (
  options: {
    settings?: Partial<AISettings>;
    script?: (input: RunTurnInput) => Array<AgentTurnEvent | Promise<void>>;
    now?: () => number;
    /** Errors thrown by the first N turns, in order (error/retry tests). */
    failures?: unknown[];
    locateQuote?: (
      bookHash: string,
      quoteText: string,
    ) => { nodeIndex: number; nodeTitle: string; charOffset: number; nodeKind: NodeKind } | null;
  } = {},
): Harness => {
  const db = new ReadestPlusDatabase(`chat-store-test-${Math.random().toString(36).slice(2)}`);
  databases.push(db);
  const manager = createConversationManager({ repository: new ConversationRepository(db), now: options.now });
  const traces = new AgentTraceRepository(db);
  const requests: RunTurnInput[] = [];
  let settings: AISettings = { ...DEFAULT_AI_SETTINGS, ...options.settings };
  const store = createChatStore({
    manager,
    traces,
    runTurn: makeRunTurn(requests, options.script, options.failures ?? []),
    getSettings: () => settings,
    ...(options.locateQuote ? { locateQuote: options.locateQuote } : {}),
  });
  return { store, manager, requests, traces, setSettings: (next) => { settings = next; } };
};

describe('send', () => {
  it('streams the answer, persists user+assistant messages and advances the turn count', async () => {
    const h = makeStore({ script: () => [{ type: 'delta', text: '回答' }, { type: 'delta', text: '继续' }] });
    await h.store.getState().openBook('book-a', 1);
    await h.store.getState().send('第一章讲了什么？', '灯火在雾中摇曳');

    const state = h.store.getState();
    expect(state.phase).toBe('idle');
    expect(state.error).toBeNull();
    expect(state.streamingText).toBe('');
    expect(state.liveTraces).toEqual([]);
    expect(state.conversation?.turnCount).toBe(1);
    expect(state.conversation?.title).toBe('第一章讲了什么？');
    expect(state.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(state.messages[0]).toMatchObject({ content: '第一章讲了什么？', quoteText: '灯火在雾中摇曳' });
    expect(state.messages[1]).toMatchObject({ role: 'assistant', content: '回答继续' });
    expect(turnQuotaLabel(state.conversation, 10)).toBe('1 / 10');

    const persisted = await h.manager.loadMessages(state.conversation!.id);
    expect(persisted.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('passes the Reading Position into the orchestrator, not derived node facts', async () => {
    const h = makeStore();
    useReaderStore.setState({
      bookHash: 'book-a',
      bookTitle: '迷雾之城',
      spineIndex: 2,
      anchor: 'sec1',
      spineCount: 4,
    });
    await h.store.getState().openBook('book-a', 2);
    await h.store.getState().send('问题一');

    const request = h.requests[0]!;
    // The seam speaks Reading Position only: the node, its title, its level
    // and its text are the orchestrator's to resolve (CONTEXT.md "Node View").
    expect(request.position).toEqual({ bookHash: 'book-a', spineIndex: 2, anchor: 'sec1' });
    expect(request.bookTitle).toBe('迷雾之城');
    expect(request).not.toHaveProperty('currentNodeTitle');
    expect(request).not.toHaveProperty('currentNodeText');
    expect(request.quoteText).toBeUndefined();
    expect(request.history).toEqual([]);

    await h.store.getState().send('问题二');
    const second = h.requests[1]!;
    // Full in-topic history rides along (no sliding window).
    expect(second.history.map((m) => m.content)).toEqual(['问题一', '回答继续']);
  });

  it('keeps a topic bound to its own position, and never invents an anchor for it', async () => {
    const h = makeStore();
    // The reader is at spine 3 with an anchor …
    useReaderStore.setState({ bookHash: 'book-a', spineIndex: 3, anchor: 'live-anchor' });
    // … but the topic was opened at spine 0.
    await h.store.getState().openBook('book-a', 0);
    await h.store.getState().send('问题');

    // The topic's position wins; the live anchor is NOT borrowed, because it
    // belongs to a different physical section (ADR 0011).
    expect(h.requests[0]!.position).toEqual({ bookHash: 'book-a', spineIndex: 0 });
  });

  it('surfaces live tool traces and citations while streaming, then persists them', async () => {
    let releaseTools!: () => void;
    let releaseCite!: () => void;
    const toolsGate = new Promise<void>((resolve) => { releaseTools = resolve; });
    const citeGate = new Promise<void>((resolve) => { releaseCite = resolve; });
    const citation = {
      bookHash: 'book-a',
      nodeIndex: 3,
      nodeTitle: '第四章 河灯',
      nodeKind: 'chapter',
      charOffset: 120,
      quoteSnippet: '河灯顺流而下',
    } as const;
    const h = makeStore({
      script: () => [
        { type: 'tool-call', trace: { ...TRACE, resultSnippet: undefined } },
        toolsGate,
        { type: 'tool-result', trace: TRACE },
        { type: 'delta', text: '印证完毕。' },
        citeGate,
        { type: 'citation', citation },
      ],
    });
    await h.store.getState().openBook('book-a', 0);

    const pending = h.store.getState().send('伏笔在后文有呼应吗？');
    await waitFor(() => expect(h.store.getState().liveTraces.length).toBe(1));
    expect(h.store.getState().phase).toBe('streaming');
    releaseTools();
    releaseCite();
    await pending;

    const state = h.store.getState();
    // Live surfaces cleared after the turn…
    expect(state.liveTraces).toEqual([]);
    expect(state.liveCitations).toEqual([]);
    // …and persisted on the assistant message + trace table.
    const assistant = state.messages.find((m) => m.role === 'assistant')!;
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.toolCalls![0]).toMatchObject({ toolName: 'search_book_text', durationMs: 30 });
    expect(assistant.citations![0]).toMatchObject({ nodeIndex: 3, quoteSnippet: '河灯顺流而下' });
    const traceRows = await h.traces.listByConversation(state.conversation!.id);
    expect(traceRows).toHaveLength(1);
    expect(traceRows[0]!.toolCalls[0]!.toolName).toBe('search_book_text');
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
    const h = makeStore({
      script: (input) => [
        { type: 'delta', text: '部分回答' },
        gate.then(() => {
          if (input.signal.aborted) {
            throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
          }
        }),
        { type: 'delta', text: '后半段' },
      ],
    });
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

  it('surfaces turn failures as classified copy without consuming a turn', async () => {
    const store = makeFailingStore();
    await store.getState().openBook('book-a', 0);
    await store.getState().send('会失败的问题');

    const state = store.getState();
    expect(state.phase).toBe('error');
    // 分类先于读者看到：SDK 原文不外露（docs/architecture.md）。
    expect(state.error).toBe(describeAIError(new Error('provider unreachable')).message);
    expect(state.error).toContain('网络');
    expect(state.error).not.toContain('provider unreachable');
    expect(state.conversation?.turnCount).toBe(0);
    expect(state.inputDisabled).toBe(false);
  });
});

/** Direct failing-seam store (avoids generator/as-function confusion). */
function makeFailingStore() {
  const db = new ReadestPlusDatabase(`chat-store-fail-${Math.random().toString(36).slice(2)}`);
  databases.push(db);
  const manager = createConversationManager({ repository: new ConversationRepository(db) });
  const runTurn: RunTurnFn = async (input) => {
    input.onEvent({ type: 'delta', text: '开头' });
    throw new Error('provider unreachable');
  };
  return createChatStore({
    manager,
    runTurn,
    getSettings: () => ({ ...DEFAULT_AI_SETTINGS }),
  });
}

describe('topic lifecycle', () => {
  it('openBook resumes the newest still-open conversation and replays its messages', async () => {
    const h = makeStore({ now: (() => { let tick = 0; return () => ++tick; })() });
    const older = await h.manager.startConversation({ bookHash: 'book-f', spineIndex: 0, title: '旧话题' });
    await h.manager.sendMessage(older, { role: 'user', content: '旧问题' });
    const newer = await h.manager.startConversation({ bookHash: 'book-f', spineIndex: 1, title: '新话题' });
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

  it('exports the transcript with the title, roles, quotes, tools and citations', async () => {
    const h = makeStore({
      script: () => [
        { type: 'tool-call', trace: { ...TRACE, resultSnippet: undefined } },
        { type: 'tool-result', trace: TRACE },
        {
          type: 'citation',
          citation: {
            bookHash: 'book-e',
            nodeIndex: 2,
            nodeTitle: '第三章 夜航',
            nodeKind: 'chapter',
            quoteSnippet: '夜航开始',
          },
        },
      ],
    });
    await h.store.getState().openBook('book-e', 0);
    await h.store.getState().send('引用提问', '灯火在雾中摇曳');

    const transcript = h.store.getState().exportTranscript();
    expect(transcript.startsWith('# 引用提问')).toBe(true);
    expect(transcript).toContain('> 灯火在雾中摇曳');
    expect(transcript).toContain('[读者] 引用提问');
    expect(transcript).toContain('[助手] 回答继续');
    expect(transcript).toContain('🔧 search_book_text');
    // 「」 quotes the node title — 《》 is for book titles only.
    expect(transcript).toContain('📍 章「第三章 夜航」');
  });

  it('labels the quote source with the node level word', async () => {
    const h = makeStore({
      locateQuote: () => ({
        nodeIndex: 4,
        nodeTitle: '第二节 河灯',
        charOffset: 128,
        nodeKind: 'section',
      }),
    });
    await h.store.getState().openBook('book-g', 4);
    await h.store.getState().send('这句话什么意思？', '河灯顺流而下');

    const userMessage = h.store.getState().messages.find((message) => message.role === 'user')!;
    expect(userMessage.quoteSource).toBe('节「第二节 河灯」 约 128 字符处');
  });
});

describe('retry (ticket 14 item 6)', () => {
  const API_ERROR = { name: 'AI_APICallError', message: 'Service Unavailable', statusCode: 503 };

  it('re-runs the last question without appending it twice', async () => {
    const h = makeStore({ failures: [API_ERROR] });
    await h.store.getState().openBook('book-r', 0);
    await h.store.getState().send('会失败的问题');

    expect(h.store.getState().phase).toBe('error');
    expect(h.store.getState().messages.map((m) => m.role)).toEqual(['user']);
    expect(h.requests).toHaveLength(1);

    await h.store.getState().retry();

    const state = h.store.getState();
    expect(state.phase).toBe('idle');
    expect(state.error).toBeNull();
    expect(state.streamingText).toBe('');
    expect(state.conversation?.turnCount).toBe(1);
    // One question, one answer — on screen and in the topic.
    expect(state.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(state.messages[0]!.content).toBe('会失败的问题');
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1]!.userMessage).toBe('会失败的问题');
    // The prompt history is what the first attempt used: nothing before it.
    expect(h.requests[1]!.history).toEqual([]);
    const persisted = await h.manager.loadMessages(state.conversation!.id);
    expect(persisted.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('carries the question\'s quote and position into the retried turn', async () => {
    const h = makeStore({ failures: [API_ERROR] });
    useReaderStore.setState({ bookHash: 'book-r', spineIndex: 3, anchor: 'sec-2' });
    await h.store.getState().openBook('book-r', 3);
    await h.store.getState().send('这句话什么意思？', '河灯顺流而下');

    await h.store.getState().retry();

    const retried = h.requests[1]!;
    expect(retried.userMessage).toBe('这句话什么意思？');
    expect(retried.quoteText).toBe('河灯顺流而下');
    expect(retried.position).toEqual({ bookHash: 'book-r', spineIndex: 3, anchor: 'sec-2' });
    // The quote travels once: the user message was not re-persisted.
    expect(h.store.getState().messages.filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('does nothing when the last message is not the question to re-run', async () => {
    const h = makeStore();
    await h.store.getState().openBook('book-r', 0);
    await h.store.getState().send('问题一');
    expect(h.requests).toHaveLength(1);

    // The reply after the question means the turn completed; re-running it
    // would persist a second answer.
    await h.store.getState().retry();

    expect(h.requests).toHaveLength(1);
    expect(h.store.getState().messages).toHaveLength(2);
    expect(h.store.getState().conversation?.turnCount).toBe(1);
  });

  it('does nothing with no conversation or no messages', async () => {
    const h = makeStore();
    await h.store.getState().openBook('book-r', 0);
    await h.store.getState().retry();
    expect(h.requests).toHaveLength(0);

    h.store.setState({ conversation: null, messages: [] });
    await h.store.getState().retry();
    expect(h.requests).toHaveLength(0);
  });

  it('surfaces a second failure the same way, still without a turn', async () => {
    const h = makeStore({ failures: [API_ERROR, new TypeError('Failed to fetch')] });
    await h.store.getState().openBook('book-r', 0);
    await h.store.getState().send('会失败的问题');
    await h.store.getState().retry();

    const state = h.store.getState();
    expect(state.phase).toBe('error');
    expect(state.error).toContain('网络');
    expect(state.conversation?.turnCount).toBe(0);
    expect(state.messages.map((m) => m.role)).toEqual(['user']);
  });
});
