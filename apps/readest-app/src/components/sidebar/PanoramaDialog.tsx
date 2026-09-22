'use client';

/**
 * 全书画像弹窗 (user review, tab layout): instead of one long cramped
 * column, the dialog splits into two focused tabs —
 *   画像     — 主旨概要 quote block, 世界观 card, 人物 chips;
 *   全书脉络 — brief-index progress bar + the COMPLETE hierarchical
 *             node-brief outline with the full content height to breathe.
 * A compact context strip (题材 / 节点划分 / 状态) stays above the tabs, and the
 * 重新索引 action stays in the footer across both tabs.
 *
 * Wording (CONTEXT.md 词表 / ADR 0010): every level word and count comes from
 * the node model (`shape` / `nodeKindLabel` / `resolveNodeKind`) — the dialog
 * itself never says 章 / 节.
 */
import { useState } from 'react';
import { BookOpen, Globe2, ListTree, Quote, RotateCw, Sparkles, Users } from 'lucide-react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { useBookIndexStore } from '@/store/bookIndexStore';
import { useReaderStore } from '@/store/readerStore';
import { getAgentBookContext } from '@/services/agent/agentContext';
import { formatNodeCounts, nodeKindLabel, resolveNodeKind } from '@/services/bookNodes';
import MarkdownView from '@/components/common/MarkdownView';

export interface PanoramaDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Pre-confirm reindex handler (the parent owns the confirm dialog). */
  onRequestReindex: () => void;
}

type PanoramaTab = 'portrait' | 'outline';

/** Small labelled stat block for the context strip. */
function StatBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <VStack gap={1} style={{ minWidth: 0, flex: 1 }}>
      <Text type="supporting" color="secondary">{label}</Text>
      {children}
    </VStack>
  );
}

