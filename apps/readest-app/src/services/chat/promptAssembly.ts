/**
 * Prompt assembly for the companion chat (ticket 04, design doc 4.4, ADR 0006).
 *
 * - `buildSystemPrompt`: companion role + explicit anti-spoiler boundary scoped
 *   to the currently open chapter.
 * - `buildChatPrompt`: chapter text + the topic's FULL message history + the
 *   current question. History is never truncated here (ADR 0006 rejects silent
 *   sliding windows); the only truncation point is the chapter text itself via
 *   `extractPlainTextForPrompt`.
 */
import type { Message } from '@/types/ai';
import { extractPlainTextForPrompt } from '@/services/reader/extractor';

export interface SystemPromptInput {
  bookTitle: string;
  /** 0-based section ordinal; rendered human-style as `chapterIndex + 1`. */
  chapterIndex: number;
  chapterTitle: string;
}

export function buildSystemPrompt({
  bookTitle,
  chapterIndex,
  chapterTitle,
}: SystemPromptInput): string {
  return [
    `你是一位渊博、敏锐且富有启发性的伴读助手。当前用户正在阅读《${bookTitle}》第 ${chapterIndex + 1} 章《${chapterTitle}》。`,
    '请主要围绕当前章节的内容展开解答与剖析。除非用户明确要求透露后续情节，否则严禁主动剧透后续章节内容。',
  ].join('\n');
}

export interface ChatPromptInput {
  chapterText: string;
  /** Full in-topic history; every entry is included verbatim, in order. */
  history: Message[];
  userMessage: string;
  /** Selection quote rendered as a `> ` block above the question. */
  quoteText?: string;
}

const historyLabel = (role: Message['role']): string =>
  role === 'user' ? '读者' : role === 'assistant' ? '助手' : '系统';

export function buildChatPrompt({
  chapterText,
  history,
  userMessage,
  quoteText,
}: ChatPromptInput): string {
  const historyText = history.map((m) => `${historyLabel(m.role)}：${m.content}`).join('\n');
  const question = quoteText ? `> ${quoteText}\n\n${userMessage}` : userMessage;
  return [
    `【本章正文】\n${extractPlainTextForPrompt(chapterText)}`,
    `【对话历史】\n${historyText}`,
    `【本轮提问】\n${question}`,
  ].join('\n\n');
}
