import { describe, expect, it } from 'vitest';
import { formatHighlightsAsMarkdown, relativeTimeLabel } from './highlightExport';
import type { ReaderHighlight } from '@/types/highlight';

/**
 * The 划线 tab's presentation helpers.
 *
 * The formatter's contract is the *shape* of the pasted Markdown (heading per
 * location, quotes as blockquotes, document order preserved), because that is
 * what makes an export readable in someone's notes; and the date's contract is
 * that it never counts a future timestamp backwards.
 */
const row = (over: Partial<ReaderHighlight> & { id: string; quote: string }): ReaderHighlight => ({
  bookHash: 'book-a',
  nodeIndex: 0,
  nodeTitle: '第二章 图书馆的密语',
  spineIndex: 0,
  createdAt: 0,
  ...over,
});

const locationOf = (highlight: ReaderHighlight): string =>
  highlight.nodeTitle === '第二章 图书馆的密语' ? '第一卷 迷雾 › 第二章 图书馆的密语' : '第三章 灯塔';

describe('formatHighlightsAsMarkdown', () => {
  it('groups quotes under their location, in document order', () => {
    const markdown = formatHighlightsAsMarkdown(
      [
        row({ id: 'a', quote: '穹顶上的星图亮了起来' }),
        row({ id: 'b', quote: '图书馆的木门在她身后合上' }),
        row({ id: 'c', quote: '灯火在雾中摇曳', nodeTitle: '第三章 灯塔' }),
      ],
      { resolveLocation: locationOf, bookTitle: '灯塔之夜' },
    );

    expect(markdown).toBe(
      [
        '# 《灯塔之夜》划线',
        '',
        '## 第一卷 迷雾 › 第二章 图书馆的密语',
        '',
        '> 穹顶上的星图亮了起来',
        '',
        '> 图书馆的木门在她身后合上',
        '',
        '## 第三章 灯塔',
        '',
        '> 灯火在雾中摇曳',
        '',
      ].join('\n'),
    );
  });

  it('keeps a multi-line quote readable as a blockquote', () => {
    const markdown = formatHighlightsAsMarkdown([row({ id: 'a', quote: '第一句\n\n第二句' })], {
      resolveLocation: locationOf,
    });
    // The location heading needs no book title: the caller may not have one yet.
    expect(markdown).toBe(['## 第一卷 迷雾 › 第二章 图书馆的密语', '', '> 第一句', '>', '> 第二句', ''].join('\n'));
  });

  it('returns an empty string for a book with no marks', () => {
    expect(formatHighlightsAsMarkdown([], { resolveLocation: locationOf })).toBe('');
  });
});

describe('relativeTimeLabel', () => {
  const now = new Date('2026-09-23T12:00:00Z').getTime();

  it('says the age the way a reader would', () => {
    expect(relativeTimeLabel(now - 30_000, now)).toBe('刚刚');
    expect(relativeTimeLabel(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(relativeTimeLabel(now - 3 * 3_600_000, now)).toBe('3 小时前');
    expect(relativeTimeLabel(now - 3 * 86_400_000, now)).toBe('3 天前');
    expect(relativeTimeLabel(now - 40 * 86_400_000, now)).toBe('1 个月前');
    expect(relativeTimeLabel(now - 400 * 86_400_000, now)).toBe('1 年前');
  });

  it('never counts a future timestamp backwards', () => {
    expect(relativeTimeLabel(now + 86_400_000, now)).toBe('刚刚');
  });
});
