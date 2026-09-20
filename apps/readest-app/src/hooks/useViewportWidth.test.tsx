import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPACT_MEDIA_QUERY, useViewportWidth } from './useViewportWidth';

type ChangeListener = (event: { matches: boolean }) => void;

function Probe() {
  const { isCompact } = useViewportWidth();
  return <div data-testid="probe">{isCompact ? 'compact' : 'wide'}</div>;
}

const originalMatchMedia = window.matchMedia;

const listeners = new Set<ChangeListener>();

function mockMatchMedia(matches: boolean) {
  listeners.clear();
  const query = {
    matches,
    media: COMPACT_MEDIA_QUERY,
    onchange: null,
    addEventListener: (_: string, listener: ChangeListener) => listeners.add(listener),
    removeEventListener: (_: string, listener: ChangeListener) => listeners.delete(listener),
    addListener: (listener: ChangeListener) => listeners.add(listener),
    removeListener: (listener: ChangeListener) => listeners.delete(listener),
    dispatchEvent: () => false,
  };
  window.matchMedia = vi.fn().mockReturnValue(query) as unknown as typeof window.matchMedia;
  return query;
}

beforeEach(() => {
  mockMatchMedia(false);
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('useViewportWidth', () => {
  it('queries the <768px breakpoint and mirrors matches=true', () => {
    mockMatchMedia(true);
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('compact');
    expect(window.matchMedia).toHaveBeenCalledWith(COMPACT_MEDIA_QUERY);
  });

  it('stays wide when the viewport is >=768px', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('wide');
  });

  it('starts SSR-safe at false and reacts to breakpoint changes', () => {
    mockMatchMedia(true);
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('compact');
    expect(listeners.size).toBe(1);

    act(() => {
      listeners.forEach((listener) => listener({ matches: false }));
    });
    expect(screen.getByTestId('probe').textContent).toBe('wide');
    act(() => {
      listeners.forEach((listener) => listener({ matches: true }));
    });
    expect(screen.getByTestId('probe').textContent).toBe('compact');
  });

  it('removes its change listener on unmount', () => {
    mockMatchMedia(true);
    const { unmount } = render(<Probe />);
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('stays wide when matchMedia is unavailable', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('wide');
  });
});
