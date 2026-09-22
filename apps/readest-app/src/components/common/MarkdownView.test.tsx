import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MarkdownView from './MarkdownView';

describe('MarkdownView', () => {
  it('renders GFM content as rich HTML (headings, lists, code, tables)', () => {
    render(
      <MarkdownView
        data-testid="md"
        content={[
          '## 本章要点',
          '',
          '- **核心**: 雾是叙事的隐喻',
          '- `CFI` 定位章节位置',
          '',
          '| 概念 | 含义 |',
          '| --- | --- |',
          '| 迷雾 | 未知 |',
          '',
          '> 引用原文',
          '',
          '```js',
          'const x = 1;',
          '```',
        ].join('\n')}
      />,
    );

    const md = screen.getByTestId('md');
    expect(md.querySelector('h2')?.textContent).toBe('本章要点');
    expect(md.querySelector('strong')?.textContent).toBe('核心');
    expect(md.querySelector('code')?.textContent).toBe('CFI');
    expect(md.querySelectorAll('li')).toHaveLength(2);
    expect(md.querySelector('blockquote')?.textContent?.trim()).toBe('引用原文');
    expect(md.querySelectorAll('th')).toHaveLength(2);
    expect(md.querySelector('pre code')?.textContent).toContain('const x = 1;');
    // Plain text stays readable: no style tag text leaks into the content.
    expect(md.querySelector('style')).toBeNull();
  });

  it('sanitizes untrusted markup out of the rendered HTML', () => {
    render(
      <MarkdownView
        data-testid="md"
        content={'正常段落\n\n<script>alert(1)</script>\n\n<img src="http://evil/x.png" onerror="alert(2)">'}
      />,
    );

    const md = screen.getByTestId('md');
    expect(md.querySelector('script')).toBeNull();
    expect(md.querySelector('img')).toBeNull(); // external src stripped entirely
  });

  it('keeps plain text verbatim (no markdown syntax, no wrapper noise)', () => {
    render(<MarkdownView data-testid="md" content="雾意味着什么？" />);
    expect(screen.getByTestId('md').textContent).toBe('雾意味着什么？');
  });

  it('shows the streaming cursor only while streaming', () => {
    const { rerender } = render(<MarkdownView data-testid="md" content="正在思考" streaming />);
    expect(screen.getByTestId('md').textContent).toBe('正在思考▍');

    rerender(<MarkdownView data-testid="md" content="正在思考" />);
    expect(screen.getByTestId('md').textContent).toBe('正在思考');
  });
});
