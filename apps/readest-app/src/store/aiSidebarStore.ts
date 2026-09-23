import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AISidebarTab = 'summary' | 'chat';

export const SIDEBAR_MIN_WIDTH = 320;
/**
 * Widest the companion pane may be dragged to. Raised from 600 to 900 on
 * request — wider chat content needs the room — while still leaving the reader
 * pane usable on a 1280-wide window. Kept as an absolute cap rather than a
 * share of the window so the width stays a pure, testable function of the drag
 * (ADR 0003).
 */
export const SIDEBAR_MAX_WIDTH = 900;
export const SIDEBAR_DEFAULT_WIDTH = 400;

/** Clamp any candidate width into the legal 320~900 range (ADR 0003). */
export const clampSidebarWidth = (width: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));

export interface AISidebarState {
  expanded: boolean;
  width: number;
  activeTab: AISidebarTab;
  /**
   * Whether the AI settings panel is open. Lives here rather than in
   * `AISidebar`'s local state so surfaces that are blocked on an unconfigured
   * provider (the `awaiting-key` index state) can open it. Deliberately NOT
   * persisted — see `partialize`.
   */
  settingsOpen: boolean;
  toggle: () => void;
  setExpanded: (expanded: boolean) => void;
  /** Clamps into [320, 900] before committing. */
  setWidth: (width: number) => void;
  setActiveTab: (tab: AISidebarTab) => void;
  openSettings: () => void;
  closeSettings: () => void;
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
      settingsOpen: false,
      toggle: () => set((state) => ({ expanded: !state.expanded })),
      setExpanded: (expanded) => set({ expanded }),
      setWidth: (width) => set({ width: clampSidebarWidth(width) }),
      setActiveTab: (activeTab) => set({ activeTab }),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
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
