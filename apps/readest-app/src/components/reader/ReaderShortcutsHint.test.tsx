import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ReaderShortcutsHint from './ReaderShortcutsHint';

/**
 * 阅读区底边的快捷键提示：说的是「按键做什么」，动词跟着阅读模式走——双页是翻页，
 * 单页/TXT 是滚动。一行小字，四项：方向键、空格、Esc、Ctrl + /。
 */
const row = () => screen.getByTestId('reader-shortcuts');

describe('ReaderShortcutsHint', () => {
  it('names every shortcut once, with its key cap', () => {
    render(<ReaderShortcutsHint mode="page" />);

    // 只有键帽 + 动作，没有「快捷键」之类的栏目标题——这行字自己说明自己。
    expect(row().textContent).not.toContain('快捷键');
    expect(screen.getByTestId('shortcut-keys-turn').textContent).toBe('← →');
    expect(screen.getByTestId('shortcut-keys-forward').textContent).toBe('空格');
    expect(screen.getByTestId('shortcut-keys-escape').textContent).toBe('Esc');
    expect(screen.getByTestId('shortcut-keys-companion').textContent).toBe('Ctrl + /');

    // The three non-page-turn actions read the same in both modes.
    expect(screen.getByTestId('shortcut-label-escape').textContent).toBe('关闭工具条');
    expect(screen.getByTestId('shortcut-label-companion').textContent).toBe('伴读侧栏');
  });

  it('says 翻页 in 双页 and 滚动 in 单页 — the same keys do different things', () => {
    const { rerender } = render(<ReaderShortcutsHint mode="page" />);
    expect(screen.getByTestId('shortcut-label-turn').textContent).toBe('翻页');
    expect(screen.getByTestId('shortcut-label-forward').textContent).toBe('下翻');

    rerender(<ReaderShortcutsHint mode="scroll" />);
    expect(screen.getByTestId('shortcut-label-turn').textContent).toBe('滚动');
    expect(screen.getByTestId('shortcut-label-forward').textContent).toBe('向下滚动');
  });
});
