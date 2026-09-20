import { describe, expect, it } from 'vitest';
import { DEMO_MONOLITHIC_TXT } from '@/services/reader/demoBook';
import { buildVirtualSections, detectChapters } from './detector';

/** Builds a small monolithic text: each heading followed by one body line. */
const makeText = (...headings: string[]): string =>
  headings.map((heading) => `${heading}\n这里是一行普通的正文内容，不含任何章节编号。`).join('\n\n');

describe('detectChapters', () => {
  it('finds the five demo chapters with monotonic offsets at their headings', () => {
    const chapters = detectChapters(DEMO_MONOLITHIC_TXT);

    expect(chapters.map((c) => c.title)).toEqual([
      '第一章 风起之地1',
      '第二章 风起之地2',
      '第三章 风起之地3',
      '第四章 风起之地4',
      '第五章 风起之地5',
    ]);

    const offsets = chapters.map((c) => c.charOffset);
    expect(offsets[0]).toBe(0);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets); // strictly ascending input
    for (const chapter of chapters) {
      expect(DEMO_MONOLITHIC_TXT.startsWith(chapter.title, chapter.charOffset)).toBe(true);
    }
  });

  it('matches English chapter and section headings case-insensitively', () => {
    expect(detectChapters(makeText('Chapter 12 The Storm', 'Chapter 13 Aftermath')).length).toBe(2);
    expect(detectChapters(makeText('chapter 2 出发', 'chapter 3 归途')).length).toBe(2);
    expect(detectChapters(makeText('SECTION 3', 'SECTION 4')).length).toBe(2);
    expect(detectChapters(makeText('section 10 初版', 'section 11 再版')).length).toBe(2);
  });

  it('matches Chinese compound numerals with 章/回/卷 markers', () => {
    expect(detectChapters(makeText('第一百二十三章 夜袭', '第一百二十四章 黎明')).length).toBe(2);
    expect(detectChapters(makeText('第十回', '第十一回')).length).toBe(2);
    expect(detectChapters(makeText('第三卷', '第四卷')).length).toBe(2);
  });

  it('does not match headings without a chapter number', () => {
    expect(detectChapters(makeText('chapter', 'chapter'))).toEqual([]);
    expect(detectChapters(makeText('第章', '第章'))).toEqual([]);
    expect(detectChapters(makeText('第一章', 'SECTION'))).toEqual([]); // SECTION needs digits too
  });

  it('returns [] for texts with fewer than two headings', () => {
    expect(detectChapters('没有任何标题的一整段文字。\n继续正文。')).toEqual([]);
    expect(detectChapters('第一章 孤章\n正文不足以分段。')).toEqual([]);
    expect(detectChapters('')).toEqual([]);
  });

  it('prefixes a preamble section when text precedes the first heading', () => {
    const text = `作者的话：这是一段写在正文之前的话。\n\n第一章 开端\n正文。\n\n第二章 转折\n正文。`;
    const chapters = detectChapters(text);
    expect(chapters.map((c) => c.title)).toEqual(['序言', '第一章 开端', '第二章 转折']);
    expect(chapters[0]!.charOffset).toBe(0);
    expect(chapters[1]!.charOffset).toBe(text.indexOf('第一章 开端'));
  });

  it('accepts a custom pattern', () => {
    const text = makeText('Part 1', 'Part 2');
    expect(detectChapters(text)).toEqual([]);
    const custom = detectChapters(text, /Part\s+\d+/);
    expect(custom.map((c) => c.title)).toEqual(['Part 1', 'Part 2']);
  });
});

describe('buildVirtualSections', () => {
  it('maps 0-based indexes and carries titles/offsets through', () => {
    const chapters = detectChapters(DEMO_MONOLITHIC_TXT);
    const sections = buildVirtualSections(chapters);

    expect(sections.map((s) => s.virtualIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(sections.map((s) => s.title)).toEqual(chapters.map((c) => c.title));
    expect(sections.map((s) => s.charOffset)).toEqual(chapters.map((c) => c.charOffset));
    for (const section of sections) {
      expect('startCfi' in section).toBe(false);
    }
  });
});
