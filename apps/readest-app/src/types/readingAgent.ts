/**
 * Whole-book reading-specialist agent domain types
 * (docs/technical-solution-reading-agent-architecture.md §3.3 & §6.1).
 *
 * The BookNode family establishes the unified global continuous character
 * coordinate space shared by the reader, the DOM selection tracking and every
 * agent tool call; the panorama / entity / trace records persist the import
 * pipeline outputs and the agent turn traces in Dexie.
 *
 * Node model (CONTEXT.md, ADR 0010): a **Book Node (书籍节点)** is one
 * navigable division of a book, identified by `nodeIndex`. Its level is its
 * **Node Kind**: 章 = 第一层节点 (a node directly under the book), 节 =
 * 第二层节点 (a node nested under a 章). Books are not required to have both
 * levels — the **Minimal Node (最小节点)** is the deepest level actually
 * present, and it is always the summarizing / indexing viewpoint.
 */

/** Segmentation strategy that produced the book nodes. */
export type SegmentStrategy = 'native' | 'regex' | 'fixed-length';

/**
 * Level of a book node: 章 (first level) / 节 (second level) / 分段 (a
 * synthetic fixed-length node of a structureless book, which behaves as a
 * first-level node but must not claim 章 structure).
 */
export type NodeKind = 'chapter' | 'section' | 'chunk';

/**
 * The one and only user-facing wording for each level (CONTEXT.md 词表).
 * Every count, ordinal, badge and navigation label in the app is built from
 * this map — never from a hard-coded 章 / 节 string.
 */
export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  chapter: '章',
  section: '节',
  chunk: '段',
};

/**
 * 微简介尚未生成时的占位语（界面与提示词共用一处，避免措辞漂移）。
 *
 * 只用于**可能**生成微简介的节点——即最小节点（叶子节点）。容器章（下含子节点的
 * 第一层节点）永远不进入微简介队列（ADR 0010），对它说「待生成」是误导，应当用
 * {@link CONTAINER_BRIEF_LABEL}。
 */
export const PENDING_BRIEF_LABEL = '（待生成微简介）';

/**
 * 容器章（结构分组节点）的微简介说明：它自己的内容由下级最小节点承载，因此
 * 不存在「还没生成」的微简介。界面不显示占位，模型侧用它代替待生成占位语。
 */
export const CONTAINER_BRIEF_LABEL = '（结构分组节点，微简介见其下各级节点）';

/** 给模型看的一行微简介文案：叶子未生成 → 待生成；容器 → 结构分组说明。 */
export const briefLabelFor = (brief: string | undefined, isContainer: boolean): string =>
  brief ?? (isContainer ? CONTAINER_BRIEF_LABEL : PENDING_BRIEF_LABEL);

/** `depth` of each level: 0 = 章 (第一层节点), 1 = 节 (第二层节点). */
export const NODE_DEPTH: Record<'chapter' | 'section', number> = {
  chapter: 0,
  section: 1,
};

/** Index pipeline state of one book node. */
export type NodeIndexStatus = 'pending' | 'indexing' | 'ready' | 'failed';

/** A directory anchor inside a spine section, with its text line offset. */
export interface NodeAnchor {
  id: string;
  /** Line-start offset in the spine's normalized plain text. */
  offset: number;
}

/**
 * One entry of the book's own table of contents, already resolved onto the
 * physical spine. This is the raw material of the node model: nodes are taken
 * from the directory whenever it is the finer description of the book.
 */
export interface BookTocEntry {
  label: string;
  /** Nesting depth declared by the directory itself (0 = top level). */
  depth: number;
  /** Resolved spine section ordinal, or -1 when the href could not resolve. */
  spineIndex: number;
  /** `href` hash part (intra-section anchor), when the entry carries one. */
  anchor?: string;
  /** Destination href (anchor included) the engine can navigate to. */
  href?: string;
}

