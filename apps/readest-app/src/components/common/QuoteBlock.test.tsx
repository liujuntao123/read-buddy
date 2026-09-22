import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import QuoteBlock from './QuoteBlock';

describe('QuoteBlock', () => {
  it('renders the quoted text as markdown inside the quote treatment', () => {
    render(<QuoteBlock text={'物理学不存在了——**主旨句**'} testId="q" />);
    expect(screen.getByTestId('q')).toBeTruthy();
    const content = screen.getByTestId('q-content');
    expect(content.textContent).toContain('物理学不存在了');
    // Markdown is parsed, not shown raw: the strong tag replaces the asterisks.
    expect(content.querySelector('strong')?.textContent).toBe('主旨句');
    expect(content.textContent).not.toContain('**');
  });

  it('shows the source attribution when provided', () => {
    render(<QuoteBlock text="河灯顺流而下" source="第 3 章《河灯迷影》 · 偏移 4,321 字符" testId="q2" />);
    expect(screen.getByTestId('q2').textContent).toContain('第 3 章《河灯迷影》');
    expect(screen.getByTestId('q2').textContent).toContain('偏移 4,321 字符');
  });
});
