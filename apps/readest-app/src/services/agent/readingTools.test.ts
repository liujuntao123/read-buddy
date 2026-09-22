import { describe, expect, it, vi } from 'vitest';
import { createReadingTools, toolLabel } from './readingTools';
import { createAgentBookContext } from './agentContext';
import { subscribeLocate } from '@/services/reader/readerLink';
import type { BookNode } from '@/types/readingAgent';

const FULL_TEXT = '第一章 起源\n林远走进图书馆。\n第二章 转折\n灯塔熄灭了，林远决定出海。';

const CHAPTERS: BookNode[] = [
  {
    nodeId: 'h:n_0',
    bookHash: 'h',
    nodeIndex: 0,
    title: '第一章 起源',
    startOffset: 0,
    endOffset: 15,
    charCount: 15,
    depth: 0,
    indexStatus: 'ready',
    brief: '林远发现无名之书。',
  },
  {
    nodeId: 'h:n_1',
    bookHash: 'h',
    nodeIndex: 1,
    title: '第二章 转折',
    startOffset: 15,
    endOffset: FULL_TEXT.length,
    charCount: FULL_TEXT.length - 15,
    depth: 0,
    indexStatus: 'pending',
  },
];

const makeTools = () => {
  const context = createAgentBookContext({ bookHash: 'h', nodes: CHAPTERS, fullText: FULL_TEXT });
  const citations: unknown[] = [];
  const tools = createReadingTools(context, {
    onCitation: (citation) => citations.push(citation),
  });
  return { tools, context, citations };
};

const execute = async (tools: ReturnType<typeof makeTools>['tools'], name: string, input: unknown) => {
  const entry = tools[name] as unknown as { execute?: (input: unknown) => Promise<unknown> };
  if (!entry?.execute) throw new Error(`tool ${name} has no execute`);
  return entry.execute(input);
};

describe('reading tools', () => {
  it('get_book_outline returns paged briefs with totals, shape and node kinds', async () => {
    const { tools } = makeTools();
    const result = (await execute(tools, 'get_book_outline', {})) as {
      totalNodes: number;
      shape: Record<string, unknown>;
      entries: Array<{ title: string; brief: string; nodeKind: string }>;
    };
    expect(result.totalNodes).toBe(2);
    expect(result.shape).toEqual({
      chapter: 2,
      section: 0,
      chunk: 0,
      total: 2,
      isNested: false,
      minimalKind: 'chapter',
    });
    expect(result.entries[0]).toMatchObject({
      title: '第一章 起源',
      nodeKind: '章',
      brief: '林远发现无名之书。',
    });
    expect(result.entries[1]!.nodeKind).toBe('章');
    expect(result.entries[1]!.brief).toBe('（待生成微简介）');

    const paged = (await execute(tools, 'get_book_outline', { startSection: 1 })) as {
      entries: unknown[];
    };
    expect(paged.entries).toHaveLength(1);
  });

  it('labels nested second-level nodes as 节 and reports the nested shape', async () => {
    const nested: BookNode[] = [
      {
        nodeId: 'h:n_0',
        bookHash: 'h',
        nodeIndex: 0,
        title: '第一卷 风云',
        startOffset: 0,
        endOffset: 15,
        charCount: 15,
        depth: 0,
        indexStatus: 'ready',
      },
      {
        nodeId: 'h:n_1',
        bookHash: 'h',
        nodeIndex: 1,
        title: '第一章 风起',
        startOffset: 15,
        endOffset: FULL_TEXT.length,
        charCount: FULL_TEXT.length - 15,
        depth: 1,
        parentNodeId: 'h:n_0',
        indexStatus: 'ready',
      },
    ];
    const context = createAgentBookContext({ bookHash: 'h', nodes: nested, fullText: FULL_TEXT });
    const tools = createReadingTools(context);
    const result = (await execute(tools, 'get_book_outline', {})) as {
      shape: Record<string, unknown>;
      entries: Array<{ nodeKind: string; parentChapter?: string }>;
    };
    expect(result.shape).toMatchObject({
      chapter: 1,
      section: 1,
      total: 2,
      isNested: true,
      minimalKind: 'section',
    });
    expect(result.entries[0]!.nodeKind).toBe('章');
    expect(result.entries[1]).toMatchObject({ nodeKind: '节', parentChapter: '第一卷 风云' });
  });

  it('read_node_passage slices raw text and reports hasMore', async () => {
    const { tools } = makeTools();
    const result = (await execute(tools, 'read_node_passage', {
      nodeIndex: 1,
      charOffset: 0,
      length: 10,
    })) as { text: string; hasMore: boolean; nodeTitle: string };
    expect(result.text).toBe(FULL_TEXT.slice(15, 25));
    expect(result.hasMore).toBe(true);
    expect(result.nodeTitle).toBe('第二章 转折');

    const missing = (await execute(tools, 'read_node_passage', { nodeIndex: 9 })) as {
      error: string;
    };
    expect(missing.error).toContain('不存在');
    expect(missing.error).toBe('节点 9 不存在（全书 2 章）');
  });

  it('search_book_text maps hits across nodes', async () => {
    const { tools } = makeTools();
    const result = (await execute(tools, 'search_book_text', { query: '林远' })) as {
      matches: Array<{ nodeIndex: number; charOffset: number }>;
    };
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]!.nodeIndex).toBe(0);
    expect(result.matches[1]!.nodeIndex).toBe(1);
  });

  it('locate_in_reader jumps the reader, emits the citation and confirms', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocate(listener);
    const { tools, citations } = makeTools();
    const result = (await execute(tools, 'locate_in_reader', {
      nodeIndex: 1,
      charOffset: 4,
      quoteSnippet: '灯塔熄灭了',
    })) as { located: boolean; nodeTitle: string };
    expect(result.located).toBe(true);
    expect(result.nodeTitle).toBe('第二章 转折');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ nodeIndex: 1 }));
    expect(citations).toHaveLength(1);

    const missing = (await execute(tools, 'locate_in_reader', {
      nodeIndex: 9,
      quoteSnippet: '灯塔',
    })) as { error: string };
    expect(missing.error).toBe('节点 9 不存在（全书 2 章），无法定位');
    unsubscribe();
  });

  it('coerces malformed inputs defensively instead of crashing', async () => {
    const { tools } = makeTools();
    const bad = (await execute(tools, 'read_node_passage', 'garbage')) as { error: string };
    expect(bad.error).toContain('缺少');
    const empty = (await execute(tools, 'search_book_text', { query: '  ' })) as {
      matches: unknown[];
    };
    expect(empty.matches).toEqual([]);
  });

  it('speaks the node vocabulary in tool descriptions', () => {
    const { tools } = makeTools();
    const described = Object.values(tools)
      .map((entry) => (entry as { description?: string }).description ?? '')
      .join('\n');
    expect(described).not.toContain('章节');
    expect(described).toContain('节点');
  });

  it('exposes friendly tool labels for the trace UI', () => {
    expect(toolLabel('search_book_text')).toBe('检索全书关键词');
    expect(toolLabel('read_node_passage')).toBe('查阅节点原文切片');
    expect(toolLabel('unknown_tool')).toBe('unknown_tool');
  });
});
