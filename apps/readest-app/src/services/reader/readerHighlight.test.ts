import { describe, expect, it } from 'vitest';
import {
  READER_HIGHLIGHT_ACTIVE_CLASS,
  READER_HIGHLIGHT_CLASS,
  READER_HIGHLIGHT_ID_ATTRIBUTE,
  anchorForSelection,
  highlightIdAt,
  highlightRectIn,
  markReaderHighlights,
  textAnchorOf,
} from './readerHighlight';
import type { ReaderHighlight } from '@/types/highlight';

/**
 * Painting and re-finding reader marks.
 *
 * The two facts that make this more than a `indexOf`: the engine rebuilds a
 * chapter's document on every load (so a mark is only ever a *quote* away from
 * being found again), and a chapter can contain the same sentence twice (so the
 * context has to decide which one a row owns).
 */
const makeArticle = (html?: string): HTMLElement => {
  const article = document.createElement('article');
  article.innerHTML =
    html ??
    [
      '<p>灯塔在雾中摇曳，古老的钟楼敲响了第三声。</p>',
      '<p>年轻的图书管理员林晚背着油灯走进南门。</p>',
    ].join('');
  document.body.appendChild(article);
  return article;
};

const row = (over: Partial<ReaderHighlight> & { quote: string }): ReaderHighlight => ({
  id: `book:h_${over.quote.slice(0, 2)}`,
  bookHash: 'book',
  nodeIndex: 1,
  nodeTitle: '第一章',
  spineIndex: 0,
  createdAt: 1,
  ...over,
});

describe('anchorForSelection', () => {
  it('reads the context off the live range, not off the first occurrence', () => {
    const article = makeArticle('<p>前文甲。他不说话。后文甲。</p><p>前文乙。他不说话。后文乙。</p>');
    const second = article.querySelectorAll('p')[1]!.firstChild as Text;
    const range = document.createRange();
    // '前文乙。他不说话。后文乙。' — the quote occupies [4, 9).
    range.setStart(second, 4);
    range.setEnd(second, 9);

    const anchor = anchorForSelection(article, '他不说话。', range);
    expect(anchor?.quote).toBe('他不说话。');
    // Context proves the anchor belongs to the SECOND occurrence.
    expect(anchor?.prefix).toContain('前文乙。');
    expect(anchor?.suffix).toContain('后文乙。');
    article.remove();
  });

  it('falls back to the first occurrence when no range survives', () => {
    const article = makeArticle('<p>前文甲。他不说话。后文甲。</p><p>前文乙。他不说话。后文乙。</p>');
    const anchor = anchorForSelection(article, '他不说话。');
    expect(anchor?.prefix).toContain('前文甲。');
    article.remove();
  });

  it('returns null when the text is not in the document', () => {
    const article = makeArticle();
    expect(anchorForSelection(article, '不在这一章的句子')).toBeNull();
    expect(anchorForSelection(article, '   ')).toBeNull();
    expect(anchorForSelection(null, '任意')).toBeNull();
    article.remove();
  });

  it('reads an anchor from a document it did not select in (repaint path)', () => {
    const article = makeArticle();
    const anchor = textAnchorOf(
      { text: article.textContent ?? '', segments: [] },
      '年轻的图书管理员',
    );
    expect(anchor?.suffix).toContain('林晚背着油灯');
    article.remove();
  });
});

