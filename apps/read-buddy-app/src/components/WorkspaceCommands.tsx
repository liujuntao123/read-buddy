'use client';

import { useEffect, useMemo } from 'react';
import { CommandPalette, CommandPaletteInput } from '@astryxdesign/core/CommandPalette';
import type { SearchSource } from '@astryxdesign/core/Typeahead';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { BookOpen, CornerDownLeft, Search, Zap } from 'lucide-react';
import { useLibraryStore } from '@/store/libraryStore';
import { useAISidebarStore, type AISidebarTab } from '@/store/aiSidebarStore';
import { useWorkspaceUI } from '@/store/workspaceUIStore';
import { getAgentBookContext } from '@/services/agent/agentContext';
import { requestLocate } from '@/services/reader/readerLink';
import { useViewportWidth } from '@/hooks/useViewportWidth';
import { useBookIndexStore } from '@/store/bookIndexStore';
import { handleWorkspaceShortcut } from './workspaceShortcuts';

interface Entry {
  id: string; label: string; description: string; kind: 'book' | 'passage' | 'action';
  auxiliaryData: { group: string }; run: () => void;
}

export default function WorkspaceCommands() {
  const isOpen = useWorkspaceUI((s) => s.commandOpen);
  const setOpen = useWorkspaceUI((s) => s.setCommandOpen);
  const focused = useWorkspaceUI((s) => s.focused);
  const books = useLibraryStore((s) => s.books);
  const hash = useLibraryStore((s) => s.currentHash);
  const view = useLibraryStore((s) => s.view);
  const indexPhase = useBookIndexStore((s) => s.phase);
  const { isCompact } = useViewportWidth();

  useEffect(() => {
    window.addEventListener('keydown', handleWorkspaceShortcut);
    return () => window.removeEventListener('keydown', handleWorkspaceShortcut);
  }, []);

  const { source, entries } = useMemo(() => {
    const entries = new Map<string, Entry>();
    const remember = (items: Entry[]) => { items.forEach((item) => entries.set(item.id, item)); return items; };
    const openTab = (tab: AISidebarTab) => {
      useWorkspaceUI.getState().leaveFocus();
      useAISidebarStore.getState().setActiveTab(tab);
      useAISidebarStore.getState().setExpanded(true);
    };
    const action = (id: string, label: string, description: string, run: () => void): Entry => ({ id, label, description, kind: 'action', auxiliaryData: { group: '快捷操作' }, run });
    const actions = [
      action('shelf', '返回书架', '整理藏书，挑选下一本', () => { useWorkspaceUI.getState().leaveFocus(); useLibraryStore.getState().closeToShelf(); }),
      ...(view === 'reader' ? [
        action('focus', focused ? '退出专注阅读' : '进入专注阅读', 'Ctrl / ⌘ + Shift + F', () => { const ui = useWorkspaceUI.getState(); if (ui.focused) ui.leaveFocus(); else ui.enterFocus(); }),
        action('summary', '总结与概念地图', '梳理当前内容的要义、脉络和概念', () => openTab('summary')),
        action('chat', '打开 AI 伴读', '带着问题继续阅读', () => openTab('chat')),
        action('highlights', '查看我的划线', '回顾留存的原文与想法', () => openTab('highlights')),
      ] : []),
      action('settings', '模型与连接设置', '管理你的 AI 伴读服务', () => { useWorkspaceUI.getState().leaveFocus(); useAISidebarStore.getState().setExpanded(true); useAISidebarStore.getState().openSettings(); }),
    ];
    const bookEntries: Entry[] = [...books].sort((a, b) => b.updatedAt - a.updatedAt).map((book) => ({
      id: `book:${book.hash}`, label: book.title, description: book.author || '未知作者', kind: 'book', auxiliaryData: { group: '我的藏书' },
      run: () => { useWorkspaceUI.getState().leaveFocus(); const library = useLibraryStore.getState(); if (library.currentHash === book.hash) library.resumeReading(); else void library.open(book.hash); },
    }));
    const source: SearchSource<Entry> = {
      bootstrap: () => remember([...actions, ...bookEntries.slice(0, 4)]),
      search: (query) => {
        const q = query.trim();
        if (!q) return source.bootstrap();
        const lower = q.toLocaleLowerCase();
        const matches = [...actions, ...bookEntries].filter((entry) => `${entry.label} ${entry.description}`.toLocaleLowerCase().includes(lower));
        const context = view === 'reader' && hash ? getAgentBookContext(hash) : undefined;
        const passages: Entry[] = q.length < 2 || !context ? [] : context.searchText(q, 12).map((match) => ({
          id: `passage:${hash}:${match.globalOffset}`, label: match.nodeTitle, description: match.matchSnippet, kind: 'passage', auxiliaryData: { group: '当前书籍 · 原文匹配（最多 12 处）' },
          run: () => {
            if (useLibraryStore.getState().currentHash !== hash || useLibraryStore.getState().view !== 'reader') return;
            if (isCompact) useAISidebarStore.getState().setExpanded(false);
            requestLocate({ bookHash: context.bookHash, nodeIndex: match.nodeIndex, charOffset: match.charOffset,
              quoteSnippet: context.fullText.slice(match.globalOffset, match.globalOffset + q.length),
              anchor: { prefix: context.fullText.slice(Math.max(0, match.globalOffset - 32), match.globalOffset), suffix: context.fullText.slice(match.globalOffset + q.length, match.globalOffset + q.length + 32) } });
          },
        }));
        return remember([...passages, ...matches.slice(0, 12)]);
      },
    };
    return { source, entries };
  }, [books, hash, view, focused, isCompact, indexPhase]);

  return <CommandPalette isOpen={isOpen} onOpenChange={setOpen} searchSource={source} label="搜索与快捷操作"
    width="min(92vw, 680px)" maxHeight="min(78dvh, 640px)"
    input={<CommandPaletteInput label="搜索书籍、原文或功能" placeholder={view === 'reader' ? '搜索当前书的原文、藏书或功能…' : '搜索藏书或功能…'} />}
    emptySearchText="没有找到匹配内容，试试更短的关键词。"
    onValueChange={(id) => { setOpen(false); entries.get(id)?.run(); }}
    renderItem={(item) => <HStack gap={3} vAlign="center" style={{ width: '100%', minWidth: 0 }}>
      {item.kind === 'book' ? <BookOpen size={18} /> : item.kind === 'passage' ? <Search size={18} /> : <Zap size={18} />}
      <VStack gap={1} style={{ flex: 1, minWidth: 0 }}><Text weight="medium" maxLines={1}>{item.label}</Text><Text type="supporting" color="secondary" maxLines={2}>{item.kind === 'passage' ? item.description.split(/(【[^】]+】)/).map((part, i) => part.startsWith('【') && part.endsWith('】') ? <mark key={i} style={{ background: 'var(--color-accent-muted)', color: 'var(--color-text-accent)', borderRadius: 'var(--radius-inner)' }}>{part.slice(1, -1)}</mark> : part) : item.description}</Text></VStack>
      <CornerDownLeft size={13} style={{ color: 'var(--color-icon-secondary)', flexShrink: 0 }} />
    </HStack>}
    footer={<HStack gap={2} justify="between" wrap="wrap" padding={3}>
      <Text type="supporting" color="secondary">↑ ↓ 选择 · Enter 打开 · Esc 关闭</Text>
      <Text type="supporting" color="secondary">{view !== 'reader' ? 'Ctrl / ⌘ + K 随时打开' : hash && getAgentBookContext(hash)?.fullText ? '输入至少 2 个字搜索原文 · 无需 AI' : indexPhase === 'segmenting' ? '正在准备本书原文，稍后即可搜索' : '此书暂无可检索的原文，可搜索藏书和功能'}</Text>
    </HStack>} />;
}
