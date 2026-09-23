import { describe, expect, it, vi } from 'vitest';
import { buildAgentUserPrompt, createAgentOrchestrator } from './agentOrchestrator';
import { createAgentBookContext } from './agentContext';
import type { AgentStreamEvent, AgentStreamFn } from '@/services/ai/agentStreamClient';
import { DEFAULT_AI_SETTINGS } from '@/types/ai';
import type { BookNode } from '@/types/readingAgent';
import { nodeViewAt, type NodeView, type ReadingPosition } from '@/services/bookNodes/nodeView';

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

/**
 * A 章/节 book where the two coordinate spaces **disagree**: every node starts
 * in the same physical spine section (0), so `nodeIndex !== spineIndex` for
 * everything after the first. This is the shape ADR 0010 exists for
 * (《何为良好生活》: 11 spine files, 81 directory entries) and the reason the
 * turn must resolve the node from the Reading Position rather than trust a
 * caller-supplied ordinal.
 */
const HIER_TEXT = '甲'.repeat(40);

const HIER_NODES: BookNode[] = [
  {
    nodeId: 'hier:n_0',
    bookHash: 'hier',
    nodeIndex: 0,
    title: '第一章 起源',
    startOffset: 0,
    endOffset: 40,
    charCount: 40,
    depth: 0,
    spineIndex: 0,
    indexStatus: 'ready',
  },
  {
    nodeId: 'hier:n_1',
    bookHash: 'hier',
    nodeIndex: 1,
    title: '第一节 图书馆',
    startOffset: 0,
    endOffset: 20,
    charCount: 20,
    depth: 1,
    parentNodeId: 'hier:n_0',
    spineIndex: 0,
    anchor: 'sec1',
    indexStatus: 'ready',
  },
  {
    nodeId: 'hier:n_2',
    bookHash: 'hier',
    nodeIndex: 2,
    title: '第二节 出海',
    startOffset: 20,
    endOffset: 40,
    charCount: 20,
    depth: 1,
    parentNodeId: 'hier:n_0',
    spineIndex: 0,
    anchor: 'sec2',
    indexStatus: 'ready',
  },
];

const hierarchyContext = createAgentBookContext({
  bookHash: 'hier',
  nodes: HIER_NODES,
  fullText: HIER_TEXT,
});

/** A Node View stub, so the orchestrator tests read as plain values. */
const stubView = (over: Partial<NodeView> = {}): NodeView => ({
  bookHash: 'h',
  nodeIndex: 0,
  spineIndex: 0,
  title: '第一章 起源',
  kind: 'chapter',
  charCount: 12,
  text: '林远走进图书馆翻开无名之书。',
  source: 'context',
  ...over,
});

const INPUT = {
  position: { bookHash: 'h', spineIndex: 0 } as ReadingPosition,
  bookTitle: '灯塔之夜',
  history: [],
  userMessage: '灯塔在后文还有呼应吗？',
  signal: new AbortController().signal,
  onEvent: () => {},
};

