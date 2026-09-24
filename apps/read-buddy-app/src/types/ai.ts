/**
 * Shared domain types for read-buddy.
 *
 * Single source of truth, mirroring:
 * - CONTEXT.md (domain glossary)
 * - docs/architecture.md (存储与数据模型)
 */

/**
 * The providers the settings center offers.
 *
 * Deliberately just two: every entry here is an OpenAI-compatible chat endpoint,
 * so the list exists to prefill a Base URL, not to select a protocol. Anything
 * else (a proxy, a self-hosted gateway) is reachable through
 * `openai-compatible` with its own Base URL.
 */
export type AIProvider = 'openai-compatible' | 'deepseek';

export interface AISettings {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTurnsPerTopic: number; // default: 10
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  maxTurnsPerTopic: 10,
};

export const MIN_TURNS_PER_TOPIC = 5;
export const MAX_TURNS_PER_TOPIC = 20;

/** Chapters at or below this length use the single-pass summarizer. */
export const SUMMARY_SINGLE_PASS_MAX_CHARS = 12_000;

/** Fixed-length fallback segmentation granularity (chars per virtual section). */
export const SEGMENT_CHUNK_MIN_CHARS = 6_000;
export const SEGMENT_CHUNK_MAX_CHARS = 8_000;

export interface VirtualSection {
  virtualIndex: number;
  title: string;
  startCfi?: string;
  charOffset: number;
}

/**
 * A monolithic book's segmentation, as the reader sees it.
 *
 * `regexPattern` / `chunkLength` were removed (候选 10): they were written by the
 * store and read by nothing, and `regexPattern` was actively wrong — it stamped
 * the legacy `NODE_HEADING_PATTERN` even when the layered segmenter's own
 * `HEADING_PATTERNS` had matched. The `strategy` says which rule ran; the
 * layered segmenter owns the patterns and the target length.
 */
export interface BookSegmentation {
  bookHash: string;
  strategy: 'native' | 'regex' | 'fixed-length';
  virtualSections: VirtualSection[];
}

export interface NodeSummary {
  /** Primary key: `${bookHash}:${nodeIndex}` (see CONTEXT.md glossary). */
  id: string;
  bookHash: string;
  nodeIndex: number;
  nodeTitle: string;
  modelUsed: string;
  summaryContent: string;
  pipeline: 'single' | 'map-reduce';
  createdAt: number;
  updatedAt: number;
}

/**
 * Primary key of a `node_summaries` row: `${bookHash}:${nodeIndex}` (CONTEXT.md).
 *
 * Deliberately **not** the same string as `bookNodeId` (`${bookHash}:n_${nodeIndex}`),
 * which keys the independent `book_nodes` table: the summary cache is addressed by
 * the Book Node ordinal but lives in its own table, filled on demand and absent for
 * most nodes. Two identities for two tables; ADR 0015 records why they stay distinct.
 */
export const nodeSummaryId = (bookHash: string, nodeIndex: number): string =>
  `${bookHash}:${nodeIndex}`;

export type ChatRole = 'user' | 'assistant' | 'system';

export interface Conversation {
  id: string;
  bookHash: string;
  /**
   * The **physical** position the topic was started at: the reader's spine
   * section ordinal (ADR 0011). Named `spineIndex` to match
   * `readerStore.spineIndex` and CONTEXT.md's Reading Position — it is
   * deliberately NOT a Book Node ordinal.
   */
  spineIndex?: number;
  title: string;
  turnCount: number;
  isClosed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  quoteText?: string;
  /** Resolved chapter attribution of the quote (selection tracking). */
  quoteSource?: string;
  createdAt: number;
  /** Tool-call trail behind an assistant reply (reading-agent workspace). */
  toolCalls?: import('./readingAgent').ToolCallTrace[];
  /** Whole-book evidence citations pinned to this reply. */
  citations?: import('./readingAgent').AgentCitation[];
}