/**
 * Unified book node over the global continuous character space.
 * `startOffset` is inclusive, `endOffset` exclusive, so slicing the cleaned
 * full text at [startOffset, endOffset) reproduces the node exactly.
 */
export interface BookNode {
  /** Primary key: `${bookHash}:n_${nodeIndex}`. */
  nodeId: string;
  bookHash: string;
  /** 0-based document-order ordinal (contiguous) — the node's identity. */
  nodeIndex: number;
  /** Normalized node title, e.g. "第一章 风起之地". */
  title: string;
  /** 0 = 章 (first-level node), 1 = 节 (second-level node). */
  depth: number;
  /** The enclosing 章 node, for second-level nodes. */
  parentNodeId?: string;

  startOffset: number;
  endOffset: number;
  charCount: number;

  /** Physical anchors for engine books. */
  spineIndex?: number;
  /** Intra-section directory anchor this node starts at. */
  anchor?: string;
  /** Destination href (anchor included) the engine can navigate to. */
  href?: string;
  startCfi?: string;
  endCfi?: string;

  /** 50~100 char micro-brief; only leaf nodes are briefed. */
  brief?: string;
  /** Key characters / terms appearing in this node. */
  keyEntities?: string[];
  indexStatus: NodeIndexStatus;
}

/**
 * Primary key of a `book_nodes` row: `${bookHash}:n_${nodeIndex}`.
 *
 * The `n_` prefix is load-bearing, not decoration: a **Node Summary** row uses
 * `${bookHash}:${nodeIndex}` (`nodeSummaryId`), and the two tables are independent —
 * one can exist while the other does not. The prefix makes the two identities
 * distinguishable in a log, a trace or a stray string, so a Node Summary key can
 * never be mistaken for a Book Node key. An architecture review proposed unifying
 * the formats; that was examined and rejected (ADR 0015) because it would remove
 * exactly this safety for no defect fixed — no code crosses the two.
 */
export const bookNodeId = (bookHash: string, nodeIndex: number): string =>
  `${bookHash}:n_${nodeIndex}`;

/** Persisted book node row (adds updatedAt for re-sync heuristics). */
export interface BookNodeRecord extends BookNode {
  updatedAt: number;
}

/** Whole-book panorama portrait (import Phase 3 output). */
export interface BookPanoramaRecord {
  bookHash: string;
  genre?: string;
  /** 200~300 char whole-book theme summary. */
  summary: string;
  worldSetting?: string;
  mainCharacters?: string[];
  /** Total number of book nodes the panorama was built from. */
  totalNodes: number;
  isFullyIndexed: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Entity glossary row (character / location / term / clue). */
export interface ReadingEntityRecord {
  /** Primary key: `${bookHash}:${entityName}`. */
  id: string;
  bookHash: string;
  name: string;
  category: 'character' | 'location' | 'term' | 'clue';
  description: string;
  firstAppearedNode: number;
  relatedNodes: number[];
  updatedAt: number;
}

/** One tool invocation inside an agent turn (trace + UI accordion source). */
export interface ToolCallTrace {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  resultSnippet?: string;
  durationMs: number;
}

/** Persisted per-message agent turn trace. */
export interface AgentTurnTraceRecord {
  id: string;
  conversationId: string;
  messageId: string;
  toolCalls: ToolCallTrace[];
  reasoningText?: string;
  createdAt: number;
}

/**
 * Whole-book evidence citation rendered as a jump card in the chat stream;
 * produced whenever the agent calls `locate_in_reader`.
 */
export interface AgentCitation {
  bookHash: string;
  nodeIndex: number;
  nodeTitle: string;
  /** Level of the cited node, so the card can name it 章 / 节. */
  nodeKind: NodeKind;
  /** Title of the enclosing 章, for second-level nodes. */
  parentNodeTitle?: string;
  /** Character offset within the node text (node-relative). */
  charOffset?: number;
  quoteSnippet: string;
}
