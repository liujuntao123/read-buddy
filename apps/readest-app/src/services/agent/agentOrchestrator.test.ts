import { describe, expect, it, vi } from 'vitest';
import { buildAgentUserPrompt, createAgentOrchestrator } from './agentOrchestrator';
import { createAgentBookContext } from './agentContext';
import type { AgentStreamEvent, AgentStreamFn } from '@/services/ai/agentStreamClient';
import { DEFAULT_AI_SETTINGS } from '@/types/ai';
import type { BookNode } from '@/types/readingAgent';

const FULL_TEXT = '第一章 起源\n林远走进图书馆翻开无名之书。\n第二章 转折\n灯塔熄灭，林远决定出海。';

const CHAPTERS: BookNode[] = [
  {
    nodeId: 'h:n_0',
    bookHash: 'h',
    nodeIndex: 0,
    title: '第一章 起源',
    startOffset: 0,
    endOffset: 20,
    charCount: 20,
    depth: 0,
    indexStatus: 'ready',
    brief: '林远发现无名之书。',
  },
  {
    nodeId: 'h:n_1',
    bookHash: 'h',
    nodeIndex: 1,
    title: '第二章 转折',
    startOffset: 20,
    endOffset: FULL_TEXT.length,
    charCount: FULL_TEXT.length - 20,
    depth: 0,
    indexStatus: 'ready',
    brief: '灯塔熄灭，林远出海。',
  },
];

const context = createAgentBookContext({
  bookHash: 'h',
  nodes: CHAPTERS,
  fullText: FULL_TEXT,
  panorama: {
    bookHash: 'h',
    summary: '守夜人追寻灯塔熄灭之谜。',
    genre: '悬疑',
    totalNodes: 2,
    isFullyIndexed: true,
    createdAt: 0,
    updatedAt: 0,
    mainCharacters: ['林远'],
  },
});

const INPUT = {
  bookHash: 'h',
  bookTitle: '灯塔之夜',
  currentSectionIndex: 0,
  currentNodeTitle: '第一章 起源',
  currentNodeText: '林远走进图书馆翻开无名之书。',
  history: [],
  userMessage: '灯塔在后文还有呼应吗？',
  signal: new AbortController().signal,
  onEvent: () => {},
};

describe('buildAgentUserPrompt', () => {
  it('carries the L1 excerpt, history and quote', () => {
    const prompt = buildAgentUserPrompt({
      currentNodeText: '正文节选内容',
      history: [
        { id: 'm1', conversationId: 'c', role: 'user', content: '第一问', createdAt: 1 },
        { id: 'm2', conversationId: 'c', role: 'assistant', content: '第一答', createdAt: 2 },
      ],
      userMessage: '第二问',
      quoteText: '物理学不存在了',
    });
    expect(prompt).toContain('【当前章节正文节选】\n正文节选内容');
    expect(prompt).toContain('读者：第一问');
    expect(prompt).toContain('助手：第一答');
    expect(prompt).toContain('> 物理学不存在了');
    expect(prompt).toContain('【本轮提问】\n> 物理学不存在了\n\n第二问');
  });

  it('appends the selection-tracking anchor with the anchor node level word', () => {
    const prompt = buildAgentUserPrompt({
      currentNodeText: '正文',
      history: [],
      userMessage: '这句什么意思？',
      quoteText: '灯塔熄灭了',
      quoteAnchor: { nodeIndex: 1, nodeTitle: '第二章 转折', charOffset: 42, nodeKind: 'chapter' },
    });
    expect(prompt).toContain('（该片段位于章《第二章 转折》约 42 字符处）');
    expect(prompt).not.toContain('第 2 章');
  });
});

