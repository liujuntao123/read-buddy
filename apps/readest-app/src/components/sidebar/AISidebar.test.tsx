import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AISidebar from './AISidebar';
import Workspace from '@/components/Workspace';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { DEFAULT_AI_SETTINGS } from '@/types/ai';

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
  useLibraryStore.setState({ view: 'shelf', currentHash: null });
  useAISettingsStore.setState({
    settings: { ...DEFAULT_AI_SETTINGS, provider: 'deepseek', apiKey: 'sk-test', model: 'deepseek-chat' },
  });
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

    const sidebar = screen.getByTestId('ai-sidebar');
    expect(sidebar.getAttribute('data-mode')).toBe('inline');
    expect((sidebar as HTMLElement).style.width).toBe('400px');
    expect(screen.getByTestId('sidebar-resize-handle')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-overlay')).toBeNull();
  });

  it('renders as a fixed overlay drawer below 768px', () => {
    mockMatchMedia(true);
    useAISidebarStore.setState({ expanded: true });
    render(<AISidebar />);

    const sidebar = screen.getByTestId('ai-sidebar');
    expect(sidebar.getAttribute('data-mode')).toBe('drawer');
    // Drawer is fixed-width (86vw, capped at 400px) with no drag handle.
    expect((sidebar as HTMLElement).style.width).toBe('86vw');
    expect(screen.queryByTestId('sidebar-resize-handle')).toBeNull();

    const overlay = screen.getByTestId('sidebar-overlay');
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
    expect(screen.getByTestId('ai-sidebar').getAttribute('data-mode')).toBe('drawer');
    first.unmount();

    mockMatchMedia(false);
    render(<AISidebar />);
    expect(screen.getByTestId('ai-sidebar').getAttribute('data-mode')).toBe('inline');
    expect(screen.queryByTestId('sidebar-overlay')).toBeNull();
  });

  it('keeps the main pane full-width beside the drawer inside the Workspace shell', () => {
    mockMatchMedia(true);
    render(<Workspace />);

    fireEvent.click(screen.getByRole('button', { name: '切换 AI 侧边栏' }));
    expect(screen.getByTestId('ai-sidebar').getAttribute('data-mode')).toBe('drawer');
    expect(screen.getByTestId('sidebar-overlay')).toBeTruthy();
    // Ticket 06: startup lands on the bookshelf (flex-filled main pane, no
    // auto-loaded demo book any more); the reader fills the same slot once a
    // library book is opened.
    const mainPane = screen.getByTestId('bookshelf') as HTMLElement;
    expect(mainPane.style.flex).toContain('1');
    expect(screen.queryByTestId('reader-pane')).toBeNull();
    // The theme switch from ticket 05 lives in the header beside the toggle.
    expect(screen.getByTestId('theme-toggle')).toBeTruthy();
  });

  it('keeps the inline split layout on a wide Workspace viewport', () => {
    mockMatchMedia(false);
    render(<Workspace />);

    fireEvent.click(screen.getByRole('button', { name: '切换 AI 侧边栏' }));
    expect(screen.getByTestId('ai-sidebar').getAttribute('data-mode')).toBe('inline');
    expect(screen.queryByTestId('sidebar-overlay')).toBeNull();
  });

  it('displays empty state when on bookshelf view (view === "shelf")', () => {
    mockMatchMedia(false);
    useAISidebarStore.setState({ expanded: true });
    // Default libraryStore state starts with view === 'shelf'
    render(<AISidebar />);

    expect(screen.getByTestId('sidebar-shelf-empty')).toBeTruthy();
    expect(screen.getByText('未打开书籍')).toBeTruthy();
    expect(screen.getByText(/打开书籍后，可在此查看章节总结与 AI 伴读/)).toBeTruthy();
  });

  it('reports the shared model at the tab level, for both tabs', () => {
    mockMatchMedia(false);
    useAISidebarStore.setState({ expanded: true });
    useLibraryStore.setState({ view: 'reader', currentHash: 'demo-book' });
    render(<AISidebar />);

    const chip = screen.getByTestId('sidebar-model-chip');
    expect(chip.textContent).toBe('deepseek-chat');
    // Header level: the tabs and the chip first meet at a row that is not a tab
    // panel, so switching 总结 ↔ 伴读 neither hides nor duplicates it.
    let row: HTMLElement | null = screen.getByRole('tablist');
    while (row && !row.contains(chip)) row = row.parentElement;
    expect(row).not.toBeNull();
    expect(row!.closest('[role="tabpanel"]')).toBeNull();
    expect(screen.getByRole('tabpanel').contains(chip)).toBe(false);
  });

  it('says the provider is unconfigured instead of naming an unusable model', () => {
    mockMatchMedia(false);
    useAISidebarStore.setState({ expanded: true });
    useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } }); // no API key
    render(<AISidebar />);

    expect(screen.getByTestId('sidebar-model-chip').textContent).toBe('未配置模型');
  });
});
