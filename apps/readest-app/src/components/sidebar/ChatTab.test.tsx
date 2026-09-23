import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatTab from './ChatTab';
import { QUOTE_AUTO_COLLAPSE_CHARS } from '@/components/common/QuoteBlock';
import { createChatStore, type ChatStoreHook } from '@/store/chatStore';
import { createConversationManager } from '@/services/chat/conversationManager';
import { ConversationRepository } from '@/services/db/repositories';
import { ReadestPlusDatabase } from '@/services/db/database';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useReaderStore } from '@/store/readerStore';
import { DEFAULT_AI_SETTINGS, type AISettings } from '@/types/ai';
import type { RunTurnInput, RunTurnResult } from '@/services/agent/agentOrchestrator';
import type { AgentTurnEvent } from '@/services/agent/agentOrchestrator';
import {
  clearAgentBookContext,
  createAgentBookContext,
  registerAgentBookContext,
} from '@/services/agent/agentContext';
import { bookNodeId, type BookNode } from '@/types/readingAgent';

const databases: ReadestPlusDatabase[] = [];

beforeEach(() => {
  useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS, maxTurnsPerTopic: 10 } });
  useAISidebarStore.setState({ settingsOpen: false });
});

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
  useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } });
  useReaderStore.setState({ bookHash: '', bookTitle: '', spineIndex: 0, anchor: undefined, nodeTitle: '' });
  clearAgentBookContext('demo-fog-city-0001');
});

interface ScriptStep {
  event: AgentTurnEvent;
  /** Await this promise before replaying the step (pacing control). */
  gate?: Promise<void>;
}

const makeStore = (
  options: {
    maxTurnsPerTopic?: number;
    script?: ScriptStep[];
    /** Errors thrown by the first N turns, in order (error-path tests). */
    failures?: unknown[];
  } = {},
) => {
  const db = new ReadestPlusDatabase(`chat-tab-test-${Math.random().toString(36).slice(2)}`);
  databases.push(db);
  const manager = createConversationManager({ repository: new ConversationRepository(db) });
  const pendingFailures = [...(options.failures ?? [])];
  let settings: AISettings = { ...DEFAULT_AI_SETTINGS, maxTurnsPerTopic: options.maxTurnsPerTopic ?? 10 };
  const store: ChatStoreHook = createChatStore({
    manager,
    runTurn: async (input: RunTurnInput): Promise<RunTurnResult> => {
      const failure = pendingFailures.shift();
      if (failure !== undefined) throw failure;
      const toolCalls: RunTurnResult['toolCalls'] = [];
      const citations: RunTurnResult['citations'] = [];
      let content = '';
      for (const step of options.script ?? [{ event: { type: 'delta', text: '回答A' as const } }]) {
        if (step.gate) await step.gate;
        const { event } = step;
        if (event.type === 'delta') {
          content += event.text;
          input.onEvent(event);
        } else if (event.type === 'tool-call') {
          toolCalls.push(event.trace);
          input.onEvent(event);
        } else if (event.type === 'citation') {
          citations.push(event.citation);
          input.onEvent(event);
        } else {
          input.onEvent(event);
        }
      }
      return { content, toolCalls, citations };
    },
    getSettings: () => settings,
  });
  return { store, setSettings: (next: AISettings) => { settings = next; } };
};

/** Configured provider: the settings the setup card and chips key off. */
const configureProvider = () =>
  useAISettingsStore.setState({
    settings: { ...DEFAULT_AI_SETTINGS, apiKey: 'sk-test', maxTurnsPerTopic: 10 },
  });

/**
 * A 章 › 节 book at the reader's position, so the Node View answers 节 for the
 * suggestion chips (CONTEXT.md: the level word is never a literal).
 */