describe('buildAgentUserPrompt', () => {
  it('carries the L1 excerpt, history and quote', () => {
    const prompt = buildAgentUserPrompt({
      nodeText: '正文节选内容',
      nodeKind: 'chapter',
      history: [
        { id: 'm1', conversationId: 'c', role: 'user', content: '第一问', createdAt: 1 },
        { id: 'm2', conversationId: 'c', role: 'assistant', content: '第一答', createdAt: 2 },
      ],
      userMessage: '第二问',
      quoteText: '物理学不存在了',
    });
    expect(prompt).toContain('【当前章正文节选】\n正文节选内容');
    expect(prompt).toContain('读者：第一问');
    expect(prompt).toContain('助手：第一答');
    expect(prompt).toContain('> 物理学不存在了');
    expect(prompt).toContain('【本轮提问】\n> 物理学不存在了\n\n第二问');
  });

  it('names the excerpt heading with the node model level word, never a literal 章节', () => {
    for (const [nodeKind, word] of [
      ['chapter', '章'],
      ['section', '节'],
      ['chunk', '段'],
    ] as const) {
      const prompt = buildAgentUserPrompt({
        nodeText: '正文',
        nodeKind,
        history: [],
        userMessage: '问',
      });
      expect(prompt).toContain(`【当前${word}正文节选】`);
      expect(prompt).not.toContain('【当前章节正文节选】');
    }
  });

  it('appends the selection-tracking anchor with the anchor node level word', () => {
    const prompt = buildAgentUserPrompt({
      nodeText: '正文',
      nodeKind: 'chapter',
      history: [],
      userMessage: '这句什么意思？',
      quoteText: '灯塔熄灭了',
      quoteAnchor: { nodeIndex: 1, nodeTitle: '第二章 转折', charOffset: 42, nodeKind: 'chapter' },
    });
    expect(prompt).toContain('（该片段位于章《第二章 转折》约 42 字符处）');
    expect(prompt).not.toContain('第 2 章');
  });

  // ---- assertions migrated from the deleted buildChatPrompt suite ----

  it('includes the FULL history verbatim — 20 messages, no sliding window (ADR 0006)', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      conversationId: 'c',
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: i % 2 === 0 ? `读者问题${i}` : `助手回答${i}`,
      createdAt: i,
    }));
    const prompt = buildAgentUserPrompt({
      nodeText: '正文',
      nodeKind: 'chapter',
      history,
      userMessage: '最后追问',
    });

    for (const message of history) {
      expect(prompt).toContain(`${message.role === 'user' ? '读者' : '助手'}：${message.content}`);
    }
    // Order preserved: first history entry before the last one.
    expect(prompt.indexOf('读者：读者问题0')).toBeLessThan(prompt.indexOf('助手：助手回答19'));
  });

  it('renders the selection quote as a `> ` block directly above the question', () => {
    const prompt = buildAgentUserPrompt({
      nodeText: '正文',
      nodeKind: 'chapter',
      history: [],
      userMessage: '这是什么意思？',
      quoteText: '古老的钟楼敲响了第三声',
    });

    const questionSection = prompt.slice(prompt.indexOf('【本轮提问】'));
    expect(questionSection).toBe('【本轮提问】\n> 古老的钟楼敲响了第三声\n\n这是什么意思？');
  });

  it('caps the L1 excerpt with an explicit ellipsis instead of sending the whole node', () => {
    const prompt = buildAgentUserPrompt({
      nodeText: 'x'.repeat(2_000),
      nodeKind: 'chapter',
      history: [],
      userMessage: '追问',
    });
    expect(prompt).toContain('【当前章正文节选】\n');
    expect(prompt).toContain('…');
    expect(prompt).not.toContain('x'.repeat(1_501));
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
      resolveNodeView: () => stubView(),
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
      resolveNodeView: () => stubView(),
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
      resolveNodeView: () => stubView({ text: FULL_TEXT.slice(0, 20) }),
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
      resolveNodeView: () => stubView(),
    });
    const result = await orchestrator.runTurn(INPUT);
    expect(result.content).toBe('回答');
    expect(result.toolCalls).toEqual([]);
    // Level word still comes from the node model, even in degraded mode. The
    // node title is quoted with 「」 — 《》 is for the book title alone.
    expect(seenSystem).toContain('当前用户正在阅读《灯塔之夜》的章「第一章 起源」');
    expect(seenSystem).not.toContain('的节点《');
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
      resolveNodeView: () => stubView(),
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

  /**
   * The regression test for the coordinate-space defect. Before the turn
   * resolved its own Node View, it passed `input.currentSectionIndex` (a spine
   * ordinal, here 0) into `getNodePath()`, which keys on node ordinals — so the
   * anchored node 2 was reported as node 0: wrong level (章 instead of 节),
   * wrong ordinal (第 1 章 instead of 第 3 节) and the 章 parent dropped.
   */
  it('names the anchored 节 whose nodeIndex differs from the spine index', async () => {
    let seenSystem = '';
    const orchestrator = createAgentOrchestrator({
      stream: async function* (req) {
        seenSystem = req.system;
        yield { type: 'text-delta', text: '回答' };
      },
      getSettings: () => ({ ...DEFAULT_AI_SETTINGS, apiKey: 'sk-test' }),
      getContext: () => hierarchyContext,
      resolveNodeView: (position) => nodeViewAt(position, { context: hierarchyContext }),
    });

    await orchestrator.runTurn({
      ...INPUT,
      position: { bookHash: 'hier', spineIndex: 0, anchor: 'sec2' },
    });

    // Node View resolved the anchored 节, not the spine's first node.
    const l1 = seenSystem.slice(
      seenSystem.indexOf('【读者当前阅读视口'),
      seenSystem.indexOf('【全书宏观画像'),
    );
    expect(l1).toContain('读者目前停留在：第 3 节');
    expect(l1).toContain('《第一章 起源》 › 节《第二节 出海》');
    // The buggy answers — node 0's level and ordinal — must be absent from the
    // viewport line. (The TOC matrix below legitimately lists node 0 as 第 1 章.)
    expect(l1).not.toContain('第 1 章');
    expect(l1).not.toContain('章《第一章 起源》（全书一级节点）');
  });

  it('resolves the same spine index to different nodes as the anchor changes', async () => {
    const viewAt = (position: ReadingPosition) => nodeViewAt(position, { context: hierarchyContext });
    const first = viewAt({ bookHash: 'hier', spineIndex: 0, anchor: 'sec1' });
    const second = viewAt({ bookHash: 'hier', spineIndex: 0, anchor: 'sec2' });
    // Same physical section, two different Book Nodes — the whole point of the
    // Node Anchor being first-class (ADR 0010 ¶3).
    expect(first.nodeIndex).toBe(1);
    expect(second.nodeIndex).toBe(2);
    expect(first.kind).toBe('section');
    expect(second.parentTitle).toBe('第一章 起源');
    expect(first.spineIndex).toBe(second.spineIndex);
  });
});
