import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAISidebarStore } from './aiSidebarStore';

export type ShelfSort = 'recent' | 'imported' | 'title' | 'size';
export type ShelfFilter = 'all' | 'queued' | 'reading' | 'unread';

/** Local presentation preferences; reading positions remain owned by readingPosition. */
export const useShelfPreferences = create<{
  queued: string[]; sort: ShelfSort; layout: 'grid' | 'list';
  toggleQueued: (hash: string) => void;
  setSort: (sort: ShelfSort) => void;
  setLayout: (layout: 'grid' | 'list') => void;
}>()(persist((set) => ({
  queued: [], sort: 'recent', layout: 'grid',
  toggleQueued: (hash) => set((s) => ({ queued: s.queued.includes(hash) ? s.queued.filter((h) => h !== hash) : [...s.queued, hash] })),
  setSort: (sort) => set({ sort }),
  setLayout: (layout) => set({ layout }),
}), { name: 'read-buddy:shelf-preferences' }));

/** Focus and command surfaces are session-only. Exiting focus restores the companion. */
export const useWorkspaceUI = create<{
  commandOpen: boolean; focused: boolean; previousSidebar: boolean;
  setCommandOpen: (commandOpen: boolean) => void;
  enterFocus: () => void; leaveFocus: () => void;
}>((set, get) => ({
  commandOpen: false, focused: false, previousSidebar: false,
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  enterFocus: () => {
    if (get().focused) return;
    const sidebar = useAISidebarStore.getState();
    set({ focused: true, previousSidebar: sidebar.expanded });
    sidebar.setExpanded(false);
  },
  leaveFocus: () => {
    if (!get().focused) return;
    const expanded = get().previousSidebar;
    set({ focused: false });
    useAISidebarStore.getState().setExpanded(expanded);
  },
}));
