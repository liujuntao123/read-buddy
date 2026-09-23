import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';import SelectionToolbar, {
  computeToolbarPosition,
  TOOLBAR_ESTIMATED_WIDTH,
  TOOLBAR_FLIP_THRESHOLD,
  TOOLBAR_GAP,
  TOOLBAR_HEIGHT,
} from './SelectionToolbar';
import type { QuickAction } from '@/services/chat/quickActions';
import type { TextSelection } from '@/hooks/useTextSelection';

const rect = (top: number, left: number, width: number, height = 20): DOMRect =>
  ({
    top,
    bottom: top + height,
    left,
    right: left + width,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const makeSelection = (text = '被选中的正文片段', top = 300, left = 200): TextSelection => ({
  text,
  rect: rect(top, left, 80),
});

describe('SelectionToolbar', () => {
  it('renders nothing when there is no selection', () => {
    const { container } = render(
      <SelectionToolbar selection={null} onAction={() => {}} onClose={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('selection-toolbar')).toBeNull();
  });

  it('renders the AI quick action buttons with icon labels', () => {
    render(<SelectionToolbar selection={makeSelection()} onAction={() => {}} onClose={() => {}} />);
    const toolbar = screen.getByTestId('selection-toolbar');
    expect(toolbar.getAttribute('role')).toBe('toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe('选区操作');

    const labels = ['解释', '翻译', '追问', '提炼'];
    labels.forEach((label) => {
      const button = screen.getByRole('button', { name: label });
      expect(button.textContent).toContain(label);
      // The app's icon vocabulary is the design system's, not emoji baked into
      // the label (the reader dock, the sidebar header and these buttons now all
      // draw icons the same way).
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    });
    // 划线 is a reader action, not a model action: without a handler there is no
    // button, because there would be nothing to paint into.
    expect(screen.queryByTestId('toolbar-highlight')).toBeNull();
  });

  it('offers 划线 as the first action, handing over the whole selection', () => {
    const onHighlight = vi.fn();
    const selection = makeSelection('油灯与信纸');
    render(
      <SelectionToolbar
        selection={selection}
        onAction={() => {}}
        onHighlight={onHighlight}
        onClose={() => {}}
      />,
    );

    const highlight = screen.getByTestId('toolbar-highlight');
    expect(highlight.textContent).toContain('划线');
    // Marks the text, and keeps the range so the right occurrence is marked.
    fireEvent.click(highlight);
    expect(onHighlight).toHaveBeenCalledWith(selection);
    // The mark sits before the model actions, behind the divider.
    const toolbar = screen.getByTestId('selection-toolbar');
    expect(toolbar.firstElementChild?.contains(highlight)).toBe(true);
  });

  it('invokes onAction with the action id and the selected text for every button', () => {
    const onAction = vi.fn();
    render(<SelectionToolbar selection={makeSelection('油灯与信纸')} onAction={onAction} onClose={() => {}} />);

    const expected: Array<[QuickAction, string]> = [
      ['explain', '油灯与信纸'],
      ['translate', '油灯与信纸'],
      ['ask', '油灯与信纸'],
      ['summarize', '油灯与信纸'],
    ];
    expected.forEach(([action]) => {
      const label = action === 'explain' ? '解释' : action === 'translate' ? '翻译' : action === 'ask' ? '追问' : '提炼';
      fireEvent.click(screen.getByRole('button', { name: label }));
    });
    expect(onAction.mock.calls).toEqual(expected);
  });

  it('centers the toolbar above the selection rect', () => {
    const selection = makeSelection('选中文本', 300, 200);
    render(<SelectionToolbar selection={selection} onAction={() => {}} onClose={() => {}} />);
    const toolbar = screen.getByTestId('selection-toolbar') as HTMLElement;
    expect(toolbar.style.top).toBe(`${300 - TOOLBAR_HEIGHT - TOOLBAR_GAP}px`);
    expect(toolbar.style.left).toBe(`${200 + 80 / 2}px`);
    expect(toolbar.style.transform).toBe('translateX(-50%)');
  });

  it('flips below the selection when it is too close to the viewport top', () => {
    const selection = makeSelection('顶部选区', TOOLBAR_FLIP_THRESHOLD - 10, 200);
    render(<SelectionToolbar selection={selection} onAction={() => {}} onClose={() => {}} />);
    const toolbar = screen.getByTestId('selection-toolbar') as HTMLElement;
    expect(toolbar.style.top).toBe(`${TOOLBAR_FLIP_THRESHOLD - 10 + 20 + TOOLBAR_GAP}px`);
  });

  it('clamps the toolbar inside the viewport on both edges', () => {
    const farLeft = computeToolbarPosition(rect(200, -40, 20), 1024);
    expect(farLeft.left).toBe(TOOLBAR_ESTIMATED_WIDTH / 2 + TOOLBAR_GAP);

    const farRight = computeToolbarPosition(rect(200, 1200, 40), 1024);
    expect(farRight.left).toBe(1024 - TOOLBAR_ESTIMATED_WIDTH / 2 - TOOLBAR_GAP);

    const centered = computeToolbarPosition(rect(200, 400, 100), 1024);
    expect(centered.left).toBe(450);
  });

  it('dismisses via the Escape key', () => {
    const onClose = vi.fn();
    render(<SelectionToolbar selection={makeSelection()} onAction={() => {}} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId('selection-toolbar'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
