/**
 * Prompt builders for chapter summarization (ticket 03, design doc 4.3).
 *
 * Pure functions only: every builder returns the full user prompt as a string
 * so tests can assert on chapter titles, the three-part section headings and
 * the injected chapter text. The stream seam (`services/ai/streamClient`)
 * receives these prompts verbatim.
 */
import { extractPlainTextForPrompt } from '@/services/reader/extractor';
import { SUMMARY_SINGLE_PASS_MAX_CHARS } from '@/types/ai';

/** Section 1 heading of the mandated three-part structure (design doc 4.3.3). */
export const SUMMARY_HEADING_CORE = '### 📌 章节核心要义';

/** Section 2 heading of the mandated three-part structure. */
export const SUMMARY_HEADING_OUTLINE = '### 🗺️ 关键内容脉络';

/** Section 3 heading of the mandated three-part structure. */
export const SUMMARY_HEADING_TERMS = '### 💡 核心概念与关键术语';

/** Canonical shape the final answer must follow (and only this shape). */
export const THREE_PART_TEMPLATE = `${SUMMARY_HEADING_CORE}
（用 2~3 句话高度概括本章核心事件或主要论点）

${SUMMARY_HEADING_OUTLINE}
1. **[阶段/论点一]**：具体事实或阐述推导...
2. **[阶段/论点二]**：转折或深化...
3. **[阶段/论点三]**：结论或留下的悬念...

${SUMMARY_HEADING_TERMS}
- **[概念/术语名]**：在书中的具体含义与作用`;

/** Rule injected wherever the model must emit the three-part structure. */
export const THREE_PART_RULE = `你的输出必须且仅需包含以下三个小节，顺序固定，不得添加任何额外小节、开场白或结尾解释：
${THREE_PART_TEMPLATE}`;

/** System prompt for the final-answer calls (single pass and reduce). */
export const SUMMARY_SYSTEM_PROMPT =
  '你是一位严谨的中文读书助理，负责生成结构化的章节总结。' +
  '直接输出 Markdown 正文，严格遵循用户给出的格式规范，不要输出任何解释性开场白或收尾语。';

/** System prompt for the map phase (sub-block key-point extraction). */
export const MAP_SYSTEM_PROMPT =
  '你是一位严谨的中文读书助理，正在协助分块提炼超长章节。' +
  '只依据给定片段输出要点列表，不要臆测片段之外的内容，不要输出开场白或收尾语。';

export interface SummaryPromptInput {
  bookTitle: string;
  chapterTitle: string;
  /** Full chapter plain text (≤ 12,000 chars on this path). */
  text: string;
}

/**
 * Single-pass prompt: the whole chapter (within the prompt budget) plus the
 * three-part rule. Text goes through `extractPlainTextForPrompt` so an
 * oversized input degrades to an explicit truncation marker instead of
 * blowing the context window.
 */
export function buildSinglePassPrompt({ bookTitle, chapterTitle, text }: SummaryPromptInput): string {
  return `请为《${bookTitle}》的章节「${chapterTitle}」生成三段式结构化总结。

${THREE_PART_RULE}

【章节全文】
${extractPlainTextForPrompt(text, SUMMARY_SINGLE_PASS_MAX_CHARS)}`;
}

export interface MapPromptInput {
  bookTitle: string;
  chapterTitle: string;
  /** One chunk produced by `chunkChapterText` (map phase input). */
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
export function buildMapPrompt({ bookTitle, chapterTitle, chunk, index, total }: MapPromptInput): string {
  return `《${bookTitle}》的超长章节「${chapterTitle}」被拆分为 ${total} 个片段，下面是第 ${index}/${total} 个片段。
请提炼该片段的关键要点（不需要三段式结构）：
- 逐条列出片段中的关键事件、论点或情节转折；
- 标出片段中出现的重要人物、地点与设定；
- 不要推测片段之外的内容，不要输出开场白或收尾语。

【片段 ${index}/${total}】
${chunk}`;
}

export interface ReducePromptInput {
  bookTitle: string;
  chapterTitle: string;
  /** Key-point summaries produced by the map phase, in chunk order. */
  subSummaries: string[];
}

/**
 * Reduce prompt: merge every sub-summary into the authoritative three-part
 * chapter summary.
 */
export function buildReducePrompt({ bookTitle, chapterTitle, subSummaries }: ReducePromptInput): string {
  const merged = subSummaries
    .map((summary, i) => `【片段 ${i + 1} 要点】\n${summary.trim()}`)
    .join('\n\n');

  return `以下是《${bookTitle}》章节「${chapterTitle}」各片段的要点提炼结果。请将它们合成为一份统一、权威的整章总结（去重、按叙事/论证顺序重组）。

${THREE_PART_RULE}

【各片段要点】
${merged}`;
}
