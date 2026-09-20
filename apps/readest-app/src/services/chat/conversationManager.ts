/**
 * Turn-bounded conversation manager (ticket 04, design doc 4.4, ADR 0006).
 *
 * Owns the Conversation/Message lifecycle on top of ConversationRepository:
 * starting topics, appending messages, incrementing the visible turn counter
 * and closing the topic exactly when the quota is reached. The repository is
 * injectable so tests run against an isolated ReadestPlusDatabase.
 */
import type { ChatRole, Conversation, Message } from '@/types/ai';
import type { ConversationRepository } from '@/services/db/repositories';

export const DEFAULT_TOPIC_TITLE = '新话题';
export const TOPIC_TITLE_MAX_CHARS = 30;

export interface ConversationManagerDeps {
  repository: ConversationRepository;
  idFactory?: () => string;
  now?: () => number;
}

export interface StartConversationInput {
  bookHash: string;
  sectionIndex?: number;
  title?: string;
}

export interface SendMessageInput {
  role: ChatRole;
  content: string;
  quoteText?: string;
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
  const now = deps.now ?? Date.now;

  return {
    startConversation: async ({ bookHash, sectionIndex, title }) => {
      const timestamp = now();
      const conversation: Conversation = {
        id: newId(),
        bookHash,
        sectionIndex,
        title: normalizeTitle(title),
        turnCount: 0,
        isClosed: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await deps.repository.put(conversation);
      return conversation;
    },

    sendMessage: async (conversation, { role, content, quoteText }) => {
      const message: Message = {
        id: newId(),
        conversationId: conversation.id,
        role,
        content,
        quoteText,
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
        isClosed: turnCount >= maxTurns,
        updatedAt: now(),
      };
      await deps.repository.put(updated);
      return updated;
    },

    canSend: (conversation) => !conversation.isClosed,

    getConversation: (id) => deps.repository.get(id),

    listTopics: (bookHash) => deps.repository.listByBook(bookHash),

    loadMessages: (conversationId) => deps.repository.listMessages(conversationId),
  };
}
