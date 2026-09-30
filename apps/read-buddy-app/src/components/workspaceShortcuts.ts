import { useLibraryStore } from '@/store/libraryStore';
import { useWorkspaceUI } from '@/store/workspaceUIStore';

/** Shared by the host and EPUB documents; iframe keyboard events do not bubble. */
export function handleWorkspaceShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  const ui = useWorkspaceUI.getState();
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    ui.setCommandOpen(!ui.commandOpen);
    return true;
  }
  if (modifier && event.shiftKey && event.key.toLowerCase() === 'f' && useLibraryStore.getState().view === 'reader') {
    event.preventDefault();
    if (ui.focused) ui.leaveFocus(); else ui.enterFocus();
    return true;
  }
  if (event.key === 'Escape' && ui.focused && !ui.commandOpen) {
    const element = event.target as HTMLElement | null;
    if (element?.closest?.('dialog, [role="dialog"], input, textarea, [contenteditable="true"]')) return false;
    event.preventDefault();
    ui.leaveFocus();
    return true;
  }
  return false;
}
