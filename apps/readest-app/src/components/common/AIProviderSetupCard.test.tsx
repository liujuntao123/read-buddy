import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import AIProviderSetupCard, { AI_SETUP_DESCRIPTION } from './AIProviderSetupCard';
import { useAISidebarStore } from '@/store/aiSidebarStore';

/**
 * The card's whole job is the hand-off to the settings panel, so the assertions
 * are: it says what the companion does, and clicking the button opens settings
 * without touching a model (ADR 0004).
 */
beforeEach(() => {
  useAISidebarStore.setState({ settingsOpen: false });
});

describe('AIProviderSetupCard', () => {
  it('explains the capability in one sentence and offers the settings action', () => {
    render(<AIProviderSetupCard />);

    const card = screen.getByTestId('ai-provider-setup');
    expect(card.textContent).toContain('先配置一个 AI 模型');
    expect(card.textContent).toContain(AI_SETUP_DESCRIPTION);
    expect(screen.getByTestId('ai-provider-setup-button').textContent).toContain('配置 AI 模型');
  });

  it('opens the AI settings panel on click', () => {
    render(<AIProviderSetupCard testId="setup" />);

    fireEvent.click(screen.getByTestId('setup-button'));

    expect(useAISidebarStore.getState().settingsOpen).toBe(true);
  });

  it('accepts a per-tab sentence', () => {
    render(<AIProviderSetupCard description="为当前节点生成三段式总结。" testId="setup" />);
    expect(screen.getByTestId('setup').textContent).toContain('为当前节点生成三段式总结。');
  });
});
