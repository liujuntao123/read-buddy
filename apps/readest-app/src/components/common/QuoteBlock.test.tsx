import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import QuoteBlock, { QUOTE_AUTO_COLLAPSE_CHARS } from './QuoteBlock';

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
    render(<QuoteBlock text="河灯顺流而下" source="第 3 章「河灯迷影」 · 偏移 4,321 字符" testId="q2" />);
    expect(screen.getByTestId('q2').textContent).toContain('第 3 章「河灯迷影」');
    expect(screen.getByTestId('q2').textContent).toContain('偏移 4,321 字符');
  });

  describe('collapsible', () => {
    const triggerOf = (testId: string) =>
      screen.getByTestId(`${testId}-collapsible`).querySelector('.astryx-collapsible-trigger')!;

    it('keeps a short quote open, behind a 「引用原文 · N 字」 trigger', () => {
      render(<QuoteBlock text="河灯顺流而下" source="第 3 章" collapsible testId="qs" />);
      const trigger = triggerOf('qs');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(trigger.textContent).toContain('引用原文');
      expect(trigger.textContent).toContain('6 字');
      // The attribution rides in the trigger so the folded state still cites.
      expect(trigger.textContent).toContain('第 3 章');
    });

    it('folds a long quote by default and expands on click', () => {
      const long = '雾'.repeat(QUOTE_AUTO_COLLAPSE_CHARS + 1);
      render(<QuoteBlock text={long} collapsible testId="ql" />);
      const trigger = triggerOf('ql');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      fireEvent.click(trigger);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      // Folded content stays mounted (display:none), so the text is always there
      // for copy/export; the trigger is what changes.
      expect(screen.getByTestId('ql-content').textContent).toBe(long);
    });

    it('leaves the plain (non-collapsible) block without a trigger', () => {
      render(<QuoteBlock text="河灯顺流而下" testId="qp" />);
      expect(screen.queryByTestId('qp-collapsible')).toBeNull();
      expect(screen.getByTestId('qp').querySelector('.astryx-collapsible-trigger')).toBeNull();
    });
  });
});
