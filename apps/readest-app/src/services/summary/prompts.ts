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
 *
 * Fidelity is the primary contract, and it is why these prompts are wordy:
 * a summary may compress *wording*, it may not compress *facts*. Every beat of
 * the source has to land somewhere, and concrete information (people, places,
 * organisations, times, numbers, proper nouns, key phrasing) has to survive.
 * Two failure modes are therefore addressed explicitly:
 * - *omission*, made worse by a three-item template (reads as a cap) and by a
 *   terse extract-then-merge pipeline, where the reduce phase can only be as
 *   detailed as the map phase was;
 * - *abstraction*, where details get replaced by "某人 / 一些 / 某地" and the
 *   summary keeps the shape but loses the substance.
 * Every rule below is an operational check rather than an adjective.
 *
 * Tuning the detail level means touching exactly three places: the point-count
 * line in `THREE_PART_TEMPLATE`, items 5–8 of `CAUSALITY_RULE`, and the four
 * extraction slots of `MAP_SYSTEM_PROMPT`.
 *
 * Structure is mandated, prose is not: the outer three sections are a product
 * contract (the card renders and caches them), while each section's *thinking*
 * is guidance. `CORE_RULE` deliberately describes what the opening section is
 * for instead of fixing its bullet labels, so the summary can say what the
 * source actually argues rather than filling in the same three slots.
 *
 * Rule ownership — each rule is stated once per call, never twice:
 * - `SUMMARY_SYSTEM_PROMPT` states the one standing priority (fidelity over
 *   brevity); the operational checklist belongs to `THREE_PART_RULE`, and the
 *   two never restate each other.
 * - `MAP_SYSTEM_PROMPT` owns the map phase's extraction slots, because that
 *   phase never receives `THREE_PART_RULE`.
 * - `THREE_PART_RULE` owns the final-answer contract: the structure
 *   (`THREE_PART_TEMPLATE`) plus the three section rules (`CORE_RULE`,
 *   `CAUSALITY_RULE`, `TERMS_RULE`).
 * - The `buildXPrompt` bodies own the task statement and the injected material.
 * - Wording that several phases need is defined once and interpolated
 *   (`PERSPECTIVE_RULE`, `CAUSAL_CHAIN_RULE`).
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

/**
 * Canonical shape the final answer must follow (and only this shape).
 *
 * The outline lines carry the *shape*: the core section's bullet list, the
 * outline items, and — in the parenthetical — how many points to emit. Four
 * earlier versions failed here and all four are now guarded:
 * - three example items read as a hard cap of three, so a chapter lost most of
 *   its beats;
 * - a bare `...` for items 2–3 read as "one item is enough", which collapsed an
 *   eight-beat passage into a single paragraph;
 * - a prose 核心要义 read as one long paragraph, which is hard to scan, so it is
 *   a bullet list now;
 * - a three-label 核心要义 (主旨 / 论点 / 结论) read as a form to fill in, which
 *   flattened whatever the source actually argued. The core section now shows
 *   *one* illustrative line — the thinking behind it is `CORE_RULE`, and the
 *   labels are the model's to name.
 * The shape therefore states that the list continues, that the count follows
 * the source's content rather than its length, and that the item list is
 * *parallel*, not one continuous narrative. What each point must *contain* is
 * `CAUSALITY_RULE`, which always ships with it.
 */
export const THREE_PART_TEMPLATE = `${SUMMARY_HEADING_CORE}
- **[小标题一]**：一句话说明这条要点
- **[小标题二]**：一句话说明这条要点

${SUMMARY_HEADING_OUTLINE}
1. **[要点一]**：阐述该要点核心内容
2. **[要点二]**：写法同第 1 条，接着原文的推进顺序写下一件事
3. **[要点三]**：写法同第 1 条
（以上是格式示意，不是条数：有几件独立的事实、机制或结论就写几条，短则 2~3 条，长则 10 条以上；脉络是一串并列的要点，不要写成一段连续叙述）

${SUMMARY_HEADING_TERMS}
- **[概念/术语名]**：在原文中的具体含义、语境与作用`;

