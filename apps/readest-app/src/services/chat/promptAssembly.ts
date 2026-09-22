/**
 * Prompt assembly for the companion chat (ticket 04, design doc 4.4, ADR 0006).
 *
 * - `buildSystemPrompt`: companion role + explicit anti-spoiler boundary scoped
 *   to the currently open book node. Level-aware: when the caller knows the
 *   node's level (章 / 节 / 段) the sentence names it with the shared node
 *   vocabulary, and falls back to the neutral 节点 otherwise.
 * - `buildChatPrompt`: chapter text + the topic's FULL message history + the
 *   current question. History is never truncated here (ADR 0006 rejects silent
 *   sliding windows); the only truncation point is the chapter text itself via
 *   `extractPlainTextForPrompt`.
 */
import type { Message } from '@/types/ai';
import type { NodeKind } from '@/types/readingAgent';
import { extractPlainTextForPrompt } from '@/services/reader/extractor';
import { nodeKindLabel } from '@/services/bookNodes';

export interface SystemPromptInput {
  bookTitle: string;
  /** 0-based physical node ordinal of the reader's position. */
  nodeIndex: number;
  nodeTitle: string;
  /**
   * Level of the node the reader is looking at (章 / 节 / 段). Omitted when the
   * caller has no node shape yet → the neutral 节点 wording is used.
   */
  nodeKind?: NodeKind;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const { bookTitle, nodeTitle, nodeKind } = input;
  const kindWord = nodeKind ? nodeKindLabel(nodeKind) : '节点';
  return [
    `你是一位渊博、敏锐且富有启发性的伴读助手。当前用户正在阅读《${bookTitle}》的${kindWord}《${nodeTitle}》。`,
    `请主要围绕当前${kindWord}的内容展开解答与剖析。除非用户明确要求透露后续情节，否则严禁主动剧透后续内容。`,
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
