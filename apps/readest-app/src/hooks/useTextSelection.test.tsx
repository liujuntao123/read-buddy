import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useTextSelection } from './useTextSelection';

function Probe() {
  const ref = useRef<HTMLDivElement | null>(null);
  const { selection, close, reset } = useTextSelection(ref);
  return (
    <div ref={ref} data-testid="container">
      <p data-testid="inside">图书馆的木门在她身后合上时，穹顶上的星图亮了起来。</p>
      <output data-testid="state">{selection ? selection.text : 'none'}</output>
      <button type="button" data-testid="close" onClick={close}>
        close
      </button>
      <button type="button" data-testid="reset" onClick={reset}>
        reset
      </button>
    </div>
  );
}

const selectNodeContents = (element: Node | null) => {
  const range = document.createRange();
  range.selectNodeContents(element as Node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const state = () => screen.getByTestId('state').textContent;

describe('useTextSelection', () => {
  it('captures an in-container selection on mouseup', () => {
    render(<Probe />);
    selectNodeContents(screen.getByTestId('inside').firstChild);
    fireEvent.mouseUp(document);
    expect(state()).toBe('图书馆的木门在她身后合上时，穹顶上的星图亮了起来。');
  });

  it('captures a keyboard-made selection on keyup', () => {
    render(<Probe />);
    selectNodeContents(screen.getByTestId('inside').firstChild);
    fireEvent.keyUp(document, { key: 'Shift' });
    expect(state()).not.toBe('none');
  });

  it('ignores selections anchored outside the container', () => {
    render(
      <div>
        <Probe />
        <p data-testid="outside">这一段不在阅读容器内，不应唤起工具栏。</p>
      </div>,
    );
    selectNodeContents(screen.getByTestId('outside').firstChild);
    fireEvent.mouseUp(document);
    expect(state()).toBe('none');
  });

  it('rejects selections shorter than two characters after trimming', () => {
    render(<Probe />);
    const textNode = screen.getByTestId('inside').firstChild as Node;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 1); // a single character
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(document);
    expect(state()).toBe('none');
  });

  it('hides again once the selection collapses (blank click)', () => {
    render(<Probe />);
    selectNodeContents(screen.getByTestId('inside').firstChild);
    fireEvent.mouseUp(document);
    expect(state()).not.toBe('none');

    act(() => {
      window.getSelection()?.removeAllRanges();
    });
    fireEvent.mouseUp(document);
    expect(state()).toBe('none');
  });

  it('close() hides the toolbar but keeps the native selection', () => {
    render(<Probe />);
    selectNodeContents(screen.getByTestId('inside').firstChild);
    fireEvent.mouseUp(document);

    fireEvent.click(screen.getByTestId('close'));
    expect(state()).toBe('none');
    expect(window.getSelection()?.toString()).not.toBe('');
  });

  it('reset() hides the toolbar and clears the native selection', () => {
    render(<Probe />);
    selectNodeContents(screen.getByTestId('inside').firstChild);
    fireEvent.mouseUp(document);

    fireEvent.click(screen.getByTestId('reset'));
    expect(state()).toBe('none');
    expect(window.getSelection()?.toString()).toBe('');
  });
});
