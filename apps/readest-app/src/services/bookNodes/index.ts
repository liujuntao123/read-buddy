/**
 * 书籍节点模型（Book Node Model）——章 / 节 相关概念的唯一出处。
 *
 * - `nodeKind`：层级判定与文案词表（章 / 节 / 段）；
 * - `nodeShape`：整本书的节点形状、计数文案、节点树与阅读位置解析；
 * - `nodeHierarchy`：当前阅读位置的节点层级（章 › 节 面包屑）。
 *
 * 界面与 Agent prompt 都只能通过本模块回答「这是第几章第几节」，
 * 不允许再出现写死的「章 / 节」文案（CONTEXT.md / ADR 0010）。
 */
export * from './nodeKind';
export * from './nodeShape';
export * from './nodeHierarchy';
