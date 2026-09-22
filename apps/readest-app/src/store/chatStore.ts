/**
 * Whole-book agent companion chat store (reading-agent architecture doc §7):
 * turn-bounded topics whose replies stream through the reading-specialist
 * orchestrator — four-layer context pyramid, autonomous reading tools and
 * reader-synced citations included.
 *
 * - `send` appends the user message, runs one agent turn (live text deltas,
 *   tool traces and citations surface through `liveTraces` / `liveCitations`
 *   while streaming), then persists the assistant message WITH its trace and
 *   the `agent_turn_traces` row, completing the visible turn quota.
 * - Aborting keeps the partial answer on screen but never persists an
 *   assistant message for the interrupted turn (ADR 0006 behaviour kept).
 *
 * Factory `createChatStore` takes injectable manager/runTurn/settings/
 * chapter seams; the app uses the `useChatStore` singleton bound to the real
 * Dexie repositories and the lazily imported AI-SDK agent stream.
 */
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { AISettings, Conversation, Message } from '@/types/ai';
import type { AgentCitation, NodeKind, ToolCallTrace } from '@/types/readingAgent';
import {
  ConversationRepository,
  AgentTraceRepository,
} from '@/services/db/repositories';
import {
  TOPIC_TITLE_MAX_CHARS,
  createConversationManager,
  type ConversationManager,
} from '@/services/chat/conversationManager';
import {
  createAgentOrchestrator,
  locateQuoteInContext,
  type AgentOrchestrator,
  type RunTurnInput,
  type RunTurnResult,
} from '@/services/agent/agentOrchestrator';
import { getAgentBookContext } from '@/services/agent/agentContext';
import { nodeKindLabel } from '@/services/bookNodes';
import { resolveCurrentNodeText } from '@/services/summary/nodeSource';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useReaderStore } from '@/store/readerStore';

export type ChatPhase = 'idle' | 'streaming' | 'error' | 'closed';

export interface ChatChapterText {
  title: string;
  text: string;
}

/** Injectable seam: one full agent turn (orchestrator-shaped). */
export type RunTurnFn = (input: RunTurnInput) => Promise<RunTurnResult>;

export interface ChatStoreDeps {
  manager: ConversationManager;
  runTurn: RunTurnFn;
  getSettings: () => AISettings;
  getNodeText: () => ChatChapterText;
  /** Trace persistence; omit to skip (tests). */
  traces?: AgentTraceRepository;
  /**
   * Selection tracking (doc §3.3): resolve a quoted fragment to its book node
   * anchor for display on the user's message. Optional; the singleton wires
   * it to the live AgentBookContext.
   */
  locateQuote?: (
    bookHash: string,
    quoteText: string,
  ) => { nodeIndex: number; nodeTitle: string; charOffset: number; nodeKind: NodeKind } | null;
}

export interface ChatState {
  conversation: Conversation | null;
  messages: Message[];
  /** All topics of the active book (history switcher), newest first. */
  topics: Conversation[];
  /** Partial answer while `phase === 'streaming'`. */
  streamingText: string;
  /** Live tool-call trail of the in-flight agent turn. */
  liveTraces: ToolCallTrace[];
  /** Live locate_in_reader citations of the in-flight agent turn. */
  liveCitations: AgentCitation[];
  phase: ChatPhase;
  error: string | null;
  /** Pending selection quote (ticket 05 fills this via `setQuoteDraft`). */
  quoteDraft: string | null;
  /** Derived: streaming or topic closed. */
  inputDisabled: boolean;
  activeBookHash: string;
  activeSectionIndex: number | null;
  openBook: (bookHash: string, nodeIndex?: number) => Promise<void>;
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
      liveTraces: [],
      liveCitations: [],
      phase: 'idle',
      error: null,
      quoteDraft: null,
      inputDisabled: false,
      activeBookHash: '',
      activeSectionIndex: null,

      openBook: async (bookHash, nodeIndex) => {
        patch({
          activeBookHash: bookHash,
          activeSectionIndex: nodeIndex ?? null,
          streamingText: '',
          liveTraces: [],
          liveCitations: [],
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
            nodeIndex: state.activeSectionIndex ?? undefined,
            title: userText.slice(0, TOPIC_TITLE_MAX_CHARS),
          });
          patch({ conversation });
        }

        const history = get().messages;
        // Selection tracking: attribute the quote to its book node before the
        // turn starts, so the reply card explains where the quote lives.
        let quoteSource: string | undefined;
        if (quoteText && deps.locateQuote) {
          const anchor = deps.locateQuote(bookHash, quoteText);
          if (anchor) {
            quoteSource = `${nodeKindLabel(anchor.nodeKind)}《${anchor.nodeTitle}》 约 ${anchor.charOffset} 字符处`;
          }
        }
        const userMessage = await deps.manager.sendMessage(conversation, {
          role: 'user',
          content: userText,
          quoteText,
          ...(quoteSource ? { quoteSource } : {}),
        });
        patch({
          messages: [...history, userMessage],
          phase: 'streaming',
          streamingText: '',
          liveTraces: [],
          liveCitations: [],
          error: null,
        });

