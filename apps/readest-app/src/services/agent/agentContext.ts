/**
 * In-memory whole-book agent context (reading-agent architecture doc §5).
 *
 * One registered context per opened book: the book nodes over the unified
 * global character space, the joined full text backing them, and the query
 * surface consumed by the four reading tools (outline / passage / search /
 * locate). The import pipeline (bookIndexStore) builds and registers it;
 * chat / summary features resolve it by book hash.
 *
 * The node tree (章 › 节) is built once here and shared with the UI, so the
 * reader, the summary panel and the companion agent always answer "which
 * chapter / which section is this?" identically.
 */
import type {
  AgentCitation,
  BookNode,
  BookPanoramaRecord,
  NodeIndexStatus,
  NodeKind,
} from '@/types/readingAgent';
import { requestLocate } from '@/services/reader/readerLink';
import {
  buildNodeTree,
  resolveNodeAtPosition,
  type NodeTree,
} from '@/services/bookNodes/nodeShape';
import { resolveNodeKind } from '@/services/bookNodes/nodeKind';

/** One outline row served to `get_book_outline`. */
export interface OutlineEntry {
  nodeIndex: number;
  title: string;
  /** 章 / 节 / 段 */
  kind: NodeKind;
  depth: number;
  /** Title of the parent 章-level node, for second-level nodes. */
  parentTitle?: string;
  /** True when this node still has children (a container 章). */
  isContainer: boolean;
  charCount: number;
  brief?: string;
  indexStatus: NodeIndexStatus;
}

/** Hierarchical position of one node: the node plus its 章 ancestor. */
export interface NodePath {
  node: BookNode;
  /** The 章-level node above it, when present. */
  parent?: BookNode;
}

/** One passage slice served to `read_node_passage`. */
export interface PassageSlice {
  nodeIndex: number;
  nodeTitle: string;
  /** Node-relative offset of the returned slice. */
  charOffset: number;
  text: string;
  /** True when the node has more text after this slice. */
  hasMore: boolean;
}

/** One full-text search match served to `search_book_text`. */
export interface SearchMatch {
  nodeIndex: number;
  nodeTitle: string;
  matchSnippet: string;
  /** Node-relative character offset of the match. */
  charOffset: number;
  globalOffset: number;
}

export const OUTLINE_DEFAULT_LIMIT = 30;
export const OUTLINE_MAX_LIMIT = 100;
export const PASSAGE_DEFAULT_LENGTH = 1_500;
export const PASSAGE_MAX_LENGTH = 3_000;
export const SEARCH_DEFAULT_MAX_RESULTS = 5;
/** Context characters on each side of a search hit. */
export const SEARCH_SNIPPET_RADIUS = 40;

export interface AgentBookContext {
  readonly bookHash: string;
  readonly nodes: readonly BookNode[];
  readonly fullText: string;
  /** 章 › 节 节点树（最小节点 = 无子节点的节点）。 */
  getNodeTree(): NodeTree;
  /** Panorama portrait when Phase 3 of the import pipeline finished. */
  getPanorama(): BookPanoramaRecord | undefined;
  setPanorama(panorama: BookPanoramaRecord): void;
  /** Replace / patch nodes (brief scheduler updates nodes in place). */
  updateNodes(nodes: BookNode[]): void;
  getNode(nodeIndex: number): BookNode | undefined;
  /** 物理阅读位置（段序号 + 段内锚点）→ 节点。 */
  resolveNodeAt(spineIndex: number, anchor?: string): BookNode | undefined;
  /** Hierarchical position: node plus its 章-level ancestor. */
  getNodePath(nodeIndex: number): NodePath | null;
  getOutline(startNode?: number, limit?: number): OutlineEntry[];
  readPassage(nodeIndex: number, charOffset?: number, length?: number): PassageSlice | null;
  searchText(query: string, maxResults?: number): SearchMatch[];
  /** Drive the reader viewport to a passage and report the citation. */
  locate(nodeIndex: number, charOffset: number | undefined, quoteSnippet: string): AgentCitation | null;
}

/** Snippet with ellipses around a search hit. */
const buildSnippet = (fullText: string, hitStart: number, hitEnd: number): string => {
  const from = Math.max(0, hitStart - SEARCH_SNIPPET_RADIUS);
  const to = Math.min(fullText.length, hitEnd + SEARCH_SNIPPET_RADIUS);
  const prefix = from > 0 ? '…' : '';
  const suffix = to < fullText.length ? '…' : '';
  return `${prefix}${fullText.slice(from, hitStart)}【${fullText.slice(hitStart, hitEnd)}】${fullText.slice(hitEnd, to)}${suffix}`;
};

export interface CreateAgentBookContextInput {
  bookHash: string;
  nodes: BookNode[];
  fullText: string;
  panorama?: BookPanoramaRecord;
}

