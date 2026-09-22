/**
 * 当前阅读节点解析（CONTEXT.md「Reading Position」/ ADR 0010）。
 *
 * 阅读器记录的是**物理位置**（段序号 + 可选段内锚点），而总结、伴读、引用卡片
 * 需要的是**书籍节点**（第几章第几节）。这里把前者翻译成后者，并在节点模型尚未
 * 建立时逐级退化：
 *
 * 1. 全书节点模型（AgentBookContext 的节点树）——权威来源；
 * 2. 分段存储的虚拟分段（TXT 在索引完成前）；
 * 3. 仅凭目录/标题分级（演示书籍、降级模式）。
 *
 * 任何地方要回答「用户现在在章还是节、叫什么、属于哪一章」，都走这里。
 */
import type { BookNode, NodeKind } from '@/types/readingAgent';
import { getAgentBookContext } from '@/services/agent/agentContext';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { classifyHeadingLevel } from '@/services/segmentation/layeredSegmenter';
import { resolveNodeKind, stampDepths } from './nodeKind';
import { buildNodeTree, resolveNodeAtPosition } from './nodeShape';

export interface NodeHierarchy {
  /** 当前节点的标题（阅读器视口所在节点）。 */
  title: string;
  /** 当前节点的层级：章 / 节 / 段。 */
  kind: NodeKind;
  /** 所属章标题（当前节点是节时才有）。 */
  parentTitle?: string;
  /** 该节点在同层节点中的序号（1-based）与同层总数。 */
  position: { ordinal: number; total: number };
  /** 该节点还有子节点（容器章）。 */
  isContainer: boolean;
  /** 解析来源，便于诊断与测试。 */
  source: 'context' | 'segmentation' | 'title';
}

/** 当前阅读位置的书籍节点；节点模型尚未建立时为 null。 */
export function resolveCurrentNode(): BookNode | null {
  const { bookHash, spineIndex, anchor } = useReaderStore.getState();
  if (!bookHash) return null;
  const context = getAgentBookContext(bookHash);
  if (!context) return null;
  return resolveNodeAtPosition(context.getNodeTree(), spineIndex, anchor) ?? null;
}

function hierarchyFromNode(tree: ReturnType<typeof buildNodeTree>, node: BookNode): NodeHierarchy {
  const parent = node.parentNodeId ? tree.byId.get(node.parentNodeId) : undefined;
  const siblings = tree.nodes.filter((candidate) => candidate.depth === node.depth);
  return {
    title: node.title,
    kind: resolveNodeKind(node.depth, node.title),
    ...(parent ? { parentTitle: parent.title } : {}),
    position: {
      ordinal: siblings.findIndex((candidate) => candidate.nodeId === node.nodeId) + 1,
      total: siblings.length,
    },
    isContainer: tree.childIdsByParent.has(node.nodeId),
    source: 'context',
  };
}

/** 路径 2：分段存储的虚拟分段（TXT 在索引完成前）。 */
function fromSegmentation(bookHash: string, spineIndex: number): NodeHierarchy | null {
  const { segmentation } = useSegmentationStore.getState();
  if (!segmentation || segmentation.bookHash !== bookHash) return null;
  const sections = [...segmentation.virtualSections].sort((a, b) => a.charOffset - b.charOffset);
  const current = sections[spineIndex];
  if (!current) return null;

  const stamped = stampDepths(sections.map((section) => ({ title: section.title, depth: 0 })));
  const depth = stamped[spineIndex]?.depth ?? 0;
  let parentTitle: string | undefined;
  for (let i = spineIndex - 1; i >= 0; i--) {
    if (classifyHeadingLevel(sections[i]!.title) === 'container') {
      parentTitle = sections[i]!.title;
      break;
    }
  }
  const sameLevel = stamped.filter((entry) => entry.depth === depth);
  let ordinal = 0;
  for (let i = 0; i <= spineIndex; i++) if (stamped[i]!.depth === depth) ordinal += 1;
  return {
    title: current.title,
    kind: resolveNodeKind(depth, current.title),
    ...(parentTitle ? { parentTitle } : {}),
    position: { ordinal: Math.max(1, ordinal), total: sameLevel.length },
    isContainer: false,
    source: 'segmentation',
  };
}

/** 路径 3：仅凭阅读位置标题分级（演示书籍、降级模式）。 */
function fromTitleOnly(): NodeHierarchy {
  const { nodeTitle } = useReaderStore.getState();
  return {
    title: nodeTitle,
    kind: resolveNodeKind(0, nodeTitle),
    position: { ordinal: 1, total: 1 },
    isContainer: false,
    source: 'title',
  };
}

/** 解析当前阅读位置的节点层级（三层数据源回退）。 */
export function resolveNodeHierarchy(): NodeHierarchy {
  const { bookHash, spineIndex } = useReaderStore.getState();
  const context = bookHash ? getAgentBookContext(bookHash) : undefined;
  if (context) {
    const tree = context.getNodeTree();
    const node = resolveNodeAtPosition(tree, spineIndex, useReaderStore.getState().anchor);
    if (node) return hierarchyFromNode(tree, node);
  }
  return fromSegmentation(bookHash, spineIndex) ?? fromTitleOnly();
}

/** 便捷调用：把节点树与节点转成层级（供 UI 直接复用当前节点）。 */
export function hierarchyOfNode(
  tree: ReturnType<typeof buildNodeTree>,
  node: BookNode,
): NodeHierarchy {
  return hierarchyFromNode(tree, node);
}
