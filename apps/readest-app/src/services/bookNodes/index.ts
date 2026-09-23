/**
 * 书籍节点模型（Book Node Model）——章 / 节 相关概念的唯一出处。
 *
 * - `nodeKind`：层级判定与文案词表（章 / 节 / 段）；
 * - `nodeShape`：整本书的节点形状、计数文案、节点树与阅读位置解析；
 * - `nodeView`：Reading Position → Node View（「读者此刻在哪一个节点」的唯一答案）；
 * - `nodeContent`：节点正文的类别（正文 / 封面 / 版权页 / 目录页），
 *   也就是「这一个节点值不值得总结」的唯一答案。
 *
 * 界面与 Agent prompt 都只能通过本模块回答「这是第几章第几节」，
 * 不允许再出现写死的「章 / 节」文案（CONTEXT.md / ADR 0010）。
 */
export * from './nodeKind';
export * from './nodeShape';
export * from './nodeView';
export * from './nodeContent';
