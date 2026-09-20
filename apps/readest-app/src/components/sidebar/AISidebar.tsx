'use client';

import { useRef, useState } from 'react';
import { GripVertical, Settings, X } from 'lucide-react';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import AISettingsPanel from '@/components/settings/AISettingsPanel';
import SummaryTabPlaceholder from './SummaryTabPlaceholder';
import ChatTabPlaceholder from './ChatTabPlaceholder';

interface DragState {
  pointerId: number;
  startClientX: number;
  startWidth: number;
}

/**
 * Split-screen AI companion sidebar (ADR 0003): collapsible container whose
 * width (320~600px) is driven through the shared aiSidebarStore, so it is
 * clamped there and remembered across restarts via the persist middleware.
 */
export default function AISidebar() {
  const expanded = useAISidebarStore((s) => s.expanded);
  const width = useAISidebarStore((s) => s.width);
  const activeTab = useAISidebarStore((s) => s.activeTab);
  const setActiveTab = useAISidebarStore((s) => s.setActiveTab);
  const setWidth = useAISidebarStore((s) => s.setWidth);
  const setExpanded = useAISidebarStore((s) => s.setExpanded);

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
    <aside
      data-testid="ai-sidebar"
      aria-label="AI 伴读侧边栏"
      className="relative flex shrink-0 flex-col border-l border-base-300 bg-base-100"
      style={{ width: `${width}px` }}
    >
      <div
        data-testid="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整侧栏宽度"
        className="absolute inset-y-0 left-0 z-10 flex w-3 cursor-col-resize touch-none select-none items-center justify-center"
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <GripVertical className="size-3.5 text-base-content/40" aria-hidden="true" />
      </div>

      <div className="flex items-center justify-between gap-2 border-b border-base-300 px-2 py-2 pl-5">
        <div role="tablist" aria-label="AI 侧边栏视图" className="tabs tabs-box tabs-sm">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'summary'}
            className={`tab ${activeTab === 'summary' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('summary')}
          >
            总结
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'chat'}
            className={`tab ${activeTab === 'chat' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            对话
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="AI 设置"
            title="AI 设置"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="关闭 AI 侧边栏"
            title="关闭 AI 侧边栏"
            onClick={() => setExpanded(false)}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === 'summary' ? <SummaryTabPlaceholder /> : <ChatTabPlaceholder />}
      </div>

      {settingsOpen && <AISettingsPanel open onClose={() => setSettingsOpen(false)} />}
    </aside>
  );
}
