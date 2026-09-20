/**
 * Companion chat store (ticket 04, design doc 4.4, ADR 0006).
 *
 * Turn-bounded conversations with an explicit, user-visible quota:
 * - `send` appends the user message, streams the answer with the chapter text
 *   + FULL topic history in the prompt (no sliding window), then completes the
 *   turn and closes the topic at the configured quota.
 * - Aborting keeps the partial answer on screen but never persists an
 *   assistant message for the interrupted turn.
 *
 * Factory `createChatStore` takes injectable manager/stream/settings/chapter
 * seams; the app uses the `useChatStore` singleton bound to the real Dexie
 * repository, the AI-SDK stream, the live settings store and the shared
 * chapter source (opened-book registry with demo fallback).
 */
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { AISettings, Conversation, Message } from '@/types/ai';
import type { StreamTextFn } from '@/services/ai/streamClient';
import { ConversationRepository } from '@/services/db/repositories';
import {
  TOPIC_TITLE_MAX_CHARS,
  createConversationManager,
  type ConversationManager,
} from '@/services/chat/conversationManager';
import { resolveCurrentChapterText } from '@/services/summary/chapterSource';
import { buildChatPrompt, buildSystemPrompt } from '@/services/chat/promptAssembly';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useReaderStore } from '@/store/readerStore';

export type ChatPhase = 'idle' | 'streaming' | 'error' | 'closed';

export interface ChatChapterText {
  title: string;
  text: string;
}

export interface ChatStoreDeps {
  manager: ConversationManager;
  stream: StreamTextFn;
  getSettings: () => AISettings;
  getChapterText: () => ChatChapterText;
}

export interface ChatState {
  conversation: Conversation | null;
  messages: Message[];
  /** All topics of the active book (history switcher), newest first. */
  topics: Conversation[];
  /** Partial answer while `phase === 'streaming'`. */
  streamingText: string;
  phase: ChatPhase;
  error: string | null;
  /** Pending selection quote (ticket 05 fills this via `setQuoteDraft`). */
  quoteDraft: string | null;
  /** Derived: streaming or topic closed. */
  inputDisabled: boolean;
  activeBookHash: string;
  activeSectionIndex: number | null;
  openBook: (bookHash: string, sectionIndex?: number) => Promise<void>;
  send: (userText: string, quoteText?: string) => Promise<void>;
  stop: () => void;
  startNewTopic: () => void;
  selectTopic: (conversationId: string) => Promise<void>;
  setQuoteDraft: (text: string | null) => void;
  refreshTopics: () => Promise<void>;
  exportTranscript: () => string;
}

export type ChatStoreHook = UseBoundStore<StoreApi<ChatState>>;

const isAbortError = (err: unknown): boolean => {
  const candidate = err as { name?: unknown; message?: unknown } | null | undefined;
  if (!candidate) return false;
  if (candidate.name === 'AbortError') return true;
  return typeof candidate.message === 'string' && /abort/i.test(candidate.message);
};

const toErrorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === 'string' ? err : 'AI 请求失败，请稍后重试';

const computeInputDisabled = (phase: ChatPhase, conversation: Conversation | null): boolean =>
  phase === 'streaming' || (conversation?.isClosed ?? false);

/** `turnCount / maxTurns` label for the quota pill. */
export const turnLabel = (conversation: Conversation | null | undefined, maxTurns: number): string =>
  `${conversation?.turnCount ?? 0} / ${maxTurns}`;

