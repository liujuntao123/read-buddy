import { afterEach, describe, expect, it } from 'vitest';
import type { BookNode } from '@/types/readingAgent';
import {
  clearAgentBookContext,
  createAgentBookContext,
  registerAgentBookContext,
} from '@/services/agent/agentContext';
import {
  clearOpenedBook,
  registerOpenedBook,
} from '@/services/library/contentRegistry';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { currentReadingPosition, nodeViewAt, resolveCurrentNodeView, resolveNodeViewAt } from './nodeView';

/**
 * The Node View pure core: no global store is read, so every fallback path is
 * driven with plain values and `source` tells us which one answered.
 */

const NODES: BookNode[] = [
  {
    nodeId: 'b:n_0',
    bookHash: 'b',
    nodeIndex: 0,
    title: '第一章 起源',
    startOffset: 0,
    endOffset: 12,
    charCount: 12,
    depth: 0,
    spineIndex: 0,
    indexStatus: 'ready',
  },
  {
    nodeId: 'b:n_1',
    bookHash: 'b',
    nodeIndex: 1,
    title: '第一节 图书馆',
    startOffset: 0,
    endOffset: 6,
    charCount: 6,
    depth: 1,
    parentNodeId: 'b:n_0',
    spineIndex: 0,
    anchor: 'sec1',
    indexStatus: 'ready',
  },
  {
    nodeId: 'b:n_2',
    bookHash: 'b',
    nodeIndex: 2,
    title: '第二节 出海',
    startOffset: 6,
    endOffset: 12,
    charCount: 6,
    depth: 1,
    parentNodeId: 'b:n_0',
    spineIndex: 1,
    anchor: 'sec2',
    indexStatus: 'ready',
  },
];

const FULL_TEXT = '甲乙丙丁戊己庚辛壬癸子丑';

const context = createAgentBookContext({
  bookHash: 'b',
  nodes: NODES,
  fullText: FULL_TEXT,
});

describe('nodeViewAt — node model path', () => {
  it('answers with the node, its level, its 章 parent and its own text', () => {
    const view = nodeViewAt({ bookHash: 'b', spineIndex: 1, anchor: 'sec2' }, { context });

    expect(view).toMatchObject({
      bookHash: 'b',
      nodeIndex: 2,
      spineIndex: 1,
      anchor: 'sec2',
      title: '第二节 出海',
      kind: 'section',
      parentTitle: '第一章 起源',
      charCount: 6,
      text: '庚辛壬癸子丑',
      source: 'context',
    });
  });

  it('separates the two coordinate spaces: one spine section, two nodes', () => {
    const first = nodeViewAt({ bookHash: 'b', spineIndex: 0, anchor: 'sec1' }, { context });
    const chapter = nodeViewAt({ bookHash: 'b', spineIndex: 0 }, { context });

    expect(first.nodeIndex).toBe(1);
    expect(chapter.nodeIndex).toBe(0);
    // Same physical position, different Book Nodes.
    expect(first.spineIndex).toBe(chapter.spineIndex);
    expect(first.kind).toBe('section');
    expect(chapter.kind).toBe('chapter');
  });

  it('numbers siblings at the same level, not globally', () => {
    const first = nodeViewAt({ bookHash: 'b', spineIndex: 0, anchor: 'sec1' }, { context });
    const second = nodeViewAt({ bookHash: 'b', spineIndex: 1, anchor: 'sec2' }, { context });
    // Both are 节 in the same 章; the 章 is reported separately as parentTitle.
    expect(first.kind).toBe('section');
    expect(second.kind).toBe('section');
    expect(first.parentTitle).toBe('第一章 起源');
    expect(second.parentTitle).toBe('第一章 起源');
  });

  it('gives a container 章 the full extent of its children', () => {
    const chapter = nodeViewAt({ bookHash: 'b', spineIndex: 0 }, { context });
    expect(chapter.charCount).toBe(12);
    expect(chapter.text).toBe(FULL_TEXT);
  });
});

describe('nodeViewAt — fallback ladder', () => {
  it('falls back to the segmentation when no node model is registered', () => {
    const view = nodeViewAt(
      { bookHash: 'txt', spineIndex: 1 },
      {
        segmentation: {
          bookHash: 'txt',
          strategy: 'regex',
          virtualSections: [
            { virtualIndex: 0, title: '第一章', charOffset: 0 },
            { virtualIndex: 1, title: '第二章', charOffset: 5 },
          ],
        },
        monolithicText: '一二三四五六七八九十',
      },
    );

    expect(view).toMatchObject({
      nodeIndex: 1,
      title: '第二章',
      kind: 'chapter',
      charCount: 5,
      text: '六七八九十',
      source: 'segmentation',
    });
  });

  it('ignores a native segmentation on the fallback path', () => {
    const view = nodeViewAt(
      { bookHash: 'txt', spineIndex: 0 },
      {
        segmentation: {
          bookHash: 'txt',
          strategy: 'native',
          virtualSections: [{ virtualIndex: 0, title: '第一章', charOffset: 0 }],
        },
        getStructuredHtml: () => '<h2>回退标题</h2><p>正文</p>',
      },
    );
    expect(view.source).toBe('title');
    expect(view.title).toBe('回退标题');
  });

  it('falls back to the spine HTML and names the level from the title', () => {
    const view = nodeViewAt(
      { bookHash: 'eng', spineIndex: 3 },
      { getStructuredHtml: (index) => (index === 3 ? '<h2>第三章 长夜</h2><p>长夜第一节。</p>' : undefined) },
    );

    expect(view).toMatchObject({
      nodeIndex: 3,
      spineIndex: 3,
      title: '第三章 长夜',
      kind: 'chapter',
      source: 'title',
    });
    expect(view.text).toContain('长夜第一节。');
  });

  it('returns an empty, honestly-labelled view when every source is missing', () => {
    const view = nodeViewAt({ bookHash: 'eng', spineIndex: 7 }, {});

    expect(view).toMatchObject({
      bookHash: 'eng',
      nodeIndex: 7,
      spineIndex: 7,
      title: '',
      kind: 'chapter',
      charCount: 0,
      text: '',
      source: 'title',
    });
  });

  it('ignores a segmentation belonging to another book', () => {
    const view = nodeViewAt(
      { bookHash: 'other', spineIndex: 0 },
      {
        segmentation: {
          bookHash: 'txt',
          strategy: 'regex',
          virtualSections: [{ virtualIndex: 0, title: '别人的章节', charOffset: 0 }],
        },
      },
    );
    // No source matched, so the view degrades honestly instead of borrowing
    // another book's segmentation.
    expect(view.source).toBe('title');
    expect(view.title).toBe('');
  });
});

