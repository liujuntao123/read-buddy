import { describe, expect, it } from 'vitest';
import {
  collectTextSegments,
  findAnchoredQuote,
  findQuote,
  injectStyleOnce,
  textRangeOfDomRange,
  unwrapMarks,
  wrapTextRange,
} from './textMarks';

/**
 * The shared text-mark primitives.
 *
 * The interesting cases are the ones a naive `indexOf` gets wrong: a selection
 * that spans two paragraphs (its string carries a block separator the DOM text
 * never contains), two identical sentences in one chapter, and a range whose
 * endpoints are element nodes rather than text nodes.
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

describe('collectTextSegments', () => {
  it('concatenates non-blank text nodes in document order with offsets', () => {
    const article = makeArticle('<p>甲</p><p>乙丙</p>');
    const docText = collectTextSegments(article);
    expect(docText.text).toBe('甲乙丙');
    expect(docText.segments.map((s) => [s.node.nodeValue, s.start, s.end])).toEqual([
      ['甲', 0, 1],
      ['乙丙', 1, 3],
    ]);
    article.remove();
  });

  it('skips whitespace-only nodes so offsets describe readable text', () => {
    const article = makeArticle('<p>甲</p>\n  <p>乙</p>');
    expect(collectTextSegments(article).text).toBe('甲乙');
    article.remove();
  });
});

describe('findQuote', () => {
  it('matches across a paragraph break by ignoring whitespace on both sides', () => {
    const article = makeArticle();
    // What `Selection.toString()` produces for a cross-paragraph selection.
    const selected = '第三声。\n年轻的图书管理员';
    const docText = collectTextSegments(article);
    const first = findQuote(docText, selected)[0];
    expect(first).toBeDefined();
    // The range still points at the real text, block separator and all.
    expect(docText.text.slice(first!.start, first!.end)).toBe('第三声。年轻的图书管理员');
    article.remove();
  });

  it('reports every occurrence with its surrounding context', () => {
    const article = makeArticle('<p>他不说话。中间。他不说话。</p>');
    const matches = findQuote(collectTextSegments(article), '他不说话。');
    expect(matches).toHaveLength(2);
    expect(matches[0]!.start).toBe(0);
    expect(matches[1]!.before).toContain('中间。');
    article.remove();
  });

  it('returns nothing for an empty or absent quote', () => {
    const docText = collectTextSegments(makeArticle());
    expect(findQuote(docText, '   ')).toEqual([]);
    expect(findQuote(docText, '不存在的句子')).toEqual([]);
  });
});

describe('findAnchoredQuote', () => {
  it('uses the surrounding context to pick between identical sentences', () => {
    const article = makeArticle('<p>前文甲。他不说话。后文甲。</p><p>前文乙。他不说话。后文乙。</p>');
    const docText = collectTextSegments(article);

    const second = findAnchoredQuote(docText, {
      quote: '他不说话。',
      prefix: '前文乙。',
      suffix: '后文乙。',
    });
    expect(second).not.toBeNull();
    expect(docText.text.slice(second!.start, second!.end + 4)).toBe('他不说话。后文乙。');

    // A shifted context must still find the quote rather than lose the mark.
    const drifted = findAnchoredQuote(docText, { quote: '他不说话。', prefix: '完全不匹配' });
    expect(drifted).not.toBeNull();
    article.remove();
  });
});

describe('wrapTextRange / unwrapMarks', () => {
  it('wraps a slice inside one text node without touching its neighbours', () => {
    const article = makeArticle('<p>灯塔在雾中摇曳</p>');
    const docText = collectTextSegments(article);
    const marks = wrapTextRange(docText, { start: 2, end: 5 }, 'mk');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe('在雾中');
    expect(article.textContent).toBe('灯塔在雾中摇曳');
    expect(article.querySelectorAll('mark.mk')).toHaveLength(1);
    article.remove();
  });

  it('creates one mark per text node the range crosses', () => {
    const article = makeArticle('<p>甲组</p><p>乙组</p>');
    const docText = collectTextSegments(article);
    const marks = wrapTextRange(docText, { start: 1, end: 3 }, 'mk');
    expect(marks.map((mark) => mark.textContent)).toEqual(['组', '乙']);
    expect(article.textContent).toBe('甲组乙组');
    article.remove();
  });

  it('restores plain text and normalizes, so a repaint sees the same offsets', () => {
    const article = makeArticle('<p>灯塔在雾中摇曳</p>');
    const before = collectTextSegments(article);
    wrapTextRange(before, { start: 2, end: 5 }, 'mk');
    unwrapMarks(article, 'mk');
    const after = collectTextSegments(article);
    expect(article.querySelectorAll('mark.mk')).toHaveLength(0);
    expect(after.text).toBe(before.text);
    expect(after.segments.map((s) => [s.start, s.end])).toEqual(
      before.segments.map((s) => [s.start, s.end]),
    );
    // Repainting produces the very same mark, so the cycle is stable.
    const again = wrapTextRange(after, { start: 2, end: 5 }, 'mk');
    expect(again[0]!.textContent).toBe('在雾中');
    article.remove();
  });
});

describe('textRangeOfDomRange', () => {
  it('maps a DOM range onto concatenated-text offsets', () => {
    const article = makeArticle('<p>灯塔在雾中摇曳</p><p>钟楼敲响了第三声</p>');
    const textNodes = Array.from(article.querySelectorAll('p')).map((p) => p.firstChild as Text);
    const range = document.createRange();
    range.setStart(textNodes[0]!, 2);
    range.setEnd(textNodes[1]!, 3);

    const docText = collectTextSegments(article);
    const mapped = textRangeOfDomRange(docText, range);
    expect(mapped).not.toBeNull();
    expect(docText.text.slice(mapped!.start, mapped!.end)).toBe('在雾中摇曳钟楼敲');
    article.remove();
  });

  it('falls back to the inner text when a range endpoint is an element', () => {
    const article = makeArticle('<p>甲</p><p>乙丙</p>');
    const paragraphs = article.querySelectorAll('p');
    const range = document.createRange();
    range.setStart(paragraphs[0]!, 0);
    range.setEnd(paragraphs[1]!, 0);

    const docText = collectTextSegments(article);
    const mapped = textRangeOfDomRange(docText, range);
    expect(mapped).toEqual({ start: 0, end: 1 });
    article.remove();
  });

  it('rejects a collapsed range', () => {
    const article = makeArticle('<p>灯塔</p>');
    const node = article.querySelector('p')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 1);
    range.setEnd(node, 1);
    expect(textRangeOfDomRange(collectTextSegments(article), range)).toBeNull();
    article.remove();
  });
});

describe('injectStyleOnce', () => {
  it('injects by id exactly once', () => {
    injectStyleOnce(document, 'mk-style', 'mark.mk { color: red; }');
    injectStyleOnce(document, 'mk-style', 'mark.mk { color: blue; }');
    const styles = document.querySelectorAll('style#mk-style');
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toContain('red');
  });
});
