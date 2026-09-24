/**
 * 节点层级词表与层级判定（CONTEXT.md「Language」/ ADR 0010）——全应用唯一的
 * 层级判定入口。
 *
 * 章（chapter）= 书籍的第一层节点；节（section）= 第二层节点；段（chunk）=
 * 无结构书籍的定长分段节点。任何「这个词该叫章还是节」的问题都必须经过
 * `resolveNodeKind`，界面文案一律取自 `NODE_KIND_LABEL`。
 *
 * 层级由两个信号共同决定，二者取较深者，目录自带的嵌套永不被丢弃：
 * - **目录声明**：EPUB NCX/nav 自身把条目嵌到了第二层，就是「节」；
 * - **标题分级**：目录是平的、层级只写在标题里时（《思考快与慢》的
 *   「第一部分 / 第N章」、《看见孩子》的「第N部分 / 准则N」），由本模块的
 *   `classifyHeadingLevel` / `stampDepths` 补出缺失的那一层。
 *
 * ADR 0010 ¶1 assigns the classifier这里 — 直到候选 5 之前，它是住在分层分段器
 * 里的，再由本模块用一个 re-export 转出来绕开循环依赖。现在依赖方向是正的：
 * `layeredSegmenter` → `bookNodes/nodeKind`，没有回边，也不需要 shim。
 */
import { NODE_DEPTH, NODE_KIND_LABEL, type NodeKind } from '@/types/readingAgent';

export { NODE_DEPTH, NODE_KIND_LABEL };
export type { NodeKind };

/**
 * Hierarchical node model (CONTEXT.md / ADR 0010): the first-level nodes under a
 * book are 章 — typically 卷/部/篇/部分 containers or standalone 章/回 headings;
 * nodes nested under them are 节. Not every book has both levels; the deepest one
 * present is the **Minimal Node**, and it is always the summarizing viewpoint.
 */
export type HeadingLevel = 'container' | 'leaf';

/**
 * 章-level container suffixes (first-level nodes under the book). Entries may
 * be multi-character (`部分`), so they are matched as alternatives rather than
 * as one character class — 「第一部分」 ends in 分, which a bare `[卷部篇]`
 * class can never match.
 */
export const CONTAINER_SUFFIXES: readonly string[] = ['部分', '卷', '部', '篇'];
/** 节-level leaf suffixes (second-level nodes under a container). */
export const LEAF_SUFFIXES: readonly string[] = ['章', '回', '节', '集', '幕'];

/** Regex source alternating the container suffixes, longest first. */
const CONTAINER_ALTERNATION = CONTAINER_SUFFIXES.join('|');

/**
 * The Level-3 fixed-length segment title (`第 1 部分`, `第 2 / 5 部分`).
 * `buildFixedLengthNodes` names its synthetic chunks this way, so a bare
 * "第 N 部分" must stay a 分段节点 (no structural signal) even though
 * 「第一部分 系统1，系统2」 is a real container: the real one always carries a
 * name after the 部分, the synthetic one never does.
 */
export const FIXED_PART_PATTERN = /^第\s*\d+(\s*\/\s*\d+)?\s*部分$/;

/**
 * Classify a heading title into the hierarchy model. 卷/部/篇/部分 (and English
 * Part/Book) are containers (章); 章/回/节/集/幕 (and Chapter/Section) are
 * leaves (节 when nested, standalone 章 otherwise). Returns null when the
 * title carries no structural signal (ordinals, 序言/番外, …).
 */
export function classifyHeadingLevel(title: string): HeadingLevel | null {
  const trimmed = title.trim();
  if (FIXED_PART_PATTERN.test(trimmed)) return null;
  const numerals = '[0-9一二三四五六七八九十百千零两]+';
  // NOTE: no \b — JS word boundaries are ASCII-only and never match CJK.
  const boundary = '(?:\\s|\\u3000|:：、.。|\\s*$)';
  if (
    new RegExp(`第${numerals}(?:${CONTAINER_ALTERNATION})${boundary}`).test(trimmed) ||
    new RegExp(`(?:${CONTAINER_ALTERNATION})\\s*$`).test(trimmed) ||
    /^(Part|Book)\b/i.test(trimmed)
  ) {
    return 'container';
  }
  if (
    new RegExp(`第${numerals}[${LEAF_SUFFIXES.join('')}]${boundary}`).test(trimmed) ||
    new RegExp(`[${LEAF_SUFFIXES.join('')}]\\s*$`).test(trimmed) ||
    /^(Chapter|Section)\b/i.test(trimmed)
  ) {
    return 'leaf';
  }
  return null;
}