        const reader = useReaderStore.getState();
        const chapter = deps.getNodeText();
        controller = new AbortController();

        try {
          const result = await deps.runTurn({
            bookHash,
            bookTitle: reader.bookTitle,
            currentSectionIndex: get().activeSectionIndex ?? reader.spineIndex,
            currentNodeTitle: chapter.title || reader.nodeTitle,
            currentNodeText: chapter.text,
            history,
            userMessage: userText,
            quoteText,
            signal: controller.signal,
            onEvent: (event) => {
              if (event.type === 'delta') {
                patch({ streamingText: get().streamingText + event.text });
              } else if (event.type === 'tool-call') {
                patch({ liveTraces: [...get().liveTraces, event.trace] });
              } else if (event.type === 'tool-result') {
                patch({ liveTraces: [...get().liveTraces] });
              } else if (event.type === 'citation') {
                patch({ liveCitations: [...get().liveCitations, event.citation] });
              }
            },
          });

          controller = null;
          const assistantMessage = await deps.manager.sendMessage(conversation, {
            role: 'assistant',
            content: result.content,
            toolCalls: result.toolCalls,
            citations: result.citations,
          });
          if (deps.traces && result.toolCalls.length > 0) {
            await deps.traces.put({
              id: assistantMessage.id,
              conversationId: conversation.id,
              messageId: assistantMessage.id,
              toolCalls: result.toolCalls,
              createdAt: assistantMessage.createdAt,
            });
          }
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
            liveTraces: [],
            liveCitations: [],
            error: null,
            phase: updated.isClosed ? 'closed' : 'idle',
          });
        } catch (err) {
          controller = null;
          if (isAbortError(err)) {
            // User stopped the answer: keep the partial text on screen, persist
            // nothing for this turn and stay usable (design doc 4.4.3).
            patch({ phase: 'idle', error: null });
            return;
          }
          patch({ phase: 'error', error: toErrorMessage(err), streamingText: '' });
          return;
        }
      },

      stop: () => {
        controller?.abort();
      },

      startNewTopic: () => {
        controller?.abort();
        controller = null;
        patch({
          conversation: null,
          messages: [],
          streamingText: '',
          liveTraces: [],
          liveCitations: [],
          error: null,
          phase: 'idle',
        });
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
          activeSectionIndex: conversation.nodeIndex ?? null,
          streamingText: '',
          liveTraces: [],
          liveCitations: [],
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
          const toolLines = (message.toolCalls ?? [])
            .map((call) => `  · 🔧 ${call.toolName}${call.resultSnippet ? `：${call.resultSnippet}` : ''}`)
            .join('\n');
          const citationLines = (message.citations ?? [])
            .map((citation) => `  · 📍 ${nodeKindLabel(citation.nodeKind)}《${citation.nodeTitle}》`)
            .join('\n');
          return `${quote}[${label}] ${message.content}${toolLines ? `\n${toolLines}` : ''}${citationLines ? `\n${citationLines}` : ''}`;
        });
        return `# ${title}\n\n${body.join('\n\n')}`;
      },
    };
  });
}

/**
 * App-wide singleton (AISidebar's 伴读 tab binds ChatTab to this by default).
 * Turns run through the whole-book agent orchestrator; chapter context
 * resolves through the shared nodeSource exactly like the summary tab.
 */
let singletonOrchestrator: AgentOrchestrator | null = null;

/** Lazily build the real orchestrator (AI SDK dynamic import, tests bypass). */
const getSingletonOrchestrator = async (): Promise<AgentOrchestrator> => {
  if (!singletonOrchestrator) {
    const { createAgentStreamFn } = await import('@/services/ai/agentStreamClient');
    singletonOrchestrator = createAgentOrchestrator({
      stream: createAgentStreamFn(),
      getSettings: () => useAISettingsStore.getState().settings,
      getContext: getAgentBookContext,
    });
  }
  return singletonOrchestrator;
};

export const useChatStore: ChatStoreHook = createChatStore({
  manager: createConversationManager({ repository: new ConversationRepository() }),
  traces: new AgentTraceRepository(),
  runTurn: async (input) => (await getSingletonOrchestrator()).runTurn(input),
  getSettings: () => useAISettingsStore.getState().settings,
  getNodeText: () => {
    const { title, text } = resolveCurrentNodeText();
    return { title: title || useReaderStore.getState().nodeTitle, text };
  },
  locateQuote: (bookHash, quoteText) => {
    const context = getAgentBookContext(bookHash);
    if (!context) return null;
    return locateQuoteInContext(context, quoteText);
  },
});
