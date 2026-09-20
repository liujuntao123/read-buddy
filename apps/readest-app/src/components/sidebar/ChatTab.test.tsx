import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatTab from './ChatTab';
import { createChatStore, type ChatStoreHook } from '@/store/chatStore';
import { createConversationManager } from '@/services/chat/conversationManager';
import { ConversationRepository } from '@/services/db/repositories';
import { ReadestPlusDatabase } from '@/services/db/database';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { DEFAULT_AI_SETTINGS, type AISettings } from '@/types/ai';
import type { StreamTextFn } from '@/services/ai/streamClient';

const databases: ReadestPlusDatabase[] = [];

beforeEach(() => {
  useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS, maxTurnsPerTopic: 10 } });
});

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.delete()));
  useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } });
});

const makeStore = (options: { maxTurnsPerTopic?: number; stream?: StreamTextFn } = {}) => {
  const db = new ReadestPlusDatabase(`chat-tab-test-${Math.random().toString(36).slice(2)}`);
  databases.push(db);
  const manager = createConversationManager({ repository: new ConversationRepository(db) });
  let settings: AISettings = { ...DEFAULT_AI_SETTINGS, maxTurnsPerTopic: options.maxTurnsPerTopic ?? 10 };
  const store: ChatStoreHook = createChatStore({
    manager,
    stream: options.stream ?? (async function* () { yield '回答A'; }),
    getSettings: () => settings,
    getChapterText: () => ({ title: '第一章 迷雾之城', text: '灯火在雾中摇曳。' }),
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
    const stream: StreamTextFn = async function* () {
      yield '正在思考';
      await gate;
      yield '完毕';
    };
    const { store } = makeStore({ stream });
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

  it('shows a pending selection quote above the input and clears it on demand', async () => {
    const { store } = makeStore();
    await store.getState().openBook('demo-fog-city-0001', 0);
    render(<ChatTab store={store} />);

    act(() => { store.getState().setQuoteDraft('古老的钟楼敲响了第三声'); });
    const quote = await screen.findByTestId('quote-draft');
    expect(quote.textContent).toContain('> 古老的钟楼敲响了第三声');

    fireEvent.click(screen.getByRole('button', { name: '清除引用' }));
    await waitFor(() => expect(screen.queryByTestId('quote-draft')).toBeNull());
  });
});
