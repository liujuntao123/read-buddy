'use client';

/**
 * 全书画像弹窗 (user review, tab layout): instead of one long cramped
 * column, the dialog splits into two focused tabs —
 *   画像     — 主旨概要 quote block, 世界观 card, 人物 chips;
 *   全书脉络 — brief-index progress bar + the COMPLETE hierarchical
 *             node-brief outline as an accordion (章 header rows fold their 节
 *             rows) with the full content height to breathe.
 * A compact context strip (书名 / 题材 / 划分 / 状态) stays above the tabs, and
 * the 重新索引 action stays in the footer across both tabs.
 *
 * Wording (CONTEXT.md 词表 / ADR 0010): every level word and count comes from
 * the node model (`shape` / `nodeKindLabel`) — the dialog itself never says
 * 章 / 节, and a row carries no level badge: the accordion's nesting *is* the
 * hierarchy (user review — the 章 / 节 markers repeated what the indent said).
 *
 * Container nodes (a 章 that owns 节) are structural groupings and are never
 * briefed (ADR 0010), so their rows carry no 「待生成微简介」 placeholder: only
 * rows that can actually receive a brief show that wording (user report — the
 * placeholder on container 章 rows read as a stuck queue).
 */
import { useState, useMemo } from 'react';
import {
  BookOpen,
  ChevronsDownUp,
  ChevronsUpDown,
  Compass,
  Gauge,
  KeyRound,
  Layers,
  Library,
  ListTree,
  Quote,
  RotateCw,
  Sparkles,
  Square,
  Tags,
} from 'lucide-react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { useBookIndexStore } from '@/store/bookIndexStore';
import { useReaderStore } from '@/store/readerStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { providerReady } from '@/services/ai/providerReadiness';
import { PENDING_BRIEF_LABEL, type BookNode } from '@/types/readingAgent';
import { getAgentBookContext } from '@/services/agent/agentContext';
import { formatNodeCounts, nodeKindLabel } from '@/services/bookNodes';
import MarkdownView from '@/components/common/MarkdownView';

export interface PanoramaDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Pre-confirm reindex handler (the parent owns the confirm dialog). */
  onRequestReindex: () => void;
}

type PanoramaTab = 'portrait' | 'outline';