const registerSectionNode = () => {
  const nodes: BookNode[] = [
    {
      nodeId: bookNodeId('demo-fog-city-0001', 0),
      bookHash: 'demo-fog-city-0001',
      nodeIndex: 0,
      title: '第三章 长夜漫漫',
      startOffset: 0,
      endOffset: 60,
      charCount: 60,
      depth: 0,
      spineIndex: 0,
      indexStatus: 'ready',
    },
    {
      nodeId: bookNodeId('demo-fog-city-0001', 1),
      bookHash: 'demo-fog-city-0001',
      nodeIndex: 1,
      title: '第一节 灯塔的守望',
      startOffset: 60,
      endOffset: 160,
      charCount: 100,
      depth: 1,
      parentNodeId: bookNodeId('demo-fog-city-0001', 0),
      spineIndex: 1,
      indexStatus: 'ready',
    },
  ];
  registerAgentBookContext(
    createAgentBookContext({ bookHash: 'demo-fog-city-0001', nodes, fullText: '雾'.repeat(160) }),
  );
  useReaderStore.setState({
    bookHash: 'demo-fog-city-0001',
    bookTitle: '迷雾之城（演示书）',
    spineIndex: 1,
    anchor: undefined,
    nodeTitle: '第一节 灯塔的守望',
  });
};

const setClipboard = (writeText: ReturnType<typeof vi.fn>) =>
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });

const inputElement = (): HTMLTextAreaElement => screen.getByTestId('chat-input') as HTMLTextAreaElement;

