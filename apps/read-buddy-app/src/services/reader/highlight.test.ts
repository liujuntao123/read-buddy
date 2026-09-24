import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_CLASS, clearHighlights, highlightSnippet, injectHighlightStyles } from './highlight';

const makeArticle = (): HTMLElement => {
  const article = document.createElement('article');
  article.innerHTML = [
    '<p>灯塔在雾中摇曳，古老的钟楼敲响了第三声。</p>',
    '<p>年轻的图书管理员林晚背着油灯走进南门。</p>',
    '<p>她手里攥着一封没有署名的信。</p>',
  ].join('');
  document.body.appendChild(article);
  return article;
};

describe('highlightSnippet', () => {
  it('wraps the quoted snippet in breathing marks and injects styles once', () => {
    const article = makeArticle();
    const found = highlightSnippet(article, '古老的钟楼敲响了第三声');
    expect(found).toBe(true);

    const marks = article.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`);
    expect(marks.length).toBe(1);
    expect(marks[0]!.textContent).toBe('古老的钟楼敲响了第三声');
    // Keyframes injected exactly once.
    expect(document.querySelectorAll('style#read-buddy-agent-highlight-style').length).toBe(1);
    expect(document.getElementById('read-buddy-agent-highlight-style')?.textContent).toContain(
      'read-buddy-agent-breathe',
    );
    injectHighlightStyles(document);
    expect(document.querySelectorAll('style#read-buddy-agent-highlight-style').length).toBe(1);
    document.body.removeChild(article);
  });

  it('highlights snippets spanning multiple text nodes/paragraphs', () => {
    const article = makeArticle();
    const found = highlightSnippet(article, '油灯走进南门。她手里攥着一封');
    expect(found).toBe(true);
    const marks = article.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`);
    expect(marks.length).toBe(2);
    document.body.removeChild(article);
  });

  it('falls back to a prefix match when the full quote drifts', () => {
    const article = makeArticle();
    // Model quote carries extra cleaned-away punctuation drift at the end.
    const found = highlightSnippet(article, '年轻的图书管理员林晚背着油灯——（模型转述）');
    expect(found).toBe(true);
    expect(article.querySelector(`mark.${HIGHLIGHT_CLASS}`)?.textContent).toContain('年轻的图书管理员');
    document.body.removeChild(article);
  });

  it('reports false and clears previous marks for unfindable snippets', () => {
    const article = makeArticle();
    expect(highlightSnippet(article, '不存在的句子xyz')).toBe(false);
    highlightSnippet(article, '古老的钟楼');
    expect(article.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`).length).toBe(1);
    expect(highlightSnippet(article, '彻底不存在的引文')).toBe(false);
    // A failed re-highlight clears the stale marks.
    expect(article.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`).length).toBe(0);
    document.body.removeChild(article);
  });

  it('clearHighlights restores plain text', () => {
    const article = makeArticle();
    highlightSnippet(article, '古老的钟楼敲响了第三声');
    clearHighlights(article);
    expect(article.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`).length).toBe(0);
    expect(article.textContent).toContain('灯塔在雾中摇曳，古老的钟楼敲响了第三声。');
    document.body.removeChild(article);
  });
});
