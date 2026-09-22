import { describe, expect, it } from 'vitest';
import {
  buildNodeTree,
  formatBookScale,
  formatNodeCounts,
  formatProgress,
  nodeExtent,
  resolveNodeAtPosition,
  shapeOfNodes,
} from './nodeShape';
import { bookNodeId, type BookNode } from '@/types/readingAgent';

/** 章容器（自身无正文，靠子节点）。 */
const chapterNode = (index: number, title: string, start: number, end: number): BookNode => ({
  nodeId: bookNodeId('book', index),
  bookHash: 'book',
  nodeIndex: index,
  title,
  depth: 0,
  startOffset: start,
  endOffset: end,
  charCount: end - start,
  spineIndex: 0,
  indexStatus: 'pending',
});

const sectionNode = (
  index: number,
  title: string,
  start: number,
  end: number,
  parent: BookNode,
  anchor: string,
): BookNode => ({
  nodeId: bookNodeId('book', index),
  bookHash: 'book',
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

describe('shapeOfNodes', () => {
  it('reports a single-level book as chapters whose minimal node is a 章', () => {
    const shape = shapeOfNodes([
      { depth: 0, title: '第一章 起点' },
      { depth: 0, title: '第二章 转折' },
    ]);

    expect(shape).toMatchObject({ chapter: 2, section: 0, chunk: 0, total: 2, isNested: false });
    expect(shape.minimalKind).toBe('chapter');
  });

  it('reports a 章/节 book with 节 as the minimal node', () => {
    const shape = shapeOfNodes([
      { depth: 0, title: '第一部分 系统1，系统2' },
      { depth: 1, title: '第1章 一张愤怒的脸' },
      { depth: 1, title: '第2章 电影的主角与配角' },
    ]);

    expect(shape).toMatchObject({ chapter: 1, section: 2, total: 3, isNested: true });
    expect(shape.minimalKind).toBe('section');
  });

  it('reports fixed-length nodes as 段, not 章', () => {
    const shape = shapeOfNodes([
      { depth: 0, title: '第 1 部分' },
      { depth: 0, title: '第 2 部分' },
    ]);

    expect(shape).toMatchObject({ chapter: 0, section: 0, chunk: 2, total: 2 });
    expect(shape.minimalKind).toBe('chunk');
  });
});

describe('node-model formatters', () => {
  it('renders only the levels a book actually has', () => {
    expect(
      formatNodeCounts(shapeOfNodes([{ depth: 0, title: '第一卷' }, { depth: 1, title: '第一章' }])),
    ).toBe('1 章 · 1 节');
    expect(formatNodeCounts(shapeOfNodes([{ depth: 0, title: '第一章' }]))).toBe('1 章');
    expect(formatNodeCounts(shapeOfNodes([]))).toBe('尚无节点');
  });

  it('prefixes the whole-book scale and names progress after the minimal node', () => {
    const nested = shapeOfNodes([
      { depth: 0, title: '第一章 伦理与伦理学' },
      { depth: 1, title: '§1 伦理学这个名称' },
      { depth: 1, title: '§2 伦理与道德' },
    ]);

    expect(formatBookScale(nested)).toBe('全书 1 章 · 2 节');
    expect(formatProgress(nested, 3)).toBe('读至第 3 节');
    expect(formatProgress(shapeOfNodes([{ depth: 0, title: '第一章' }]), 3)).toBe('读至第 3 章');
  });
});

describe('buildNodeTree', () => {
  const chapter = chapterNode(0, '第一章 伦理与伦理学', 0, 0);
  const first = sectionNode(1, '§1 伦理学这个名称', 0, 10, chapter, 'sigil_toc_id_1');
  const second = sectionNode(2, '§2 伦理与道德', 13, 20, chapter, 'sigil_toc_id_2');
  const nodes = [chapter, first, second];

  it('treats container 章 as structural rows, not minimal nodes', () => {
    const tree = buildNodeTree(nodes);
    expect(tree.minimalNodes.map((node) => node.nodeIndex)).toEqual([1, 2]);
  });

  it('extends a container 章 over its children so it can still be summarized', () => {
    const tree = buildNodeTree(nodes);
    expect(nodeExtent(tree, chapter)).toEqual({ startOffset: 0, endOffset: 20 });
    expect(nodeExtent(tree, first)).toEqual({ startOffset: 0, endOffset: 10 });
  });
});

describe('resolveNodeAtPosition', () => {
  const chapter = chapterNode(0, '第一章 伦理与伦理学', 0, 0);
  const first = sectionNode(1, '§1 伦理学这个名称', 0, 10, chapter, 'sigil_toc_id_1');
  const second = sectionNode(2, '§2 伦理与道德', 13, 20, chapter, 'sigil_toc_id_2');
  const spanning: BookNode = {
    nodeId: bookNodeId('book', 3),
    bookHash: 'book',
    nodeIndex: 3,
    title: '第2章 电影的主角与配角',
    depth: 0,
    startOffset: 20,
    endOffset: 40,
    charCount: 20,
    spineIndex: 5,
    indexStatus: 'pending',
  };
  const tree = buildNodeTree([chapter, first, second, spanning]);

  it('picks the anchored node the viewport sits in', () => {
    expect(resolveNodeAtPosition(tree, 0, 'sigil_toc_id_2')?.nodeIndex).toBe(2);
  });

  it('falls back to the node that starts the spine when there is no anchor', () => {
    expect(resolveNodeAtPosition(tree, 0)?.nodeIndex).toBe(0);
  });

  it('maps a spine with no node of its own onto the node spanning it', () => {
    // 目录比正文文件更糙：节点从第 5 段开始，第 6/7 段仍属于它。
    expect(resolveNodeAtPosition(tree, 6)?.nodeIndex).toBe(3);
  });

  it('returns undefined when the position precedes every node', () => {
    expect(resolveNodeAtPosition(buildNodeTree([spanning]), 1)).toBeUndefined();
  });
});
