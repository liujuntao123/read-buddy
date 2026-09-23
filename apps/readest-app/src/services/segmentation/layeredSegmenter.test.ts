import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_ADOPT_THRESHOLD,
  LEVEL3_TARGET_CHARS,
  SPINE_JOIN,
  buildFixedLengthNodes,
  buildTocNodes,
  detectTocPageEnd,
  isDegenerateSpine,
  monotonicityScore,
  parseChineseNumeral,
  parseRomanNumeral,
  scanHeadingCandidates,
  scoreConfidence,
  segmentMonolithic,
  segmentSpineBook,
  type SpineSectionInput,
} from './layeredSegmenter';
// Level rules are owned by the node model (ADR 0010 ¶1, 候选 5); they are used
// here only as pre-conditions inside integration tests.
import { classifyHeadingLevel, stampDepths } from '@/services/bookNodes';
import { bookNodeId, type BookTocEntry, type NodeAnchor } from '@/types/readingAgent';

const paragraph = (seed: string, lines = 60): string =>
  Array.from({ length: lines }, (_, i) => `${seed}段落${i + 1}：夜色中的城市依旧喧嚣，灯火沿着河岸铺陈开来，雾气在街角缓慢聚拢。`)
    .join('\n');

const CHAPTER_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];

/** A well-formed 12-chapter book (~2,000 chars per chapter). */
const buildBook = (): string =>
  CHAPTER_NUMERALS.map(
    (numeral, i) => [`第${numeral}章 ${['风起之地', '雾锁孤城', '河灯迷影'][i % 3] ?? '夜航'}之卷`, paragraph(`c${i}`)].join('\n'),
  ).join('\n');

describe('numeral parsing', () => {
  it('parses Chinese numerals including compounds', () => {
    expect(parseChineseNumeral('一')).toBe(1);
    expect(parseChineseNumeral('9')).toBe(9);
    expect(parseChineseNumeral('十')).toBe(10);
    expect(parseChineseNumeral('二十三')).toBe(23);
    expect(parseChineseNumeral('一百零八')).toBe(108);
    expect(parseChineseNumeral('两')).toBe(2);
    expect(parseChineseNumeral('x')).toBeNull();
  });

  it('parses Roman numerals', () => {
    expect(parseRomanNumeral('IV')).toBe(4);
    expect(parseRomanNumeral('XIX')).toBe(19);
    expect(parseRomanNumeral('ABC')).toBeNull();
  });
});

describe('scanHeadingCandidates', () => {
  it('detects canonical Chinese chapter headings with ordinals', () => {
    const text = ['第一章 风起之地', paragraph('a'), '第二章 雾锁孤城', paragraph('b')].join('\n');
    const candidates = scanHeadingCandidates(text);
    expect(candidates.map((c) => c.title)).toEqual(['第一章 风起之地', '第二章 雾锁孤城']);
    expect(candidates[0]!.ordinal).toBe(1);
    expect(candidates[1]!.ordinal).toBe(2);
  });

  it('detects ordinal+punctuation and English chapter patterns', () => {
    const text = [
      '1. 绪论',
      paragraph('a'),
      'Chapter 3 The Long Night',
      paragraph('b'),
      'Part II',
      paragraph('c'),
    ].join('\n');
    const titles = scanHeadingCandidates(text).map((c) => c.title);
    expect(titles).toContain('1. 绪论');
    expect(titles).toContain('Chapter 3 The Long Night');
    expect(titles).toContain('Part II');
  });

  it('detects附属章节 (序言/尾声/番外)', () => {
    const text = ['序言', paragraph('a'), '尾声', paragraph('b')].join('\n');
    const titles = scanHeadingCandidates(text).map((c) => c.title);
    expect(titles).toContain('序言');
    expect(titles).toContain('尾声');
  });
});

