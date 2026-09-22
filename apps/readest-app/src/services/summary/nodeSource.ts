/**
 * 当前视角节点的正文解析（ticket 03 / ADR 0005 / ADR 0010）。
 *
 * 总结永远以**最小节点**为视角（CONTEXT.md）：有节的书总结这一节，只有章的
 * 书总结这一章。解析顺序：
 *
 * 1. **全书节点模型**（AgentBookContext）：阅读位置（物理段 + 段内锚点）映射到
 *    书籍节点，按节点的全局字符范围切片——目录比正文文件更细时（锚点级
 *    的「节」）这里就是唯一能让总结落在节上的路径；容器章取整章范围。
 * 2. **分段存储的虚拟分段**：TXT 在索引完成前，按 charOffset 切片。
 * 3. **物理段 HTML**：引擎书籍尚未建索引时，直接抽取该段正文。
 */
import { extractNodeText, type NodeText } from '@/services/reader/extractor';
import { DEMO_BOOK, DEMO_MONOLITHIC_TXT } from '@/services/reader/demoBook';
import { getOpenedBook } from '@/services/library/contentRegistry';
import { getAgentBookContext, type AgentBookContext } from '@/services/agent/agentContext';
import { nodeExtent, resolveNodeKind } from '@/services/bookNodes';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import type { NodeKind } from '@/types/readingAgent';

export interface NodeSourceResult extends NodeText {
  /** 本次视角的节点层级：章 / 节 / 段。 */
  kind: NodeKind;
  /** 所属章标题（视角是节时才有）。 */
  parentTitle?: string;
}

export interface NodeSourceDeps {
  /** 物理段（spine）的展示 HTML，`undefined` 表示尚未缓存。 */
  getStructuredHtml: (spineIndex: number) => string | undefined;
  /** 单文件书籍的全文（TXT），`undefined` 表示未知。 */
  getMonolithicText: (bookHash: string) => string | undefined;
  /** 节点模型来源；默认取全局注册表。 */
  getContext?: (bookHash: string) => AgentBookContext | undefined;
}

export function createNodeSource(deps: NodeSourceDeps) {
  return (): NodeSourceResult => {
    const { bookHash, spineIndex, anchor } = useReaderStore.getState();

    // ---- 路径 1：全书节点模型（权威） ----
    const context = bookHash ? (deps.getContext ?? getAgentBookContext)(bookHash) : undefined;
    if (context && context.fullText) {
      const node = context.resolveNodeAt(spineIndex, anchor);
      if (node) {
        const tree = context.getNodeTree();
        const { startOffset, endOffset } = nodeExtent(tree, node);
        const text = context.fullText.slice(startOffset, endOffset);
        const parent = node.parentNodeId ? tree.byId.get(node.parentNodeId) : undefined;
        return {
          title: node.title,
          text,
          charCount: text.length,
          kind: resolveNodeKind(node.depth, node.title),
          ...(parent ? { parentTitle: parent.title } : {}),
        };
      }
    }

    // ---- 路径 2：分段存储的虚拟分段 ----
    const { segmentation, scanContext } = useSegmentationStore.getState();
    if (segmentation && segmentation.bookHash === bookHash && segmentation.strategy !== 'native') {
      let fullText = deps.getMonolithicText(bookHash);
      if (fullText === undefined && scanContext?.bookHash === bookHash) {
        fullText = scanContext.fullText;
      }
      if (fullText === undefined) fullText = '';

      const sections = [...segmentation.virtualSections].sort((a, b) => a.charOffset - b.charOffset);
      const position = sections.findIndex((section) => section.virtualIndex === spineIndex);
      const title = sections[position]?.title ?? `第 ${spineIndex + 1} 段`;
      if (position === -1) return { title, text: '', charCount: 0, kind: 'chunk' };

      const start = sections[position]!.charOffset;
      const end = sections[position + 1]?.charOffset ?? fullText.length;
      const text = fullText.slice(start, Math.max(start, end));
      return { title, text, charCount: text.length, kind: resolveNodeKind(0, title) };
    }

    // ---- 路径 3：物理段 HTML ----
    const html = deps.getStructuredHtml(spineIndex);
    if (html === undefined) {
      return { title: '', text: '', charCount: 0, kind: 'chapter' };
    }
    const extracted = extractNodeText(html);
    return { ...extracted, kind: resolveNodeKind(0, extracted.title) };
  };
}

/**
 * Default binding: the opened-book content registry (real imported books)
 * wins; the demo fixtures remain as the fallback when nothing real is open.
 * `demo-monolithic` keeps working for the no-TOC TXT demo button.
 */
const registrySource = createNodeSource({
  getStructuredHtml: (spineIndex) =>
    getOpenedBook(useReaderStore.getState().bookHash)?.getSpineHtml(spineIndex),
  getMonolithicText: (bookHash) => getOpenedBook(bookHash)?.getMonolithicText?.(),
});

const demoSource = createNodeSource({
  getStructuredHtml: (spineIndex) => DEMO_BOOK.sections[spineIndex]?.html,
  getMonolithicText: (bookHash) =>
    bookHash === 'demo-monolithic' ? DEMO_MONOLITHIC_TXT : undefined,
});

export const resolveCurrentNodeText = (): NodeSourceResult =>
  getOpenedBook(useReaderStore.getState().bookHash) ? registrySource() : demoSource();
