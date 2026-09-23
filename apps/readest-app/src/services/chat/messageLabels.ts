/**
 * Message role labels — the one place a role becomes a word.
 *
 * A Conversation's messages are rendered into two different texts: the **prompt**
 * sent to the model (the history block of a turn) and the **transcript** the reader
 * copies out of the topic. Both need to say who said what, and they were doing it
 * with two separate expressions of the same rule — one in
 * `services/agent/agentOrchestrator`, one inline in `store/chatStore`. A third
 * phrasing would have been easy and silent.
 *
 * The words are deliberately the reader's, not the API's: 读者 / 助手 / 系统. The
 * model reads Chinese source text, so the history block stays in Chinese rather than
 * mixing in `user:` / `assistant:`.
 */
import type { ChatRole } from '@/types/ai';

/** 读者 / 助手 / 系统 — the reader-facing word for a message role. */
export const roleLabel = (role: ChatRole): string =>
  role === 'user' ? '读者' : role === 'assistant' ? '助手' : '系统';

/**
 * Render the full in-topic history as one block.
 *
 * Never truncated: ADR 0006 rejects silent sliding windows, so the only truncation
 * point in a turn is the node text (via `extractPlainTextForPrompt`).
 */
export const renderHistory = (history: readonly { role: ChatRole; content: string }[]): string =>
  history.map((message) => `${roleLabel(message.role)}：${message.content}`).join('\n');