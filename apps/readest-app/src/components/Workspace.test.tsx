import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import Workspace from './Workspace';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { DEMO_BOOK } from '@/services/reader/demoBook';

const sidebarState = () => useAISidebarStore.getState();

beforeEach(() => {
  useAISidebarStore.setState({ expanded: false, width: 400, activeTab: 'summary' });
});

const expand = () => fireEvent.click(screen.getByRole('button', { name: '切换 AI 侧边栏' }));

describe('Workspace split-screen shell', () => {
  it('renders the header with the loaded book title and keeps the sidebar collapsed', () => {
    render(<Workspace />);
    expect(screen.getByText(DEMO_BOOK.title)).toBeTruthy();
    expect(screen.getByTestId('reader-pane')).toBeTruthy();
    expect(screen.queryByTestId('ai-sidebar')).toBeNull();
    expect(screen.queryByTestId('summary-tab-panel')).toBeNull();
  });

  it('shows and hides the sidebar via the header toggle button', () => {
    render(<Workspace />);
    expand();
    expect(screen.getByTestId('ai-sidebar')).toBeTruthy();
    expect(screen.getByTestId('summary-tab-panel')).toBeTruthy();
    expect(screen.getByTestId('sidebar-resize-handle')).toBeTruthy();
    expand();
    expect(screen.queryByTestId('ai-sidebar')).toBeNull();
  });

  it('collapses the sidebar via its close button', () => {
    render(<Workspace />);
    expand();
    fireEvent.click(screen.getByRole('button', { name: '关闭 AI 侧边栏' }));
    expect(screen.queryByTestId('ai-sidebar')).toBeNull();
    expect(sidebarState().expanded).toBe(false);
  });

  it('toggles the sidebar with Ctrl+/ and Cmd+/', () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    expect(sidebarState().expanded).toBe(true);
    fireEvent.keyDown(window, { key: '/', metaKey: true });
    expect(sidebarState().expanded).toBe(false);
    // Plain "/" without modifier must not toggle.
    fireEvent.keyDown(window, { key: '/' });
    expect(sidebarState().expanded).toBe(false);
  });

  it('switches between the summary and chat tabs', () => {
    render(<Workspace />);
    expand();
    expect(screen.getByTestId('summary-tab-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '对话' }));
    expect(screen.getByTestId('chat-tab-panel')).toBeTruthy();
    expect(screen.queryByTestId('summary-tab-panel')).toBeNull();
    expect(sidebarState().activeTab).toBe('chat');
    fireEvent.click(screen.getByRole('tab', { name: '总结' }));
    expect(screen.getByTestId('summary-tab-panel')).toBeTruthy();
    expect(sidebarState().activeTab).toBe('summary');
  });

  it('clamps a left drag past 600px down to the sidebar max width', () => {
    render(<Workspace />);
    expand();
    const handle = screen.getByTestId('sidebar-resize-handle');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(sidebarState().width).toBe(600);
    expect((screen.getByTestId('ai-sidebar') as HTMLElement).style.width).toBe('600px');
  });

  it('clamps a right drag below 320px up to the sidebar min width', () => {
    render(<Workspace />);
    expand();
    const handle = screen.getByTestId('sidebar-resize-handle');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1100 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(sidebarState().width).toBe(320);
  });

  it('applies intermediate drag positions without clamping inside the range', () => {
    render(<Workspace />);
    expand();
    const handle = screen.getByTestId('sidebar-resize-handle');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 700 });
    expect(sidebarState().width).toBe(500);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 750 });
    expect(sidebarState().width).toBe(450);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(sidebarState().width).toBe(450);
  });

  it('opens the AI settings panel from the sidebar header', () => {
    render(<Workspace />);
    expand();
    fireEvent.click(screen.getByRole('button', { name: 'AI 设置' }));
    expect(screen.getByTestId('ai-settings-panel')).toBeTruthy();
  });
});
