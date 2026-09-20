'use client';

import { useEffect } from 'react';
import type { QuickAction } from '@/services/chat/quickActions';
import type { TextSelection } from '@/hooks/useTextSelection';

/** Estimated rendered height of the toolbar (btn-xs + padding). */
export const TOOLBAR_HEIGHT = 36;
/** Estimated rendered width, used only for viewport clamping. */
export const TOOLBAR_ESTIMATED_WIDTH = 236;
/** Gap between the selection rect and the toolbar. */
export const TOOLBAR_GAP = 8;
/** Selections whose top sits closer than this to the viewport top flip below. */
export const TOOLBAR_FLIP_THRESHOLD = 50;

const ACTIONS: ReadonlyArray<{ action: QuickAction; label: string; icon: string }> = [
  { action: 'explain', label: '解释', icon: '💡' },
  { action: 'translate', label: '翻译', icon: '🌐' },
  { action: 'ask', label: '追问', icon: '💬' },
  { action: 'summarize', label: '提炼', icon: '📝' },
];

export interface SelectionToolbarProps {
  selection: TextSelection | null;
  onAction: (action: QuickAction, text: string) => void;
  onClose: () => void;
}

export interface ToolbarPosition {
  top: number;
  left: number;
}

/**
 * Fixed-viewport position for the toolbar: centered above the selection rect,
 * flipped below it when the selection is too close to the viewport top, and
 * horizontally clamped so the toolbar never overflows.
 */
export function computeToolbarPosition(
  rect: DOMRect,
  viewportWidth: number = typeof window === 'undefined' ? TOOLBAR_ESTIMATED_WIDTH : window.innerWidth,
): ToolbarPosition {
  const flipBelow = rect.top < TOOLBAR_FLIP_THRESHOLD;
  const top = flipBelow
    ? rect.bottom + TOOLBAR_GAP
    : Math.max(rect.top - TOOLBAR_HEIGHT - TOOLBAR_GAP, TOOLBAR_GAP);

  const half = TOOLBAR_ESTIMATED_WIDTH / 2;
  const minLeft = half + TOOLBAR_GAP;
  const maxLeft = Math.max(viewportWidth - half - TOOLBAR_GAP, minLeft);
  const left = Math.min(Math.max(rect.left + rect.width / 2, minLeft), maxLeft);
  return { top, left };
}

/**
 * Floating AI action group for the reader selection (design doc 4.4.3,
 * ADR 0007): purely presentational — the parent owns selection capture.
 * Escape dismisses it.
 */
export default function SelectionToolbar({ selection, onAction, onClose }: SelectionToolbarProps) {
  useEffect(() => {
    if (!selection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selection, onClose]);

  if (!selection) return null;

  const { top, left } = computeToolbarPosition(selection.rect);

  return (
    <div
      data-testid="selection-toolbar"
      role="toolbar"
      aria-label="选区 AI 快捷操作"
      className="fixed z-50 flex -translate-x-1/2 items-center gap-0.5 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
      style={{ top: `${top}px`, left: `${left}px` }}
    >
      {ACTIONS.map(({ action, label, icon }) => (
        <button
          key={action}
          type="button"
          className="btn btn-ghost btn-xs whitespace-nowrap"
          aria-label={label}
          title={label}
          onClick={() => onAction(action, selection.text)}
        >
          {icon} {label}
        </button>
      ))}
    </div>
  );
}
