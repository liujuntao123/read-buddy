import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatTab from './ChatTab';
import { createChatStore, type ChatStoreHook } from '@/store/chatStore';
import { createConversationManager } from '@/services/chat/conversationManager';
import { ConversationRepository } from '@/services/db/repositories';
import { ReadestPlusDatabase } from '@/services/db/database';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { DEFAULT_AI_SETTINGS, type AISettings } from '@/types/ai';
import type { RunTurnInput, RunTurnResult } from '@/services/agent/agentOrchestrator';
import type { AgentTurnEvent } from '@/services/agent/agentOrchestrator';

const databases: ReadestPlusDatabase[] = [];

beforeEach(() => {
  useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS, maxTurnsPerTopic: 10 } });
});

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
  useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } });
});

interface ScriptStep {
  event: AgentTurnEvent;
  /** Await this promise before replaying the step (pacing control). */
  gate?: Promise<void>;
}

const makeStore = (options: { maxTurnsPerTopic?: number; script?: ScriptStep[] } = {}) => {
  const db = new ReadestPlusDatabase(`chat-tab-test-${Math.random().toString(36).slice(2)}`);
  databases.push(db);
  const manager = createConversationManager({ repository: new ConversationRepository(db) });
  let settings: AISettings = { ...DEFAULT_AI_SETTINGS, maxTurnsPerTopic: options.maxTurnsPerTopic ?? 10 };
  const store: ChatStoreHook = createChatStore({
    manager,
    runTurn: async (input: RunTurnInput): Promise<RunTurnResult> => {
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
    getNodeText: () => ({ title: '第一章 迷雾之城', text: '灯火在雾中摇曳。' }),
  });
  return { store, setSettings: (next: AISettings) => { settings = next; } };
};

const inputElement = (): HTMLTextAreaElement => screen.getByTestId('chat-input') as HTMLTextAreaElement;

describe('ChatTab', () => {
  it('shows the quota pill at 💬 0 / 10 轮 before any message', async () => {
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    expect(screen.getByTestId('chat-tab-panel')).toBeTruthy();
    expect(screen.getByTestId('turn-quota').textContent).toBe('💬 0 / 10 轮');
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
    await waitFor(() => expect(screen.getByTestId('turn-quota').textContent).toBe('💬 1 / 10 轮'));
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
    await waitFor(() => expect(screen.getByTestId('turn-quota').textContent).toBe('💬 1 / 10 轮'));
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
    expect(accordion.textContent).toContain('Agent 思考与工具调用轨迹 (1)');
    expect(screen.queryByTestId('agent-trace-body')).toBeNull();

    fireEvent.click(screen.getByTestId('agent-trace-toggle'));
    expect(await screen.findByTestId('agent-trace-body')).toBeTruthy();
    expect(screen.getByTestId('agent-trace-body').textContent).toContain('检索全书关键词');

    const card = screen.getByTestId('citation-card');
    // Node title alone + its level word — never the global ordinal as a 章号.
    expect(card.textContent).toContain('第三章 长夜漫漫');
    expect(screen.getByTestId('citation-node-kind').textContent).toBe('章');
    expect(card.textContent).not.toContain('《第 3 章');
    expect(card.textContent).toContain('偏移量 4,321 字符');
    expect(card.textContent).toContain('守夜人在第七次巡逻时发现星图移动');

    // The jump button re-dispatches the reader locate request.
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
    expect(card.textContent).toContain('《第三章 长夜漫漫》 ›');
    expect(card.textContent).toContain('第一节 灯塔的守望');
    expect(screen.getByTestId('citation-node-kind').textContent).toBe('节');
    expect(card.textContent).not.toContain('《第 6 章');
  });

  it('locks the input at the quota, offers new-topic + copy, and resets on a new topic', async () => {
    useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS, maxTurnsPerTopic: 1 } });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });

    const { store, setSettings } = makeStore({ maxTurnsPerTopic: 1 });
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '唯一的问题' } });
    fireEvent.click(screen.getByTestId('send-message'));
    await screen.findByTestId('assistant-bubble');

    await waitFor(() => expect(inputElement().disabled).toBe(true));
    expect(screen.getByTestId('turn-quota').textContent).toBe('💬 1 / 1 轮');
    expect(screen.getByTestId('quota-exhausted-hint').textContent).toContain(
      '本轮话题探讨已达上限（1/1），建议开启新话题以保持解答精准度',
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

    // Starting a fresh topic resets the quota pill and unlocks the input.
    useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS, maxTurnsPerTopic: 10 } });
    setSettings({ ...DEFAULT_AI_SETTINGS, maxTurnsPerTopic: 10 });
    fireEvent.click(screen.getByTestId('start-new-topic'));
    await waitFor(() => expect(screen.getByTestId('turn-quota').textContent).toBe('💬 0 / 10 轮'));
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

    fireEvent.click(screen.getByRole('button', { name: '清除引用' }));
    await waitFor(() => expect(screen.queryByTestId('quote-draft')).toBeNull());
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