describe('ChatTab', () => {
  it('shows the quota pill at 0 / 10 轮 before any message', async () => {
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    expect(screen.getByTestId('chat-tab-panel')).toBeTruthy();
    expect(screen.getByTestId('turn-quota').textContent).toBe('0 / 10 轮');
    expect(screen.queryByTestId('quota-exhausted-hint')).toBeNull();
    expect(inputElement().disabled).toBe(false);
  });

  it('renders the user bubble, streams the assistant answer and bumps the quota to 1 / 10', async () => {
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '雾意味着什么？' } });
    fireEvent.click(screen.getByTestId('send-message'));

    expect(await screen.findByTestId('user-bubble')).toBeTruthy();
    expect(screen.getByTestId('user-bubble').textContent).toBe('雾意味着什么？');
    expect((await screen.findByTestId('assistant-bubble')).textContent).toBe('回答A');
    await waitFor(() => expect(screen.getByTestId('turn-quota').textContent).toBe('1 / 10 轮'));
    // The composer is cleared and re-enabled after the turn completes.
    expect(inputElement().value).toBe('');
    expect(inputElement().disabled).toBe(false);
    expect(screen.queryByTestId('streaming-bubble')).toBeNull();
  });

  it('shows the live streaming bubble with cursor and stop button while generating', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { store } = makeStore({
      script: [
        { event: { type: 'delta', text: '正在思考' } },
        { gate, event: { type: 'delta', text: '完毕' } },
      ],
    });
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '慢问题' } });
    fireEvent.click(screen.getByTestId('send-message'));

    expect(await screen.findByTestId('streaming-bubble')).toBeTruthy();
    expect(screen.getByTestId('streaming-bubble').textContent).toContain('正在思考');
    expect(screen.getByTestId('stop-stream')).toBeTruthy();
    expect(screen.queryByTestId('send-message')).toBeNull();
    expect(inputElement().disabled).toBe(true);

    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByTestId('assistant-bubble').textContent).toBe('正在思考完毕'));
    await waitFor(() => expect(screen.getByTestId('turn-quota').textContent).toBe('1 / 10 轮'));
  });

  it('renders the collapsed tool-trace accordion and citation cards on a reply', async () => {
    const citation = {
      bookHash: 'demo-fog-city-0001',
      nodeIndex: 2,
      nodeTitle: '第三章 长夜漫漫',
      nodeKind: 'chapter' as const,
      charOffset: 4321,
      quoteSnippet: '守夜人在第七次巡逻时发现星图移动',
    };
    const { store } = makeStore({
      script: [
        {
          event: {
            type: 'tool-call',
            trace: {
              id: 'call-1',
              toolName: 'search_book_text',
              args: { query: '星图' },
              durationMs: 0,
            },
          },
        },
        {
          event: {
            type: 'tool-result',
            trace: {
              id: 'call-1',
              toolName: 'search_book_text',
              args: {},
              resultSnippet: '{"matches":[...]}',
              durationMs: 26,
            },
          },
        },
        { event: { type: 'delta', text: '在第三章形成呼应。' } },
        { event: { type: 'citation', citation } },
      ],
    });
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '星图有伏笔吗？' } });
    fireEvent.click(screen.getByTestId('send-message'));

    // The reply carries a collapsed trace accordion (1 tool) and one jump card.
    await waitFor(() => expect(screen.getByTestId('assistant-bubble').textContent).toContain('在第三章形成呼应'));
    const accordion = screen.getByTestId('agent-trace-accordion');
    expect(accordion.textContent).toContain('思考与检索过程 (1)');
    expect(screen.queryByTestId('agent-trace-body')).toBeNull();

    fireEvent.click(screen.getByTestId('agent-trace-toggle'));
    expect(await screen.findByTestId('agent-trace-body')).toBeTruthy();
    expect(screen.getByTestId('agent-trace-body').textContent).toContain('检索全书关键词');

    const card = screen.getByTestId('citation-card');
    // Node title alone + its level word — never the global ordinal as a 章号.
    expect(card.textContent).toContain('第三章 长夜漫漫');
    expect(screen.getByTestId('citation-node-kind').textContent).toBe('章');
    expect(card.textContent).not.toContain('《第 3 章');
    expect(card.textContent).toContain('约第 4,321 字');
    expect(card.textContent).toContain('守夜人在第七次巡逻时发现星图移动');

    // The jump button re-dispatches the reader locate request. Its label has no
    // 📍: the MapPin icon already says where the button goes (ticket 14 item 11).
    expect(screen.getByRole('button', { name: '定位到原文' })).toBe(
      screen.getByTestId('citation-jump'),
    );
    expect(screen.getByTestId('citation-jump').textContent).not.toContain('📍');
    const locateSpy = vi.fn();
    window.addEventListener('readest-plus:agent-locate-test', locateSpy);
    fireEvent.click(screen.getByTestId('citation-jump'));
    // (No global event exists; the readerLink bus is exercised in service
    // tests — here we only assert the button is wired without crashing.)
    expect(screen.getByTestId('citation-jump')).toBeTruthy();
    window.removeEventListener('readest-plus:agent-locate-test', locateSpy);
  });

  it('renders a second-level citation as a 节 with its 章 breadcrumb', async () => {
    const citation = {
      bookHash: 'demo-fog-city-0001',
      nodeIndex: 5,
      nodeTitle: '第一节 灯塔的守望',
      nodeKind: 'section' as const,
      parentNodeTitle: '第三章 长夜漫漫',
      charOffset: 12,
      quoteSnippet: '灯塔的火种由守夜人代代相传',
    };
    const { store } = makeStore({
      script: [
        { event: { type: 'delta', text: '这条线索在第一节。' } },
        { event: { type: 'citation', citation } },
      ],
    });
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '火种从哪来？' } });
    fireEvent.click(screen.getByTestId('send-message'));
    await waitFor(() => expect(screen.getByTestId('citation-card')).toBeTruthy());

    const card = screen.getByTestId('citation-card');
    expect(card.textContent).toContain('「第三章 长夜漫漫」 ›');
    expect(card.textContent).toContain('第一节 灯塔的守望');
    expect(screen.getByTestId('citation-node-kind').textContent).toBe('节');
    expect(card.textContent).not.toContain('《第 6 章');
  });

  it('locks the input at the quota, offers new-topic + copy, and resets on a new topic', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);

    const { store, setSettings } = makeStore({ maxTurnsPerTopic: 1 });
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '唯一的问题' } });
    fireEvent.click(screen.getByTestId('send-message'));
    await screen.findByTestId('assistant-bubble');

    await waitFor(() => expect(inputElement().disabled).toBe(true));
    expect(screen.getByTestId('turn-quota').textContent).toBe('1 / 1 轮');
    expect(screen.getByTestId('quota-exhausted-hint').textContent).toContain(
      '当前话题已达轮数上限（1/1），建议开启新话题以保持回答质量',
    );
    expect(screen.getByTestId('start-new-topic')).toBeTruthy();
    expect(screen.getByTestId('copy-transcript')).toBeTruthy();

    // Copy exports the transcript through navigator.clipboard.
    fireEvent.click(screen.getByTestId('copy-transcript'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toContain('# 唯一的问题');
    expect(writeText.mock.calls[0]![0]).toContain('[读者] 唯一的问题');
    await screen.findByText('已复制');

    // Clear the view first so the history replay below is observable.
    fireEvent.click(screen.getByTestId('start-new-topic'));
    await waitFor(() => expect(screen.queryByTestId('user-bubble')).toBeNull());

    // History keeps the closed topic; clicking it replays the full transcript.
    fireEvent.click(screen.getByTestId('history-topics-toggle'));
    const items = await screen.findAllByTestId('topic-item');
    expect(items.length).toBe(1);
    expect(items[0]!.textContent).toContain('🔒');
    fireEvent.click(items[0]!);
    await waitFor(() => expect(screen.getByTestId('user-bubble').textContent).toBe('唯一的问题'));
    await waitFor(() => expect(inputElement().disabled).toBe(true));

    // Starting a fresh topic resets the quota pill and unlocks the input. Only
    // the store's own settings matter now: ChatTab renders the cap the store
    // enforces, so there is no second number to keep in sync (候选 epilogue).
    setSettings({ ...DEFAULT_AI_SETTINGS, maxTurnsPerTopic: 10 });
    fireEvent.click(screen.getByTestId('start-new-topic'));
    await waitFor(() => expect(screen.getByTestId('turn-quota').textContent).toBe('0 / 10 轮'));
    expect(inputElement().disabled).toBe(false);
    expect(screen.queryByTestId('quota-exhausted-hint')).toBeNull();
    expect(screen.queryByTestId('user-bubble')).toBeNull();
  });

  it('shows a pending selection quote (markdown-parsed quote block) above the input and clears it on demand', async () => {
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    act(() => { store.getState().setQuoteDraft('古老的钟楼敲响了第三声'); });
    const quote = await screen.findByTestId('quote-draft');
    expect(quote.textContent).toContain('古老的钟楼敲响了第三声');
    // The quote renders inside the dedicated quote block with its own testid.
    expect(screen.getByTestId('quote-draft-block')).toBeTruthy();
    // The pending draft never folds: the reader is about to send it.
    expect(quote.querySelector('.astryx-collapsible-trigger')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '清除引用' }));
    await waitFor(() => expect(screen.queryByTestId('quote-draft')).toBeNull());
  });

  it('folds a long quoted passage inside the sent message behind a trigger', async () => {
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    const passage =
      '这座城市的雾从来不是为了遮住什么，而是为了让人习惯看不见；久到没有人再追问雾从何而来，也没有人记得灯塔熄灭的那一夜究竟发生过什么，只有守夜人仍旧每晚点灯。';
    // Only a long passage folds; short ones stay open (see QuoteBlock).
    expect(passage.length).toBeGreaterThan(QUOTE_AUTO_COLLAPSE_CHARS);
    act(() => { store.getState().setQuoteDraft(passage); });
    fireEvent.change(inputElement(), { target: { value: '请解释下面这段文字的背景与含义。' } });
    fireEvent.click(screen.getByTestId('send-message'));

    const quoteBlock = await screen.findByTestId('user-quote');
    const trigger = quoteBlock.querySelector('.astryx-collapsible-trigger') as HTMLElement;
    // Long quote ⇒ folded, with the citation facts still on the trigger row.
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain('引用原文');
    expect(trigger.textContent).toContain(`${passage.length} 字`);
    // The question — not the passage — is the bubble's own text.
    expect(screen.getByTestId('user-bubble').textContent).toBe('请解释下面这段文字的背景与含义。');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('user-quote-content').textContent).toContain('习惯看不见');
    await waitFor(() => expect(screen.getByTestId('assistant-bubble')).toBeTruthy());
  });

  it('focuses the chat input with the caret at the end on the selection "ask" event', async () => {
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    const input = inputElement();
    fireEvent.change(input, { target: { value: '为什么雾永远不散？' } });
    expect(document.activeElement).not.toBe(input);

    window.dispatchEvent(new Event('readest-plus:focus-chat-input'));
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe('为什么雾永远不散？'.length);
    expect(input.selectionEnd).toBe('为什么雾永远不散？'.length);
  });
});

