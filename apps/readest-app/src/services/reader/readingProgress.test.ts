import { describe, expect, it } from 'vitest';
import {
  formatNodePosition,
  nodePositionIn,
  virtualSectionPosition,
} from './readingProgress';
import { bookNodeId, type BookNode } from '@/types/readingAgent';

/** A Book Node as the index would produce it — only the fields the level rules read. */
const node = (
  bookHash: string,
  nodeIndex: number,
  title: string,
  depth: number,
): BookNode => ({
  nodeId: bookNodeId(bookHash, nodeIndex),
  bookHash,
  nodeIndex,
  title,
  depth,
  startOffset: nodeIndex * 10,
  endOffset: (nodeIndex + 1) * 10,
  charCount: 10,
  indexStatus: 'ready',
});

describe('nodePositionIn', () => {
  it('counts 节 within the whole book for a 章 › 节 book', () => {
    const nodes = [
      node('b', 0, '第一章 迷雾之城', 0),
      node('b', 1, '§1 起雾', 1),
      node('b', 2, '§2 灯火', 1),
      node('b', 3, '第二章 图书馆的密语', 0),
      node('b', 4, '§1 星图', 1),
    ];

    expect(nodePositionIn(nodes, nodes[4]!)).toEqual({ kind: 'section', ordinal: 3, total: 3 });
    expect(nodePositionIn(nodes, nodes[2]!)).toEqual({ kind: 'section', ordinal: 2, total: 3 });
    // A container 章 is counted among 章 — its own 2nd 节 does not make it a 节.
    expect(nodePositionIn(nodes, nodes[3]!)).toEqual({ kind: 'chapter', ordinal: 2, total: 2 });
  });

  it('counts 章 for a single-level book', () => {
    const nodes = [
      node('b', 0, '第一章 起点', 0),
      node('b', 1, '第二章 转折', 0),
      node('b', 2, '第三章 归途', 0),
    ];
    expect(nodePositionIn(nodes, nodes[1]!)).toEqual({ kind: 'chapter', ordinal: 2, total: 3 });
  });

  it('names a fixed-length section 段, never 章', () => {
    const nodes = [
      node('b', 0, '第 1 部分', 0),
      node('b', 1, '第 2 部分', 0),
      node('b', 2, '第 3 部分', 0),
    ];
    expect(nodePositionIn(nodes, nodes[2]!)).toEqual({ kind: 'chunk', ordinal: 3, total: 3 });
  });

  it('answers null for a node that is not in the list', () => {
    const nodes = [node('b', 0, '第一章', 0)];
    expect(nodePositionIn(nodes, node('b', 7, '第七章', 0))).toBeNull();
  });
});

describe('virtualSectionPosition', () => {
  it('stamps the missing level of a flat section list from its titles', () => {
    // 《何为良好生活》 shape before the index lands: a container, then its leaves.
    const sections = [
      { title: '第一部分 系统1，系统2' },
      { title: '第1章 一张愤怒的脸' },
      { title: '第2章 电影的主角与配角' },
    ];
    expect(virtualSectionPosition(sections, 2)).toEqual({ kind: 'section', ordinal: 2, total: 2 });
    // The container itself stays a 章 (the 1st of 1).
    expect(virtualSectionPosition(sections, 0)).toEqual({ kind: 'chapter', ordinal: 1, total: 1 });
  });

  it('keeps a genuinely single-level TXT at 章 level', () => {
    const sections = [
      { title: '第一章 起点' },
      { title: '第二章 转折' },
      { title: '第三章 归途' },
    ];
    expect(virtualSectionPosition(sections, 1)).toEqual({ kind: 'chapter', ordinal: 2, total: 3 });
  });

  it('answers null outside the section list', () => {
    expect(virtualSectionPosition([{ title: '第一章' }], 3)).toBeNull();
  });
});

describe('formatNodePosition', () => {
  it('words the level from the node model', () => {
    expect(formatNodePosition({ kind: 'section', ordinal: 3, total: 12 })).toBe('第 3 / 12 节');
    expect(formatNodePosition({ kind: 'chapter', ordinal: 1, total: 9 })).toBe('第 1 / 9 章');
    expect(formatNodePosition({ kind: 'chunk', ordinal: 2, total: 4 })).toBe('第 2 / 4 段');
  });
});
