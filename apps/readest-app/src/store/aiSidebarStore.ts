import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AISidebarTab = 'summary' | 'chat';

export const SIDEBAR_MIN_WIDTH = 320;
export const SIDEBAR_MAX_WIDTH = 600;
export const SIDEBAR_DEFAULT_WIDTH = 400;

/** Clamp any candidate width into the legal 320~600 range (ADR 0003). */
export const clampSidebarWidth = (width: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));

export interface AISidebarState {
  expanded: boolean;
  width: number;
  activeTab: AISidebarTab;
  toggle: () => void;
  setExpanded: (expanded: boolean) => void;
  /** Clamps into [320, 600] before committing. */
  setWidth: (width: number) => void;
  setActiveTab: (tab: AISidebarTab) => void;
}

/**
 * Sidebar shell state (expand/collapse, drag width, active tab).
 * Width + expanded + activeTab are persisted to localStorage so the
 * layout is remembered across restarts (ticket 01).
 */
export const useAISidebarStore = create<AISidebarState>()(
  persist(
    (set) => ({
      expanded: false,
      width: SIDEBAR_DEFAULT_WIDTH,
      activeTab: 'summary',
      toggle: () => set((state) => ({ expanded: !state.expanded })),
      setExpanded: (expanded) => set({ expanded }),
      setWidth: (width) => set({ width: clampSidebarWidth(width) }),
      setActiveTab: (activeTab) => set({ activeTab }),
    }),
    {
      name: 'readest-plus:ai-sidebar',
      partialize: (state) => ({
        width: state.width,
        expanded: state.expanded,
        activeTab: state.activeTab,
      }),
    },
  ),
);
