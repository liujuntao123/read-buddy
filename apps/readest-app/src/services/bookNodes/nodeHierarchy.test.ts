import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCurrentNode, resolveNodeHierarchy } from './nodeHierarchy';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import {
  clearAgentBookContext,
  createAgentBookContext,
  registerAgentBookContext,
} from '@/services/agent/agentContext';
import { bookNodeId, type BookNode } from '@/types/readingAgent';

const BOOK = 'book-hierarchy';

const chapter = (index: number, title: string): BookNode => ({
  nodeId: bookNodeId(BOOK, index),
  bookHash: BOOK,
  nodeIndex: index,
  title,
  depth: 0,
  startOffset: 0,
  endOffset: 0,
  charCount: 0,
  spineIndex: 0,
  indexStatus: 'pending',
});

const section = (
  index: number,
  title: string,
  parent: BookNode,
  anchor: string,
  start: number,
  end: number,
): BookNode => ({
  nodeId: bookNodeId(BOOK, index),
  bookHash: BOOK,
  nodeIndex: index,
  title,
  depth: 1,
  parentNodeId: parent.nodeId,
  startOffset: start,
  endOffset: end,
  charCount: end - start,
  spineIndex: 0,
  anchor,
  indexStatus: 'pending',
});

const registerHierarchy = (): void => {
  const first = chapter(0, '第一章 伦理与伦理学');
  const nodes = [
    first,
    section(1, '§1 伦理学这个名称', first, 'sigil_toc_id_1', 0, 10),
    section(2, '§2 伦理与道德', first, 'sigil_toc_id_2', 13, 20),
    chapter(3, '第二章 功效主义与自私的基因'),
  ];
  registerAgentBookContext(
    createAgentBookContext({ bookHash: BOOK, nodes, fullText: 'x'.repeat(40) }),
  );
};

const resetStores = () => {
  useReaderStore.setState({
    bookHash: BOOK,
    bookTitle: '何为良好生活',
    spineIndex: 0,
    anchor: undefined,
    nodeTitle: '',
    spineCount: 11,
  });
  useSegmentationStore.setState({
    segmentation: null,
    banner: { visible: false, detectedCount: 0 },
    applyDecision: null,
    scanContext: null,
  });
};

beforeEach(() => {
  resetStores();
  registerHierarchy();
});

afterEach(() => clearAgentBookContext(BOOK));

describe('resolveCurrentNode', () => {
  it('maps the physical position onto the book node the reader is in', () => {
    useReaderStore.setState({ spineIndex: 0, anchor: 'sigil_toc_id_2' });
    expect(resolveCurrentNode()?.title).toBe('§2 伦理与道德');
  });

  it('returns null without a registered node model', () => {
    clearAgentBookContext(BOOK);
    expect(resolveCurrentNode()).toBeNull();
  });
});

describe('resolveNodeHierarchy', () => {
  it('names a second-level node 节 and carries its 章 ancestor', () => {
    useReaderStore.setState({ spineIndex: 0, anchor: 'sigil_toc_id_1' });
    const hierarchy = resolveNodeHierarchy();

    expect(hierarchy.kind).toBe('section');
    expect(hierarchy.title).toBe('§1 伦理学这个名称');
    expect(hierarchy.parentTitle).toBe('第一章 伦理与伦理学');
    expect(hierarchy.isContainer).toBe(false);
    expect(hierarchy.source).toBe('context');
    // 同层（节）序号：全书共 2 个节，当前是第 1 个。
    expect(hierarchy.position).toEqual({ ordinal: 1, total: 2 });
  });

  it('marks a container 章 and numbers it among its own level', () => {
    useReaderStore.setState({ spineIndex: 0, anchor: undefined });
    const hierarchy = resolveNodeHierarchy();

    expect(hierarchy.kind).toBe('chapter');
    expect(hierarchy.title).toBe('第一章 伦理与伦理学');
    expect(hierarchy.parentTitle).toBeUndefined();
    expect(hierarchy.isContainer).toBe(true);
    expect(hierarchy.position).toEqual({ ordinal: 1, total: 2 });
  });

  it('falls back to the segmentation sections before the index exists', () => {
    clearAgentBookContext(BOOK);
    useSegmentationStore.setState({
      segmentation: {
        bookHash: BOOK,
        strategy: 'regex',
        virtualSections: [
          { virtualIndex: 0, title: '第一卷 风云之始', charOffset: 0 },
          { virtualIndex: 1, title: '第一章 风起', charOffset: 100 },
          { virtualIndex: 2, title: '第二章 雾锁', charOffset: 200 },
        ],
      },
    });
    useReaderStore.setState({ spineIndex: 2, anchor: undefined });

    const hierarchy = resolveNodeHierarchy();
    expect(hierarchy.source).toBe('segmentation');
    expect(hierarchy.kind).toBe('section');
    expect(hierarchy.title).toBe('第二章 雾锁');
    expect(hierarchy.parentTitle).toBe('第一卷 风云之始');
    expect(hierarchy.position).toEqual({ ordinal: 2, total: 2 });
  });

  it('degrades to the reading position title alone', () => {
    clearAgentBookContext(BOOK);
    useReaderStore.setState({ nodeTitle: '第一章 迷雾之城' });

    const hierarchy = resolveNodeHierarchy();
    expect(hierarchy.source).toBe('title');
    expect(hierarchy.kind).toBe('chapter');
    expect(hierarchy.title).toBe('第一章 迷雾之城');
    expect(hierarchy.position).toEqual({ ordinal: 1, total: 1 });
  });
});
