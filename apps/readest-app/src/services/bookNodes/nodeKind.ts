/**
 * 节点层级词表（CONTEXT.md「Language」/ ADR 0010）——全应用唯一的层级判定入口。
 *
 * 章（chapter）= 书籍的第一层节点；节（section）= 第二层节点；段（chunk）=
 * 无结构书籍的定长分段节点。任何「这个词该叫章还是节」的问题都必须经过
 * `resolveNodeKind`，界面文案一律取自 `NODE_KIND_LABEL`。
 *
 * 层级由两个信号共同决定，二者取较深者，目录自带的嵌套永不被丢弃：
 * - **目录声明**：EPUB NCX/nav 自身把条目嵌到了第二层，就是「节」；
 * - **标题分级**：目录是平的、层级只写在标题里时（《思考快与慢》的
 *   「第一部分 / 第N章」、《看见孩子》的「第N部分 / 准则N」），由分级器
 *   补出缺失的那一层（`stampDepths`，住在分层分段器里以避免循环依赖）。
 */
import { FIXED_PART_PATTERN } from '@/services/segmentation/layeredSegmenter';
import { NODE_KIND_LABEL, type NodeKind } from '@/types/readingAgent';

export { NODE_DEPTH, NODE_KIND_LABEL, semanticDepthOf, stampDepths } from '@/services/segmentation/layeredSegmenter';
export type { NodeKind };

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