describe('detectTocPageEnd', () => {
  it('flags a dense front TOC listing and keeps real headings after it', () => {
    const toc = ['第一章 风起', '第二章 雾锁', '第三章 夜行', '第四章 河灯', '第五章 孤城'].join('\n');
    const text = [toc, '', '作者的话', paragraph('pre'), '第一章 风起之地', paragraph('a'), '第二章 雾锁孤城', paragraph('b')].join('\n');
    const candidates = scanHeadingCandidates(text);
    const tocEnd = detectTocPageEnd(text, candidates);
    expect(tocEnd).toBeGreaterThan(0);
    // Real headings live strictly after the manifest.
    const after = candidates.filter((c) => c.offset >= tocEnd).map((c) => c.title);
    expect(after).toEqual(['第一章 风起之地', '第二章 雾锁孤城']);
  });

  it('returns 0 when headings are separated by real prose', () => {
    const text = ['第一章 风起', paragraph('a'), '第二章 雾锁', paragraph('b')].join('\n');
    expect(detectTocPageEnd(text)).toBe(0);
  });
});

describe('confidence scoring', () => {
  it('scores well-formed progressions highly', () => {
    const chapters = Array.from({ length: 12 }, (_, i) => ({
      ordinal: i + 1,
      charCount: 4_000,
    }));
    expect(scoreConfidence(chapters).total).toBeGreaterThanOrEqual(CONFIDENCE_ADOPT_THRESHOLD);
  });

  it('scores shuffled ordinals below the adopt threshold', () => {
    const ordinals = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const chapters = ordinals.map((ordinal) => ({ ordinal, charCount: 4_000 }));
    expect(scoreConfidence(chapters).total).toBeLessThan(CONFIDENCE_ADOPT_THRESHOLD);
  });

  it('monotonicityScore is neutral with too few ordinals', () => {
    expect(monotonicityScore([null, null])).toBe(0.5);
    expect(monotonicityScore([1, 2, 3])).toBe(1);
  });
});

describe('segmentMonolithic', () => {
  it('adopts the regex strategy for a clean book and maps exact offsets', () => {
    const fullText = buildBook();
    const result = segmentMonolithic('bookhash', fullText);
    expect(result.strategy).toBe('regex');
    expect(result.confidence?.total).toBeGreaterThanOrEqual(CONFIDENCE_ADOPT_THRESHOLD);
    expect(result.nodes.length).toBe(12);

    // Unified offset invariant: slices tile the text without gaps/overlap.
    result.nodes.forEach((node, i) => {
      expect(fullText.slice(node.startOffset, node.endOffset)).toBe(
        fullText.slice(node.startOffset, result.nodes[i + 1]?.startOffset ?? fullText.length),
      );
      if (i > 0) expect(node.startOffset).toBe(result.nodes[i - 1]!.endOffset);
    });
    expect(fullText.slice(result.nodes[0]!.startOffset, result.nodes[0]!.endOffset).startsWith('第一章')).toBe(true);
    expect(result.nodes[0]!.indexStatus).toBe('pending');
    expect(result.nodes[0]!.nodeId).toBe(bookNodeId('bookhash', 0));
  });

  it('skips a front TOC manifest instead of slicing fake chapters', () => {
    const toc = CHAPTER_NUMERALS.map((numeral, i) => `第${numeral}章 标题${i + 1}`).join('\n');
    const fullText = [toc, '', paragraph('pre'), ...buildBook().split('\n')].join('\n');
    const result = segmentMonolithic('bookhash', fullText);
    expect(result.strategy).toBe('regex');
    // The preamble becomes 前言; the first real chapter follows. No node may
    // be a one-line TOC entry.
    expect(result.nodes[0]!.title).toBe('前言');
    const firstChapter = fullText.slice(result.nodes[1]!.startOffset, result.nodes[1]!.endOffset);
    expect(firstChapter.startsWith('第一章')).toBe(true);
    result.nodes.forEach((node) => {
      expect(node.charCount).toBeGreaterThan(500);
    });
  });

  it('prepends a 前言 chapter for a substantial preamble', () => {
    const fullText = [paragraph('pre', 30), buildBook()].join('\n');
    const result = segmentMonolithic('bookhash', fullText);
    expect(result.nodes[0]!.title).toBe('前言');
    expect(result.nodes[1]!.title.startsWith('第一章')).toBe(true);
  });

  it('falls back to Level 3 smooth chunks for structure-less text', () => {
    const fullText = paragraph('x', 900); // ~27k chars, no headings
    const result = segmentMonolithic('bookhash', fullText);
    expect(result.strategy).toBe('fixed-length');
    expect(result.nodes.length).toBeGreaterThan(3);
    result.nodes.forEach((node, index) => {
      if (index > 0) expect(node.startOffset).toBe(result.nodes[index - 1]!.endOffset);
      expect(node.charCount).toBeLessThanOrEqual(LEVEL3_TARGET_CHARS + 200);
    });
    // Chunks must cut at newline boundaries (never mid-line).
    result.nodes.slice(0, -1).forEach((node) => {
      expect(fullText[node.endOffset - 1]).toBe('\n');
    });
    expect(result.nodes[0]!.title).toBe('第 1 部分');
  });
});

