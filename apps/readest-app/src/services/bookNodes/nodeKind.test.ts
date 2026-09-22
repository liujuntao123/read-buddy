import { describe, expect, it } from 'vitest';
import {
  formatNavLabel,
  formatNodeOrdinal,
  nodeKindLabel,
  resolveNodeKind,
  stampDepths,
} from './nodeKind';

describe('resolveNodeKind', () => {
  it('maps depth 0 to 章 and depth 1 to 节', () => {
    expect(resolveNodeKind(0, '第一章 起点')).toBe('chapter');
    expect(resolveNodeKind(1, '第一章 起点')).toBe('section');
  });

  it('never lets a synthetic fixed-length title claim 章 structure', () => {
    expect(resolveNodeKind(0, '第 3 部分')).toBe('chunk');
    expect(resolveNodeKind(0, '第 2 / 5 部分')).toBe('chunk');
    // 有名字的真实容器仍然是章。
    expect(resolveNodeKind(0, '第一部分 系统1，系统2')).toBe('chapter');
  });
});

describe('level wording', () => {
  it('is the single source of the 章/节/段 words', () => {
    expect(nodeKindLabel('chapter')).toBe('章');
    expect(nodeKindLabel('section')).toBe('节');
    expect(nodeKindLabel('chunk')).toBe('段');
    expect(formatNodeOrdinal('section', 3)).toBe('第 3 节');
    expect(formatNavLabel('section', 'prev')).toBe('上一节');
    expect(formatNavLabel('chapter', 'next')).toBe('下一章');
  });
});

describe('stampDepths', () => {
  it('recovers a missing level from the titles of a flat directory', () => {
    const stamped = stampDepths([
      { title: '第一部分 系统1，系统2', depth: 0 },
      { title: '第1章 一张愤怒的脸和一道乘法题', depth: 0 },
      { title: '第2章 电影的主角与配角', depth: 0 },
      { title: '第二部分 启发法与偏见', depth: 0 },
      { title: '第10章 大数法则与小数定律', depth: 0 },
    ]);

    expect(stamped.map((entry) => entry.depth)).toEqual([0, 1, 1, 0, 1]);
  });

  it('keeps a container-free book flat', () => {
    const stamped = stampDepths([
      { title: '第一章 伦理与伦理学', depth: 0 },
      { title: '第二章 功效主义与自私的基因', depth: 0 },
    ]);

    expect(stamped.map((entry) => entry.depth)).toEqual([0, 0]);
  });

  it('never discards a level the directory already declared', () => {
    const stamped = stampDepths([
      { title: '第一章 伦理与伦理学', depth: 0 },
      // 目录把「§节」嵌在第二层：标题没有结构信号，层级仍然保留。
      { title: '§1 伦理学这个名称', depth: 1 },
    ]);

    expect(stamped.map((entry) => entry.depth)).toEqual([0, 1]);
  });

  it('keeps front matter before the first container at the first level', () => {
    const stamped = stampDepths([
      { title: '序言', depth: 0 },
      { title: '第一卷 风云之始', depth: 0 },
      { title: '第一章 风起', depth: 0 },
    ]);

    expect(stamped.map((entry) => entry.depth)).toEqual([0, 0, 1]);
  });
});
