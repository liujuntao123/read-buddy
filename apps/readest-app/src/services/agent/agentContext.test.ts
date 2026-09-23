import { describe, expect, it, vi } from 'vitest';
import {
  PASSAGE_MAX_LENGTH,
  createAgentBookContext,
  clearAgentBookContext,
  getAgentBookContext,
  registerAgentBookContext,
} from './agentContext';
import { subscribeLocate } from '@/services/reader/readerLink';
import { buildFixedLengthNodes } from '@/services/segmentation/layeredSegmenter';
import { bookNodeId, type BookNode } from '@/types/readingAgent';

const FULL_TEXT = [
  '第一章 起源',
  '主角林远走进图书馆，翻开了那本没有名字的书。',
  '第二章 转折',
  '风雨之夜，灯塔的光芒第一次熄灭了，林远决定出海。',
].join('\n');

const makeNodes = (): BookNode[] => {
  const firstEnd = FULL_TEXT.indexOf('第二章');
  return [
    {
      nodeId: bookNodeId('h', 0),
      bookHash: 'h',
      nodeIndex: 0,
      title: '第一章 起源',
      startOffset: 0,
      endOffset: firstEnd,
      charCount: firstEnd,
      depth: 0,
      indexStatus: 'ready',
      brief: '林远发现无名之书。',
    },
    {
      nodeId: bookNodeId('h', 1),
      bookHash: 'h',
      nodeIndex: 1,
      title: '第二章 转折',
      startOffset: firstEnd,
      endOffset: FULL_TEXT.length,
      charCount: FULL_TEXT.length - firstEnd,
      depth: 0,
      indexStatus: 'pending',
    },
  ];
};

