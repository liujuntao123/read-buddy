import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AISidebar from './AISidebar';
import Workspace from '@/components/Workspace';
import { useAISidebarStore } from '@/store/aiSidebarStore';

const originalMatchMedia = window.matchMedia;

function mockMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  mockMatchMedia(false);
  useAISidebarStore.setState({ expanded: false, width: 400, activeTab: 'summary' });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe('AISidebar responsive drawer mode', () => {
  it('renders the inline split pane with drag handle on wide viewports', () => {
    mockMatchMedia(false);
    useAISidebarStore.setState({ expanded: true });
    render(<AISidebar />);

    const sidebar = screen.getByTestId('ai-sidebar') as HTMLElement;
    expect(sidebar.classList.contains('fixed')).toBe(false);
    expect(sidebar.classList.contains('relative')).toBe(true);
    expect(sidebar.style.width).toBe('400px');
    expect(screen.getByTestId('sidebar-resize-handle')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-overlay')).toBeNull();
  });

  it('renders as a fixed overlay drawer below 768px', () => {
    mockMatchMedia(true);
    useAISidebarStore.setState({ expanded: true });
    render(<AISidebar />);

    const sidebar = screen.getByTestId('ai-sidebar') as HTMLElement;
    expect(sidebar.classList.contains('fixed')).toBe(true);
    expect(sidebar.className).toContain('w-[86vw]');
    expect(sidebar.className).toContain('max-w-[400px]');
    expect(sidebar.className).toContain('transition-transform');
    // Drawer is fixed-width: no inline width and no drag handle.
    expect(sidebar.style.width).toBe('');
    expect(screen.queryByTestId('sidebar-resize-handle')).toBeNull();

    const overlay = screen.getByTestId('sidebar-overlay');
    expect(overlay.className).toContain('bg-black/40');
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
  });

  it('closes the drawer through the backdrop click', () => {
    mockMatchMedia(true);
    useAISidebarStore.setState({ expanded: true });
    render(<AISidebar />);

    fireEvent.click(screen.getByTestId('sidebar-overlay'));
    expect(useAISidebarStore.getState().expanded).toBe(false);
    expect(screen.queryByTestId('ai-sidebar')).toBeNull();
  });

  it('renders nothing while collapsed regardless of viewport', () => {
    mockMatchMedia(true);
    render(<AISidebar />);
    expect(screen.queryByTestId('ai-sidebar')).toBeNull();
    expect(screen.queryByTestId('sidebar-overlay')).toBeNull();
  });

  it('switches between drawer and inline modes when the breakpoint changes', () => {
    mockMatchMedia(true);
    useAISidebarStore.setState({ expanded: true });
    const first = render(<AISidebar />);
    expect(screen.getByTestId('ai-sidebar').classList.contains('fixed')).toBe(true);
    first.unmount();

    mockMatchMedia(false);
    render(<AISidebar />);
    expect(screen.getByTestId('ai-sidebar').classList.contains('fixed')).toBe(false);
    expect(screen.queryByTestId('sidebar-overlay')).toBeNull();
  });

  it('keeps the reader full-width beside the drawer inside the Workspace shell', () => {
    mockMatchMedia(true);
    render(<Workspace />);

    fireEvent.click(screen.getByRole('button', { name: '切换 AI 侧边栏' }));
    expect(screen.getByTestId('ai-sidebar').classList.contains('fixed')).toBe(true);
    expect(screen.getByTestId('sidebar-overlay')).toBeTruthy();
    // The reader pane stays in normal flow and keeps its flex fill.
    const reader = screen.getByTestId('reader-pane') as HTMLElement;
    expect(reader.className).toContain('flex-1');
    expect(screen.getByTestId('reader-article')).toBeTruthy();
    // The theme switch from ticket 05 lives in the header beside the toggle.
    expect(screen.getByTestId('theme-toggle')).toBeTruthy();
  });

  it('keeps the inline split layout on a wide Workspace viewport', () => {
    mockMatchMedia(false);
    render(<Workspace />);

    fireEvent.click(screen.getByRole('button', { name: '切换 AI 侧边栏' }));
    expect(screen.getByTestId('ai-sidebar').classList.contains('fixed')).toBe(false);
    expect(screen.queryByTestId('sidebar-overlay')).toBeNull();
  });
});
