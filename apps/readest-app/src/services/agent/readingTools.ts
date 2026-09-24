/**
 * First-party reading toolbox (docs/architecture.md): the
 * four JSON-schema tools mounted onto the model's tool-calling stream.
 *
 *   get_book_outline     — TOC + micro-brief matrix (paged)
 *   read_node_passage    — any node's raw text slice (≤ 3,000 chars)
 *   search_book_text     — whole-book keyword search with exact offsets
 *   locate_in_reader     — drive the reader viewport + highlight breathing
 *
 * All tools close over an AgentBookContext and speak the shared node
 * vocabulary (章 / 节 / 段 resolved by the node model, never a hard-coded
 * level word); `locate_in_reader` additionally reports an AgentCitation
 * through `onCitation` so the chat stream can pin the evidence card to the
 * reply.
 */
import { jsonSchema, tool, type ToolSet } from '@ai-sdk/provider-utils';
import type { AgentBookContext } from './agentContext';
import type { AgentCitation } from '@/types/readingAgent';
import { briefLabelFor } from '@/types/readingAgent';
import { formatBookScale, nodeKindLabel, shapeOfNodes } from '@/services/bookNodes';

/** Human-facing labels for the UI trace accordion. */
export const TOOL_LABELS: Record<string, string> = {
  get_book_outline: '调取全书脉络大纲',
  read_node_passage: '查阅节点原文切片',
  search_book_text: '检索全书关键词',
  locate_in_reader: '驱动阅读器定位原文',
};

export const toolLabel = (toolName: string): string => TOOL_LABELS[toolName] ?? toolName;

export interface ReadingToolHooks {
  /** Fired when the agent drives the reader to a passage. */
  onCitation?: (citation: AgentCitation) => void;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;

const asNumber = (value: unknown): number | undefined => {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(num) ? num : undefined;
};

/**
 * Build the tool set bound to one book context. Tool `execute` functions
 * receive the SDK-parsed input; unknown shapes are coerced defensively so a
 * malformed model call can never crash the turn.
 */
export function createReadingTools(context: AgentBookContext, hooks: ReadingToolHooks = {}): ToolSet {
  const shape = shapeOfNodes(context.nodes);
  const bookScale = formatBookScale(shape);

  return {
    get_book_outline: tool({
      description:
        '查询全书完整目录与节点微简介（Briefs），支持按节点范围分页查阅。',
      inputSchema: jsonSchema<{
        startSection?: number;
        limit?: number;
      }>({
        type: 'object',
        properties: {
          startSection: { type: 'integer', description: '起始节点序号（0-based，默认 0）' },
          limit: { type: 'integer', description: '返回条数（默认 30，最大 100）' },
        },
      }),
      execute: async (raw) => {
        const input = asRecord(raw);
        const entries = context.getOutline(
          asNumber(input.startSection) ?? 0,
          asNumber(input.limit) ?? undefined,
        );
        return {
          totalNodes: context.nodes.length,
          shape,
          entries: entries.map((entry) => ({
            nodeIndex: entry.nodeIndex,
            title: entry.title,
            // The model reads the same level word the reader sees (章 / 节 / 段).
            nodeKind: nodeKindLabel(entry.kind),
            ...(entry.parentTitle ? { parentChapter: entry.parentTitle } : {}),
            // A container 章 is a structural grouping and is never briefed
            // (ADR 0010): say that instead of 「待生成微简介」, which would read
            // as a brief that is still queued.
            isContainer: entry.isContainer,
            brief: briefLabelFor(entry.brief, entry.isContainer),
          })),
        };
      },
    }),

    read_node_passage: tool({
      description:
        '调取全书任意节点的原文切片（默认 1500 字符，上限 3000），用于考证对话细节、伏笔或特定文本。',
      inputSchema: jsonSchema<{
        nodeIndex: number;
        charOffset?: number;
        length?: number;
      }>({
        type: 'object',
        properties: {
          nodeIndex: { type: 'integer', description: '目标节点序号（0-based）' },
          charOffset: { type: 'integer', description: '该节点内起始偏移量（默认 0）' },
          length: { type: 'integer', description: '提取字符长度（默认 1500，上限 3000）' },
        },
        required: ['nodeIndex'],
      }),
      execute: async (raw) => {
        const input = asRecord(raw);
        const nodeIndex = asNumber(input.nodeIndex);
        if (nodeIndex === undefined) return { error: '缺少 nodeIndex 参数' };
        const slice = context.readPassage(
          nodeIndex,
          asNumber(input.charOffset),
          asNumber(input.length),
        );
        if (!slice) return { error: `节点 ${nodeIndex} 不存在（${bookScale}）` };
        return {
          nodeIndex: slice.nodeIndex,
          nodeTitle: slice.nodeTitle,
          charOffset: slice.charOffset,
          hasMore: slice.hasMore,
          text: slice.text,
        };
      },
    }),

    search_book_text: tool({
      description:
        '在全书所有节点中进行关键词检索，快速定位关键词出现的全部节点与精确偏移量。',
      inputSchema: jsonSchema<{
        query: string;
        maxResults?: number;
      }>({
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索词或短语' },
          maxResults: { type: 'integer', description: '最大返回条数（默认 5）' },
        },
        required: ['query'],
      }),
      execute: async (raw) => {
        const input = asRecord(raw);
        const query = typeof input.query === 'string' ? input.query : '';
        if (!query.trim()) return { matches: [] };
        const matches = context.searchText(query, asNumber(input.maxResults) ?? undefined);
        return {
          matches: matches.map((match) => ({
            nodeIndex: match.nodeIndex,
            nodeTitle: match.nodeTitle,
            matchSnippet: match.matchSnippet,
            charOffset: match.charOffset,
          })),
        };
      },
    }),

    locate_in_reader: tool({
      description:
        '当回答中引用了有价值的原文事实时，驱动阅读器视窗跳转至目标节点并高亮对应文本。',
      inputSchema: jsonSchema<{
        nodeIndex: number;
        charOffset?: number;
        quoteSnippet: string;
      }>({
        type: 'object',
        properties: {
          nodeIndex: {
            type: 'integer',
            description: '目标节点序号（0-based），该节点所在层级由节点模型判定',
          },
          charOffset: { type: 'integer', description: '该节点内的目标字符偏移量（可选）' },
          quoteSnippet: { type: 'string', description: '需要高亮的精准文本片段' },
        },
        required: ['nodeIndex', 'quoteSnippet'],
      }),
      execute: async (raw) => {
        const input = asRecord(raw);
        const nodeIndex = asNumber(input.nodeIndex);
        const quoteSnippet = typeof input.quoteSnippet === 'string' ? input.quoteSnippet : '';
        if (nodeIndex === undefined || !quoteSnippet.trim()) {
          return { error: '缺少 nodeIndex 或 quoteSnippet 参数' };
        }
        const citation = context.locate(nodeIndex, asNumber(input.charOffset), quoteSnippet);
        if (!citation) return { error: `节点 ${nodeIndex} 不存在（${bookScale}），无法定位` };
        hooks.onCitation?.(citation);
        return {
          located: true,
          nodeIndex: citation.nodeIndex,
          nodeTitle: citation.nodeTitle,
          quoteSnippet: citation.quoteSnippet,
        };
      },
    }),
  };
}
