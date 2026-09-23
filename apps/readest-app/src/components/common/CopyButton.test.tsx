import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CopyButton, { COPY_FEEDBACK_MS } from './CopyButton';

const setClipboard = (writeText: ReturnType<typeof vi.fn> | undefined) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  });
};

/** Click, then let the clipboard promise settle with fake timers installed. */
const clickAndSettle = async (element: HTMLElement) => {
  fireEvent.click(element);
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setClipboard(undefined);
});

describe('CopyButton', () => {
  it('resolves the text on click, not on render', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const getText = vi.fn(() => '迟到的文本');

    render(<CopyButton getText={getText} label="复制回答" testId="copy" />);
    expect(getText).not.toHaveBeenCalled();

    await clickAndSettle(screen.getByTestId('copy'));
    expect(writeText).toHaveBeenCalledWith('迟到的文本');
    expect(getText).toHaveBeenCalledTimes(1);
  });

  it('shows 「已复制」 on a labelled button and reverts after the feedback window', async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    render(<CopyButton getText={() => '对话全文'} label="复制对话" isIconOnly={false} testId="copy" />);

    const button = screen.getByTestId('copy');
    expect(button.textContent).toBe('复制对话');
    expect(screen.queryByText('已复制')).toBeNull();

    await clickAndSettle(button);
    expect(button.textContent).toBe('已复制');
    // The accessible name stays the action, so AT never loses the button.
    expect(screen.getByRole('button', { name: '复制对话' })).toBe(button);

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });
    expect(button.textContent).toBe('复制对话');
  });

  it('marks the copied state on an icon-only button for hover-revealed actions', async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    render(
      <CopyButton getText={() => '回答正文'} label="复制回答" showCopiedText testId="copy" />,
    );

    const button = screen.getByTestId('copy');
    const wrapper = screen.getByTestId('copy-feedback');
    expect(wrapper.getAttribute('data-copied')).toBe('false');
    expect(screen.queryByText('已复制')).toBeNull();

    await clickAndSettle(button);
    expect(wrapper.getAttribute('data-copied')).toBe('true');
    // The tooltip also carries the word, so assert on the visible text node.
    expect(wrapper.textContent).toContain('已复制');
    // The icon-only button's name follows the state, so AT hears the result.
    expect(screen.getByRole('button', { name: '已复制' })).toBe(button);
  });

  it('never claims success when the clipboard write fails', async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    document.execCommand = vi.fn().mockReturnValue(false);
    render(<CopyButton getText={() => 'x'} label="复制回答" showCopiedText testId="copy" />);

    await clickAndSettle(screen.getByTestId('copy'));
    expect(screen.getByTestId('copy-feedback').getAttribute('data-copied')).toBe('false');
    expect(screen.getByTestId('copy-feedback').textContent).not.toContain('已复制');
  });
});
