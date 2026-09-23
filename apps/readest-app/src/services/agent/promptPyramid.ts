/**
 * Four-layer context pyramid assembler (reading-agent architecture doc §5.2
 * + §5.4): builds the whole-book-specialist system prompt.
 *
 * L2 (panorama + full TOC micro-brief matrix) is the System Prompt backbone
 * giving the agent its god's-eye view; L1 (current chapter viewport) rides
 * along in the same prompt; L0 (user quote) is appended to the user turn.
 */
import type { BookPanoramaRecord, BookNode, NodeKind } from '@/types/readingAgent';
import { briefLabelFor } from '@/types/readingAgent';
import {
  formatNodeCounts,
  formatNodeOrdinal,
  nodeKindLabel,
  resolveNodeKind,
  shapeOfNodes,
  type BookNodeShape,
} from '@/services/bookNodes';

export interface AssembleSystemPromptOptions {
  bookTitle: string;
  /** 0-based **node** ordinal of the viewport node (a Node View ordinal). */
  currentNodeIndex: number;
  currentNodeTitle: string;
  /** 章-level container above the current node (user hierarchy model). */
  parentNodeTitle?: string;
  /** Node kind of the current viewpoint: 章 / 节 / 段. */
  currentNodeKind?: NodeKind;
  /**
   * Whole-book node shape; drives the outline heading counts. Required: the
   * shape must come from the book's own node list (候选 6), never from the micro
   * briefs that happen to be in hand — those are a different population and a
   * book with pending briefs would report the wrong counts.
   */
  shape: BookNodeShape;
  panorama?: Pick<
    BookPanoramaRecord,
    'genre' | 'summary' | 'worldSetting' | 'mainCharacters'
  >;
  /**
   * All book nodes (briefs may still be pending). `isContainer` marks the
   * structural grouping nodes (a 章 owning 节): they are never briefed, so the
   * matrix says so instead of claiming a brief is still pending (ADR 0010).
   */
  allNodeBriefs: Array<
    Pick<BookNode, 'nodeIndex' | 'title' | 'brief'> & {
      depth?: BookNode['depth'];
      parentTitle?: string;
      isContainer?: boolean;
    }
  >;
  /** L0: the user's selected text fragment, when the turn started from one. */
  quoteText?: string;
}

/** L1 excerpt cap: current chapter's opening injected into the prompt. */
export const CURRENT_CHAPTER_EXCERPT_CHARS = 1_500;

/**
 * Render the full-book TOC matrix of micro-briefs (design doc §5.4) with
 * the hierarchical node model: depth-1 节 nodes are indented under their
 * 章-level container so the model can reason about book structure. Each row
 * names its level with the shared vocabulary (`nodeKindLabel`) — never the
 * ambiguous "节点" placeholder that used to hide 章 / 节.
 *
 * A container 章 is never briefed (ADR 0010), so its row names the grouping
 * instead of showing the pending-brief placeholder: the model must not read a
 * container as "this chapter's brief has not been generated yet".
 */
export function renderTocMatrix(
  nodes: AssembleSystemPromptOptions['allNodeBriefs'],
): string {
  return nodes
    .map((node) => {
      const depth = node.depth ?? 0;
      const kind = resolveNodeKind(depth, node.title);
      const base = `• ${formatNodeOrdinal(kind, node.nodeIndex + 1)}《${node.title}》：${briefLabelFor(node.brief, node.isContainer === true)}`;
      if (depth > 0) {
        const parent = node.parentTitle ? `（隶属《${node.parentTitle}》）` : '';
        return `  └ ${base}${parent}`;
      }
      return base;
    })
    .join('\n');
}

export function assembleAgentSystemPrompt({
  bookTitle,
  currentNodeIndex,
  currentNodeTitle,
  parentNodeTitle,
  currentNodeKind,
  shape,
  panorama,
  allNodeBriefs,
  quoteText,
}: AssembleSystemPromptOptions): string {
  const fullTOC = renderTocMatrix(allNodeBriefs);
  const nodeShape = shape;

  const quoteBlock = quoteText
    ? `\n【读者划选的原文片段】\n${quoteText}\n`
    : '';

  const kind: NodeKind = currentNodeKind ?? (parentNodeTitle ? 'section' : 'chapter');
  const kindWord = nodeKindLabel(kind);
  const breadcrumb = parentNodeTitle
    ? `《${parentNodeTitle}》 › ${kindWord}《${currentNodeTitle}》`
    : `${kindWord}《${currentNodeTitle}》（全书一级节点）`;

  return `你正在陪伴读者阅读《${bookTitle}》。

【读者当前阅读视口】
- 读者目前停留在：${formatNodeOrdinal(kind, currentNodeIndex + 1)}，${breadcrumb}
${quoteBlock}
【全书宏观画像与主旨】
- 所属领域与体裁：${panorama?.genre ?? '未标注'}
- 全书核心主旨与脉络：${panorama?.summary ?? '暂无全景概要'}
- 核心概念与关键主体：${panorama?.mainCharacters?.join('、') ?? '未标注'}
- 探讨语境与背景脉络：${panorama?.worldSetting ?? '无特定设定'}

【全书节点脉络（共 ${allNodeBriefs.length} 个：${formatNodeCounts(nodeShape)}，└ 缩进行为第二层节点）】
${fullTOC}

【核心行为准则与能力】

1. **全书视角洞察**：你应站在整部作品的高度给出深具启发性的解答。
2. **主动调用工具考证**：当需要引用全书某一处的精准对话或考证伏笔时，自主调用阅读工具（如 search_book_text、read_node_passage）查阅原文进行印证。
3. **驱动阅读器协同**：当你引用了有价值的原文时，调用 locate_in_reader 工具。

4. **语言风格**：沉稳、典雅、富有启发性，条理清晰，观点明确。`;
}

/**
 * L1 context: the current chapter's opening excerpt, kept separate so the
 * orchestrator can inline it into the user turn without re-sending it on
 * every system prompt rebuild.
 */
export function buildCurrentChapterExcerpt(
  chapterText: string,
  limit = CURRENT_CHAPTER_EXCERPT_CHARS,
): string {
  const trimmed = chapterText.replace(/\s+/g, ' ').trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`;
}