describe('AgentBookContext', () => {
  it('serves the outline with briefs and pagination', () => {
    const context = createAgentBookContext({ bookHash: 'h', nodes: makeNodes(), fullText: FULL_TEXT });
    const outline = context.getOutline();
    expect(outline).toHaveLength(2);
    expect(outline[0]).toMatchObject({
      nodeIndex: 0,
      title: '第一章 起源',
      kind: 'chapter',
      depth: 0,
      isContainer: false,
      brief: '林远发现无名之书。',
      indexStatus: 'ready',
    });
    expect(context.getOutline(1)).toHaveLength(1);
    expect(context.getOutline(0, 1)).toHaveLength(1);
  });

  it('reads passages with offset/length clamping', () => {
    const context = createAgentBookContext({ bookHash: 'h', nodes: makeNodes(), fullText: FULL_TEXT });
    const slice = context.readPassage(1, 0, 20)!;
    expect(slice.nodeIndex).toBe(1);
    expect(slice.nodeTitle).toBe('第二章 转折');
    expect(slice.charOffset).toBe(0);
    expect(slice.text).toBe(
      FULL_TEXT.slice(context.nodes[1]!.startOffset, context.nodes[1]!.startOffset + 20),
    );
    expect(slice.hasMore).toBe(true);
    // Overlong length requests are capped.
    const long = context.readPassage(1, 0, 999_999)!;
    expect(long.text.length).toBeLessThanOrEqual(PASSAGE_MAX_LENGTH);
    expect(context.readPassage(99)).toBeNull();
  });

  it('searches the whole book and maps hits to node-relative offsets', () => {
    const context = createAgentBookContext({ bookHash: 'h', nodes: makeNodes(), fullText: FULL_TEXT });
    const matches = context.searchText('林远');
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ nodeIndex: 0, nodeTitle: '第一章 起源' });
    expect(matches[1]!.nodeIndex).toBe(1);
    expect(matches[1]!.nodeTitle).toBe('第二章 转折');
    expect(
      FULL_TEXT.slice(context.nodes[1]!.startOffset + matches[1]!.charOffset).startsWith('林远'),
    ).toBe(true);
    expect(matches[0]!.matchSnippet).toContain('【林远】');
    expect(context.searchText('  ')).toEqual([]);
  });

  it('locate dispatches a reader jump and returns the citation', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocate(listener);
    const context = createAgentBookContext({ bookHash: 'h', nodes: makeNodes(), fullText: FULL_TEXT });
    const citation = context.locate(1, 42, '灯塔的光芒第一次熄灭');
    expect(listener).toHaveBeenCalledWith({
      bookHash: 'h',
      nodeIndex: 1,
      charOffset: 42,
      quoteSnippet: '灯塔的光芒第一次熄灭',
    });
    expect(citation).toMatchObject({ nodeIndex: 1, nodeTitle: '第二章 转折', nodeKind: 'chapter' });
    expect(context.locate(9, 0, 'x')).toBeNull();
    unsubscribe();
  });

  it('updateNodes patches nodes by nodeIndex', () => {
    const context = createAgentBookContext({ bookHash: 'h', nodes: makeNodes(), fullText: FULL_TEXT });
    context.updateNodes([{ ...context.nodes[1]!, brief: '灯塔熄灭，林远出海。', indexStatus: 'ready' }]);
    expect(context.nodes[1]!.brief).toBe('灯塔熄灭，林远出海。');
    expect(context.getOutline()[1]!.brief).toBe('灯塔熄灭，林远出海。');
  });

  it('registry stores and clears contexts per book', () => {
    clearAgentBookContext('reg');
    const context = createAgentBookContext({ bookHash: 'reg', nodes: [], fullText: '' });
    registerAgentBookContext(context);
    expect(getAgentBookContext('reg')).toBe(context);
    clearAgentBookContext('reg');
    expect(getAgentBookContext('reg')).toBeUndefined();
  });

  it('outline entries carry the hierarchical depth, kind and parent title', () => {
    const container: BookNode = {
      nodeId: bookNodeId('h', 0),
      bookHash: 'h',
      nodeIndex: 0,
      title: '第一卷 风云',
      startOffset: 0,
      endOffset: 10,
      charCount: 10,
      depth: 0,
      indexStatus: 'ready',
    };
    const leaf: BookNode = {
      nodeId: bookNodeId('h', 1),
      bookHash: 'h',
      nodeIndex: 1,
      title: '第一章 风起',
      startOffset: 10,
      endOffset: FULL_TEXT.length,
      charCount: FULL_TEXT.length - 10,
      depth: 1,
      parentNodeId: bookNodeId('h', 0),
      indexStatus: 'pending',
    };
    const context = createAgentBookContext({ bookHash: 'h', nodes: [container, leaf], fullText: FULL_TEXT });
    const outline = context.getOutline();
    expect(outline[0]).toMatchObject({ depth: 0, kind: 'chapter', isContainer: true });
    expect(outline[1]).toMatchObject({ depth: 1, kind: 'section', parentTitle: '第一卷 风云' });
  });

  it('resolveNodeAt uses the directory anchor and falls back to the spine-start node', () => {
    const coverPage = '版权页\n版权所有，翻印必究。';
    const body = [
      '序言',
      '这是序言的正文内容，交代了写作背景。',
      '第一章 风起',
      '第一章的正文内容在这里展开。',
      '第二章 雾锁',
      '第二章的正文内容在这里继续。',
    ].join('\n');
    const fullText = `${coverPage}\n\n${body}`;
    const bodyBase = coverPage.length + 2;
    const firstStart = bodyBase + body.indexOf('第一章 风起');
    const secondStart = bodyBase + body.indexOf('第二章 雾锁');
    const spine = (index: number) => ({ spineIndex: index, indexStatus: 'ready' as const });
    const nodes: BookNode[] = [
      {
        nodeId: bookNodeId('anchored', 0),
        bookHash: 'anchored',
        nodeIndex: 0,
        title: '版权页',
        startOffset: 0,
        endOffset: coverPage.length,
        charCount: coverPage.length,
        depth: 0,
        ...spine(0),
      },
      // Two 锚点 (节) inside the same physical spine file, plus the node that
      // owns the file's own start (no anchor).
      {
        nodeId: bookNodeId('anchored', 1),
        bookHash: 'anchored',
        nodeIndex: 1,
        title: '序言',
        startOffset: bodyBase,
        endOffset: firstStart,
        charCount: firstStart - bodyBase,
        depth: 0,
        ...spine(1),
      },
      {
        nodeId: bookNodeId('anchored', 2),
        bookHash: 'anchored',
        nodeIndex: 2,
        title: '第一章 风起',
        startOffset: firstStart,
        endOffset: secondStart,
        charCount: secondStart - firstStart,
        depth: 0,
        anchor: 'sigil_toc_id_1',
        href: 'text.xhtml#sigil_toc_id_1',
        ...spine(1),
      },
      {
        nodeId: bookNodeId('anchored', 3),
        bookHash: 'anchored',
        nodeIndex: 3,
        title: '第二章 雾锁',
        startOffset: secondStart,
        endOffset: fullText.length,
        charCount: fullText.length - secondStart,
        depth: 0,
        anchor: 'sigil_toc_id_2',
        href: 'text.xhtml#sigil_toc_id_2',
        ...spine(1),
      },
    ];
    const context = createAgentBookContext({ bookHash: 'anchored', nodes, fullText });

    // The anchor disambiguates the two 节 living in the same spine file.
    expect(context.resolveNodeAt(1, 'sigil_toc_id_1')?.nodeIndex).toBe(2);
    expect(context.resolveNodeAt(1, 'sigil_toc_id_2')?.nodeIndex).toBe(3);
    expect(context.resolveNodeAt(1, 'sigil_toc_id_2')?.title).toBe('第二章 雾锁');

    // Without an anchor (or with an unknown one) the position resolves to the
    // node that starts that spine — the file's first 节.
    expect(context.resolveNodeAt(1)?.nodeIndex).toBe(1);
    expect(context.resolveNodeAt(1, 'missing-anchor')?.nodeIndex).toBe(1);
    expect(context.resolveNodeAt(0)?.nodeIndex).toBe(0);
    // Past the last physical section the last node starting at or before it wins.
    expect(context.resolveNodeAt(9)?.nodeIndex).toBe(3);
  });

  it('fixed-length segmentation tiles offsets exactly (integration)', () => {
    const nodes = buildFixedLengthNodes('h', FULL_TEXT);
    const context = createAgentBookContext({ bookHash: 'h', nodes, fullText: FULL_TEXT });
    context.nodes.forEach((node, index) => {
      if (index > 0) expect(node.startOffset).toBe(context.nodes[index - 1]!.endOffset);
    });
    // Synthetic `第 N 部分` rows are 段 (chunk), never structural 章.
    expect(context.getOutline().every((entry) => entry.kind === 'chunk')).toBe(true);
    expect(context.readPassage(0, 0, FULL_TEXT.length)!.text.length).toBeLessThanOrEqual(PASSAGE_MAX_LENGTH);
  });
});