export function createAgentBookContext(input: CreateAgentBookContextInput): AgentBookContext {
  let nodes = [...input.nodes].sort((a, b) => a.nodeIndex - b.nodeIndex);
  let tree = buildNodeTree(nodes);
  let panorama: BookPanoramaRecord | undefined = input.panorama;

  return {
    bookHash: input.bookHash,
    get nodes(): readonly BookNode[] {
      return nodes;
    },
    get fullText(): string {
      return input.fullText;
    },

    getNodeTree: () => tree,

    getPanorama: () => panorama,
    setPanorama: (next) => {
      panorama = next;
    },

    updateNodes: (next) => {
      const byIndex = new Map(nodes.map((node) => [node.nodeIndex, node]));
      for (const node of next) byIndex.set(node.nodeIndex, node);
      nodes = [...byIndex.values()].sort((a, b) => a.nodeIndex - b.nodeIndex);
      tree = buildNodeTree(nodes);
    },

    getNode: (nodeIndex) => tree.byIndex.get(nodeIndex),

    resolveNodeAt: (spineIndex, anchor) => resolveNodeAtPosition(tree, spineIndex, anchor),

    getNodePath: (nodeIndex) => {
      const node = tree.byIndex.get(nodeIndex);
      if (!node) return null;
      const parent = node.parentNodeId ? tree.byId.get(node.parentNodeId) : undefined;
      return { node, ...(parent ? { parent } : {}) };
    },

    getOutline: (startNode = 0, limit = OUTLINE_DEFAULT_LIMIT) => {
      const capped = Math.min(Math.max(1, limit), OUTLINE_MAX_LIMIT);
      return nodes
        .filter((node) => node.nodeIndex >= startNode)
        .slice(0, capped)
        .map((node) => {
          const parent = node.parentNodeId ? tree.byId.get(node.parentNodeId) : undefined;
          return {
            nodeIndex: node.nodeIndex,
            title: node.title,
            kind: resolveNodeKind(node.depth, node.title),
            depth: node.depth,
            isContainer: tree.childIdsByParent.has(node.nodeId),
            charCount: node.charCount,
            ...(parent ? { parentTitle: parent.title } : {}),
            ...(node.brief !== undefined ? { brief: node.brief } : {}),
            indexStatus: node.indexStatus,
          };
        });
    },

    readPassage: (nodeIndex, charOffset = 0, length = PASSAGE_DEFAULT_LENGTH) => {
      const node = tree.byIndex.get(nodeIndex);
      if (!node) return null;
      const start = Math.min(Math.max(0, charOffset), Math.max(0, node.charCount - 1));
      const span = Math.min(Math.max(1, length), PASSAGE_MAX_LENGTH);
      const text = input.fullText.slice(node.startOffset + start, node.startOffset + start + span);
      return {
        nodeIndex,
        nodeTitle: node.title,
        charOffset: start,
        text,
        hasMore: start + span < node.charCount,
      };
    },

    searchText: (query, maxResults = SEARCH_DEFAULT_MAX_RESULTS) => {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const matches: SearchMatch[] = [];
      const limit = Math.min(Math.max(1, maxResults), 20);
      let cursor = 0;
      while (matches.length < limit) {
        const hit = input.fullText.indexOf(trimmed, cursor);
        if (hit === -1) break;
        const node = nodes.find(
          (candidate) => hit >= candidate.startOffset && hit < candidate.endOffset,
        );
        if (node) {
          matches.push({
            nodeIndex: node.nodeIndex,
            nodeTitle: node.title,
            matchSnippet: buildSnippet(input.fullText, hit, hit + trimmed.length),
            charOffset: hit - node.startOffset,
            globalOffset: hit,
          });
        }
        cursor = hit + Math.max(1, trimmed.length);
      }
      return matches;
    },

    locate: (nodeIndex, charOffset, quoteSnippet) => {
      const node = tree.byIndex.get(nodeIndex);
      if (!node) return null;
      requestLocate({
        bookHash: input.bookHash,
        nodeIndex,
        charOffset,
        quoteSnippet,
      });
      const parent = node.parentNodeId ? tree.byId.get(node.parentNodeId) : undefined;
      return {
        bookHash: input.bookHash,
        nodeIndex,
        nodeTitle: node.title,
        nodeKind: resolveNodeKind(node.depth, node.title),
        ...(parent ? { parentNodeTitle: parent.title } : {}),
        charOffset,
        quoteSnippet,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Registry: one context per opened book (mirrors contentRegistry).
// ---------------------------------------------------------------------------

const registry = new Map<string, AgentBookContext>();

export const registerAgentBookContext = (context: AgentBookContext): void => {
  registry.set(context.bookHash, context);
};

export const getAgentBookContext = (bookHash: string): AgentBookContext | undefined =>
  registry.get(bookHash);

export const clearAgentBookContext = (bookHash: string): void => {
  registry.delete(bookHash);
};