/**
 * The app-edge binding is the path production actually takes (the chat store's
 * orchestrator is wired to it), so it gets its own coverage: it assembles the
 * sources from the registries rather than receiving them.
 */
describe('resolveNodeViewAt — app edge', () => {
  afterEach(() => {
    clearAgentBookContext('b');
    clearAgentBookContext('txt');
    useReaderStore.setState({
      bookHash: '',
      bookTitle: '',
      spineIndex: 0,
      anchor: undefined,
      nodeTitle: '',
      spineCount: 0,
    });
    useSegmentationStore.setState({ segmentation: null });
    clearOpenedBook('txt');
  });

  it('uses the registered node model when the book is indexed', () => {
    registerAgentBookContext(context);
    const view = resolveNodeViewAt({ bookHash: 'b', spineIndex: 1, anchor: 'sec2' });
    expect(view).toMatchObject({ nodeIndex: 2, title: '第二节 出海', source: 'context' });
  });

  it('uses the persisted segmentation plus the opened book text for a TXT before indexing', () => {
    // Production supplies the monolithic text through the content registry —
    // the removed `scanContext` was a second, never-populated path to the same
    // string (候选 10).
    registerOpenedBook({
      bookHash: 'txt',
      kind: 'monolithic',
      spineCount: 1,
      getSpineTitle: () => '全文',
      getSpineHtml: () => '',
      getSpineText: async () => '一二三四五六七八九十',
      getMonolithicText: () => '一二三四五六七八九十',
      getTocEntries: () => [],
      getSpineAnchors: () => [],
    });
    useSegmentationStore.setState({
      segmentation: {
        bookHash: 'txt',
        strategy: 'regex',
        virtualSections: [
          { virtualIndex: 0, title: '第一章', charOffset: 0 },
          { virtualIndex: 1, title: '第二章', charOffset: 5 },
        ],
      },
    });

    const view = resolveNodeViewAt({ bookHash: 'txt', spineIndex: 1 });
    expect(view).toMatchObject({ nodeIndex: 1, title: '第二章', source: 'segmentation' });
    expect(view.text).toBe('六七八九十');
  });

  it('falls back to the demo spine when nothing real is open', () => {
    const view = resolveNodeViewAt({ bookHash: 'demo-fog-city-0001', spineIndex: 0 });
    // The demo fixture's section HTML is the only source left, so the level is
    // named from its title.
    expect(view.source).toBe('title');
    expect(view.title.length).toBeGreaterThan(0);
  });

  it('recovers the 章 parent and the 节 level from the segmentation titles', () => {
    // The virtual sections are all first-level rows, so their nesting has to be
    // recovered from the titles — otherwise a TXT book before its index
    // advertised 章《第二章 雾锁》 here while the node model said 节.
    useSegmentationStore.setState({
      segmentation: {
        bookHash: 'txt',
        strategy: 'regex',
        virtualSections: [
          { virtualIndex: 0, title: '第一卷 风云之始', charOffset: 0 },
          { virtualIndex: 1, title: '第一章 风起', charOffset: 5 },
          { virtualIndex: 2, title: '第二章 雾锁', charOffset: 10 },
        ],
      },
    });
    useReaderStore.setState({ bookHash: 'txt', spineIndex: 2 });
    registerOpenedBook({
      bookHash: 'txt',
      kind: 'monolithic',
      spineCount: 1,
      getSpineTitle: () => '全文',
      getSpineHtml: () => '',
      getSpineText: async () => '一二三四五六七八九十',
      getMonolithicText: () => '一二三四五六七八九十',
      getTocEntries: () => [],
      getSpineAnchors: () => [],
    });

    const view = resolveCurrentNodeView();
    expect(view.source).toBe('segmentation');
    expect(view.title).toBe('第二章 雾锁');
    expect(view.kind).toBe('section');
    expect(view.parentTitle).toBe('第一卷 风云之始');
  });

  it('falls back to the reading position title when no source can name the node', () => {
    useReaderStore.setState({ bookHash: 'unknown-book', spineIndex: 3, nodeTitle: '第三章 长夜' });
    const view = resolveCurrentNodeView();

    expect(view.title).toBe('第三章 长夜');
    expect(view.kind).toBe('chapter');
    expect(view.spineIndex).toBe(3);
  });

  it('reads the reader store for the current Reading Position, anchor included only when set', () => {
    useReaderStore.setState({ bookHash: 'b', spineIndex: 4, anchor: undefined });
    expect(currentReadingPosition()).toEqual({ bookHash: 'b', spineIndex: 4 });

    useReaderStore.setState({ bookHash: 'b', spineIndex: 4, anchor: 'sec2' });
    expect(currentReadingPosition()).toEqual({ bookHash: 'b', spineIndex: 4, anchor: 'sec2' });
  });
});
