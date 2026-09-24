'use client';

import { useEffect } from 'react';
import {
  Eraser,
  Highlighter,
  Languages,
  Lightbulb,
  MessageCircle,
  ScrollText,
} from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/Stack';
import type { QuickAction } from '@/services/chat/quickActions';
import type { TextSelection } from '@/hooks/useTextSelection';
import type { HighlightTarget } from '@/hooks/useReaderHighlights';

/** Estimated rendered height of the toolbar (sm buttons + padding). */
export const TOOLBAR_HEIGHT = 36;
/**
 * Estimated rendered width, used only for viewport clamping: five icon+label
 * `sm` buttons (one of them 「取消划线」, two characters wider than 「划线」), four
 * dividers and the pill's own padding. Deliberately a slight over-estimate — a
 * toolbar that is clamped one notch too far from the edge is a cosmetic miss, one
 * that overflows the viewport is a broken control.
 */
export const TOOLBAR_ESTIMATED_WIDTH = 444;
/** Gap between the selection rect and the toolbar. */
export const TOOLBAR_GAP = 8;
/** Selections whose top sits closer than this to the viewport top flip below. */
export const TOOLBAR_FLIP_THRESHOLD = 50;

/** The model actions, in the order the toolbar shows them (after 划线). */
const AI_ACTIONS: ReadonlyArray<{ action: QuickAction; label: string; icon: typeof Lightbulb }> = [
  { action: 'explain', label: '解释', icon: Lightbulb },
  { action: 'translate', label: '翻译', icon: Languages },
  { action: 'ask', label: '追问', icon: MessageCircle },
  { action: 'summarize', label: '提炼', icon: ScrollText },
];

export interface SelectionToolbarProps {
  selection: TextSelection | null;
  onAction: (action: QuickAction, text: string) => void;
  /**
   * Mark the selection (划线). Optional so a surface that has no document to
   * paint into (or a test of the AI actions alone) can leave it out. It receives
   * the whole selection — not just its text — because only the live range can say
   * *which* occurrence of a repeated sentence the reader marked.
   */
  onHighlight?: (selection: TextSelection) => void;
  /**
   * A 划线 the reader clicked in the page (`useReaderHighlights`' target). The
   * toolbar is the **same** one — same four model actions, now acting on the
   * marked passage — with 划线 replaced by 取消划线.
   */
  clickedHighlight?: HighlightTarget | null;
  /** 取消划线 — delete the mark the reader clicked. */
  onUnhighlight?: (target: HighlightTarget) => void;
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
 * Floating action group for the reader selection (design doc 4.4.3, ADR 0007).
 *
 * Two kinds of action, deliberately separated by a divider instead of sorted into
 * one row: **划线 marks the text** (a reader-owned mark that outlives the
 * selection), while the four model actions hand the passage to the companion.
 * The divider also makes the toolbar's leftmost button 「划线」 — the mark lives
 * one click away instead of behind a menu.
 *
 * It serves **two subjects with one shape**: a live selection, and a 划线 the
 * reader clicked in the page. The second is not a different toolbar — the reader
 * who wants to explain a passage they already marked, or to unmark it, gets the
 * same four actions over the same passage, with 划线 becoming 取消划线. Two
 * toolbars would have meant two vocabularies for one gesture.
 *
 * Purely presentational: the parent owns selection capture, the clicked-mark
 * hit-test and the highlight actions (only the pane knows which document to paint).
 * Escape dismisses it.
 */
export default function SelectionToolbar({
  selection,
  onAction,
  onHighlight,
  clickedHighlight,
  onUnhighlight,
  onClose,
}: SelectionToolbarProps) {
  useEffect(() => {
    if (!selection && !clickedHighlight) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selection, clickedHighlight, onClose]);

  /**
   * A live selection wins over a clicked mark: it is the gesture the reader is
   * making right now, and marking it is what the toolbar is for. The clicked mark
   * only supplies the anchor (and the subject) when there is no selection.
   */
  const marking = selection !== null;
  const rect = selection?.rect ?? clickedHighlight?.rect ?? null;
  const text = selection?.text ?? clickedHighlight?.highlight.quote ?? '';
  if (!rect) return null;

  const useHighlightAction = marking
    ? Boolean(onHighlight)
    : Boolean(clickedHighlight && onUnhighlight);

  const computed = computeToolbarPosition(rect);

  return (
    <HStack
      data-testid="selection-toolbar"
      data-mode={marking ? 'selection' : 'highlight'}
      role="toolbar"
      aria-label="选区操作"
      gap={0}
      vAlign="center"
      style={{
        position: 'fixed',
        zIndex: 50,
        top: computed.top,
        left: computed.left,
        transform: 'translateX(-50%)',
        paddingInline: 'var(--spacing-2)',
        paddingBlock: 'var(--spacing-1)',
        borderRadius: 'var(--radius-full)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-background-surface)',
        boxShadow: 'var(--shadow-high)',
        userSelect: 'none',
      }}
    >
      {useHighlightAction && (
        <HStack gap={0} vAlign="center">
          <Button
            label={marking ? '划线' : '取消划线'}
            variant="ghost"
            size="sm"
            data-testid={marking ? 'toolbar-highlight' : 'toolbar-unhighlight'}
            icon={marking ? <Highlighter size={14} aria-hidden /> : <Eraser size={14} aria-hidden />}
            onClick={() => {
              if (marking && selection) onHighlight?.(selection);
              else if (clickedHighlight) onUnhighlight?.(clickedHighlight);
            }}
          />
          <Divider orientation="vertical" />
        </HStack>
      )}
      {AI_ACTIONS.map(({ action, label, icon: Icon }, idx) => (
        <HStack key={action} gap={0} vAlign="center">
          {idx > 0 && <Divider orientation="vertical" />}
          <Button
            label={label}
            variant="ghost"
            size="sm"
            data-testid={`toolbar-${action}`}
            icon={<Icon size={14} aria-hidden />}
            onClick={() => onAction(action, text)}
          />
        </HStack>
      ))}
    </HStack>
  );
}
