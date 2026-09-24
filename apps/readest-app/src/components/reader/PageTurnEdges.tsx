'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { VStack } from '@astryxdesign/core/Stack';
import type { EdgeSide } from '@/hooks/useEdgeHover';

export interface PageTurnEdgesProps {
  /** The edge the pointer is on (`useEdgeHover`), or null for none. */
  edge: EdgeSide | null;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * 双页模式的边缘翻页控件.
 *
 * Paginated reading is the mouse-driven mode, but it only offered a wheel (with a
 * 50px threshold and a cooldown) and the keyboard. Dragging the pointer to an edge
 * is what a reader's hand does on its own — the control is then one click away.
 *
 * Purely presentational: the pane owns the pointer tracking (`useEdgeHover`,
 * which also has to listen inside the chapter iframes) and the page turn itself.
 * A hidden control is `visibility: hidden`, not merely transparent, so it is
 * neither clickable nor reachable by Tab while off screen (globals.css).
 */
export default function PageTurnEdges({ edge, onPrev, onNext }: PageTurnEdgesProps) {
  return (
    <>
      <VStack
        className="reader-page-edge"
        data-side="prev"
        data-visible={edge === 'prev' ? 'true' : 'false'}
        vAlign="center"
        hAlign="center"
      >
        <IconButton
          label="上一页"
          tooltip="上一页"
          variant="secondary"
          data-testid="page-turn-prev"
          icon={<ChevronLeft size={20} aria-hidden />}
          onClick={onPrev}
        />
      </VStack>
      <VStack
        className="reader-page-edge"
        data-side="next"
        data-visible={edge === 'next' ? 'true' : 'false'}
        vAlign="center"
        hAlign="center"
      >
        <IconButton
          label="下一页"
          tooltip="下一页"
          variant="secondary"
          data-testid="page-turn-next"
          icon={<ChevronRight size={20} aria-hidden />}
          onClick={onNext}
        />
      </VStack>
    </>
  );
}
