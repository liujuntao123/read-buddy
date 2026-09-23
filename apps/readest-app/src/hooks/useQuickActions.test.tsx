import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQuickActions } from './useQuickActions';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useChatStore } from '@/store/chatStore';

/**
 * Ticket 07: the quick-action logic was extracted from ReaderPane into this
 * shared hook (ReaderPane keeps its own integration tests); these cover the
 * hook contract directly.
 */
describe('useQuickActions', () => {
  beforeEach(() => {
    useAISidebarStore.setState({ expanded: false, width: 400, activeTab: 'summary' });
    useChatStore.setState({ quoteDraft: null });
  });

  it('ask fills the quote draft, expands the chat sidebar and dismisses', () => {
    const focusListener = vi.fn();
    window.addEventListener('readest-plus:focus-chat-input', focusListener);
    const sendSpy = vi.spyOn(useChatStore.getState(), 'send').mockResolvedValue(undefined);
    const dismiss = vi.fn();

    const { result } = renderHook(() => useQuickActions());
    result.current('ask', '星图亮了起来', dismiss);

    expect(useChatStore.getState().quoteDraft).toBe('星图亮了起来');
    expect(useAISidebarStore.getState().expanded).toBe(true);
    expect(useAISidebarStore.getState().activeTab).toBe('chat');
    expect(focusListener).toHaveBeenCalledTimes(1);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalledTimes(1);

    window.removeEventListener('readest-plus:focus-chat-input', focusListener);
    sendSpy.mockRestore();
  });

  it('explain sends the instruction with the selection as quote only', () => {
    const sendSpy = vi.spyOn(useChatStore.getState(), 'send').mockResolvedValue(undefined);
    const dismiss = vi.fn();

    const { result } = renderHook(() => useQuickActions());
    result.current('explain', '灯火在雾中摇曳', dismiss);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [instruction, quote] = sendSpy.mock.calls[0]!;
    expect(instruction).toContain('请解释');
    // The passage is the quote, never repeated inside the message body — the
    // bubble would otherwise show it a second time below the quote block.
    expect(instruction).not.toContain('灯火在雾中摇曳');
    expect(quote).toBe('灯火在雾中摇曳');
    expect(useAISidebarStore.getState().activeTab).toBe('chat');
    expect(dismiss).toHaveBeenCalledTimes(1);
    sendSpy.mockRestore();
  });
});
