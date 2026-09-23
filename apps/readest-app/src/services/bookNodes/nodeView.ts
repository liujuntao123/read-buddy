/**
 * Node View（节点视图）——CONTEXT.md 词表。
 *
 * 「读者此刻在哪一个 Book Node，它的正文是什么」是阅读器、总结、伴读与引用卡片
 * 共用的同一个问题。在 ADR 0011 之前它被三个模块各答了一遍，三套字段、三条
 * 不同顺序的回退阶梯（`NodeSourceResult` / `NodeHierarchy` / `SummaryNodeContext`）。
 *
 * 这里把它收成一个概念、一个答案，并分成两层：
 *
 * 1. **纯核 `nodeViewAt(position, sources)`**：不读任何全局 store，依赖由调用方
 *    传入，因此可以用普通值直接测试三条回退路径（返回值的 `source` 字段就是
 *    它们的落点）。
 * 2. **应用边缘 `resolveNodeViewAt(position)` / `currentReadingPosition()`**：
 *    从已打开书籍注册表、分段 store 与全书节点模型装配 sources，供界面与
 *    Agent 编排器直接调用。
 *
 * 回退阶梯（与 ADR 0010 一致：节点模型的答案永远优先）：
 * 1. 全书节点模型（AgentBookContext）——目录锚点级的「节」只有这条路径能落到；
 * 2. 分段存储的虚拟分段（TXT 在索引建立之前）；
 * 3. 物理段 HTML（引擎书籍尚未建索引时按标题分级）。
 */
import type { BookSegmentation } from '@/types/ai';
import type { NodeKind } from '@/types/readingAgent';
import { getAgentBookContext } from '@/services/agent/agentContext';
import { getOpenedBook } from '@/services/library/contentRegistry';
import { DEMO_BOOK, DEMO_MONOLITHIC_TXT } from '@/services/reader/demoBook';
import { extractNodeText } from '@/services/reader/extractor';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { resolveNodeKind, formatNodeOrdinal, classifyHeadingLevel, stampDepths } from './nodeKind';
import { nodeExtent, resolveNodeAtPosition, type NodeTree } from './nodeShape';

/**
 * Reading Position（CONTEXT.md）：视口的**物理**位置——物理段序号，加上视口落在
 * 锚定节点内时该节点的目录锚点。它刻意**不是**节点序号；节点视图由它派生。
 */
export interface ReadingPosition {
  bookHash: string;
  /** 物理段序号（引擎书籍 = spine 序号；TXT = 虚拟分段序号）。 */
  spineIndex: number;
  /** 段内目录锚点；undefined 表示该段起始处。 */
  anchor?: string;
}

/** 节点视图的来源集合。全部可选，缺失即沿回退阶梯向下走。 */
export interface NodeViewSources {
  /** 全书节点模型（节点树 + 全局正文字符空间）。 */
  context?: { getNodeTree(): NodeTree; fullText: string } | undefined;
  /** 分段结果（TXT 在索引建立之前），仅非 native 策略参与回退。 */
  segmentation?: BookSegmentation | null | undefined;
  /** 单文件书籍的全文（TXT）。 */
  monolithicText?: string | undefined;
  /** 物理段（spine）的展示 HTML；返回 undefined 表示该来源不可用。 */
  getStructuredHtml?: ((spineIndex: number) => string | undefined) | undefined;
}

/** 一个 Book Node 连同它在阅读位置上的全部可述说事实。 */
export interface NodeView {
  bookHash: string;
  /** 0-based 全局节点序号——节点的身份。 */
  nodeIndex: number;
  /** 该视图所依据的物理段序号。 */
  spineIndex: number;
  anchor?: string;
  title: string;
  /** 章 / 节 / 段——词由节点模型给（`resolveNodeKind`）。 */
  kind: NodeKind;
  /** 所属章的标题（视角是节时才有）。 */
  parentTitle?: string;
  charCount: number;
  text: string;
  /** 命中的回退层级，便于诊断与测试。 */
  source: 'context' | 'segmentation' | 'title';
}

const emptyView = (
  position: ReadingPosition,
  source: NodeView['source'],
  title = '',
  kind: NodeKind = 'chapter',
  parentTitle?: string,
): NodeView => ({
  bookHash: position.bookHash,
  nodeIndex: position.spineIndex,
  spineIndex: position.spineIndex,
  ...(position.anchor ? { anchor: position.anchor } : {}),
  title,
  kind,
  ...(parentTitle ? { parentTitle } : {}),
  charCount: 0,
  text: '',
  source,
});

/**
 * 纯核：阅读位置 + 来源 → 节点视图。不读全局 store。
 *
 * 三级回退与 ADR 0010 的优先级一致，任何一级都返回完整的 NodeView（缺失的信息
 * 以空值退化），使调用方不必知道当前处于哪一级——需要知道时读 `source`。
 */