describe('markReaderHighlights', () => {
  it('paints every row that belongs to the document and reports the rest as missing', () => {
    const article = makeArticle();
    const result = markReaderHighlights(article, [
      row({ quote: '古老的钟楼敲响了第三声', id: 'a' }),
      row({ quote: '隔壁章节的句子', id: 'b' }),
    ]);

    expect(result.applied).toEqual(['a']);
    expect(result.missing).toEqual(['b']);
    const marks = article.querySelectorAll(`mark.${READER_HIGHLIGHT_CLASS}`);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('古老的钟楼敲响了第三声');
    // The style sheet is injected into the document that owns the marks.
    expect(document.getElementById('readest-reader-highlight-style')?.textContent).toContain(
      READER_HIGHLIGHT_CLASS,
    );
    article.remove();
  });

  it('is idempotent: repainting replaces the previous marks instead of nesting them', () => {
    const article = makeArticle();
    const rows = [row({ quote: '古老的钟楼' })];
    markReaderHighlights(article, rows);
    markReaderHighlights(article, rows);
    markReaderHighlights(article, rows);
    expect(article.querySelectorAll(`mark.${READER_HIGHLIGHT_CLASS}`)).toHaveLength(1);
    expect(article.textContent).toContain('灯塔在雾中摇曳，古老的钟楼敲响了第三声。');
    article.remove();
  });

  it('gives each of two identical sentences to its own row', () => {
    const article = makeArticle('<p>前文甲。他不说话。后文甲。</p><p>前文乙。他不说话。后文乙。</p>');
    const result = markReaderHighlights(article, [
      row({ id: 'first', quote: '他不说话。', prefix: '前文甲。', suffix: '后文甲。' }),
      row({ id: 'second', quote: '他不说话。', prefix: '前文乙。', suffix: '后文乙。' }),
    ]);

    expect(result.applied).toEqual(['first', 'second']);
    const marks = Array.from(article.querySelectorAll(`mark.${READER_HIGHLIGHT_CLASS}`));
    expect(marks.map((mark) => mark.textContent)).toEqual(['他不说话。', '他不说话。']);
    // The two rows landed on different paragraphs.
    const paragraphs = Array.from(article.querySelectorAll('p')).map((p) =>
      p.querySelector(`mark.${READER_HIGHLIGHT_CLASS}`)?.textContent ?? '',
    );
    expect(paragraphs).toEqual(['他不说话。', '他不说话。']);
    article.remove();
  });

  it('paints a range that spans two paragraphs as two marks', () => {
    const article = makeArticle();
    markReaderHighlights(article, [row({ quote: '第三声。\n年轻的图书管理员' })]);
    const marks = article.querySelectorAll(`mark.${READER_HIGHLIGHT_CLASS}`);
    expect(marks).toHaveLength(2);
    expect(Array.from(marks).map((mark) => mark.textContent)).toEqual(['第三声。', '年轻的图书管理员']);
    article.remove();
  });

  it('marks the jumped-to row with the emphasis class', () => {
    const article = makeArticle();
    markReaderHighlights(article, [row({ id: 'jump', quote: '古老的钟楼' })], {
      activeIds: ['jump'],
    });
    expect(
      article.querySelector(`mark.${READER_HIGHLIGHT_CLASS}.${READER_HIGHLIGHT_ACTIVE_CLASS}`),
    ).not.toBeNull();
    article.remove();
  });

  it('clears the marks when the book has none', () => {
    const article = makeArticle();
    markReaderHighlights(article, [row({ quote: '古老的钟楼' })]);
    const result = markReaderHighlights(article, []);
    expect(result.applied).toEqual([]);
    expect(article.querySelectorAll(`mark.${READER_HIGHLIGHT_CLASS}`)).toHaveLength(0);
    expect(article.textContent).toContain('古老的钟楼');
    article.remove();
  });

  it('does nothing without a document', () => {
    expect(markReaderHighlights(null, [row({ quote: '任意' })])).toEqual({
      applied: [],
      missing: [],
      marks: [],
    });
  });
});

/**
 * Clicking a mark. The mark is the reader's own handle on the row, so it has to
 * carry the row's identity — and a quote that spans a paragraph break is *two*
 * marks, so "the mark the reader clicked" has to be answerable as one rect.
 */
describe('clicking a painted 划线', () => {
  const stubRect = (element: Element, rect: DOMRect): void => {
    element.getBoundingClientRect = () => rect;
  };

  it('tags every mark of one highlight with that highlight id', () => {
    const article = makeArticle();
    markReaderHighlights(article, [
      row({ id: 'one', quote: '古老的钟楼' }),
      row({ id: 'two', quote: '年轻的图书管理员' }),
    ]);
    const ids = Array.from(article.querySelectorAll(`mark.${READER_HIGHLIGHT_CLASS}`)).map(
      (mark) => mark.getAttribute(READER_HIGHLIGHT_ID_ATTRIBUTE),
    );
    expect(ids).toEqual(['one', 'two']);
    article.remove();
  });

  it('names the highlight a click landed on, and nothing else', () => {
    const article = makeArticle();
    markReaderHighlights(article, [row({ id: 'clicked', quote: '古老的钟楼' })]);
    const mark = article.querySelector(`mark.${READER_HIGHLIGHT_CLASS}`)!;
    const text = mark.firstChild!;

    expect(highlightIdAt(mark)).toBe('clicked');
    // A click can land on the text node the mark wraps.
    expect(highlightIdAt(text)).toBe('clicked');
    // Anywhere else is not a mark.
    expect(highlightIdAt(article.querySelector('p'))).toBeNull();
    expect(highlightIdAt(null)).toBeNull();
    article.remove();
  });

  it('covers a quote that spans two paragraphs with one rect', () => {
    const article = makeArticle();
    // One highlight, wrapped as one mark per text node it crosses.
    markReaderHighlights(article, [row({ id: 'span', quote: '第三声。\n年轻的图书管理员' })]);
    const marks = Array.from(article.querySelectorAll(`mark.${READER_HIGHLIGHT_CLASS}`));
    expect(marks).toHaveLength(2);
    stubRect(marks[0]!, new DOMRect(10, 100, 20, 16));
    stubRect(marks[1]!, new DOMRect(200, 130, 40, 16));

    const rect = highlightRectIn(article, 'span')!;
    expect([rect.left, rect.top, rect.width, rect.height]).toEqual([10, 100, 230, 46]);
    // A row that is not painted here has no rect to anchor a toolbar to.
    expect(highlightRectIn(article, 'other')).toBeNull();
    expect(highlightRectIn(null, 'span')).toBeNull();
    article.remove();
  });
});
