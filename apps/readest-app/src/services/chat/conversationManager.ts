/**
 * Turn-bounded conversation manager (ticket 04, design doc 4.4, ADR 0006).
 *
 * Owns the Conversation/Message lifecycle on top of ConversationRepository:
 * starting topics, appending messages, incrementing the visible turn counter
 * and closing the topic exactly when the quota is reached. The repository is
 * injectable so tests run against an isolated ReadestPlusDatabase.
 */
import type { ChatRole, Conversation, Message } from '@/types/ai';
import type { AgentCitation, ToolCallTrace } from '@/types/readingAgent';
import type { ConversationRepository } from '@/services/db/repositories';

export const DEFAULT_TOPIC_TITLE = '新话题';
export const TOPIC_TITLE_MAX_CHARS = 30;

/**
 * The **one** Turn Quota rule (ADR 0006 / 候选 epilogue).
 *
 * The rule used to be written three times — `completeTurn`'s `turnCount >=
 * maxTurns`, `chatStore`'s `computeInputDisabled`, and `ChatTab`'s own `isClosed`
 * — while both convenience helpers (`canSend`, `turnLabel`) were called only by
 * their own tests. The cap itself was read from two stores: `aiSettingsStore` for
 * the pill's display and the injected settings for enforcement. If the two ever
 * disagreed the pill read 「1 / 10」 while the topic locked at 2.
 */
export const isQuotaReached = (turnCount: number, maxTurns: number): boolean =>
  turnCount >= maxTurns;

/** The quota pill's text — the same expression the store enforces. */
export const turnQuotaLabel = (
  conversation: Conversation | null | undefined,
  maxTurns: number,
): string => `${conversation?.turnCount ?? 0} / ${maxTurns}`;

/** A topic accepts a turn unless the quota already closed it. */
export const canSend = (conversation: Conversation | null | undefined): boolean =>
  !(conversation?.isClosed ?? false);

/**
 * The index of the user message a **retry** would re-run, or -1 when there is
 * nothing to retry.
 *
 * Only the tail user message qualifies: a reply after it means the turn already
 * completed (a persistence failure, say), and re-running would persist a second
 * answer to one question. One rule, two readers — `chatStore.retry` enforces it
 * and `ChatTab` uses it to decide whether the 重试 action exists at all, so the
 * button can never be a no-op.
 */
export const retryTargetIndex = (messages: readonly Message[]): number => {
  const last = messages.length - 1;
  return last >= 0 && messages[last]!.role === 'user' ? last : -1;
};

export interface ConversationManagerDeps {
  repository: ConversationRepository;
  idFactory?: () => string;
  now?: () => number;
}

export interface StartConversationInput {
  bookHash: string;
  /** Physical position the topic starts at (see `Conversation.spineIndex`). */
  spineIndex?: number;
  title?: string;
}

export interface SendMessageInput {
  role: ChatRole;
  content: string;
  quoteText?: string;
  /** Resolved chapter attribution of the quote (selection tracking). */
  quoteSource?: string;
  /** Tool-call trail + citations persisted with assistant replies. */
  toolCalls?: ToolCallTrace[];
  citations?: AgentCitation[];
}

export interface ConversationManager {
  startConversation(input: StartConversationInput): Promise<Conversation>;
  sendMessage(conversation: Conversation, input: SendMessageInput): Promise<Message>;
  completeTurn(conversation: Conversation, maxTurns: number): Promise<Conversation>;
  canSend(conversation: Conversation): boolean;
  getConversation(id: string): Promise<Conversation | undefined>;
  listTopics(bookHash: string): Promise<Conversation[]>;
  loadMessages(conversationId: string): Promise<Message[]>;
}

const randomId = (): string => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const normalizeTitle = (title: string | undefined): string => {
  const trimmed = (title ?? '').trim();
  if (!trimmed) return DEFAULT_TOPIC_TITLE;
  return trimmed.length <= TOPIC_TITLE_MAX_CHARS ? trimmed : trimmed.slice(0, TOPIC_TITLE_MAX_CHARS);
};

export function createConversationManager(deps: ConversationManagerDeps): ConversationManager {
  const newId = deps.idFactory ?? randomId;
  const clock = deps.now ?? Date.now;
  /**
   * Messages are ordered by `createdAt` (see `ConversationRepository.listMessages`)
   * and a fast turn can put two of them in the same millisecond — where the sort
   * falls back to comparing random ids, i.e. to a coin flip. A topic's message
   * order is not something to leave to chance, so the manager stamps strictly
   * increasing times.
   */
  let lastStamp = 0;
  const now = (): number => {
    const stamp = clock();
    lastStamp = stamp > lastStamp ? stamp : lastStamp + 1;
    return lastStamp;
  };

  return {
    startConversation: async ({ bookHash, spineIndex, title }) => {
      const timestamp = now();
      const conversation: Conversation = {
        id: newId(),
        bookHash,
        spineIndex,
        title: normalizeTitle(title),
        turnCount: 0,
        isClosed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await deps.repository.put(conversation);
      return conversation;
    },

    sendMessage: async (conversation, { role, content, quoteText, quoteSource, toolCalls, citations }) => {
      const message: Message = {
        id: newId(),
        conversationId: conversation.id,
        role,
        content,
        quoteText,
        ...(quoteSource ? { quoteSource } : {}),
        ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
        ...(citations && citations.length > 0 ? { citations } : {}),
        createdAt: now(),
      };
      await deps.repository.appendMessage(message);
      // Any new message keeps the topic at the top of the history list.
      await deps.repository.put({ ...conversation, updatedAt: now() });
      return message;
    },

    completeTurn: async (conversation, maxTurns) => {
      const turnCount = conversation.turnCount + 1;
      const updated: Conversation = {
        ...conversation,
        turnCount,
        isClosed: isQuotaReached(turnCount, maxTurns),
        updatedAt: now(),
      };
      await deps.repository.put(updated);
      return updated;
    },

    canSend: (conversation) => canSend(conversation),

    getConversation: (id) => deps.repository.get(id),

    listTopics: (bookHash) => deps.repository.listByBook(bookHash),

    loadMessages: (conversationId) => deps.repository.listMessages(conversationId),
  };
}