/** Small labelled stat block for the context strip. */
function StatBlock({
  label,
  icon,
  children,
  isLast = false,
}: {
  label: string;
  /** Small leading glyph — the strip is scanned, not read. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-1)',
        padding: 'var(--spacing-3) var(--spacing-4)',
        minWidth: 0,
        borderInlineEnd: isLast ? 'none' : '1px solid var(--color-border)',
      }}
    >
      <HStack gap={1.5} vAlign="center" style={{ minWidth: 0 }}>
        {icon && (
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              flexShrink: 0,
              color: 'var(--color-text-secondary)',
            }}
          >
            {icon}
          </span>
        )}
        <Text
          type="supporting"
          color="secondary"
          style={{
            fontSize: 'var(--font-size-xs)',
            lineHeight: 'var(--line-height-tight)',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </Text>
      </HStack>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 28,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function PanoramaDialog({ isOpen, onOpenChange, onRequestReindex }: PanoramaDialogProps) {
  const [activeTab, setActiveTab] = useState<PanoramaTab>('portrait');
  const [collapsedChapterIds, setCollapsedChapterIds] = useState<Set<string>>(new Set());

  const bookTitle = useReaderStore((s) => s.bookTitle);
  const bookHash = useReaderStore((s) => s.bookHash);
  const spineIndex = useReaderStore((s) => s.spineIndex);
  const phase = useBookIndexStore((s) => s.phase);
  const shape = useBookIndexStore((s) => s.shape);
  const briefTotal = useBookIndexStore((s) => s.briefTotal);
  const briefedCount = useBookIndexStore((s) => s.briefedCount);
  const panoramaReady = useBookIndexStore((s) => s.panoramaReady);
  const strategy = useBookIndexStore((s) => s.strategy);
  const startIndexing = useBookIndexStore((s) => s.startIndexing);
  const stopIndexing = useBookIndexStore((s) => s.stopIndexing);
  const setSidebarExpanded = useAISidebarStore((s) => s.setExpanded);
  const openSettings = useAISidebarStore((s) => s.openSettings);
  const settings = useAISettingsStore((s) => s.settings);

  // Live reads: briefs stream in as the background queue advances (the store
  // subscriptions above re-render this component on every progress tick).
  const context = isOpen && bookHash ? getAgentBookContext(bookHash) : undefined;
  const panorama = context?.getPanorama();
  const nodes = context?.nodes ?? [];

  /**
   * The outline as accordion groups: every first-level node with the
   * second-level nodes that follow it. Node order is document order, so a
   * depth>0 node belongs to the group the last depth-0 node opened.
   */
  const outlineGroups = useMemo(() => {
    const groups: Array<{ node: BookNode; children: BookNode[] }> = [];
    for (const node of nodes) {
      if (node.depth === 0 || groups.length === 0) {
        groups.push({ node, children: [] });
      } else {
        groups[groups.length - 1]!.children.push(node);
      }
    }
    return groups;
  }, [nodes]);

  /** Group rows that can actually fold — the ones owning second-level nodes. */
  const collapsibleIds = useMemo(
    () => outlineGroups.filter((group) => group.children.length > 0).map((group) => group.node.nodeId),
    [outlineGroups],
  );

  const toggleChapter = (chapterId: string) => {
    setCollapsedChapterIds((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  };

  const hasAnyCollapsible = collapsibleIds.length > 0;
  const allCollapsed =
    hasAnyCollapsible && collapsibleIds.every((id) => collapsedChapterIds.has(id));

  /** 最小节点层级的层词（节 / 章 / 段）——计数与折叠提示共用。 */
  const minimalKindWord = nodeKindLabel(shape.minimalKind);

  /** One control flips every group at once: collapse all, or open all again. */
  const toggleAllChapters = () => {
    setCollapsedChapterIds(allCollapsed ? new Set() : new Set(collapsibleIds));
  };

  const strategyLabel =
    strategy === 'native' ? '原生目录' : strategy === 'regex' ? '启发式节点识别' : strategy === 'fixed-length' ? '定长分段' : '未建立';

  const isIndexing = phase === 'panorama' || phase === 'briefs';
  const awaitingKey = phase === 'awaiting-key';
  // A configured provider turns the parked state back into a start action.
  const needsProvider = awaitingKey && !providerReady(settings);

  /** Bring the reader to the AI settings panel (the awaiting-key action). */
  const goToSettings = () => {
    setSidebarExpanded(true);
    openSettings();
    onOpenChange(false);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width={760}
      maxHeight="82dvh"
      data-testid="panorama-dialog"
    >
      <DialogHeader
        title="全书全景画像"
        onOpenChange={onOpenChange}
        startContent={<Compass size={18} aria-hidden />}
      />
      {panorama ? (
        <VStack
          gap={5}
          style={{
            minWidth: 0,
            flex: 1,
            minHeight: 0,
            marginTop: 'var(--spacing-2)',
            // The dialog body is a real scroll container: if the active panel
            // ever needs more room than the 82dvh dialog has, the reader can
            // still scroll everything (stats strip included) back into view —
            // a clipped body with no way to scroll is what made the strip
            // unreachable (user report).
            overflowY: 'auto',
          }}
        >
          {/* 常驻上下文条：书名 / 题材 / 划分 / 状态 */}
          <div
            data-testid="panorama-stats"
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 0.9fr) minmax(0, 1.4fr) minmax(0, 0.9fr)',
              background: 'var(--color-background-surface)',
              borderRadius: 'var(--radius-container)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-low)',
              overflow: 'hidden',
              // `overflow: hidden` zeroes this strip's automatic minimum size, so
              // without an explicit `flex-shrink: 0` the flex column pays any
              // shortfall in the 全书脉络 tab out of this strip and collapses it
              // to a sliver (user report: the strip disappeared and could not be
              // brought back). The panel below owns the scroll instead.
              flexShrink: 0,
            }}
          >
            <StatBlock label="当前书名" icon={<BookOpen size={12} aria-hidden />}>
              <span
                title={bookTitle || '当前书籍'}
                style={{
                  display: 'block',
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <Text weight="semibold" maxLines={1} style={{ fontSize: 'var(--font-size-sm)' }}>
                  《{bookTitle || '当前书籍'}》
                </Text>
              </span>
            </StatBlock>
            <StatBlock label="体裁领域" icon={<Library size={12} aria-hidden />}>
              <Badge variant="blue" label={panorama.genre || '未标注'} />
            </StatBlock>
            <StatBlock label="节点划分" icon={<Layers size={12} aria-hidden />}>
              <HStack gap={1.5} vAlign="center" style={{ minWidth: 0, overflow: 'hidden' }}>
                <Token size="sm" label={formatNodeCounts(shape)} data-testid="panorama-node-counts" />
                <Text
                  type="supporting"
                  color="secondary"
                  maxLines={1}
                  style={{ fontSize: 'var(--font-size-xs)', flexShrink: 0 }}
                >
                  ({strategyLabel})
                </Text>
              </HStack>
            </StatBlock>
            <StatBlock label="画像状态" icon={<Sparkles size={12} aria-hidden />} isLast>
              <HStack gap={1.5} vAlign="center">
                <StatusDot
                  variant={panoramaReady ? 'success' : 'accent'}
                  isPulsing={!panoramaReady}
                  label={panoramaReady ? '已就绪' : '生成中'}
                />
                <Text type="supporting" weight="medium" color={panoramaReady ? 'primary' : 'accent'}>
                  {panoramaReady ? '已就绪' : '生成中…'}
                </Text>
              </HStack>
            </StatBlock>
          </div>

          <div style={{ marginBlock: 'var(--spacing-1)' }}>
            <TabList
              role="tablist"
              value={activeTab}
              onChange={(next) => setActiveTab(next as PanoramaTab)}
              aria-label="全书画像视图"
              data-testid="panorama-tabs"
            >
              <Tab
                value="portrait"
                label="画像"
                panelId="panorama-panel-portrait"
                icon={<Sparkles size={14} aria-hidden />}
              />
              <Tab
                value="outline"
                label={`全书脉络（${shape.total}）`}
                panelId="panorama-panel-outline"
                icon={<ListTree size={14} aria-hidden />}
              />
            </TabList>
          </div>

          {activeTab === 'portrait' ? (
            <VStack
              id="panorama-panel-portrait"
              role="tabpanel"
              gap={5}
              style={{ minWidth: 0, flex: 1, minHeight: 0, overflowY: 'auto', paddingInline: 'var(--spacing-1)' }}
            >
              {/* 主旨概要：强调式引文块 */}
              <VStack gap={2} style={{ minWidth: 0 }}>
                <HStack gap={2} vAlign="center">
                  <Quote size={16} aria-hidden style={{ color: 'var(--color-accent)' }} />
                  <Text weight="semibold">全书核心主旨与脉络推演</Text>
                </HStack>
                <div
                  data-testid="panorama-summary"
                  style={{
                    minWidth: 0,
                    borderInlineStart: '3px solid var(--color-accent)',
                    background: 'var(--color-background-muted)',
                    borderRadius: 'var(--radius-container)',
                    padding: 'var(--spacing-4) var(--spacing-5)',
                    fontSize: 'var(--font-size-base)',
                    lineHeight: 1.85,
                  }}
                >
                  <MarkdownView content={panorama.summary} />
                </div>
              </VStack>

              {/* 探讨语境与问题意识：结构化卡片 */}
              {panorama.worldSetting && (
                <VStack gap={2} style={{ minWidth: 0 }}>
                  <HStack gap={2} vAlign="center">
                    <Compass size={16} aria-hidden style={{ color: 'var(--color-accent)' }} />
                    <Text weight="semibold">探讨语境与问题意识</Text>
                  </HStack>
                  <div
                    data-testid="panorama-world"
                    style={{
                      minWidth: 0,
                      background: 'var(--color-background-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-container)',
                      padding: 'var(--spacing-4) var(--spacing-5)',
                      fontSize: 'var(--font-size-base)',
                      lineHeight: 1.85,
                    }}
                  >
                    <Text type="supporting" style={{ lineHeight: 1.85 }}>{panorama.worldSetting}</Text>
                  </div>
                </VStack>
              )}

              {/* 核心概念与关键实体：词条 chips 卡片 */}
              {panorama.mainCharacters && panorama.mainCharacters.length > 0 && (
                <VStack gap={2} style={{ minWidth: 0 }}>
                  <HStack gap={2} vAlign="center">
                    <Tags size={16} aria-hidden style={{ color: 'var(--color-accent)' }} />
                    <Text weight="semibold">核心概念与关键实体</Text>
                    <Text type="supporting" color="secondary">{`（共 ${panorama.mainCharacters.length} 项）`}</Text>
                  </HStack>
                  <div
                    style={{
                      minWidth: 0,
                      background: 'var(--color-background-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-container)',
                      padding: 'var(--spacing-4) var(--spacing-5)',
                    }}
                  >
                    <HStack gap={2} wrap="wrap" data-testid="panorama-characters">
                      {panorama.mainCharacters.map((name) => (
                        <Token key={name} size="sm" label={name} />
                      ))}
                    </HStack>
                  </div>
                </VStack>
              )}
            </VStack>
          ) : (
            <VStack
              id="panorama-panel-outline"
              role="tabpanel"
              gap={4}
              style={{ minWidth: 0, flex: 1, minHeight: 0, paddingInline: 'var(--spacing-1)' }}
            >
              {/* 微大纲索引进度：单位取最小节点层级 */}
              {shape.total > 0 && (
                <div
                  data-testid="panorama-brief-progress"
                  style={{
                    padding: 'var(--spacing-3) var(--spacing-4)',
                    background: 'var(--color-background-muted)',
                    borderRadius: 'var(--radius-container)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <VStack gap={2} style={{ minWidth: 0 }}>
                    <HStack justify="between" vAlign="center">
                      <HStack gap={2} vAlign="center">
                        <Gauge size={14} aria-hidden style={{ color: 'var(--color-accent)' }} />
                        <Text type="supporting" weight="semibold">节点微大纲索引进度</Text>
                      </HStack>
                      <Text type="supporting" color="secondary" hasTabularNumbers>
                        {`${briefedCount}/${briefTotal} ${nodeKindLabel(shape.minimalKind)}`}
                      </Text>
                    </HStack>
                    <ProgressBar
                      label="节点微大纲索引进度"
                      value={briefedCount}
                      max={Math.max(briefTotal, 1)}
                      variant={briefedCount >= briefTotal ? 'success' : 'accent'}
                      hasValueLabel
                      formatValueLabel={(value, max) => `${value}/${max}`}
                    />
                  </VStack>
                </div>
              )}

              {/* 节点微大纲：完整层级列表，独占剩余高度并逐级折叠（手风琴） */}
              {nodes.length > 0 && (
                <VStack gap={3} style={{ minWidth: 0, flex: 1, minHeight: 0 }}>
                  <HStack justify="between" vAlign="center" style={{ paddingInline: 'var(--spacing-1)' }}>
                    <HStack gap={2} vAlign="center">
                      <ListTree size={16} aria-hidden style={{ color: 'var(--color-accent)' }} />
                      <Text weight="semibold">全书章节脉络</Text>
                    </HStack>
                    {hasAnyCollapsible && (
                      <IconButton
                        icon={
                          allCollapsed ? (
                            <ChevronsUpDown size={14} aria-hidden />
                          ) : (
                            <ChevronsDownUp size={14} aria-hidden />
                          )
                        }
                        label={allCollapsed ? '全部展开' : '全部折叠'}
                        tooltip={allCollapsed ? '展开所有节点' : '折叠所有节点'}
                        variant="ghost"
                        size="sm"
                        data-testid="toggle-all-panorama-chapters"
                        onClick={toggleAllChapters}
                      />
                    )}
                  </HStack>
                  <VStack
                    gap={2}
                    data-testid="panorama-briefs"
                    className="panorama-outline"
                    style={{
                      minWidth: 0,
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                    }}
                  >
                    {outlineGroups.map(({ node, children }) => {
                      const hasChildren = children.length > 0;
                      const isCollapsed = collapsedChapterIds.has(node.nodeId);

                      /**
                       * One row: title (+ 本章节数) and, for a single-level book,
                       * the node's own brief. A container 章's row never carries
                       * the pending placeholder (it is never briefed).
                       */
                      const rowContent = (
                        <VStack
                          data-testid="panorama-brief-item"
                          gap={1}
                          style={{ minWidth: 0, width: '100%', textAlign: 'start' }}
                        >
                          <HStack
                            justify="between"
                            vAlign="center"
                            gap={3}
                            // Whole-row fold trigger: this handle names the
                            // chapter row, the count token says what it holds.
                            {...(hasChildren
                              ? { 'data-testid': `panorama-fold-toggle-${node.nodeIndex}` }
                              : {})}
                            style={{ minWidth: 0 }}
                          >
                            <Text
                              type="supporting"
                              weight="semibold"
                              maxLines={1}
                              style={{ minWidth: 0, flex: 1 }}
                            >
                              {node.title}
                            </Text>
                            {hasChildren && (
                              <Token size="sm" label={`${children.length} ${minimalKindWord}`} />
                            )}
                          </HStack>
                          {/* 微简介只生成到最小节点 (CONTEXT.md / ADR 0010)：叶子节点
                              未生成时才是「待生成」；容器章没有简介就不显示占位。 */}
                          {(node.brief || !hasChildren) && (
                            <Text
                              type="supporting"
                              color="secondary"
                              style={{
                                wordBreak: 'break-word',
                                opacity: node.brief ? 1 : 0.6,
                                lineHeight: 'calc(var(--text-body-leading) * 1.15)',
                              }}
                            >
                              {node.brief || PENDING_BRIEF_LABEL}
                            </Text>
                          )}
                        </VStack>
                      );

                      return (
                        <VStack
                          key={node.nodeId}
                          gap={2}
                          style={{
                            minWidth: 0,
                            // 行内边距的单一来源（`.panorama-outline`）：折叠触发器
                            // 用同一对变量做负外边距，所以整个卡片就是命中区。
                            padding:
                              'var(--panorama-row-padding-block) var(--panorama-row-padding-inline)',
                            borderRadius: 'var(--radius-tile)',
                            background: 'var(--color-background-surface)',
                            borderInlineStart: '3px solid var(--color-accent)',
                          }}
                        >
                          {hasChildren ? (
                            // 手风琴：整行（标题 + 计数 + chevron）都是折叠触发器，
                            // 子节点收在同一组里。折叠时直接不渲染子行，滚动高度随之收回。
                            <Collapsible
                              value={node.nodeId}
                              isOpen={!isCollapsed}
                              className="panorama-accordion"
                              onOpenChange={(next) => {
                                if (next === isCollapsed) toggleChapter(node.nodeId);
                              }}
                              trigger={rowContent}
                            >
                              {isCollapsed ? null : (
                                <VStack gap={2} style={{ minWidth: 0 }}>
                                  {children.map((child) => (
                                    <VStack
                                      key={child.nodeId}
                                      data-testid="panorama-brief-item"
                                      gap={1}
                                      style={{
                                        minWidth: 0,
                                        marginInlineStart: 'var(--spacing-2)',
                                        marginBlockEnd: 'var(--spacing-1)',
                                        padding: 'var(--spacing-2) var(--spacing-3)',
                                        borderRadius: 'var(--radius-tile)',
                                        background: 'var(--color-background-muted)',
                                        borderInlineStart: '2px solid var(--color-border)',
                                      }}
                                    >
                                      <Text
                                        type="supporting"
                                        weight="semibold"
                                        maxLines={1}
                                        style={{ minWidth: 0 }}
                                      >
                                        {child.title}
                                      </Text>
                                      {/* 微简介只生成到最小节点 (CONTEXT.md / ADR 0010)：
                                          叶子节点未生成时才是「待生成」。 */}
                                      <Text
                                        type="supporting"
                                        color="secondary"
                                        style={{
                                          wordBreak: 'break-word',
                                          opacity: child.brief ? 1 : 0.6,
                                          lineHeight: 'calc(var(--text-body-leading) * 1.15)',
                                        }}
                                      >
                                        {child.brief || PENDING_BRIEF_LABEL}
                                      </Text>
                                    </VStack>
                                  ))}
                                </VStack>
                              )}
                            </Collapsible>
                          ) : (
                            // 单层结构（全书只有一级节点）：没有可折叠的子节点。
                            rowContent
                          )}
                        </VStack>
                      );
                    })}
                  </VStack>
                </VStack>
              )}
            </VStack>
          )}
        </VStack>
      ) : (
        <VStack
          gap={5}
          data-testid="panorama-empty"
          padding={6}
          vAlign="center"
          hAlign="center"
          style={{
            textAlign: 'center',
            background: 'var(--color-background-muted)',
            borderRadius: 'var(--radius-container)',
            border: '1px solid var(--color-border)',
            margin: 'var(--spacing-4) 0',
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-background-surface)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-accent)',
            }}
          >
            <Sparkles size={24} aria-hidden />
          </div>
          <VStack gap={2} vAlign="center" style={{ maxWidth: 440 }}>
            <HStack gap={2} vAlign="center">
              <Text weight="semibold" type="large">
                《{bookTitle || '当前书籍'}》
              </Text>
            </HStack>
            <Text weight="semibold" type="large">
              {isIndexing
                ? '全书画像构建中…'
                : needsProvider
                  ? '需要先配置 AI Provider'
                  : '尚未生成全书画像'}
            </Text>
            <Text type="supporting" color="secondary" style={{ lineHeight: 1.7 }}>
              {isIndexing
                ? '正在提炼全书主旨与章节脉络，稍后即可查阅。'
                : needsProvider
                  ? '请先在 AI 设置中填写 API Key。配置后即可生成全书画像与节点微大纲。'
                  : '生成全书画像可提炼主旨框架与章节脉络，帮助 AI 伴读更好地理解全书。'}
            </Text>
          </VStack>
          {isIndexing ? (
            <Button
              label="停止生成"
              variant="secondary"
              size="sm"
              icon={<Square size={14} aria-hidden />}
              onClick={stopIndexing}
            />
          ) : needsProvider ? (
            <Button
              label="前往 AI 设置"
              variant="primary"
              size="sm"
              data-testid="panorama-open-settings"
              icon={<KeyRound size={14} aria-hidden />}
              onClick={goToSettings}
            />
          ) : (
            <Button
              label="生成全书画像"
              variant="primary"
              size="sm"
              icon={<Sparkles size={14} aria-hidden />}
              onClick={() => void startIndexing({ currentSpineIndex: spineIndex })}
            />
          )}
        </VStack>
      )}
      <HStack
        justify="end"
        gap={2}
        style={{
          marginTop: 'var(--spacing-3)',
          paddingTop: 'var(--spacing-3)',
          borderTop: '1px solid var(--color-border)',
          flexShrink: 0,
        }}
      >
        <Button
          label="重新索引"
          variant="secondary"
          size="sm"
          data-testid="panorama-reindex"
          icon={<RotateCw size={14} aria-hidden />}
          onClick={() => {
            onOpenChange(false);
            onRequestReindex();
          }}
        />
      </HStack>
    </Dialog>
  );
}