describe('createAgentOrchestrator', () => {
  it('streams text, merges tool traces and surfaces citations', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'tool-call', id: 'call-1', toolName: 'search_book_text', args: { query: '灯塔' } },
      {
        type: 'tool-result',
        id: 'call-1',
        toolName: 'search_book_text',
        result: { matches: [{ nodeIndex: 1 }] },
        durationMs: 42,
      },
      { type: 'text-delta', text: '灯塔意象在' },
      { type: 'text-delta', text: '第二章形成终局呼应。' },
    ];
    const stream: AgentStreamFn = async function* () {
      for (const event of events) yield event;
    };
    const seen: string[] = [];
    const orchestrator = createAgentOrchestrator({
      stream,
      getSettings: () => ({ ...DEFAULT_AI_SETTINGS, apiKey: 'sk-test' }),
      getContext: (hash) => (hash === 'h' ? context : undefined),
    });

    const result = await orchestrator.runTurn({
      ...INPUT,
      onEvent: (event) => seen.push(event.type),
    });

    expect(result.content).toBe('灯塔意象在第二章形成终局呼应。');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      id: 'call-1',
      toolName: 'search_book_text',
      durationMs: 42,
    });
    expect(result.toolCalls[0]!.resultSnippet).toContain('nodeIndex');
    expect(seen).toEqual(['tool-call', 'tool-result', 'delta', 'delta']);
  });

  it('collects citations emitted by locate_in_reader', async () => {
    // The stream fake simulates the SDK loop: it executes the mounted
    // locate tool directly, which dispatches the citation hook.
    const orchestrator = createAgentOrchestrator({
      stream: async function* (req) {
        const locate = req.tools.locate_in_reader as unknown as {
          execute?: (input: unknown) => Promise<unknown>;
        };
        if (locate?.execute) {
          await locate.execute({ nodeIndex: 1, quoteSnippet: '灯塔熄灭' });
        }
        yield { type: 'text-delta', text: '已定位。' };
      },
      getSettings: () => ({ ...DEFAULT_AI_SETTINGS, apiKey: 'sk-test' }),
      getContext: () => context,
    });
    const citations: string[] = [];
    const result = await orchestrator.runTurn({
      ...INPUT,
      onEvent: (event) => {
        if (event.type === 'citation') citations.push(event.citation.quoteSnippet);
      },
    });
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({ nodeIndex: 1, quoteSnippet: '灯塔熄灭' });
    expect(citations).toEqual(['灯塔熄灭']);
  });

  it('resolves the quote to a global-offset anchor inside the prompt', async () => {
    let seenPrompt = '';
    const orchestrator = createAgentOrchestrator({
      stream: async function* (req) {
        seenPrompt = req.prompt;
        yield { type: 'text-delta', text: '回答' };
      },
      getSettings: () => ({ ...DEFAULT_AI_SETTINGS }),
      getContext: () => context,
    });
    await orchestrator.runTurn({
      ...INPUT,
      userMessage: '这句什么意思？',
      quoteText: '灯塔熄灭，林远决定出海',
    });
    expect(seenPrompt).toContain('（该片段位于章《第二章 转折》约');
  });

  it('degrades to the node-scoped prompt when the book has no context', async () => {
    let seenSystem = '';
    let seenTools: unknown = null;
    const stream: AgentStreamFn = async function* (req) {
      seenSystem = req.system;
      seenTools = req.tools;
      yield { type: 'text-delta', text: '回答' };
    };
    const orchestrator = createAgentOrchestrator({
      stream,
      getSettings: () => ({ ...DEFAULT_AI_SETTINGS }),
      getContext: () => undefined,
    });
    const result = await orchestrator.runTurn(INPUT);
    expect(result.content).toBe('回答');
    expect(result.toolCalls).toEqual([]);
    expect(seenSystem).toContain('当前用户正在阅读《灯塔之夜》的节点《第一章 起源》');
    expect(seenTools).toEqual({});
  });

  it('stops consuming events once aborted', async () => {
    const controller = new AbortController();
    const deltas = vi.fn();
    const stream: AgentStreamFn = async function* () {
      yield { type: 'text-delta', text: '部分' };
      controller.abort();
      yield { type: 'text-delta', text: '不应出现' };
    };
    const orchestrator = createAgentOrchestrator({
      stream,
      getSettings: () => ({ ...DEFAULT_AI_SETTINGS }),
      getContext: () => context,
    });
    const result = await orchestrator.runTurn({
      ...INPUT,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'delta') deltas();
      },
    });
    expect(result.content).toBe('部分');
    expect(deltas).toHaveBeenCalledTimes(1);
  });
});
