'use client';

import { useCallback } from 'react';
import { buildQuickActionPrompt, type QuickAction } from '@/services/chat/quickActions';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useChatStore } from '@/store/chatStore';

/**
 * Selection AI quick action (design doc 4.4.3, ADR 0007), shared by the
 * scroll reader (ReaderPane) and the Foliate engine pane (ticket 07).
 *
 * Always expands the sidebar onto the chat tab; `ask` only fills the quote
 * draft (the user types the question), the others send a preset prompt with
 * the selection quoted in the bubble. `dismiss` clears the caller's toolbar
 * / native highlight afterwards (无残留).
 */
export type QuickActionRunner = (
  action: QuickAction,
  text: string,
  dismiss: () => void,
) => void;

export function useQuickActions(): QuickActionRunner {
  return useCallback((action, text, dismiss) => {
    const sidebar = useAISidebarStore.getState();
    if (!sidebar.expanded) sidebar.setExpanded(true);
    sidebar.setActiveTab('chat');

    if (action === 'ask') {
      useChatStore.getState().setQuoteDraft(text);
      // Progressive enhancement: ChatTab also focuses its composer when the
      // quote draft arrives (it may not be mounted yet at this instant).
      window.dispatchEvent(new CustomEvent('readest-plus:focus-chat-input'));
    } else {
      void useChatStore.getState().send(buildQuickActionPrompt(action, text).prompt, text);
    }
    dismiss();
  }, []);
}
