'use client';

import { useRef } from 'react';
import {
  BookOpen,
  Cpu,
  GripVertical,
  Highlighter,
  History,
  MessageSquare,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { useAISidebarStore, type AISidebarTab } from '@/store/aiSidebarStore';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { providerReady } from '@/services/ai/providerReadiness';
import { useViewportWidth } from '@/hooks/useViewportWidth';
import AISettingsPanel from '@/components/settings/AISettingsPanel';
import SummaryTab from './SummaryTab';
import HighlightsTab from './HighlightsTab';
import ChatTab from './ChatTab';

interface DragState {
  pointerId: number;
  startClientX: number;
  startWidth: number;
}

/**
 * Split-screen AI companion sidebar (ADR 0003): collapsible container whose
 * width (320~900px) is driven through the shared aiSidebarStore, so it is
 * clamped there and remembered across restarts via the persist middleware.
 *
 * Responsive (ADR 0003): below 768px the pane detaches into a fixed
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

  const view = useLibraryStore((s) => s.view);
  const currentHash = useLibraryStore((s) => s.currentHash);
  const resumeReading = useLibraryStore((s) => s.resumeReading);
  const bookTitle = useReaderStore((s) => s.bookTitle);
  const settingsOpen = useAISidebarStore((s) => s.settingsOpen);
  const openSettings = useAISidebarStore((s) => s.openSettings);
  const closeSettings = useAISidebarStore((s) => s.closeSettings);

  // The model is shared by both tabs (总结 and 伴读 call the same endpoint), so
  // it is reported once here at the tab level instead of inside either panel.
  const model = useAISettingsStore((s) => s.settings.model);
  const hasProvider = useAISettingsStore((s) => providerReady(s.settings));

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
    setWidth(drag.startWidth + delta); // store clamps into [320, 900]
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
          {view === 'shelf' ? (
            <HStack gap={2} vAlign="center" data-testid="sidebar-shelf-header" style={{ flexShrink: 0 }}>
              <Sparkles size={14} aria-hidden />
              <Text weight="semibold" size="sm">
                AI 伴读
              </Text>
              <Token size="sm" label="书架中" />
            </HStack>
          ) : (
            <TabList
              role="tablist"
              aria-label="AI 侧边栏视图"
              value={activeTab}
              onChange={(next) => setActiveTab(next as AISidebarTab)}
              size="sm"
              style={{ flexShrink: 0 }}
            >
              <Tab value="summary" label="总结" panelId="ai-panel-summary" icon={<Sparkles size={12} aria-hidden />} />
              <Tab value="chat" label="伴读" panelId="ai-panel-chat" icon={<MessageSquare size={12} aria-hidden />} />
              <Tab
                value="highlights"
                label="划线"
                panelId="ai-panel-highlights"
                icon={<Highlighter size={12} aria-hidden />}
              />
            </TabList>
          )}
          <HStack gap={2} vAlign="center" style={{ minWidth: 0 }}>
            {/* Which model both tabs are talking to. The chip absorbs the free
                space so the name sits beside the tabs and truncates (with
                Text's truncation tooltip) when the pane is at its 320px
                minimum; before a key is configured it says so instead of
                naming a model nothing can call. */}
            <HStack
              gap={1}
              vAlign="center"
              data-testid="sidebar-model-chip"
              style={{ flex: '1 1 auto', minWidth: 0 }}
            >
              <Cpu
                size={12}
                aria-hidden
                style={{ flexShrink: 0, color: 'var(--color-text-secondary)', opacity: 0.8 }}
              />
              <Text
                type="supporting"
                color={hasProvider ? 'secondary' : 'accent'}
                maxLines={1}
                style={{ minWidth: 0, opacity: hasProvider ? 0.9 : 1 }}
              >
                {hasProvider ? model : '未配置模型'}
              </Text>
            </HStack>
            <IconButton
              label="AI 设置"
              variant="ghost"
              size="sm"
              tooltip="AI 设置"
              icon={<Settings2 size={14} aria-hidden />}
              onClick={openSettings}
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
          id={view === 'shelf' ? 'ai-panel-shelf' : `ai-panel-${activeTab}`}
          role="tabpanel"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 'var(--spacing-3)',
          }}
        >
          {view === 'shelf' ? (
            <VStack
              data-testid="sidebar-shelf-empty"
              gap={4}
              vAlign="center"
              hAlign="center"
              style={{
                height: '100%',
                justifyContent: 'center',
                padding: 'var(--spacing-6) var(--spacing-4)',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-background-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <BookOpen size={24} aria-hidden />
              </div>
              <VStack gap={2} vAlign="center" style={{ maxWidth: 280 }}>
                <Text weight="semibold" type="large">
                  未打开书籍
                </Text>
                <Text type="supporting" color="secondary" style={{ lineHeight: 1.6 }}>
                  打开书籍后，可在此查看章节总结与 AI 伴读。
                </Text>
              </VStack>
              {/* 书名可以很长（《说理》的 dc:title 就有 60+ 字），而侧栏最窄只有
                  320px：按钮因此必须能被父级压窄——`maxWidth: 100%` 给出宽度上界，
                  可见文本交给 `Text maxLines={1}`（单行截断 + 悬停显示完整书名）。
                  `label` 仍是完整文案，所以无障碍名称不受截断影响。 */}
              {currentHash && (
                <Button
                  label={`继续阅读《${bookTitle || '未命名'}》`}
                  variant="secondary"
                  size="sm"
                  data-testid="sidebar-resume-reading"
                  icon={<History size={14} aria-hidden />}
                  style={{ maxWidth: '100%' }}
                  onClick={resumeReading}
                >
                  <Text maxLines={1}>继续阅读《{bookTitle || '未命名'}》</Text>
                </Button>
              )}
            </VStack>
          ) : activeTab === 'summary' ? (
            <SummaryTab />
          ) : activeTab === 'highlights' ? (
            <HighlightsTab />
          ) : (
            <ChatTab />
          )}
        </div>

        {settingsOpen && <AISettingsPanel open onClose={closeSettings} />}
      </aside>
    </>
  );
}