/**
 * 层级判定：`depth` 为目录/位置给出的层深（0 = 第一层）。
 * 定长分段节点（`第 3 部分` 这类合成标题）永远是最小单位的「段」，
 * 不能冒充有结构的「章」。
 */
export function resolveNodeKind(depth: number, title: string): NodeKind {
  if (FIXED_PART_PATTERN.test(title.trim())) return 'chunk';
  return depth > 0 ? 'section' : 'chapter';
}

/** 层级的中文词（唯一出处）。 */
export const nodeKindLabel = (kind: NodeKind): string => NODE_KIND_LABEL[kind];

/** 「第 3 节」式的节点序号文案。 */
export const formatNodeOrdinal = (kind: NodeKind, ordinal: number): string =>
  `第 ${ordinal} ${NODE_KIND_LABEL[kind]}`;

/** 「上一节 / 下一节」式的导航按钮文案。 */
export const formatNavLabel = (kind: NodeKind, direction: 'prev' | 'next'): string =>
  `${direction === 'prev' ? '上一' : '下一'}${NODE_KIND_LABEL[kind]}`;

/**
 * 给一本**没有给节点命名**的书合成占位标题（`第 3 节`、`第 7 章`）。
 *
 * 之所以由节点模型拥有：分段器、引擎与解析器都曾各自合成过一个层词
 * （`layeredSegmenter` 用 `NODE_KIND_LABEL` 拼、`foliateEngine` 与 `epubParser`
 * 硬写「第 N 节」），而引擎合成的那个字符串还会被**喂回**分级器当标题用
 * （ADR 0010 ¶1 明令任何模块不得写死章 / 节）。占位命名统一在这里，是为了让
 * 「这个未命名节点该叫第几章第几节」只有一个答案。
 */
export const placeholderTitle = (kind: NodeKind, ordinal: number): string =>
  formatNodeOrdinal(kind, ordinal);

/**
 * 标题分级器给出的结构层深：容器之后的**叶子**标题补出第二层（节）。
 * 只是 `stampDepths` 位置规则的语义化表达，供需要区分「有后缀的叶子」与
 * 「无信号的标题」的调用方使用。
 */
export function semanticDepthOf(title: string, hasContainerAbove: boolean): number {
  return classifyHeadingLevel(title) === 'leaf' && hasContainerAbove ? NODE_DEPTH.section : 0;
}

export interface DepthsStamped<T> {
  row: T;
  depth: number;
}

/**
 * 给一串**按文档顺序**的条目盖上层深：`max(声明的层深, 位置层深)`。
 * 目录自带的嵌套永不被丢弃；标题分级只用于补出目录漏掉的那一层——容器
 * （卷/部/篇/部分）之后的条目进第二层，因此《何为良好生活》的真两级 NCX 与
 * 《思考快与慢》的平铺 NCX 走同一条路径。
 *
 * 成员判定是**位置式**的（容器之后的都进第二层），不看后缀：《看见孩子》的
 * 「准则2…」「实战2…」自己没有章/节后缀，照样进第二层。
 */
export function stampDepths<T extends { title: string; depth: number }>(
  rows: readonly T[],
): Array<DepthsStamped<T>> {
  let hasContainerAbove = false;
  return rows.map((row) => {
    const isContainer = classifyHeadingLevel(row.title) === 'container';
    const positional = !isContainer && hasContainerAbove ? NODE_DEPTH.section : 0;
    if (isContainer) hasContainerAbove = true;
    return { row, depth: Math.max(row.depth, positional) };
  });
}