describe('空状态：欢迎块与建议问题 (ticket 14 item 8)', () => {
  it('welcomes the reader with chips whose level word comes from the Node View', async () => {
    registerSectionNode();
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 1);
    render(<ChatTab store={store} />);

    const empty = screen.getByTestId('chat-empty-state');
    expect(empty.textContent).toContain('有什么想问的？');
    expect(empty.textContent).toContain('《迷雾之城（演示书）》');

    // The reader is at a 节: every position-bound chip says 节, never 章.
    const chips = screen.getAllByTestId('chat-suggestion').map((chip) => chip.textContent);
    expect(chips).toEqual([
      '这一节主要讲了什么？',
      '本节有哪些关键概念？',
      '梳理一下到目前为止的脉络',
      '这本书讲了什么？',
    ]);
    expect(empty.textContent).not.toContain('这一章');
  });

  it('asks the level word of a single-level book as 章', async () => {
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    const chips = screen.getAllByTestId('chat-suggestion').map((chip) => chip.textContent);
    expect(chips[0]).toBe('这一章主要讲了什么？');
    expect(chips[1]).toBe('本章有哪些关键概念？');
  });

  it('sends the suggestion when a provider is configured', async () => {
    configureProvider();
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    fireEvent.click(screen.getAllByTestId('chat-suggestion')[0]!);

    expect((await screen.findByTestId('user-bubble')).textContent).toBe('这一章主要讲了什么？');
    expect((await screen.findByTestId('assistant-bubble')).textContent).toBe('回答A');
    expect(screen.queryByTestId('chat-empty-state')).toBeNull();
  });

  it('fills the composer instead when no provider is configured', async () => {
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    fireEvent.click(screen.getAllByTestId('chat-suggestion')[2]!);

    expect(inputElement().value).toBe('梳理一下到目前为止的脉络');
    expect(document.activeElement).toBe(inputElement());
    // Nothing was sent, so the empty state is still the panel's content.
    expect(screen.queryByTestId('user-bubble')).toBeNull();
    expect(screen.getByTestId('chat-empty-state')).toBeTruthy();
  });
});