export function createChatStore(deps: ChatStoreDeps): ChatStoreHook {
  let controller: AbortController | null = null;

  return create<ChatState>()((set, get) => {
    /** `set` wrapper that always recomputes the derived `inputDisabled`. */
    const patch = (partial: Partial<ChatState>) =>
      set((state) => {
        const phase = partial.phase ?? state.phase;
        const conversation =
          partial.conversation !== undefined ? partial.conversation : state.conversation;
        return { ...partial, inputDisabled: computeInputDisabled(phase, conversation) };
      });

    return {
      conversation: null,
      messages: [],
      topics: [],
      streamingText: '',
      phase: 'idle',
      error: null,
      quoteDraft: null,
      inputDisabled: false,
      activeBookHash: '',
      activeSectionIndex: null,

      openBook: async (bookHash, sectionIndex) => {
        patch({
          activeBookHash: bookHash,
          activeSectionIndex: sectionIndex ?? null,
          streamingText: '',
          error: null,
        });
        const topics = await deps.manager.listTopics(bookHash);
        // Resume the newest still-open topic; never auto-create one — the
        // first user message of a fresh topic names it.
        const open = topics.find((topic) => !topic.isClosed);
        if (open) {
          const messages = await deps.manager.loadMessages(open.id);
          patch({ conversation: open, messages, phase: 'idle', topics });
        } else {
          patch({ conversation: null, messages: [], phase: 'idle', topics });
        }
      },

      send: async (userText, quoteText) => {
        const state = get();
        if (state.conversation?.isClosed || state.phase === 'streaming') return;

        const bookHash = state.activeBookHash || state.conversation?.bookHash || '';
        let conversation = state.conversation;
        if (!conversation) {
          conversation = await deps.manager.startConversation({
            bookHash,
            sectionIndex: state.activeSectionIndex ?? undefined,
            title: userText.slice(0, TOPIC_TITLE_MAX_CHARS),
          });
          patch({ conversation });
        }

        const history = get().messages;
        const userMessage = await deps.manager.sendMessage(conversation, {
          role: 'user',
          content: userText,
          quoteText,
        });
        patch({ messages: [...history, userMessage], phase: 'streaming', streamingText: '', error: null });

        const reader = useReaderStore.getState();
        const chapter = deps.getChapterText();
        const system = buildSystemPrompt({
          bookTitle: reader.bookTitle,
          chapterIndex: get().activeSectionIndex ?? reader.sectionIndex,
          chapterTitle: chapter.title || reader.chapterTitle,
        });
        const prompt = buildChatPrompt({ chapterText: chapter.text, history, userMessage: userText, quoteText });

        controller = new AbortController();
        let acc = '';
        try {
          const deltas = deps.stream({ system, prompt, signal: controller.signal }, deps.getSettings());
          for await (const delta of deltas) {
            acc += delta;
            patch({ streamingText: acc });
          }
        } catch (err) {
          controller = null;
          if (isAbortError(err)) {
            // User stopped the answer: keep the partial text on screen, persist
            // nothing for this turn and stay usable (design doc 4.4.3).
            patch({ phase: 'idle', error: null, streamingText: acc });
            return;
          }
          patch({ phase: 'error', error: toErrorMessage(err), streamingText: '' });
          return;
        }
        controller = null;

        await deps.manager.sendMessage(conversation, { role: 'assistant', content: acc });
        const updated = await deps.manager.completeTurn(
          conversation,
          deps.getSettings().maxTurnsPerTopic,
        );
        const [messages, topics] = await Promise.all([
          deps.manager.loadMessages(conversation.id),
          deps.manager.listTopics(updated.bookHash),
        ]);
        patch({
          conversation: updated,
          messages,
          topics,
          streamingText: '',
          error: null,
          phase: updated.isClosed ? 'closed' : 'idle',
        });
      },

      stop: () => {
        controller?.abort();
      },

      startNewTopic: () => {
        controller?.abort();
        controller = null;
        patch({ conversation: null, messages: [], streamingText: '', error: null, phase: 'idle' });
        void get().refreshTopics();
      },

      selectTopic: async (conversationId) => {
        const conversation = await deps.manager.getConversation(conversationId);
        if (!conversation) return;
        const [messages, topics] = await Promise.all([
          deps.manager.loadMessages(conversationId),
          deps.manager.listTopics(conversation.bookHash),
        ]);
        patch({
          conversation,
          messages,
          topics,
          activeBookHash: conversation.bookHash,
          activeSectionIndex: conversation.sectionIndex ?? null,
          streamingText: '',
          error: null,
          phase: conversation.isClosed ? 'closed' : 'idle',
        });
      },

      setQuoteDraft: (text) => patch({ quoteDraft: text }),

      refreshTopics: async () => {
        const bookHash = get().activeBookHash || get().conversation?.bookHash || '';
        if (!bookHash) {
          patch({ topics: [] });
          return;
        }
        const topics = await deps.manager.listTopics(bookHash);
        patch({ topics });
      },

      exportTranscript: () => {
        const { conversation, messages } = get();
        const title = conversation?.title ?? '伴读对话';
        const body = messages.map((message) => {
          const label = message.role === 'user' ? '读者' : message.role === 'assistant' ? '助手' : '系统';
          const quote = message.quoteText ? `> ${message.quoteText}\n` : '';
          return `${quote}[${label}] ${message.content}`;
        });
        return `# ${title}\n\n${body.join('\n\n')}`;
      },
    };
  });
}

/**
 * App-wide singleton (AISidebar's 对话 tab binds ChatTab to this by default).
 * Chapter context resolves through the shared chapterSource, which prefers
 * the opened-book registry (real imported books) and falls back to the demo
 * fixtures — identical to what the summary tab sees.
 */
export const useChatStore: ChatStoreHook = createChatStore({
  manager: createConversationManager({ repository: new ConversationRepository() }),
  // Lazy dynamic import keeps the AI SDK out of module-load (and unit tests).
  stream: async function* (req, settings) {
    const { createAiSdkStreamFn } = await import('@/services/ai/streamClient');
    yield* createAiSdkStreamFn()(req, settings);
  },
  getSettings: () => useAISettingsStore.getState().settings,
  getChapterText: () => {
    const { title, text } = resolveCurrentChapterText();
    return { title: title || useReaderStore.getState().chapterTitle, text };
  },
});
