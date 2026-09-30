'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { List, ListItem } from '@astryxdesign/core/List';
import { ArrowUpRight, BookOpen, Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, ListTree, Maximize2, Network, Search, Workflow, X, MessageCircle } from 'lucide-react';
import { requestLocate } from '@/services/reader/readerLink';
import { conceptMapMarkdown } from '@/services/conceptMap/conceptMap';
import { buildSummaryMap, revealConcept, ROLE_LABEL, ROLE_COLOR, type SummaryMap } from '@/services/conceptMap/summaryMap';
import type { NodeView } from '@/services/bookNodes';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import CopyButton from '@/components/common/CopyButton';
import MarkdownView from '@/components/common/MarkdownView';
import ConceptGraph from './ConceptGraph';
import { useViewportWidth } from '@/hooks/useViewportWidth';
import { useQuickActions } from '@/hooks/useQuickActions';

interface ExplorerState { collapsed: Set<string>; query: string; selected: string | null; outline: boolean; relations: boolean }
const initialState = (data: SummaryMap): ExplorerState => ({ collapsed: new Set(data.concepts.filter((c) => c.parentId === 'root').map((c) => c.id)), query: '', selected: null, outline: false, relations: false });
export interface MapFocus { id: string; sequence: number }

export default function ConceptMapPanel({ view, summary, pending = false, updatedAt = 0, focus, onSummary, onGenerateSummary }: {
  view: NodeView; summary: string; pending?: boolean; updatedAt?: number; focus?: MapFocus;
  onSummary: (sectionId: string) => void; onGenerateSummary?: () => void;
}) {
  const data = useMemo(() => buildSummaryMap({ summary, text: view.text, title: view.title,
    bookHash: view.bookHash, nodeIndex: view.nodeIndex, updatedAt }), [summary, view.text, view.title, view.bookHash, view.nodeIndex, updatedAt]);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState(() => initialState(data));
  const [focusId, setFocusId] = useState<string>();
  const container = useRef<HTMLDivElement>(null);
  const { isCompact } = useViewportWidth();
  const runQuickAction = useQuickActions();
  const setSidebarExpanded = useAISidebarStore((s) => s.setExpanded);
  useEffect(() => { setState(initialState(data)); setFocusId(undefined); }, [data]);
  useEffect(() => { setExpanded(false); }, [view.bookHash, view.nodeIndex]);
  const select = useCallback((id: string) => {
    setState((s) => {
      let collapsed = revealConcept(data, id, s.collapsed);
      for (const relation of data.relations) {
        if (relation.source === id) collapsed = revealConcept(data, relation.target, collapsed);
        if (relation.target === id) collapsed = revealConcept(data, relation.source, collapsed);
      }
      return { ...s, selected: id, collapsed };
    });
    setFocusId(id);
  }, [data]);
  useEffect(() => {
    if (!focus) return;
    select(focus.id);
    container.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [focus, select]);
  const toggle = useCallback((id: string) => setState((s) => {
    const collapsed = new Set(s.collapsed);
    if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    return { ...s, collapsed };
  }), []);
  const current = data.concepts.find((c) => c.id === state.selected);
  const children = data.concepts.filter((c) => c.parentId === current?.id);
  const groups = data.concepts.filter((c) => c.parentId === 'root');
  const search = state.query.trim().toLocaleLowerCase();
  const results = data.concepts.filter((c) => c.id !== 'root' && (!search || `${c.label} ${c.description}`.toLocaleLowerCase().includes(search)));
  const goToSummary = (sectionId: string) => { setExpanded(false); onSummary(sectionId); };
  const jump = () => {
    if (current?.charOffset === undefined) return;
    setExpanded(false);
    if (isCompact) setSidebarExpanded(false);
    requestLocate({ bookHash: data.bookHash, nodeIndex: data.nodeIndex, charOffset: current.charOffset,
      quoteSnippet: current.quote, ...(current.anchor ? { anchor: current.anchor } : {}) });
  };
  const overview = state.collapsed.size > 0;

  const detail = <VStack gap={3} padding={4} style={{ minWidth: 0, background: 'var(--color-background-surface)', borderRadius: 'var(--radius-container)' }}>
    {current ? <>
      <HStack justify="between" vAlign="center" gap={2}>
        <Token size="sm" color={ROLE_COLOR[current.role]} label={ROLE_LABEL[current.role]} />
        <IconButton label="取消选择" tooltip="取消选择" size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setState((s) => ({ ...s, selected: null }))} />
      </HStack>
      <Text weight="semibold" style={{ overflowWrap: 'anywhere' }}>{current.label}</Text>
      {!current.isGroup && <MarkdownView content={current.sourceText.replace(/^\s*\*\*[^*]+\*\*[：:]?\s*/, '')} />}
      {current.isGroup && <>
        <Text color="secondary" type="supporting">{current.id === 'root' ? '这份地图由上方总结的三个部分组成，选择一个分支开始阅读。' : `这一分支包含 ${children.length} 项，顺序与文字总结一致。`}</Text>
        <List density="compact">
          {children.map((child) => <ListItem key={child.id} onClick={() => select(child.id)} label={
            <HStack gap={2} vAlign="center"><Text color="secondary" type="supporting" hasTabularNumbers>{child.order ? String(child.order).padStart(2, '0') : '•'}</Text><Text maxLines={2}>{child.label}</Text></HStack>
          } endContent={<ChevronRight size={14} />} />)}
        </List>
      </>}
      {current.quote && <VStack gap={2} padding={3} style={{ background: 'var(--color-background-muted)', borderRadius: 'var(--radius-container)' }}>
        <HStack gap={1} vAlign="center"><BookOpen size={13} /><Text type="supporting" color="secondary">原文依据</Text></HStack>
        <Text type="supporting" style={{ lineHeight: 'var(--text-body-leading)' }}>{current.quote}</Text>
      </VStack>}
      {!current.isGroup && !current.quote && <Text type="supporting" color="secondary">这是总结中的提炼表述，可回到对应总结查看上下文。</Text>}
      {data.relations.some((r) => r.source === current.id || r.target === current.id) && <VStack gap={2}>
        <Text type="supporting" color="secondary">相关概念</Text>
        <HStack gap={1} wrap="wrap">{data.relations.filter((r) => r.source === current.id || r.target === current.id).map((r) => {
          const id = r.source === current.id ? r.target : r.source;
          return <Button key={id} label={data.concepts.find((c) => c.id === id)!.label} variant="secondary" size="sm" onClick={() => select(id)} />;
        })}</HStack>
      </VStack>}
      <HStack gap={2} wrap="wrap">
        {current.sectionId && <Button label="查看对应总结" icon={<ArrowUpRight size={14} />} size="sm" variant="secondary" onClick={() => goToSummary(current.sectionId!)} />}
        {current.charOffset !== undefined && <Button label="查看原文" icon={<BookOpen size={14} />} size="sm" variant="ghost" onClick={jump} />}
        {!current.isGroup && <Button label="追问这个概念" tooltip="带入伴读输入框，由你决定提问与发送" icon={<MessageCircle size={14} />} size="sm" variant="ghost"
          onClick={() => runQuickAction('ask', `总结中的概念：${current.label}\n${current.sourceText}${current.quote ? `\n原文依据：${current.quote}` : ''}`, () => setExpanded(false))} />}
        {children.length > 0 && <Button label={state.collapsed.has(current.id) ? '展开此分支' : '收起此分支'} size="sm" variant="ghost" onClick={() => toggle(current.id)} />}
      </HStack>
    </> : <VStack gap={3} padding={3}>
      <Network size={22} style={{ color: 'var(--color-icon-secondary)' }} />
      <Text weight="medium">沿着总结，探索关联</Text>
      <Text type="supporting" color="secondary">选择地图中的节点，在这里阅读完整内容。选中一个概念后，它的关联会在图中突出显示。</Text>
      <Text type="supporting" color="secondary">节点右侧的 + / − 可展开或收起分支。拖动画布探索，滚轮缩放。</Text>
    </VStack>}
  </VStack>;

  const explorer = (large: boolean) => <VStack gap={3} style={{ minHeight: 0, flex: 1 }}>
    <HStack justify="between" gap={2} vAlign="center" wrap="wrap">
      <HStack gap={1} wrap="wrap">{groups.map((group) => <Button key={group.id} size="sm" variant={current?.role === group.role ? 'secondary' : 'ghost'}
        label={ROLE_LABEL[group.role]} onClick={() => select(group.id)} icon={<Network size={13} style={{ color: `var(--color-text-${ROLE_COLOR[group.role]})` }} />} />)}</HStack>
      <HStack gap={0}>
        <IconButton label={overview ? '展开全部分支' : '收起全部分支'} tooltip={overview ? '展开全部分支' : '回到三部分总览'} size="sm" variant="ghost"
          icon={overview ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
          onClick={() => setState((s) => ({ ...s, collapsed: overview ? new Set() : initialState(data).collapsed }))} />
        <IconButton label="显示概念关联" tooltip="显示总结中出现的概念关联" aria-pressed={state.relations} size="sm" variant={state.relations ? 'secondary' : 'ghost'} icon={<Workflow size={15} />}
          onClick={() => setState((s) => ({ ...s, relations: !s.relations }))} />
        <IconButton label="打开搜索与大纲" tooltip="搜索与文字大纲" aria-pressed={state.outline} size="sm" variant={state.outline ? 'secondary' : 'ghost'} icon={<ListTree size={15} />}
          onClick={() => setState((s) => ({ ...s, outline: !s.outline }))} />
        <CopyButton label="复制完整地图" getText={() => conceptMapMarkdown(data)} />
      </HStack>
    </HStack>
    <HStack gap={3} style={{ minHeight: 0, flex: 1, alignItems: 'stretch', flexDirection: large && !isCompact ? 'row' : 'column' }}>
      <VStack gap={2} style={{ minWidth: 0, flex: 1 }}>
        <ConceptGraph data={data} collapsed={state.collapsed} selected={state.selected} onSelect={select} onToggle={toggle}
          expanded={large} showRelations={state.relations} focusId={focusId} />
        <HStack justify="between" gap={2} vAlign="center"><Text type="supporting" color="secondary">{`${data.concepts.filter((c) => !c.isGroup).length} 项总结 · ${data.relations.length} 处概念关联`}</Text>
          <Text type="supporting" color="secondary">单击预览 · + / − 折叠</Text></HStack>
      </VStack>
      {(large || current) && <VStack style={{ width: large && !isCompact ? 'min(32%, 340px)' : '100%', minWidth: 0, maxHeight: large ? '65dvh' : undefined, overflow: 'auto', flexShrink: 0 }}>{detail}</VStack>}
    </HStack>
    <Collapsible isOpen={state.outline} onOpenChange={(outline) => setState((s) => ({ ...s, outline }))}
      trigger={<HStack gap={2} vAlign="center"><Search size={14} /><Text type="supporting" weight="medium">搜索与文字大纲</Text></HStack>}>
      {state.outline && <VStack gap={2} padding={2}>
        <TextInput label="搜索总结中的概念" isLabelHidden size="sm" value={state.query} onChange={(query) => setState((s) => ({ ...s, query }))} hasClear placeholder="搜索要义、脉络或关键概念…" />
        {search && <Text type="supporting" color="secondary" role="status">{results.length ? `找到 ${results.length} 项` : '没有匹配的内容，请换一个关键词。'}</Text>}
        <List density="compact" style={{ maxHeight: 'calc(var(--spacing-10) * 6)', overflow: 'auto' }}>
          {results.map((item) => <ListItem key={item.id} onClick={() => select(item.id)} label={
            <HStack gap={2} vAlign="center"><Token size="sm" color={ROLE_COLOR[item.role]} label={ROLE_LABEL[item.role]} /><Text maxLines={1}>{item.label}</Text></HStack>
          } endContent={item.id === state.selected ? <Check size={14} /> : <ChevronRight size={14} />} />)}
        </List>
      </VStack>}
    </Collapsible>
  </VStack>;

  return <VStack ref={container} gap={3} data-testid="concept-map-panel" padding={3}
    style={{ minWidth: 0, scrollMarginBlockStart: 'var(--spacing-4)', background: 'var(--color-background-muted)', borderRadius: 'var(--radius-container)' }}>
    <HStack gap={2} justify="between" vAlign="center">
      <HStack gap={2} vAlign="center"><Network size={17} style={{ color: 'var(--color-icon-accent)' }} /><Text weight="semibold">概念地图</Text></HStack>
      {summary && <HStack gap={1} vAlign="center"><Token size="sm" color="gray" label={pending ? '总结更新中' : '与总结同步'} />
        <IconButton label="放大地图" tooltip="展开地图工作区" icon={<Maximize2 size={15} />} variant="ghost" size="sm" onClick={() => setExpanded(true)} /></HStack>}
    </HStack>
    {!summary ? <VStack gap={3} padding={3}>
      <Text weight="medium">把总结连成一张图</Text>
      <Text type="supporting" color="secondary">核心要义、关键内容脉络与核心概念，将组成同一张可探索的地图。生成总结后即可查看，无需再调用模型。</Text>
      <HStack gap={1} wrap="wrap">{(['core', 'outline', 'terms'] as const).map((role) => <Token key={role} size="sm" color={ROLE_COLOR[role]} label={ROLE_LABEL[role]} />)}</HStack>
      {onGenerateSummary && <Button label={pending ? '正在生成总结…' : '生成总结与地图'} size="sm" variant="secondary" isDisabled={pending} onClick={onGenerateSummary} />}
    </VStack> : <>
      {!expanded && explorer(false)}
      <Dialog isOpen={expanded} onOpenChange={setExpanded} width="min(94vw, 1440px)" maxHeight="94dvh" padding={4}>
        <DialogHeader title="总结 · 概念地图" subtitle={view.title} onOpenChange={setExpanded} startContent={<Network size={20} />} />
        <VStack gap={3} style={{ overflow: 'auto', minHeight: 0, flex: 1 }}>{expanded && explorer(true)}</VStack>
      </Dialog>
    </>}
  </VStack>;
}