describe('未配置模型的引导 (ticket 14 item 7)', () => {
  it('shows the setup card above the still-visible composer', async () => {
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    const card = screen.getByTestId('chat-setup');
    expect(card.textContent).toContain('先配置一个 AI 模型');
    expect(card.textContent).toContain('配置模型后，可以就当前阅读位置提问');
    expect(inputElement()).toBeTruthy();
    expect(inputElement().disabled).toBe(false);

    fireEvent.click(screen.getByTestId('chat-setup-button'));
    expect(useAISidebarStore.getState().settingsOpen).toBe(true);
  });

  it('hides the card once a key is configured', async () => {
    configureProvider();
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    expect(screen.queryByTestId('chat-setup')).toBeNull();
  });
});

describe('失败与重试 (ticket 14 items 6)', () => {
  const API_ERROR_401 = {
    name: 'AI_APICallError',
    message: 'Unauthorized',
    statusCode: 401,
    responseBody: '{"error":{"message":"Incorrect API key provided: sk-***"}}',
  };

  it('shows a classified banner in the stream with 重试 and AI 设置', async () => {
    const { store } = makeStore({ failures: [API_ERROR_401] });
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '会失败的问题' } });
    fireEvent.click(screen.getByTestId('send-message'));

    const banner = await screen.findByTestId('chat-error');
    expect(banner.textContent).toContain('API Key');
    // The upstream English text never reaches the reader (§6 classification).
    expect(banner.textContent).not.toContain('Incorrect API key provided');
    expect(screen.getByTestId('retry-message')).toBeTruthy();

    fireEvent.click(screen.getByTestId('chat-error-settings'));
    expect(useAISidebarStore.getState().settingsOpen).toBe(true);
  });

  it('重试 re-runs the last question without duplicating it', async () => {
    const { store } = makeStore({
      failures: [{ name: 'AI_APICallError', message: 'Service Unavailable', statusCode: 503 }],
    });
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '重试就能成功的问题' } });
    fireEvent.click(screen.getByTestId('send-message'));
    await screen.findByTestId('chat-error');

    fireEvent.click(screen.getByTestId('retry-message'));

    expect((await screen.findByTestId('assistant-bubble')).textContent).toBe('回答A');
    // One question, one answer: the retry re-used the persisted user message.
    expect(screen.getAllByTestId('user-bubble')).toHaveLength(1);
    expect(screen.queryByTestId('chat-error')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('turn-quota').textContent).toBe('1 / 10 轮'));
  });

  it('offers no 重试 when there is nothing to retry', async () => {
    const { store } = makeStore({
      failures: [{ name: 'AI_APICallError', message: 'Service Unavailable', statusCode: 503 }],
    });
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '问题' } });
    fireEvent.click(screen.getByTestId('send-message'));
    await screen.findByTestId('chat-error');

    // An answer after the question means the turn completed; the store refuses
    // to re-run it, so the action must not exist (one rule, two readers).
    act(() => {
      store.setState({
        messages: [
          ...store.getState().messages,
          {
            id: 'assistant-1',
            conversationId: store.getState().conversation!.id,
            role: 'assistant',
            content: '迟到的回答',
            createdAt: 1,
          },
        ],
      });
    });

    expect(screen.queryByTestId('retry-message')).toBeNull();
    expect(screen.getByTestId('chat-error-settings')).toBeTruthy();
  });
});