describe('hierarchical node model (章 › 节)', () => {
  it('nests every non-container heading after a container (《看见孩子》 spine)', () => {
    const sections = [
      { title: '前言', text: paragraph('p', 10), spineIndex: 0 },
      { title: '第1部分 贝姬医生的育儿准则', text: paragraph('a', 10), spineIndex: 1 },
      { title: '准则2 真相不唯一', text: paragraph('b', 10), spineIndex: 2 },
      { title: '准则3 明确父母和孩子的职责', text: paragraph('c', 10), spineIndex: 3 },
      { title: '第2部分 建立亲密感，改善行为', text: paragraph('d', 10), spineIndex: 4 },
      { title: '实战2 孩子不听话（或者说，不合作）怎么办？', text: paragraph('e', 10), spineIndex: 5 },
      { title: '总结', text: paragraph('f', 10), spineIndex: 6 },
    ];
    const result = segmentSpineBook('seen-child', sections);
    const byTitle = new Map(result.nodes.map((node) => [node.title, node]));

    expect(byTitle.get('前言')!.depth).toBe(0);
    expect(byTitle.get('第1部分 贝姬医生的育儿准则')!.depth).toBe(0);
    expect(byTitle.get('第1部分 贝姬医生的育儿准则')!.parentNodeId).toBeUndefined();
    // 准则N carries no 章/节 suffix — membership is positional, not suffix-based.
    expect(byTitle.get('准则2 真相不唯一')).toMatchObject({ depth: 1 });
    expect(byTitle.get('准则2 真相不唯一')!.parentNodeId).toBe(
      byTitle.get('第1部分 贝姬医生的育儿准则')!.nodeId,
    );
    expect(byTitle.get('准则3 明确父母和孩子的职责')!.parentNodeId).toBe(
      byTitle.get('第1部分 贝姬医生的育儿准则')!.nodeId,
    );
    expect(byTitle.get('第2部分 建立亲密感，改善行为')!.depth).toBe(0);
    expect(byTitle.get('实战2 孩子不听话（或者说，不合作）怎么办？')).toMatchObject({ depth: 1 });
    expect(byTitle.get('实战2 孩子不听话（或者说，不合作）怎么办？')!.parentNodeId).toBe(
      byTitle.get('第2部分 建立亲密感，改善行为')!.nodeId,
    );
    expect(byTitle.get('总结')!.parentNodeId).toBe(
      byTitle.get('第2部分 建立亲密感，改善行为')!.nodeId,
    );
  });

  it('nests 章 under 部分 for 《思考快与慢》 and keeps it flat without containers', () => {
    const sections = [
      { title: '序言', text: paragraph('p', 10), spineIndex: 0 },
      { title: '第一部分 系统1，系统2', text: paragraph('a', 10), spineIndex: 1 },
      { title: '第1章 一张愤怒的脸和一道乘法题', text: paragraph('b', 10), spineIndex: 2 },
      { title: '第2章 电影的主角与配角', text: paragraph('c', 10), spineIndex: 3 },
      { title: '第二部分 启发法与偏见', text: paragraph('d', 10), spineIndex: 4 },
      { title: '第10章 大数法则与小数定律', text: paragraph('e', 10), spineIndex: 5 },
    ];
    const result = segmentSpineBook('thinking', sections);
    const byTitle = new Map(result.nodes.map((node) => [node.title, node]));

    expect(byTitle.get('序言')!.depth).toBe(0);
    expect(byTitle.get('第一部分 系统1，系统2')!.depth).toBe(0);
    expect(byTitle.get('第1章 一张愤怒的脸和一道乘法题')).toMatchObject({ depth: 1 });
    expect(byTitle.get('第1章 一张愤怒的脸和一道乘法题')!.parentNodeId).toBe(
      byTitle.get('第一部分 系统1，系统2')!.nodeId,
    );
    expect(byTitle.get('第2章 电影的主角与配角')!.parentNodeId).toBe(
      byTitle.get('第一部分 系统1，系统2')!.nodeId,
    );
    expect(byTitle.get('第10章 大数法则与小数定律')!.parentNodeId).toBe(
      byTitle.get('第二部分 启发法与偏见')!.nodeId,
    );
  });

  it('keeps a container-free 章 book with leading front matter flat (《何为良好生活》)', () => {
    const sections = [
      { title: '版权页', text: paragraph('p', 10), spineIndex: 0 },
      { title: '序言', text: paragraph('p', 10), spineIndex: 1 },
      { title: '第一章 伦理与伦理学', text: paragraph('a', 10), spineIndex: 2 },
      { title: '第二章 功效主义与自私的基因', text: paragraph('b', 10), spineIndex: 3 },
    ];
    const result = segmentSpineBook('good-life', sections);
    // 「序言」 appears BEFORE the first container, so nothing gets nested.
    expect(result.nodes.every((node) => node.depth === 0 && !node.parentNodeId)).toBe(true);
  });

  it('assigns depth/parent for 卷›章 structures in monolithic text', () => {
    const build = () =>
      [
        '第一卷 风云之始',
        paragraph('a'),
        '第一章 风起',
        paragraph('b'),
        '第二章 雾锁',
        paragraph('c'),
        '第二卷 长夜将尽',
        paragraph('d'),
        '第三章 夜航',
        paragraph('e'),
        '第四章 双塔',
        paragraph('f'),
      ].join('\n');
    const fullText = build();
    const result = segmentMonolithic('hier', fullText);
    expect(result.strategy).toBe('regex');
    const byTitle = new Map(result.nodes.map((node) => [node.title, node]));
    // Containers are first-level 章 nodes without parents.
    expect(byTitle.get('第一卷 风云之始')!.depth).toBe(0);
    expect(byTitle.get('第一卷 风云之始')!.parentNodeId).toBeUndefined();
    expect(byTitle.get('第二卷 长夜将尽')!.depth).toBe(0);
    // Leaves inside a container become depth-1 节 nodes with a parent ref.
    expect(byTitle.get('第一章 风起')).toMatchObject({ depth: 1 });
    expect(byTitle.get('第一章 风起')!.parentNodeId).toBe(byTitle.get('第一卷 风云之始')!.nodeId);
    expect(byTitle.get('第二章 雾锁')!.parentNodeId).toBe(byTitle.get('第一卷 风云之始')!.nodeId);
    expect(byTitle.get('第三章 夜航')!.parentNodeId).toBe(byTitle.get('第二卷 长夜将尽')!.nodeId);
    expect(byTitle.get('第四章 双塔')!.parentNodeId).toBe(byTitle.get('第二卷 长夜将尽')!.nodeId);
    // Flat ordinals stay contiguous across the hierarchy.
    result.nodes.forEach((node, index) => expect(node.nodeIndex).toBe(index));
  });

  it('keeps standalone 章 books single-level (depth 0, no parents)', () => {
    const fullText = buildBook();
    const result = segmentMonolithic('flat', fullText);
    expect(result.nodes.every((node) => node.depth === 0 && !node.parentNodeId)).toBe(true);
  });

  it('marks fixed-length parts as first-level nodes', () => {
    const nodes = buildFixedLengthNodes('hier', paragraph('x', 900));
    expect(nodes.every((node) => node.depth === 0 && !node.parentNodeId)).toBe(true);
  });

  it('derives hierarchy from spine titles (Part › Chapter)', () => {
    const sections = [
      { title: 'Part I', text: paragraph('p', 10), spineIndex: 0 },
      { title: 'Chapter 1', text: paragraph('a', 10), spineIndex: 1 },
      { title: 'Chapter 2', text: paragraph('b', 10), spineIndex: 2 },
      { title: 'Part II', text: paragraph('q', 10), spineIndex: 3 },
      { title: 'Chapter 3', text: paragraph('c', 10), spineIndex: 4 },
    ];
    const result = segmentSpineBook('spine-hier', sections);
    const byTitle = new Map(result.nodes.map((node) => [node.title, node]));
    expect(byTitle.get('Part I')!.depth).toBe(0);
    expect(byTitle.get('Chapter 1')).toMatchObject({ depth: 1 });
    expect(byTitle.get('Chapter 1')!.parentNodeId).toBe(byTitle.get('Part I')!.nodeId);
    expect(byTitle.get('Chapter 3')!.parentNodeId).toBe(byTitle.get('Part II')!.nodeId);
  });
});

