/**
 * Prompt builders for node summarization (ticket 03, design doc 4.3).
 *
 * Pure functions only: every builder returns the full user prompt as a string
 * so tests can assert on node titles, the three-part section headings and the
 * injected node text. The stream seam (`services/ai/streamClient`) receives
 * these prompts verbatim.
 *
 * The summary viewpoint is always the **minimal node** (CONTEXT.md / ADR
 * 0010), so the level word (章 / 节 / 段) comes from the node model rather
 * than a hard-coded 「章节」.
 */
import { extractPlainTextForPrompt } from '@/services/reader/extractor';
import { nodeKindLabel } from '@/services/bookNodes/nodeKind';
import { SUMMARY_SINGLE_PASS_MAX_CHARS } from '@/types/ai';
import type { NodeKind } from '@/types/readingAgent';

/** Section 1 heading of the mandated three-part structure (design doc 4.3.3). */
export const SUMMARY_HEADING_CORE = '### 📌 核心要义';

/** Section 2 heading of the mandated three-part structure. */
export const SUMMARY_HEADING_OUTLINE = '### 🗺️ 关键内容脉络';

/** Section 3 heading of the mandated three-part structure. */
export const SUMMARY_HEADING_TERMS = '### 💡 核心概念与关键术语';

/** Canonical shape the final answer must follow (and only this shape). */
export const THREE_PART_TEMPLATE = `${SUMMARY_HEADING_CORE}
（以与原书相同的叙述视角，用 2~3 句话概述本节点的核心主旨、核心事实或主要论点）

${SUMMARY_HEADING_OUTLINE}
1. **[阶段/论点一]**：完整阐述该要点的逻辑链与论证链，交代背景起因与目的、核心内容或经过、导向的结果与结论（删除冗余细节，保持前后上下文与论证链条完整连贯）
2. **[阶段/论点二]**：按论证/叙事脉络展开下一个要点，讲清该要点的背景起因、展开过程与最终结论
3. **[阶段/论点三]**：继续推进核心脉络，保持完整论证闭环与前后逻辑承接

${SUMMARY_HEADING_TERMS}
- **[概念/术语名]**：在书中的具体含义、语境与核心作用`;

/**
 * Narrative-completeness rule: every outline point must trace its full
 * logical / argumentative chain in the book's narrative perspective.
 */
export const CAUSALITY_RULE = `【要点撰写准则】
1. 叙述视角：始终采用与书籍内容相同的叙述视角直接陈述，不采用第三方解读书籍或解读作者的口吻。
2. 逻辑链与论证链：讲述每个要点时，完整交代前后上下文与论证链条（是谁基于什么目的或背景 → 核心内容或事实大致是什么 → 得到了什么结果与结论）。可以删除冗余细节和繁琐描述，但必须保留完整的逻辑链和论证链。
3. 脉络连贯：按原文论证或叙事的推进顺序组织各要点，各要点之间前后逻辑严密承接。`;

/** Rule injected wherever the model must emit the three-part structure. */
export const THREE_PART_RULE = `请严格按照以下三小节结构直接输出 Markdown 正文：
${THREE_PART_TEMPLATE}

${CAUSALITY_RULE}`;

/** System prompt for the final-answer calls (single pass and reduce). */
export const SUMMARY_SYSTEM_PROMPT =
  '你是一位严谨、注重逻辑脉络的中文阅读助理，负责生成结构化的节点总结。' +
  '总结时始终保持与书籍内容相同的叙述视角直接阐述内容。' +
  '讲述要点时把前后上下文讲述完整，保留完整的逻辑链与论证链（背景与目的、核心内容或事实、结果与结论），删除冗余细节，保持论证链条与逻辑闭环严密连贯。' +
  '请直接输出 Markdown 正文。';

/** System prompt for the map phase (sub-block key-point extraction). */
export const MAP_SYSTEM_PROMPT =
  '你是一位严谨、注重脉络的中文阅读助理，正在协助分块提炼长节点。' +
  '请以与书籍内容相同的叙述视角直接提取核心要点，每个要点交代清楚前后上下文、起因目的、核心事实与导向的结论，保持完整的逻辑链。' +
  '请直接输出要点列表。';

export interface SummaryPromptInput {
  bookTitle: string;
  nodeTitle: string;
  /** 视角节点的层级：节 / 章 / 段。 */
  nodeKind: NodeKind;
  /** Full node plain text (≤ 12,000 chars on this path). */
  text: string;
}

/**
 * Single-pass prompt: the whole node (within the prompt budget) plus the
 * three-part rule. Text goes through `extractPlainTextForPrompt` so an
 * oversized input degrades to an explicit truncation marker instead of
 * blowing the context window.
 */
export function buildSinglePassPrompt({
  bookTitle,
  nodeTitle,
  nodeKind,
  text,
}: SummaryPromptInput): string {
  const level = nodeKindLabel(nodeKind);
  return `请为《${bookTitle}》的${level}「${nodeTitle}」生成三段式结构化总结。

${THREE_PART_RULE}

【${level}全文】
${extractPlainTextForPrompt(text, SUMMARY_SINGLE_PASS_MAX_CHARS)}`;
}

export interface MapPromptInput {
  bookTitle: string;
  nodeTitle: string;
  nodeKind: NodeKind;
  /** One chunk produced by `chunkNodeText` (map phase input). */
  chunk: string;
  /** 1-based ordinal of the chunk. */
  index: number;
  /** Total number of chunks. */
  total: number;
}

/**
 * Map prompt: extract key points from ONE sub-block. No three-part structure
 * here — that is the reduce phase's job.
 */
export function buildMapPrompt({
  bookTitle,
  nodeTitle,
  nodeKind,
  chunk,
  index,
  total,
}: MapPromptInput): string {
  const level = nodeKindLabel(nodeKind);
  return `《${bookTitle}》的超长${level}「${nodeTitle}」被拆分为 ${total} 个片段，下面是第 ${index}/${total} 个片段。
请以与原书相同的叙述视角提炼该片段的关键要点（不需要三段式结构）：
- 逐条列出片段中的关键事件、论点或情节转折，完整交代前后上下文与逻辑链（背景目的、经过与结论）；
- 标出片段中出现的重要人物、地点与设定及其核心作用；
- 直接输出要点列表。

【片段 ${index}/${total}】
${chunk}`;
}

export interface ReducePromptInput {
  bookTitle: string;
  nodeTitle: string;
  nodeKind: NodeKind;
  /** Key-point summaries produced by the map phase, in chunk order. */
  subSummaries: string[];
}

/**
 * Reduce prompt: merge every sub-summary into the authoritative three-part
 * node summary.
 */
export function buildReducePrompt({
  bookTitle,
  nodeTitle,
  nodeKind,
  subSummaries,
}: ReducePromptInput): string {
  const level = nodeKindLabel(nodeKind);
  const merged = subSummaries
    .map((summary, i) => `【片段 ${i + 1} 要点】\n${summary.trim()}`)
    .join('\n\n');

  return `以下是《${bookTitle}》${level}「${nodeTitle}」各片段的要点提炼结果。请将它们合成为一份统一的整${level}总结：去重、按叙事/论证顺序重组，保持前后上下文连贯并接续完整的逻辑链与论证链。

${THREE_PART_RULE}

【各片段要点】
${merged}`;
}
