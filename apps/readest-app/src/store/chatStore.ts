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
 * - `retry` re-runs that turn for the last user message — the message is
 *   already persisted, so nothing is duplicated on screen or in the topic.
 * - Aborting keeps the partial answer on screen but never persists an
 *   assistant message for the interrupted turn (ADR 0006 behaviour kept).
 * - Failures surface as `describeAIError` copy (设计文档 §6), never the SDK's
 *   own English message.
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
  canSend,
  createConversationManager,
  retryTargetIndex,
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
import { roleLabel } from '@/services/chat/messageLabels';
import { describeAIError } from '@/services/ai/errorMessages';
import {
  currentReadingPosition,
  nodeKindLabel,
  resolveNodeViewAt,
  type ReadingPosition,
} from '@/services/bookNodes';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useReaderStore } from '@/store/readerStore';

export type ChatPhase = 'idle' | 'streaming' | 'error' | 'closed';

/** Injectable seam: one full agent turn (orchestrator-shaped). */
export type RunTurnFn = (input: RunTurnInput) => Promise<RunTurnResult>;

export interface ChatStoreDeps {
  manager: ConversationManager;
  runTurn: RunTurnFn;
  getSettings: () => AISettings;
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
  /**
   * The Turn Quota the store enforces, exposed so the pill displays the same
   * number. Read from the injected settings at open and at each send — never
   * from a second store (候选 epilogue: the cap used to come from two places).
   */
  maxTurns: number;
  activeBookHash: string;
  /**
   * The **physical** position (spine ordinal) the active topic is bound to,
   * or null to follow the live reader position. See `Conversation.spineIndex`.
   */
  activeSpineIndex: number | null;
  openBook: (bookHash: string, spineIndex?: number) => Promise<void>;
  send: (userText: string, quoteText?: string) => Promise<void>;
  /**
   * Re-run the last user message's turn without re-appending it. Only the tail
   * user message is retryable: the failure path persists no assistant reply,
   * so after an error the user message *is* the last message.
   */
  retry: () => Promise<void>;
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

const computeInputDisabled = (phase: ChatPhase, conversation: Conversation | null): boolean =>
  phase === 'streaming' || !canSend(conversation);

/**
 * `turnCount / maxTurns` for the quota pill. Re-exported from the conversation
 * manager so the displayed number and the enforced one are the same expression.
 */
export { turnQuotaLabel } from '@/services/chat/conversationManager';

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

    /**
     * One agent turn over a user message that is already part of the visible
     * conversation: `send` has just appended it, `retry` finds it already
     * there. Sharing the body keeps a retry from ever drifting from a first
     * attempt — the position rule, the live event wiring and the persistence
     * order exist once.
     */
    const runTurnFor = async (
      conversation: Conversation,
      history: Message[],
      userMessage: Message,
    ): Promise<void> => {
      patch({
        phase: 'streaming',
        streamingText: '',
        liveTraces: [],
        liveCitations: [],
        error: null,
      });

      const reader = useReaderStore.getState();
      controller = new AbortController();

      // The Reading Position this turn runs against. A topic bound to an older
      // position keeps it, but carries no anchor — none was recorded for it
      // (ADR 0011). Otherwise the live reader position wins, anchor included.
      const bookHash = conversation.bookHash;
      const activeSpineIndex = get().activeSpineIndex;
      const live = currentReadingPosition();
      const position: ReadingPosition =
        activeSpineIndex !== null && activeSpineIndex !== live.spineIndex
          ? { bookHash, spineIndex: activeSpineIndex }
          : {
              bookHash,
              spineIndex: live.spineIndex,
              ...(live.anchor ? { anchor: live.anchor } : {}),
            };

      try {
        const result = await deps.runTurn({
          position,
          bookTitle: reader.bookTitle,
          history,
          userMessage: userMessage.content,
          quoteText: userMessage.quoteText,
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
        // One read of the cap: the number enforced is the number displayed.
        const maxTurns = deps.getSettings().maxTurnsPerTopic;
        const updated = await deps.manager.completeTurn(conversation, maxTurns);
        const [messages, topics] = await Promise.all([
          deps.manager.loadMessages(conversation.id),
          deps.manager.listTopics(updated.bookHash),
        ]);
        patch({
          conversation: updated,
          maxTurns,
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
        // 设计文档 §6: one classified, reader-facing sentence — never the
        // SDK's own message (see `services/ai/errorMessages`).
        patch({ phase: 'error', error: describeAIError(err).message, streamingText: '' });
        return;
      }
    };

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
      maxTurns: deps.getSettings().maxTurnsPerTopic,
      activeBookHash: '',
      activeSpineIndex: null,

      openBook: async (bookHash, spineIndex) => {
        patch({
          activeBookHash: bookHash,
          activeSpineIndex: spineIndex ?? null,
          maxTurns: deps.getSettings().maxTurnsPerTopic,
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
            spineIndex: state.activeSpineIndex ?? undefined,
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
            // 「」 quotes a node title; 《》 is for book titles only (CONTEXT.md).
            quoteSource = `${nodeKindLabel(anchor.nodeKind)}「${anchor.nodeTitle}」 约 ${anchor.charOffset} 字符处`;
          }
        }
        const userMessage = await deps.manager.sendMessage(conversation, {
          role: 'user',
          content: userText,
          quoteText,
          ...(quoteSource ? { quoteSource } : {}),
        });
        patch({ messages: [...history, userMessage] });

        await runTurnFor(conversation, history, userMessage);
      },

      retry: async () => {
        const { conversation, messages, phase } = get();
        if (!conversation || conversation.isClosed || phase === 'streaming') return;

        // The retry rule lives in `conversationManager` so ChatTab can ask the
        // same question before it renders the action (no dead 重试 button).
        const index = retryTargetIndex(messages);
        if (index === -1) return;

        // The prompt history is what the first attempt used: everything before
        // the user message. The message itself is already persisted and stays
        // on screen — retry never duplicates it.
        await runTurnFor(conversation, messages.slice(0, index), messages[index]!);
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
          // A fresh topic re-reads the cap: the displayed and enforced quota both
          // follow the current settings from here on.
          maxTurns: deps.getSettings().maxTurnsPerTopic,
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
          activeSpineIndex: conversation.spineIndex ?? null,
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
          const label = roleLabel(message.role);
          const quote = message.quoteText ? `> ${message.quoteText}\n` : '';
          const toolLines = (message.toolCalls ?? [])
            .map((call) => `  · 🔧 ${call.toolName}${call.resultSnippet ? `：${call.resultSnippet}` : ''}`)
            .join('\n');
          const citationLines = (message.citations ?? [])
            .map((citation) => `  · 📍 ${nodeKindLabel(citation.nodeKind)}「${citation.nodeTitle}」`)
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
      resolveNodeView: resolveNodeViewAt,
    });
  }
  return singletonOrchestrator;
};

export const useChatStore: ChatStoreHook = createChatStore({
  manager: createConversationManager({ repository: new ConversationRepository() }),
  traces: new AgentTraceRepository(),
  runTurn: async (input) => (await getSingletonOrchestrator()).runTurn(input),
  getSettings: () => useAISettingsStore.getState().settings,
  locateQuote: (bookHash, quoteText) => {
    const context = getAgentBookContext(bookHash);
    if (!context) return null;
    return locateQuoteInContext(context, quoteText);
  },
});