describe('spine segmentation (Level 1 / degenerate downgrade)', () => {
  it('maps a healthy native spine 1:1 with cumulative offsets', () => {
    const sections = [
      { title: '第一章', text: paragraph('a', 10), spineIndex: 0 },
      { title: '第二章', text: paragraph('b', 10), spineIndex: 1 },
      { title: '第三章', text: paragraph('c', 10), spineIndex: 2 },
    ];
    const result = segmentSpineBook('hash', sections);
    expect(result.strategy).toBe('native');
    expect(result.nodes).toHaveLength(3);
    result.nodes.forEach((node, i) => {
      expect(node.spineIndex).toBe(i);
      expect(result.fullText.slice(node.startOffset, node.endOffset)).toBe(sections[i]!.text);
    });
  });

  it('downgrades a monolithic single-spine EPUB to the layered pipeline', () => {
    const giant = CHAPTER_NUMERALS.map((numeral, i) =>
      [`第${numeral}章 标题${i}`, paragraph(`c${i}`, 80)].join('\n'),
    ).join('\n');
    expect(giant.length).toBeGreaterThan(25_000);
    expect(isDegenerateSpine([giant.length])).toBe(true);
    const result = segmentSpineBook('hash', [{ title: '全书', text: giant, spineIndex: 0 }]);
    expect(result.strategy).toBe('regex');
    expect(result.nodes.length).toBe(12);
    expect(result.fullText).toBe(giant);
  });
});

