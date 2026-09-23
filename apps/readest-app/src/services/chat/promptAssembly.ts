/**
 * Degraded-mode system prompt for the companion chat (ticket 04, ADR 0006).
 *
 * This module is the **no-node-model** path only: when a book has no registered
 * AgentBookContext (demo fixtures, a TXT book before its index exists) the
 * whole-book pyramid cannot be assembled, so the turn falls back to a short
 * role prompt scoped to the node the reader is looking at. The live path lives
 * in `services/agent/promptPyramid` and `buildAgentUserPrompt`.
 *
 * The level word always comes from the node model (`nodeKindLabel`), never from
 * a literal 章 / 节 (CONTEXT.md / ADR 0010 ¶1) — which is why `nodeKind` is
 * required rather than optional: every caller resolves a Node View first.
 */
import type { NodeKind } from '@/types/readingAgent';
import { nodeKindLabel } from '@/services/bookNodes';

export interface SystemPromptInput {
  bookTitle: string;
  nodeTitle: string;
  /** Level of the node the reader is looking at: 章 / 节 / 段. */
  nodeKind: NodeKind;
}

export function buildSystemPrompt({ bookTitle, nodeTitle, nodeKind }: SystemPromptInput): string {
  const kindWord = nodeKindLabel(nodeKind);
  return [
    `你是一位伴读助手。当前用户正在阅读《${bookTitle}》的${kindWord}「${nodeTitle}」。`,
    `请围绕当前${kindWord}的内容展开解答与剖析。`,
  ].join('\n');
}