export default function PanoramaDialog({ isOpen, onOpenChange, onRequestReindex }: PanoramaDialogProps) {
  const [activeTab, setActiveTab] = useState<PanoramaTab>('portrait');

  const bookTitle = useReaderStore((s) => s.bookTitle);
  const bookHash = useReaderStore((s) => s.bookHash);
  const phase = useBookIndexStore((s) => s.phase);
  const shape = useBookIndexStore((s) => s.shape);
  const briefTotal = useBookIndexStore((s) => s.briefTotal);
  const briefedCount = useBookIndexStore((s) => s.briefedCount);
  const panoramaReady = useBookIndexStore((s) => s.panoramaReady);
  const strategy = useBookIndexStore((s) => s.strategy);

  // Live reads: briefs stream in as the background queue advances (the store
  // subscriptions above re-render this component on every progress tick).
  const context = isOpen && bookHash ? getAgentBookContext(bookHash) : undefined;
  const panorama = context?.getPanorama();
  const nodes = context?.nodes ?? [];

  const strategyLabel =
    strategy === 'native' ? '原生目录' : strategy === 'regex' ? '启发式节点识别' : strategy === 'fixed-length' ? '定长分段' : '未建立';

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width={720}
      maxHeight="80dvh"
      data-testid="panorama-dialog"
    >
      <DialogHeader
        title="全书全景画像"
        subtitle={`《${bookTitle || '当前书籍'}》 · 导入期 Agent 整理结果`}
        onOpenChange={onOpenChange}
        startContent={<BookOpen size={16} aria-hidden />}
      />
      {panorama ? (
        <VStack gap={4} style={{ minWidth: 0, flex: 1, minHeight: 0 }}>
          {/* 常驻上下文条：题材 / 划分 / 状态 */}
          <HStack gap={5} vAlign="start" wrap="wrap" data-testid="panorama-stats">
            <StatBlock label="题材类型">
              <Badge variant="blue" label={panorama.genre || '未标注'} />
            </StatBlock>
            <StatBlock label="节点划分">
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Token size="sm" label={strategyLabel} />
                <Token size="sm" label={formatNodeCounts(shape)} data-testid="panorama-node-counts" />
              </HStack>
            </StatBlock>
            <StatBlock label="画像状态">
              <Text type="supporting" weight="medium">
                {panoramaReady ? '✅ 已就绪' : '生成中…'}
              </Text>
            </StatBlock>
          </HStack>

          <TabList
            role="tablist"
            value={activeTab}
            onChange={(next) => setActiveTab(next as PanoramaTab)}
            aria-label="全书画像视图"
            data-testid="panorama-tabs"
          >
            <Tab value="portrait" label="画像" panelId="panorama-panel-portrait" />
            <Tab value="outline" label={`全书脉络（${shape.total}）`} panelId="panorama-panel-outline" />
          </TabList>

          {activeTab === 'portrait' ? (
            <VStack
              id="panorama-panel-portrait"
              role="tabpanel"
              gap={4}
              style={{ minWidth: 0, flex: 1, minHeight: 0, overflowY: 'auto' }}
            >
              {/* 主旨概要：强调式引文块 */}
              <VStack gap={2} style={{ minWidth: 0 }}>
                <HStack gap={2} vAlign="center">
                  <Quote size={14} aria-hidden />
                  <Text type="supporting" weight="medium">主旨概要</Text>
                </HStack>
                <div
                  data-testid="panorama-summary"
                  style={{
                    minWidth: 0,
                    borderInlineStart: '3px solid var(--color-accent)',
                    background: 'var(--color-background-muted)',
                    borderRadius: 'var(--radius-tile)',
                    padding: 'var(--spacing-4) var(--spacing-5)',
                    fontSize: 'var(--font-size-md)',
                    lineHeight: 1.9,
                  }}
                >
                  <MarkdownView content={panorama.summary} />
                </div>
              </VStack>

              {/* 世界观 / 背景：图标卡片 */}
              {panorama.worldSetting && (
                <VStack gap={2} style={{ minWidth: 0 }}>
                  <HStack gap={2} vAlign="center">
                    <Globe2 size={14} aria-hidden />
                    <Text type="supporting" weight="medium">世界观 / 背景</Text>
                  </HStack>
                  <Card variant="purple" padding={4} data-testid="panorama-world">
                    <Text type="supporting" style={{ lineHeight: 1.8 }}>{panorama.worldSetting}</Text>
                  </Card>
                </VStack>
              )}

              {/* 核心人物库：姓名 chips */}
              {panorama.mainCharacters && panorama.mainCharacters.length > 0 && (
                <VStack gap={2} style={{ minWidth: 0 }}>
                  <HStack gap={2} vAlign="center">
                    <Users size={14} aria-hidden />
                    <Text type="supporting" weight="medium">核心人物库</Text>
                    <Text type="supporting" color="secondary">{`（共 ${panorama.mainCharacters.length} 位）`}</Text>
                  </HStack>
                  <HStack gap={2} wrap="wrap" data-testid="panorama-characters">
                    {panorama.mainCharacters.map((name) => (
                      <Token key={name} size="sm" label={name} />
                    ))}
                  </HStack>
                </VStack>
              )}
            </VStack>
          ) : (
            <VStack
              id="panorama-panel-outline"
              role="tabpanel"
              gap={3}
              style={{ minWidth: 0, flex: 1, minHeight: 0 }}
            >
              {/* 微大纲索引进度：单位取最小节点层级（有节就是节，只有章就是章） */}
              {shape.total > 0 && (
                <VStack gap={2} style={{ minWidth: 0 }} data-testid="panorama-brief-progress">
                  <HStack justify="between" vAlign="center">
                    <Text type="supporting" weight="medium">微大纲索引进度</Text>
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
              )}

              {/* 节点微大纲：完整层级列表，独占剩余高度 */}
              {nodes.length > 0 && (
                <VStack gap={2} style={{ minWidth: 0, flex: 1, minHeight: 0 }}>
                  <HStack gap={2} vAlign="center">
                    <ListTree size={14} aria-hidden />
                    <Text type="supporting" weight="medium">节点微大纲（完整）</Text>
                    <Text type="supporting" color="secondary">第二层节点自动缩进</Text>
                  </HStack>
                  <VStack
                    gap={3}
                    data-testid="panorama-briefs"
                    style={{
                      minWidth: 0,
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                      paddingInline: 'var(--spacing-1)',
                    }}
                  >
                    {nodes.map((node) => {
                      const isNested = node.depth > 0;
                      // 行首只标层级（章 / 节 / 段），不编号——`nodeIndex` 是全书
                      // 连续序号，冒充「第 N 章」会与实际章号错位。
                      const kind = resolveNodeKind(node.depth, node.title);
                      return (
                        <HStack
                          key={node.nodeId}
                          gap={3}
                          vAlign="start"
                          data-testid="panorama-brief-item"
                          style={{
                            minWidth: 0,
                            paddingLeft: isNested ? 'var(--spacing-5)' : 0,
                            borderInlineStart: isNested
                              ? '2px solid var(--color-border)'
                              : '2px solid transparent',
                          }}
                        >
                          <Text
                            type="supporting"
                            color="secondary"
                            data-testid="panorama-brief-kind"
                            style={{ flexShrink: 0, minWidth: 20 }}
                          >
                            {nodeKindLabel(kind)}
                          </Text>
                          <VStack gap={0} style={{ minWidth: 0, flex: 1 }}>
                            <Text type="supporting" weight="medium" maxLines={1}>
                              {node.title}
                            </Text>
                            <Text
                              type="supporting"
                              color="secondary"
                              style={{ wordBreak: 'break-word', opacity: node.brief ? 1 : 0.6, lineHeight: 1.6 }}
                            >
                              {node.brief || '（待生成微简介）'}
                            </Text>
                          </VStack>
                        </HStack>
                      );
                    })}
                  </VStack>
                </VStack>
              )}
            </VStack>
          )}
        </VStack>
      ) : (
        <VStack gap={2} data-testid="panorama-empty" padding={4}>
          <HStack gap={2} vAlign="center">
            <Sparkles size={16} aria-hidden />
            <Text type="supporting">
              {phase === 'panorama' || phase === 'briefs'
                ? '全书画像正在后台构建中，稍后重新打开此弹窗即可查看。'
                : shape.total > 0
                  ? '全书画像尚未生成——请先在 ⚙️ AI 设置中配置模型，然后点击下方重新索引。'
                  : '当前书籍尚未建立全书索引。'}
            </Text>
          </HStack>
        </VStack>
      )}
      <HStack justify="end" gap={2} style={{ marginTop: 'var(--spacing-2)', flexShrink: 0 }}>
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
