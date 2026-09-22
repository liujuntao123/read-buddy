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
（用 2~3 句话高度概括本节点的核心事件或主要论点）

${SUMMARY_HEADING_OUTLINE}
1. **[阶段/论点一]**：交代来龙去脉——因何而起、如何发展、导向什么结果或转折（2~4 句连贯叙述，禁止只罗列孤立事实）
2. **[阶段/论点二]**：同上，讲清该要点的前因、经过与后续影响...
3. **[阶段/论点三]**：同上，说明它为后文留下了什么（结论、悬念或伏笔）...

${SUMMARY_HEADING_TERMS}
- **[概念/术语名]**：在书中的具体含义、首次出现的语境与作用`;

/**
 * Narrative-completeness rule (user review): every outline point must trace
 * its full arc in the source text instead of being a fragmentary fact.
 */
export const CAUSALITY_RULE = `【要点撰写铁律】
- 每个要点都必须讲清"来龙去脉"：它因何发生（前文铺垫）→ 具体如何展开（人物、场景、行动）→ 造成什么结果或转折（对后续的影响/悬念）；
- 禁止片面性、片段性的孤立罗列（例如只写"某某离开了城市"而不交代动机与后果）；
- 各要点按叙事或论证的自然顺序衔接，前后要点之间要有可追溯的因果链。`;

/** Rule injected wherever the model must emit the three-part structure. */
export const THREE_PART_RULE = `你的输出必须且仅需包含以下三个小节，顺序固定，不得添加任何额外小节、开场白或结尾解释：
${THREE_PART_TEMPLATE}

${CAUSALITY_RULE}`;

/** System prompt for the final-answer calls (single pass and reduce). */
export const SUMMARY_SYSTEM_PROMPT =
  '你是一位严谨、注重脉络的中文读书助理，负责生成结构化的节点总结。' +
  '总结要点时始终交代清楚每个要点在原文中的来龙去脉（前因、经过、后果），而非片段式摘抄。' +
  '直接输出 Markdown 正文，严格遵循用户给出的格式规范，不要输出任何解释性开场白或收尾语。';

/** System prompt for the map phase (sub-block key-point extraction). */
export const MAP_SYSTEM_PROMPT =
  '你是一位严谨、注重脉络的中文读书助理，正在协助分块提炼超长节点。' +
  '每个要点都用一两句连贯陈述交代其前因与后果，而非孤立摘抄。' +
  '只依据给定片段输出要点列表，不要臆测片段之外的内容，不要输出开场白或收尾语。';

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
请提炼该片段的关键要点（不需要三段式结构）：
- 逐条列出片段中的关键事件、论点或情节转折，每条用一两句话交代前因与后果，保持叙事连贯；
- 标出片段中出现的重要人物、地点与设定及其在片段中的角色；
- 不要推测片段之外的内容，不要输出开场白或收尾语。

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

  return `以下是《${bookTitle}》${level}「${nodeTitle}」各片段的要点提炼结果。请将它们合成为一份统一、权威的整${level}总结：去重、按叙事/论证顺序重组，并把被拆散到不同片段的因果链重新接续完整（每个要点仍须交代来龙去脉）。

${THREE_PART_RULE}

【各片段要点】
${merged}`;
}
