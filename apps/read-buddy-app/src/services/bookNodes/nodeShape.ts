/**
 * 书籍节点形状（Book Node Shape）与树查询（CONTEXT.md / ADR 0010）。
 *
 * 「这本书有几章几节、最小节点是什么、当前阅读位置落在哪个节点」是阅读器、
 * 总结、伴读索引、全景画像共用的同一组问题——答案只在这里计算一次，界面只做
 * 展示。任何 `章 / 节` 计数、序号、导航文案都必须经过本模块。
 */
import { NODE_KIND_LABEL, type BookNode, type NodeKind } from '@/types/readingAgent';
import { resolveNodeKind } from './nodeKind';

/** 整本书的节点构成，以及由此确定的最小节点层级。 */
export interface BookNodeShape {
  /** 第一层节点（章）数量。 */
  chapter: number;
  /** 第二层节点（节）数量。 */
  section: number;
  /** 定长分段节点（段）数量。 */
  chunk: number;
  total: number;
  /** 是否存在第二层节点。 */
  isNested: boolean;
  /**
   * 最小节点：书中最深一层**实际存在**的节点类型。有节就是节，没有节就是章
   * （无结构书籍为段）。总结视角、伴读索引视角一律取它。
   */
  minimalKind: NodeKind;
}

/**
 * The composition of one book's **Book Node list**, and the Minimal Node level
 * it implies.
 *
 * The argument is typed as a real Book Node list on purpose (候选 6): it used to
 * accept a `Pick<BookNode,'depth'|'title'>` projection, so each caller fed
 * whatever list it happened to hold — persisted node rows, Directory rows
 * re-stamped by the reader dock, or a micro-brief list — and two surfaces could
 * answer 「N 章 · M 节」 differently for the same book. A projection no longer
 * type-checks, so the population question has one answer.
 */
export function shapeOfNodes(nodes: readonly BookNode[]): BookNodeShape {
  let chapter = 0;
  let section = 0;
  let chunk = 0;
  for (const node of nodes) {
    // Level wording is resolved in exactly one place (nodeKind).
    switch (resolveNodeKind(node.depth, node.title)) {
      case 'section':
        section += 1;
        break;
      case 'chunk':
        chunk += 1;
        break;
      default:
        chapter += 1;
    }
  }
  return {
    chapter,
    section,
    chunk,
    total: chapter + section + chunk,
    isNested: section > 0,
    minimalKind: section > 0 ? 'section' : chapter > 0 ? 'chapter' : 'chunk',
  };
}

/** 「11 章 · 70 节」——只列出实际存在的层级；空书为「尚无节点」。 */
export function formatNodeCounts(shape: BookNodeShape): string {
  const parts: string[] = [];
  if (shape.chapter > 0) parts.push(`${shape.chapter} ${NODE_KIND_LABEL.chapter}`);
  if (shape.section > 0) parts.push(`${shape.section} ${NODE_KIND_LABEL.section}`);
  if (shape.chunk > 0) parts.push(`${shape.chunk} ${NODE_KIND_LABEL.chunk}`);
  return parts.length > 0 ? parts.join(' · ') : '尚无节点';
}

/** 「全书 11 章 · 70 节」。 */
export const formatBookScale = (shape: BookNodeShape): string =>
  `全书 ${formatNodeCounts(shape)}`;

/** 「读至第 3 节」——层词取自最小节点。 */
export const formatProgress = (shape: BookNodeShape, ordinal: number): string =>
  `读至第 ${ordinal} ${NODE_KIND_LABEL[shape.minimalKind]}`;

/** 节点树：一次建立，阅读器/总结/伴读共同复用。 */
export interface NodeTree {
  nodes: readonly BookNode[];
  byId: Map<string, BookNode>;
  byIndex: Map<number, BookNode>;
  childIdsByParent: Map<string, string[]>;
  /** 最小节点（无子节点）：微大纲与总结的对象。 */
  minimalNodes: readonly BookNode[];
}

export function buildNodeTree(nodes: readonly BookNode[]): NodeTree {
  const byId = new Map<string, BookNode>();
  const byIndex = new Map<number, BookNode>();
  const childIdsByParent = new Map<string, string[]>();
  for (const node of nodes) {
    byId.set(node.nodeId, node);
    byIndex.set(node.nodeIndex, node);
    if (node.parentNodeId) {
      const list = childIdsByParent.get(node.parentNodeId) ?? [];
      list.push(node.nodeId);
      childIdsByParent.set(node.parentNodeId, list);
    }
  }
  return {
    nodes,
    byId,
    byIndex,
    childIdsByParent,
    minimalNodes: nodes.filter((node) => !childIdsByParent.has(node.nodeId)),
  };
}

/** 节点的完整正文范围：自身范围 + 全部子节点范围（容器章取整章）。 */
export function nodeExtent(
  tree: NodeTree,
  node: BookNode,
): { startOffset: number; endOffset: number } {
  let endOffset = node.endOffset;
  for (const childId of tree.childIdsByParent.get(node.nodeId) ?? []) {
    const child = tree.byId.get(childId);
    if (child && child.endOffset > endOffset) endOffset = child.endOffset;
  }
  return { startOffset: node.startOffset, endOffset };
}

/**
 * 物理阅读位置（段序号 + 段内锚点）→ 节点。
 *
 * 目录锚点是精确定位；没有锚点时取该段起始的节点（该段的章首），再退化为
 * 「起始段不超过当前位置的最后一个节点」——目录比正文文件糙时，一个节点会
 * 横跨多个正文段，这一条保证读者翻到段中段也仍然落在这个节点里。
 */
export function resolveNodeAtPosition(
  tree: NodeTree,
  spineIndex: number,
  anchor?: string,
): BookNode | undefined {
  if (anchor) {
    const exact = tree.nodes.find(
      (node) => node.spineIndex === spineIndex && node.anchor === anchor,
    );
    if (exact) return exact;
  }
  const startingHere = tree.nodes.filter((node) => node.spineIndex === spineIndex);
  if (startingHere.length > 0) {
    return startingHere.find((node) => !node.anchor) ?? startingHere[0];
  }
  let best: BookNode | undefined;
  for (const node of tree.nodes) {
    if (node.spineIndex === undefined) continue;
    if (node.spineIndex <= spineIndex) best = node;
  }
  return best;
}