describe('复制 (ticket 14 item 9)', () => {
  it('copies one answer from its hover-revealed action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '问题' } });
    fireEvent.click(screen.getByTestId('send-message'));
    await screen.findByTestId('assistant-bubble');

    const copy = screen.getByTestId('copy-answer');
    // The action is quiet until the message is hovered/focused: globals.css
    // reveals `.chat-copy-action` from `.astryx-chat-message:hover`, so the
    // button must really sit inside the message element.
    expect(copy.closest('.astryx-chat-message')).toBeTruthy();
    expect(copy.closest('.chat-copy-action')).toBeTruthy();
    expect(screen.getByTestId('copy-answer-feedback').getAttribute('data-copied')).toBe('false');

    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('回答A'));
    await waitFor(() =>
      expect(screen.getByTestId('copy-answer-feedback').getAttribute('data-copied')).toBe('true'),
    );
    expect(screen.getByTestId('copy-answer-feedback').textContent).toContain('已复制');
  });

  it('copies the topic from the header before the quota is anywhere near exhausted', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    expect(screen.queryByTestId('quota-exhausted-hint')).toBeNull();
    fireEvent.click(screen.getByTestId('copy-topic-transcript'));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toContain('# 伴读对话');
  });
});

describe('配额胶囊的警示色 (ticket 14 item 11)', () => {
  it('turns yellow when ≤2 turns remain and red once the topic is locked', async () => {
    const { store } = makeStore({ maxTurnsPerTopic: 3 });
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    const quota = () => screen.getByTestId('turn-quota');
    const ask = async (question: string) => {
      fireEvent.change(screen.getByTestId('chat-input'), { target: { value: question } });
      fireEvent.click(screen.getByTestId('send-message'));
      await waitFor(() => expect(screen.queryByTestId('send-message')).toBeTruthy());
    };

    expect(quota().getAttribute('data-color')).toBe('default');
    expect(quota().querySelector('svg')).toBeTruthy(); // lucide icon, not an emoji

    await ask('第一问');
    await waitFor(() => expect(quota().getAttribute('data-color')).toBe('yellow'));
    await waitFor(() => expect(quota().textContent).toBe('1 / 3 轮'));

    await ask('第二问');
    await waitFor(() => expect(quota().textContent).toBe('2 / 3 轮'));
    expect(quota().getAttribute('data-color')).toBe('yellow');

    await ask('第三问');
    await waitFor(() => expect(quota().textContent).toBe('3 / 3 轮'));
    expect(quota().getAttribute('data-color')).toBe('red');
  });
});

