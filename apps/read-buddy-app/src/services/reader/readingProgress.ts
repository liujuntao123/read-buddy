/**
 * 进度条上的节点位置（Progress strip's node position）。
 *
 * CONTEXT.md 的 **Reading Position** 是**物理**位置（段序号 + 段内锚点），而设计
 * 文档 §3 的 FooterBar 要说的是「第 3 / 12 节」——一句只有节点模型能说的话。
 * 本模块是那句翻译：把「读者此刻在哪个 Book Node」变成**同类节点中的序号**，
 * 层词与计数一律取自 `@/services/bookNodes`（`resolveNodeKind` / `nodeKindLabel`
 * / `stampDepths`），这里不出现任何写死的「章 / 节 / 段」。
 *
 * 两个来源，与 `nodeViewAt` 的回退阶梯同序：
 * 1. **全书节点模型**（AgentBookContext）——权威；
 * 2. **虚拟分段**（TXT 在索引建立之前）——分级与节点模型同一套标题规则补出。
 */

import type { BookNode, NodeKind } from '@/types/readingAgent';
import { nodeKindLabel, resolveNodeKind, stampDepths } from '@/services/bookNodes';

/** 当前节点在**同类节点**中的序号，也就是「第 3 / 12 节」里的两个数字加层词。 */
export interface NodePosition {
  kind: NodeKind;
  /** 1-based：同类节点中的第几个。 */
  ordinal: number;
  total: number;
}

/** 一串节点里，`kind` 这一级的序号与总数。 */
const countAmongKind = (kinds: readonly NodeKind[], at: number, kind: NodeKind): NodePosition | null => {
  if (at < 0 || at >= kinds.length) return null;
  return {
    kind,
    ordinal: kinds.slice(0, at + 1).filter((candidate) => candidate === kind).length,
    total: kinds.filter((candidate) => candidate === kind).length,
  };
};

/**
 * 节点模型里的位置：当前节点是它**这一级**的第几个。
 *
 * 层级由 `resolveNodeKind` 判定（标题里写死「第 N 部分」的定长分段节点永远是
 * 段，不会冒充章），所以《何为良好生活》的 70 节按节计数，单层书籍按章计数。
 */
export function nodePositionIn(
  nodes: readonly BookNode[],
  current: BookNode,
): NodePosition | null {
  const kinds = nodes.map((node) => resolveNodeKind(node.depth, node.title));
  const at = nodes.findIndex((node) => node.nodeIndex === current.nodeIndex);
  if (at < 0) return null;
  return countAmongKind(kinds, at, kinds[at]!);
}

/**
 * 虚拟分段里的位置：TXT 在节点模型建立之前的答案。
 *
 * 虚拟分段的层级只写在标题里（目录是平的），所以先用 `stampDepths` 补出缺失的
 * 那一层——与 `nodeViewAt` 的第二条回退路径、以及阅读器 dock 的目录列表用的是
 * 同一条规则，因此同一本书在三个界面上不会说出不同的层级。
 */
export function virtualSectionPosition(
  sections: readonly { title: string }[],
  index: number,
): NodePosition | null {
  if (index < 0 || index >= sections.length) return null;
  const stamped = stampDepths(sections.map((section) => ({ title: section.title, depth: 0 })));
  const kinds = stamped.map(({ row, depth }) => resolveNodeKind(depth, row.title));
  return countAmongKind(kinds, index, kinds[index]!);
}

/** 「第 3 / 12 节」——层词来自节点模型（`nodeKindLabel`）。 */
export const formatNodePosition = (position: NodePosition): string =>
  `第 ${position.ordinal} / ${position.total} ${nodeKindLabel(position.kind)}`;