/**
 * The book's own narrative perspective. Shared by the map phase and the
 * final-answer phase, so it is defined once and interpolated.
 */
export const PERSPECTIVE_RULE = '采用与原书相同的叙述视角';

/**
 * The per-item completeness skeleton (who/why → what → result). Shared by the
 * map phase's event slot and the final answer's point rule, which are never
 * sent to the model together, so it is defined once and interpolated.
 */
export const CAUSAL_CHAIN_RULE = '起因或目的 → 核心内容或经过 → 结果或结论';

/**
 * Writing rules for every outline point. Each item is a check the model can
 * apply to its own draft; items 5–8 are the fidelity ones (keep concrete
 * information, one beat per point, original order, coverage self-check).
 * Injected wherever the model must emit the three-part structure, which is why
 * the final-answer system prompt stays a single priority statement.
 */
export const CAUSALITY_RULE = `【要点撰写准则】
1. 叙述视角：${PERSPECTIVE_RULE}。
2. 忠实原文：只使用原文出现的事实、人物与专名，不补充、不推断、不评价。
3. 表达易读：语言通俗易懂；通俗化只改措辞，不改事实。
4. 逻辑完整：每个要点按「${CAUSAL_CHAIN_RULE}」交代完整，不得只写结论。
5. 保留细节：人名、地名、组织、时间、数量、称谓、专名与关键表述必须保留，不得替换成「某人」「一些」「某地」这类抽象说法；原文的并列枚举（反应、关联词、诱因等清单）要逐项保留，不能压成「一系列反应」；原文强调的反常与张力（意外、惊讶、「几乎相同」与「稍逊」这类并存的说法）要保留；机制的方向（谁强化谁）不得写成「相互强化」。
6. 分点粒度：一个要点只讲一件事（一个独立的事实、观察、机制、论点、转折或结论），通常 1~3 句；一条里若用「并/同时/还/以及」串起两件以上不同的事，就拆成两条；原文里有几件可独立成立的事，就应有几条要点。
7. 脉络连贯：按原文的推进顺序给要点排序，相邻要点语气承接自然；但每条仍独立成条，不要因为「连贯」把整节写成一段连续叙述。
8. 覆盖自查：输出前对照原文确认每段都有落点，遗漏的立即补入；篇幅随原文长度自适应，宁可写长，也不要为了简短而丢要点。`;

/**
 * Direction for the first section — a thinking guide, not a form to fill in.
 * The three questions are what the section is *for*; the model names its own
 * bullets and may merge or skip them. Fixing the labels (主旨 / 论点 / 结论)
 * made every summary answer the same three slots no matter what the source
 * actually argued, which is why only the shape (a bullet list) survives in
 * `THREE_PART_TEMPLATE`.
 */
export const CORE_RULE =
  '核心要义通常用 2~4 条要点概括，每条一句话、独立成行：围绕「本节点讲了什么、作者最想让你记住的判断或结论是什么、最终落到哪里」来写，但不必逐条对应，也不必凑满条数。小标题按内容自己拟，不要套用固定用词；这一节只做概括，不展开脉络细节，也不写术语定义。';

/**
 * Selection rule for the third section: which terms are worth a line, and the
 * explicit fallback for a node that defines none, so the section is not padded
 * with invented glosses. What each entry says is `THREE_PART_TEMPLATE`'s job.
 */
export const TERMS_RULE =
  '术语小节只收录原文中给出定义、反复出现或影响理解的概念、术语与专名；原文没有可选术语时写「（无特别术语）」，不要凑数。';

/** Rule injected wherever the model must emit the three-part structure. */
export const THREE_PART_RULE = `请严格按照以下三小节结构直接输出 Markdown 正文（括号与方括号内的文字、「写法同第 1 条」都是写法说明，不要出现在输出里）：
${THREE_PART_TEMPLATE}

【核心要义小节准则】
${CORE_RULE}

${CAUSALITY_RULE}

【术语小节收录准则】
${TERMS_RULE}`;