describe('directory-driven nodes (Level 1 from the book’s own TOC, anchors included)', () => {
  const joinSections = (sections: SpineSectionInput[]): string =>
    sections.map((section) => section.text).join(SPINE_JOIN);

  const ANCHORED_TEXT = [
    '第一部分 系统1，系统2',
    '本部分导读：两套系统如何分工。',
    '第1章 一张愤怒的脸和一道乘法题',
    paragraph('t1', 10),
    '第2章 电影的主角与配角',
    paragraph('t2', 10),
  ].join('\n');

  const anchoredSections = (): SpineSectionInput[] => [
    {
      title: '正文',
      text: ANCHORED_TEXT,
      spineIndex: 0,
      anchors: [
        { id: 'sigil_toc_id_part', offset: ANCHORED_TEXT.indexOf('第一部分') },
        { id: 'sigil_toc_id_1', offset: ANCHORED_TEXT.indexOf('第1章') },
        { id: 'sigil_toc_id_2', offset: ANCHORED_TEXT.indexOf('第2章') },
      ] satisfies NodeAnchor[],
    },
  ];

  const anchoredEntries = (): BookTocEntry[] => [
    {
      label: '第一部分 系统1，系统2',
      depth: 0,
      spineIndex: 0,
      anchor: 'sigil_toc_id_part',
      href: 'text.xhtml#sigil_toc_id_part',
    },
    {
      label: '第1章 一张愤怒的脸和一道乘法题',
      depth: 0,
      spineIndex: 0,
      anchor: 'sigil_toc_id_1',
      href: 'text.xhtml#sigil_toc_id_1',
    },
    {
      label: '第2章 电影的主角与配角',
      depth: 0,
      spineIndex: 0,
      anchor: 'sigil_toc_id_2',
      href: 'text.xhtml#sigil_toc_id_2',
    },
  ];

  it('cuts one spine into 章 › 节 along its directory anchors', () => {
    const sections = anchoredSections();
    const entries = anchoredEntries();
    const nodes = buildTocNodes('toc-hash', sections, entries, ANCHORED_TEXT)!;

    expect(nodes).not.toBeNull();
    expect(nodes.map((node) => node.title)).toEqual([
      '第一部分 系统1，系统2',
      '第1章 一张愤怒的脸和一道乘法题',
      '第2章 电影的主角与配角',
    ]);
    // 章 container at depth 0, the two 节 anchored inside the same file at depth 1.
    expect(nodes.map((node) => node.depth)).toEqual([0, 1, 1]);
    expect(nodes[0]!.parentNodeId).toBeUndefined();
    expect(nodes[1]!.parentNodeId).toBe(nodes[0]!.nodeId);
    expect(nodes[2]!.parentNodeId).toBe(nodes[0]!.nodeId);
    expect(nodes[0]!.nodeId).toBe(bookNodeId('toc-hash', 0));

    // The anchor/href survive onto the nodes so the reader can jump right at them.
    expect(nodes[1]!.anchor).toBe('sigil_toc_id_1');
    expect(nodes[1]!.href).toBe('text.xhtml#sigil_toc_id_1');
    expect(nodes[1]!.spineIndex).toBe(0);
    expect(nodes[0]!.spineIndex).toBe(0);

    // Strictly increasing, non-overlapping [startOffset, endOffset) ranges that
    // tile the spine text; indices stay contiguous from 0.
    expect(nodes[0]!.startOffset).toBe(0);
    expect(nodes[nodes.length - 1]!.endOffset).toBe(ANCHORED_TEXT.length);
    nodes.forEach((node, index) => {
      expect(node.nodeIndex).toBe(index);
      expect(node.endOffset).toBeGreaterThan(node.startOffset);
      expect(node.charCount).toBe(node.endOffset - node.startOffset);
      if (index > 0) expect(node.startOffset).toBe(nodes[index - 1]!.endOffset);
    });

    // `segmentSpineBook` prefers the directory over the 1:1 spine mapping.
    const viaSegmenter = segmentSpineBook('toc-hash', sections, entries);
    expect(viaSegmenter.strategy).toBe('native');
    expect(viaSegmenter.nodes.map((node) => node.title)).toEqual(nodes.map((node) => node.title));
  });

  it('stamps the missing second level onto a FLAT directory (第一部分 › 第N章)', () => {
    const sections: SpineSectionInput[] = [
      { title: '第一部分 系统1，系统2', text: paragraph('a', 10), spineIndex: 0 },
      { title: '第1章 一张愤怒的脸和一道乘法题', text: paragraph('b', 10), spineIndex: 1 },
      { title: '第2章 电影的主角与配角', text: paragraph('c', 10), spineIndex: 2 },
    ];
    const entries: BookTocEntry[] = [
      { label: '第一部分 系统1，系统2', depth: 0, spineIndex: 0 },
      { label: '第1章 一张愤怒的脸和一道乘法题', depth: 0, spineIndex: 1 },
      { label: '第2章 电影的主角与配角', depth: 0, spineIndex: 2 },
    ];

    // The directory is 平铺 (every entry declares depth 0)…
    expect(
      stampDepths(entries.map((entry) => ({ title: entry.label, depth: entry.depth }))).map(
        (row) => row.depth,
      ),
    ).toEqual([0, 1, 1]);

    // …and the heading classifier supplies the level the directory omits.
    const nodes = buildTocNodes('flat-toc', sections, entries, joinSections(sections))!;
    expect(nodes.map((node) => node.title)).toEqual([
      '第一部分 系统1，系统2',
      '第1章 一张愤怒的脸和一道乘法题',
      '第2章 电影的主角与配角',
    ]);
    expect(nodes.map((node) => node.depth)).toEqual([0, 1, 1]);
    expect(nodes[0]!.parentNodeId).toBeUndefined();
    expect(nodes[1]!.parentNodeId).toBe(nodes[0]!.nodeId);
    expect(nodes[2]!.parentNodeId).toBe(nodes[0]!.nodeId);
    expect(nodes.map((node) => node.nodeIndex)).toEqual([0, 1, 2]);
  });

  it('drops a directory entry whose anchor cannot be located', () => {
    const sections = anchoredSections();
    const entries = anchoredEntries();
    const bogus: BookTocEntry = {
      label: '第3章 不该出现的假节点',
      depth: 0,
      spineIndex: 0,
      anchor: 'sigil_toc_id_missing',
      href: 'text.xhtml#sigil_toc_id_missing',
    };

    const nodes = buildTocNodes('dropped', sections, [...entries, bogus], ANCHORED_TEXT)!;
    expect(nodes.map((node) => node.title)).toEqual([
      '第一部分 系统1，系统2',
      '第1章 一张愤怒的脸和一道乘法题',
      '第2章 电影的主角与配角',
    ]);
    expect(nodes.some((node) => node.anchor === 'sigil_toc_id_missing')).toBe(false);
    expect(nodes.map((node) => node.nodeIndex)).toEqual([0, 1, 2]);

    // When nothing survives the lookup the directory is unusable and the caller
    // must fall back to the physical spine instead of inventing nodes.
    expect(buildTocNodes('dropped', sections, [bogus], ANCHORED_TEXT)).toBeNull();
  });

  it('keeps an empty container 章 as the parent row of its 节 (empty 节 rows are dropped)', () => {
    // A 卷 file may be an empty placeholder whose 章 live in the next files:
    // the first-level node survives with zero text so its 节 stay attached.
    const container = segmentSpineBook('empty-container', [
      { title: '第一卷 风云', text: '', spineIndex: 0 },
      { title: '第一章 风起', text: paragraph('a', 10), spineIndex: 1 },
      { title: '第二章 雾锁', text: paragraph('b', 10), spineIndex: 2 },
    ]);
    expect(container.strategy).toBe('native');
    expect(classifyHeadingLevel('第一卷 风云')).toBe('container');
    expect(container.nodes.map((node) => node.title)).toEqual([
      '第一卷 风云',
      '第一章 风起',
      '第二章 雾锁',
    ]);
    expect(container.nodes.map((node) => node.depth)).toEqual([0, 1, 1]);
    expect(container.nodes.map((node) => node.nodeIndex)).toEqual([0, 1, 2]);
    // Empty body, but still the parent of both 节.
    expect(container.nodes[0]).toMatchObject({ charCount: 0, startOffset: 0, endOffset: 0 });
    expect(container.nodes[1]!.parentNodeId).toBe(container.nodes[0]!.nodeId);
    expect(container.nodes[2]!.parentNodeId).toBe(container.nodes[0]!.nodeId);

    // A content-less 节 is padding, not structure: it is dropped and the
    // remaining indices stay contiguous.
    const dropped = segmentSpineBook('empty-section', [
      { title: '第一卷 风云', text: paragraph('p', 10), spineIndex: 0 },
      { title: '第一章 风起', text: paragraph('a', 10), spineIndex: 1 },
      { title: '第二章 雾锁', text: '', spineIndex: 2 },
    ]);
    expect(dropped.nodes.map((node) => node.title)).toEqual(['第一卷 风云', '第一章 风起']);
    expect(dropped.nodes.map((node) => node.depth)).toEqual([0, 1]);
    expect(dropped.nodes.map((node) => node.nodeIndex)).toEqual([0, 1]);
    expect(dropped.nodes[1]!.parentNodeId).toBe(dropped.nodes[0]!.nodeId);
  });
});