export function nodeViewAt(position: ReadingPosition, sources: NodeViewSources): NodeView {
  // ---- 路径 1：全书节点模型（权威） ----
  const context = sources.context;
  if (context && context.fullText) {
    const tree = context.getNodeTree();
    const node = resolveNodeAtPosition(tree, position.spineIndex, position.anchor);
    if (node) {
      const { startOffset, endOffset } = nodeExtent(tree, node);
      const text = context.fullText.slice(startOffset, endOffset);
      const parent = node.parentNodeId ? tree.byId.get(node.parentNodeId) : undefined;
      return {
        bookHash: position.bookHash,
        nodeIndex: node.nodeIndex,
        spineIndex: position.spineIndex,
        ...(position.anchor ? { anchor: position.anchor } : {}),
        title: node.title,
        kind: resolveNodeKind(node.depth, node.title),
        ...(parent ? { parentTitle: parent.title } : {}),
        charCount: text.length,
        text,
        source: 'context',
      };
    }
  }

  // ---- 路径 2：分段存储的虚拟分段 ----
  // The virtual sections are the *first* level the segmenter produced, so their
  // own nesting has to be recovered the same way the node model recovers it for a
  // flat directory: stamp the depths from the titles, then name the level and the
  // 章 parent. Without this a TXT book before its index advertised 「章《第二章 雾锁》」
  // here while the node model said 「节」 for the same position.
  const segmentation = sources.segmentation;
  if (
    segmentation &&
    segmentation.bookHash === position.bookHash &&
    segmentation.strategy !== 'native'
  ) {
    const sections = [...segmentation.virtualSections].sort((a, b) => a.charOffset - b.charOffset);
    const fullText = sources.monolithicText ?? '';
    const at = sections.findIndex((section) => section.virtualIndex === position.spineIndex);
    const stamped = stampDepths(sections.map((section) => ({ title: section.title, depth: 0 })));
    const depth = stamped[at]?.depth ?? 0;
    const title =
      sections[at]?.title ?? formatNodeOrdinal(depth > 0 ? 'section' : 'chunk', position.spineIndex + 1);
    if (at === -1) {
      return emptyView(position, 'segmentation', title, resolveNodeKind(depth, title));
    }
    // The enclosing 章 is the nearest preceding container row.
    let parentTitle: string | undefined;
    for (let i = at - 1; i >= 0; i--) {
      if (classifyHeadingLevel(sections[i]!.title) === 'container') {
        parentTitle = sections[i]!.title;
        break;
      }
    }
    const start = sections[at]!.charOffset;
    const end = sections[at + 1]?.charOffset ?? fullText.length;
    const text = fullText.slice(start, Math.max(start, end));
    return {
      ...emptyView(position, 'segmentation', title, resolveNodeKind(depth, title), parentTitle),
      charCount: text.length,
      text,
    };
  }

  // ---- 路径 3：物理段 HTML（按标题分级） ----
  const html = sources.getStructuredHtml?.(position.spineIndex);
  if (html === undefined) return emptyView(position, 'title');
  const extracted = extractNodeText(html);
  return {
    ...emptyView(position, 'title', extracted.title, resolveNodeKind(0, extracted.title)),
    charCount: extracted.charCount,
    text: extracted.text,
  };
}

/** 阅读器的当前物理位置（唯一读 readerStore 的地方）。 */
export const currentReadingPosition = (): ReadingPosition => {
  const { bookHash, spineIndex, anchor } = useReaderStore.getState();
  return { bookHash, spineIndex, ...(anchor ? { anchor } : {}) };
};

/** 应用边缘：从已注册的来源装配 sources 后解析节点视图。 */
export function resolveNodeViewAt(position: ReadingPosition): NodeView {
  const opened = getOpenedBook(position.bookHash);
  const { segmentation } = useSegmentationStore.getState();

  let monolithicText = opened?.getMonolithicText();
  if (monolithicText === undefined && !opened && position.bookHash === 'demo-monolithic') {
    monolithicText = DEMO_MONOLITHIC_TXT;
  }

  const getStructuredHtml = opened
    ? (index: number): string | undefined => opened.getSpineHtml(index)
    : (index: number): string | undefined => DEMO_BOOK.sections[index]?.html;

  return nodeViewAt(position, {
    context: getAgentBookContext(position.bookHash),
    segmentation,
    monolithicText,
    getStructuredHtml,
  });
}

/**
 * 便捷调用：阅读器当前位置的节点视图。
 *
 * 最后一跳兜底：节点模型三级都给不出标题时（无索引、无分段、该物理段也没被
 * 引擎加载过），退回阅读器为这个位置记录下的标题。空标题的「总结当前…」页头
 * 比位置自己的标题更糟——而只有「当前位置」这个绑定可以安全地借用它（传给
 * `resolveNodeViewAt` 的任意位置不行）。
 */
export const resolveCurrentNodeView = (): NodeView => {
  const view = resolveNodeViewAt(currentReadingPosition());
  if (view.title) return view;
  const { nodeTitle } = useReaderStore.getState();
  if (!nodeTitle) return view;
  return { ...view, title: nodeTitle, kind: resolveNodeKind(0, nodeTitle) };
};