/**
 * System prompt for the final-answer calls (single pass and reduce).
 *
 * One standing priority only: fidelity outranks brevity. It lives in the system
 * slot because that is where a priority that must survive a long user prompt
 * belongs, and it is deliberately *not* the checklist — `THREE_PART_RULE`
 * carries the eight operational items, and repeating them here would send the
 * model the same rules twice.
 */
export const SUMMARY_SYSTEM_PROMPT =
  '你负责生成文章的总结。' +
  '忠实优先于简洁：可以压缩措辞，不可以压缩事实——原文的要点与关键细节必须完整保留，不补充原文没有的内容。';

/**
 * System prompt for the map phase (sub-block key-point extraction).
 *
 * Owns the phase's extraction slots because the map phase never receives
 * `THREE_PART_RULE`; `buildMapPrompt` therefore only adds the chunk-specific
 * instruction. The four slots exist to stop a 7,000-char chunk from collapsing
 * into a name list: whatever the map phase drops, the reduce phase can never
 * recover.
 */
export const MAP_SYSTEM_PROMPT =
  '你正在为后续合稿提炼长节点的片段素材（本阶段不需要三段式结构）。' +
  '只记录片段中出现的内容，不要概括成抽象结论，不要评价，不要补充原文没有的信息。按以下四类逐条列出：\n' +
  `1. 事件与论点脉络：按片段内的先后顺序列出重要事件、论点、情节转折或论证步骤，每条交代「${CAUSAL_CHAIN_RULE}」；\n` +
  '2. 人物、地点、设定与专名：列出重要人物、组织、地点、物品或设定及其在片段中的作用；\n' +
  '3. 关键细节：保留有助于理解后文的具体信息，如时间、数量、身份、称谓、名称或关键表述；\n' +
  '4. 概念与术语：记录被定义或反复使用的概念，以及它在片段中的含义。\n' +
  '素材越全越好：宁可多列几条，不要合并不同事件。直接输出要点列表。';

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
 * three-part rule. The node's own length is stated so the model can size the
 * answer instead of defaulting to a fixed three lines. Text goes through
 * `extractPlainTextForPrompt` so an oversized input degrades to an explicit
 * truncation marker instead of blowing the context window.
 */
export function buildSinglePassPrompt({
  bookTitle,
  nodeTitle,
  nodeKind,
  text,
}: SummaryPromptInput): string {
  const level = nodeKindLabel(nodeKind);
  return `请为《${bookTitle}》的${level}「${nodeTitle}」生成总结。原文约 ${text.length} 字，请完整覆盖其中的要点与关键细节。

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
 * Map prompt: extract material from ONE sub-block. No three-part structure here
 * — that is the reduce phase's job. What to extract is owned by
 * `MAP_SYSTEM_PROMPT`; this body only names the perspective, the chunk and the
 * overlap between neighbouring chunks.
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
  return `《${bookTitle}》的超长${level}「${nodeTitle}」被拆分为 ${total} 个片段，下面是第 ${index}/${total} 个片段（相邻片段之间有少量重叠，重叠处照常提炼，不要因此略过内容）。
请${PERSPECTIVE_RULE}，逐条提炼该片段的素材。

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
 * Reduce prompt: merge every sub-summary into the authoritative three-part node
 * summary. The lead sentence owns what only reduce must do: cover every chunk
 * (not just the first few), dedupe without flattening the details it merges,
 * and restore the source order. Continuity and the logic chain come from
 * `THREE_PART_RULE`.
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

  return `以下是《${bookTitle}》${level}「${nodeTitle}」各片段的要点提炼结果。请把它们合成为一份统一的整${level}总结：逐一覆盖每个片段的要点，合并重复项时保留各自的细节与结论，再按叙事/论证顺序重组。

${THREE_PART_RULE}

【各片段要点】
${merged}`;
}
