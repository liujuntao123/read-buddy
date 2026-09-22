'use client';

import { useRef, useState } from 'react';
import { GripVertical, MessageSquare, Settings2, Sparkles, X } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useViewportWidth } from '@/hooks/useViewportWidth';
import AISettingsPanel from '@/components/settings/AISettingsPanel';
import SummaryTab from './SummaryTab';
import ChatTab from './ChatTab';

interface DragState {
  pointerId: number;
  startClientX: number;
  startWidth: number;
}

/**
 * Split-screen AI companion sidebar (ADR 0003): collapsible container whose
 * width (320~600px) is driven through the shared aiSidebarStore, so it is
 * clamped there and remembered across restarts via the persist middleware.
 *
 * Responsive (design doc 6): below 768px the pane detaches into a fixed
 * overlay drawer (86vw, max 400px) with a click-to-close backdrop so the
 * reader keeps the full width; the drag handle is desktop-only.
 */
export default function AISidebar() {
  const expanded = useAISidebarStore((s) => s.expanded);
  const width = useAISidebarStore((s) => s.width);
  const activeTab = useAISidebarStore((s) => s.activeTab);
  const setActiveTab = useAISidebarStore((s) => s.setActiveTab);
  const setWidth = useAISidebarStore((s) => s.setWidth);
  const setExpanded = useAISidebarStore((s) => s.setExpanded);
  const { isCompact } = useViewportWidth();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const dragState = useRef<DragState | null>(null);

  // Collapsed: render nothing so the reader keeps the full width.
  if (!expanded) return null;

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragState.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: width,
    };
    // Keep receiving moves even when the cursor leaves the handle.
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Ignore: pointer capture is a progressive enhancement.
      }
    }
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Handle sits on the sidebar's LEFT edge: moving left widens the pane.
    const delta = drag.startClientX - event.clientX;
    setWidth(drag.startWidth + delta); // store clamps into [320, 600]
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = null;
  };

  return (
    <>
      {isCompact && (
        <VStack
          data-testid="sidebar-overlay"
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 30,
            background: 'var(--color-overlay)',
          }}
          onClick={() => setExpanded(false)}
        />
      )}
      <aside
        data-testid="ai-sidebar"
        aria-label="AI 伴读侧边栏"
        data-mode={isCompact ? 'drawer' : 'inline'}
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          zIndex: isCompact ? 40 : undefined,
          position: isCompact ? 'fixed' : 'relative',
          ...(isCompact
            ? { insetBlock: 0, insetInlineEnd: 0, width: '86vw', maxWidth: 400 }
            : { width: `${width}px` }),
          borderInlineStart: '1px solid var(--color-border)',
          background: 'var(--color-background-surface)',
        }}
      >
        {!isCompact && (
          <div
            data-testid="sidebar-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="拖拽调整侧栏宽度"
            style={{
              position: 'absolute',
              insetBlock: 0,
              insetInlineStart: 0,
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 12,
              cursor: 'col-resize',
              touchAction: 'none',
              userSelect: 'none',
            }}
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <GripVertical size={14} aria-hidden />
          </div>
        )}

        <HStack
          height={44}
          vAlign="center"
          justify="between"
          gap={2}
          style={{
            paddingInline: 'var(--spacing-5) var(--spacing-3)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <TabList
            role="tablist"
            aria-label="AI 侧边栏视图"
            value={activeTab}
            onChange={(next) => setActiveTab(next as 'summary' | 'chat')}
            size="sm"
          >
            <Tab value="summary" label="总结" panelId="ai-panel-summary" icon={<Sparkles size={12} aria-hidden />} />
            <Tab value="chat" label="伴读" panelId="ai-panel-chat" icon={<MessageSquare size={12} aria-hidden />} />
          </TabList>
          <HStack gap={1} vAlign="center">
            <IconButton
              label="AI 设置"
              variant="ghost"
              size="sm"
              tooltip="AI Provider 设置"
              icon={<Settings2 size={14} aria-hidden />}
              onClick={() => setSettingsOpen(true)}
            />
            <IconButton
              label="关闭 AI 侧边栏"
              variant="ghost"
              size="sm"
              tooltip="关闭侧边栏"
              icon={<X size={14} aria-hidden />}
              onClick={() => setExpanded(false)}
            />
          </HStack>
        </HStack>

        <div
          id={`ai-panel-${activeTab}`}
          role="tabpanel"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 'var(--spacing-3)',
          }}
        >
          {activeTab === 'summary' ? <SummaryTab /> : <ChatTab />}
        </div>

        {settingsOpen && <AISettingsPanel open onClose={() => setSettingsOpen(false)} />}
      </aside>
    </>
  );
}
