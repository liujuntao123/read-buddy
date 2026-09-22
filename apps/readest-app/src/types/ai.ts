/**
 * Shared domain types for readest-plus.
 *
 * Single source of truth, mirroring:
 * - .scratch/issues/spec/001-readest-plus-core-spec.md ("Core Schemas")
 * - docs/readest-plus 桌面端应用设计文档.md section 5 (数据模型与存储设计)
 * - CONTEXT.md domain glossary
 */

export type AIProvider = 'openai-compatible' | 'deepseek' | 'claude' | 'ollama';

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

/** Canonical chapter-heading heuristic (design doc 4.2). */
export const NODE_HEADING_PATTERN =
  /(第[0-9一二三四五六七八九十百千]+[章回节卷]|Chapter\s+\d+|SECTION\s+\d+)/i;

export interface VirtualSection {
  virtualIndex: number;
  title: string;
  startCfi?: string;
  charOffset: number;
}

export interface BookSegmentation {
  bookHash: string;
  strategy: 'native' | 'regex' | 'fixed-length';
  regexPattern?: string;
  chunkLength?: number;
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

export const nodeSummaryId = (bookHash: string, nodeIndex: number): string =>
  `${bookHash}:${nodeIndex}`;

export type ChatRole = 'user' | 'assistant' | 'system';

export interface Conversation {
  id: string;
  bookHash: string;
  nodeIndex?: number;
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
