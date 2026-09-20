import { describe, expect, it } from 'vitest';
import { DEMO_BOOK } from './demoBook';
import { extractChapterText, extractPlainTextForPrompt } from './extractor';

describe('extractChapterText', () => {
  it('strips style/img nodes and keeps paragraphs newline-separated', () => {
    const { title, text } = extractChapterText(DEMO_BOOK.sections[0]!.html);

    expect(title).toBe('第一章 迷雾之城');
    expect(text).not.toContain('color: red');
    expect(text).not.toContain('fog-city.png');
    expect(text).not.toContain('迷雾之城插画'); // img alt text is dropped with the node

    const lines = text.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toBe('第一章 迷雾之城');
    expect(lines[1]).toContain('灯火在雾中摇曳');
    // Inline whitespace collapsed, no double newlines anywhere.
    expect(text).not.toMatch(/\n{2,}/);
    expect(text).not.toMatch(/[ \t]{2,}/);
  });

  it('normalizes the long demo chapter and reports a matching charCount', () => {
    const { title, text, charCount } = extractChapterText(DEMO_BOOK.sections[2]!.html);

    expect(title).toBe('第三章 长夜漫漫');
    expect(text).toContain('长夜第1节');
    expect(charCount).toBe(text.length);
    // h1 + 120 <p> blocks, each on its own line.
    expect(text.split('\n').length).toBe(121);
  });

  it('returns an empty title when no h1~h6 exists', () => {
    const { title } = extractChapterText('<p>只有正文段落。</p>');
    expect(title).toBe('');
  });

  it('removes script/iframe/noscript/svg content', () => {
    const html = [
      '<h2>标题</h2>',
      '<script>var danger = "应被剥离";</script>',
      '<iframe src="http://example.com"></iframe>',
      '<noscript>无脚本提示</noscript>',
      '<svg><text>矢量图形文字</text></svg>',
      '<p>正文。</p>',
    ].join('');
    const { text } = extractChapterText(html);
    expect(text.split('\n')).toEqual(['标题', '正文。']);
  });

  it('joins list items and blockquotes as separate lines', () => {
    const html = '<h3>列表章</h3><ul><li>其一</li><li>其二</li></ul><blockquote>引文一句</blockquote>';
    expect(extractChapterText(html).text.split('\n')).toEqual([
      '列表章',
      '其一',
      '其二',
      '引文一句',
    ]);
  });
});

describe('extractPlainTextForPrompt', () => {
  it('returns short text unchanged', () => {
    expect(extractPlainTextForPrompt('短文本')).toBe('短文本');
  });

  it('truncates oversized text and appends an ellipsis marker', () => {
    const long = '字'.repeat(300);
    const result = extractPlainTextForPrompt(long, 100);
    expect(result.startsWith(long.slice(0, 100))).toBe(true);
    expect(result.length).toBeGreaterThan(100);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain('已截断');
    expect(result).toContain('300');
  });

  it('uses the default budget when maxChars is omitted', () => {
    const long = 'a'.repeat(20_000);
    const result = extractPlainTextForPrompt(long);
    expect(result.length).toBeLessThan(long.length);
    expect(result.slice(0, 12_000)).toBe(long.slice(0, 12_000));
    expect(result).toContain('已截断');
  });
});
