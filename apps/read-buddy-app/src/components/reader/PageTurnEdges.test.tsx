import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PageTurnEdges from './PageTurnEdges';

describe('PageTurnEdges', () => {
  it('shows only the edge under the pointer', () => {
    const { rerender } = render(<PageTurnEdges edge={null} onPrev={() => {}} onNext={() => {}} />);
    const prev = screen.getByTestId('page-turn-prev').closest('.reader-page-edge')!;
    const next = screen.getByTestId('page-turn-next').closest('.reader-page-edge')!;
    expect(prev.getAttribute('data-visible')).toBe('false');
    expect(next.getAttribute('data-visible')).toBe('false');

    rerender(<PageTurnEdges edge="prev" onPrev={() => {}} onNext={() => {}} />);
    expect(prev.getAttribute('data-visible')).toBe('true');
    expect(next.getAttribute('data-visible')).toBe('false');

    rerender(<PageTurnEdges edge="next" onPrev={() => {}} onNext={() => {}} />);
    expect(prev.getAttribute('data-visible')).toBe('false');
    expect(next.getAttribute('data-visible')).toBe('true');
  });

  it('turns the page in the direction of the control that was clicked', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<PageTurnEdges edge="next" onPrev={onPrev} onNext={onNext} />);

    fireEvent.click(screen.getByTestId('page-turn-next'));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('page-turn-prev'));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });
});
