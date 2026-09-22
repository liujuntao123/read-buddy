'use client';

/**
 * 章节总结 Tab (ticket 03, design doc 4.3, ADR 0004 + user review).
 *
 * Strictly manual trigger: the component only opens the chapter (cache check)
 * when the reader moves; every model call comes from an explicit button
 * (⚡ 生成本章总结 / 🔄 重新生成) or its retry.
 *
 * Scope clarity (user review): the summary always targets the **minimal node**
 * the reader currently has open (CONTEXT.md / ADR 0010) — the 节 of a 章/节
 * book, the 章 of a single-level book. The header states where the reader is
 * (章 › 节 breadcrumb + node title) and how big the viewpoint is (level word,
 * char count, long-document note); the level word always comes from the node
 * model (`nodeKindLabel`), never from a literal. Engine books whose section
 * text warms asynchronously get a bounded retry before the "no extractable
 * text" warning is shown.
 */
import { useEffect, useMemo, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { getSummaryStore } from '@/store/summaryStore';
import { useReaderStore } from '@/store/readerStore';
import { getOpenedBook } from '@/services/library/contentRegistry';
import { resolveCurrentNodeText } from '@/services/summary/nodeSource';
import {
  nodeKindLabel,
  resolveCurrentNode,
  resolveNodeHierarchy,
  type NodeHierarchy,
} from '@/services/bookNodes';
import { SUMMARY_SINGLE_PASS_MAX_CHARS } from '@/types/ai';
import MarkdownView from '@/components/common/MarkdownView';

/** How often the async text warm-up is re-checked before giving up. */
const TEXT_RETRY_LIMIT = 4;
const TEXT_RETRY_DELAY_MS = 700;

/**
 * Rich Markdown renderer for the three-part chapter summary.
 */
export function SummaryBody({ content, streaming = false }: { content: string; streaming?: boolean }) {
  return (
    <div data-testid="summary-body" style={{ fontSize: 'var(--font-size-sm)' }}>
      <MarkdownView content={content} streaming={streaming} />
    </div>
  );
}

const formatTimestamp = (ms: number): string => {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * Node-model scope header (CONTEXT.md / ADR 0010): the summary viewpoint is
 * always the minimal node the reader has open. Two useful lines only —
 * 1. where: the 章 breadcrumb (omitted when the node *is* a 章) › node title;
 * 2. how big: the level word from the node model, the char count and the
 *    long-document note. Position / membership pills said nothing actionable.
 */
function ScopeHeader({
  hierarchy,
  charCount,
  titleFallback,
}: {
  hierarchy: NodeHierarchy;
  charCount: number;
  titleFallback: string;
}) {
  const title = hierarchy.title || titleFallback;
  const { kind, parentTitle } = hierarchy;
  return (
    <VStack gap={2} style={{ minWidth: 0 }}>
      <HStack gap={1} vAlign="center" wrap="wrap" style={{ minWidth: 0 }}>
        {parentTitle && (
          <Text type="supporting" color="secondary" maxLines={1} style={{ minWidth: 0 }}>
            {`《${parentTitle}》 ›`}
          </Text>
        )}
        <Text weight="semibold" maxLines={1} style={{ minWidth: 0, flex: 1 }}>
          {title}
        </Text>
      </HStack>
      <HStack gap={1} vAlign="center" wrap="wrap" data-testid="summary-scope-row">
        <Token size="sm" label={nodeKindLabel(kind)} data-testid="summary-node-kind" />
        {charCount > 0 && <Token size="sm" label={`约 ${charCount.toLocaleString()} 字`} />}
        {charCount > SUMMARY_SINGLE_PASS_MAX_CHARS && <Token size="sm" label="长文 · 分块提炼后汇总" />}
      </HStack>
    </VStack>
  );
}

export default function SummaryTab() {
  const useSummary = getSummaryStore();
  const phase = useSummary((s) => s.phase);
  const content = useSummary((s) => s.content);
  const cachedSummary = useSummary((s) => s.cachedSummary);
  const nodeTitle = useSummary((s) => s.nodeTitle);
  const charCount = useSummary((s) => s.charCount);
  const stageLabel = useSummary((s) => s.stageLabel);
  const error = useSummary((s) => s.error);
  const openNode = useSummary((s) => s.openNode);
  const generate = useSummary((s) => s.generate);
  const stop = useSummary((s) => s.stop);

  const bookHash = useReaderStore((s) => s.bookHash);
  const spineIndex = useReaderStore((s) => s.spineIndex);
  const anchor = useReaderStore((s) => s.anchor);
  const readerNodeTitle = useReaderStore((s) => s.nodeTitle);

  /**
   * Node-model hierarchy of the current viewpoint (章 › 节 breadcrumb) plus the
   * node ordinal used as the summary cache key. The ordinal resolution mirrors
   * `summaryStore.resolveCurrentNodeContext()`: the node model wins over the
   * physical spine ordinal, so the cache check and the generation address the
   * exact same row.
   */
  const { hierarchy, activeNodeIndex } = useMemo(
    // Recompute when the reader moves; brief / index updates don't affect it.
    () => ({
      hierarchy: resolveNodeHierarchy(),
      activeNodeIndex: resolveCurrentNode()?.nodeIndex ?? spineIndex,
    }),
    [bookHash, spineIndex, anchor, readerNodeTitle],
  );

  /** Async text warm-up retry bookkeeping, keyed per section. */
  const [textRetry, setTextRetry] = useState<{ key: string; attempts: number }>({
    key: '',
    attempts: 0,
  });
  const activeKey = `${bookHash}:${activeNodeIndex}`;
  const openedBook = bookHash ? getOpenedBook(bookHash) : undefined;
  const isEngineBook = Boolean(openedBook) && !openedBook!.getMonolithicText;
  const retriesExhausted =
    textRetry.key === activeKey && (!isEngineBook || textRetry.attempts >= TEXT_RETRY_LIMIT);

  // Cache check only — never auto-generates (ADR 0004).
  useEffect(() => {
    if (!bookHash) return;
    const { title, charCount: resolved } = resolveCurrentNodeText();
    void openNode(bookHash, activeNodeIndex, readerNodeTitle || title, resolved);
  }, [bookHash, activeNodeIndex, readerNodeTitle, openNode]);

  // Engine books (EPUB/MOBI/…) warm their section text asynchronously: when
  // the cache check lands with zero text, poll a few times before concluding
  // there is nothing extractable (previously this flashed the misleading
  // "图像或字数极少" warning the moment a chapter was entered). TXT / demo
  // sources resolve synchronously, so they settle immediately.
  useEffect(() => {
    if (!bookHash) return;
    if (textRetry.key !== activeKey) {
      setTextRetry({ key: activeKey, attempts: 0 });
      return;
    }
    if (!isEngineBook) {
      if (textRetry.attempts !== TEXT_RETRY_LIMIT) setTextRetry({ key: activeKey, attempts: TEXT_RETRY_LIMIT });
      return;
    }
    if (phase !== 'idle' || charCount !== 0) return;
    if (textRetry.attempts >= TEXT_RETRY_LIMIT) return;
    const attempt = textRetry.attempts + 1;
    setTextRetry({ key: activeKey, attempts: attempt });
    const timer = window.setTimeout(() => {
      const { title, charCount: resolved } = resolveCurrentNodeText();
      void openNode(bookHash, activeNodeIndex, readerNodeTitle || title, resolved);
    }, TEXT_RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- textRetry is intentionally read once per render cycle
  }, [phase, charCount, bookHash, activeNodeIndex, readerNodeTitle, openNode, textRetry.key]);

  // Every level word below comes from the node model (CONTEXT.md 词表) — the
  // component never spells 章 / 节 itself.
  const scopeLevel = nodeKindLabel(hierarchy.kind);
  const scopeTitle = hierarchy.title || nodeTitle || '…';

  if (!bookHash) {
    return (
      <VStack
        data-testid="summary-tab-panel"
        padding={4}
        style={{ border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-container)' }}
      >
        <Text color="secondary">尚未打开书籍，先在阅读器中选择一本书吧。</Text>
      </VStack>
    );
  }

  if (phase === 'checking-cache') {
    return (
      <HStack
        data-testid="summary-tab-panel"
        gap={2}
        vAlign="center"
        padding={4}
        style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-container)' }}
      >
        <Spinner size="sm" aria-label="检查缓存中" />
        <Text color="secondary">正在检查本地总结缓存...</Text>
      </HStack>
    );
  }

  if (phase === 'generating') {
    return (
      <Card data-testid="summary-tab-panel" padding={4}>
        <VStack gap={3}>
          <VStack gap={2} style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--spacing-2)' }}>
            <HStack justify="between" vAlign="center" gap={2}>
              <ScopeHeader hierarchy={hierarchy} charCount={charCount} titleFallback={nodeTitle} />
              <Button
                label="⏹ 停止生成"
                variant="secondary"
                size="sm"
                data-testid="stop-generation"
                onClick={stop}
              />
            </HStack>
          </VStack>
          {stageLabel && (
            <HStack gap={1} vAlign="center" role="status" data-testid="summary-stage-label">
              <Spinner size="sm" aria-label="生成中" />
              <Text type="supporting">{stageLabel}</Text>
            </HStack>
          )}
          {content ? (
            <SummaryBody content={content} streaming />
          ) : (
            <Text type="supporting" color="secondary">
              模型正在通读当前{scopeLevel}《{scopeTitle}》全文，稍等片刻...
            </Text>
          )}
        </VStack>
      </Card>
    );
  }

  if (phase === 'idle' || phase === 'aborted') {
    const nodeLabel = `当前${scopeLevel}《${scopeTitle}》`;
    return (
      <Card data-testid="summary-tab-panel" padding={4}>
        <VStack gap={2}>
          <ScopeHeader hierarchy={hierarchy} charCount={charCount} titleFallback={nodeTitle} />
          <Text type="supporting" color="secondary">
            {charCount === 0 && !retriesExhausted
              ? '正在提取当前节点的正文文本...'
              : `${nodeLabel}还没有总结`}
          </Text>
          {phase === 'aborted' && (
            <Banner
              data-testid="summary-aborted-note"
              status="warning"
              container="card"
              collapsible={false}
              title="已停止生成，已产出的部分保留在下方，可随时重新发起。"
            />
          )}
          {phase === 'aborted' && content ? <SummaryBody content={content} /> : null}
          {charCount < 50 && retriesExhausted ? (
            <Banner
              data-testid="summary-empty-text-warning"
              role="status"
              status="warning"
              container="card"
              collapsible={false}
              title="当前节点正文为图像或字数极少，无法提取纯文本总结。"
            />
          ) : charCount >= 50 ? (
            <>
              <Button
                label={`⚡ 总结当前${scopeLevel}`}
                variant="primary"
                data-testid="generate-summary"
                onClick={() => void generate()}
              />
              <Text type="supporting" color="secondary">
                {`将以当前${scopeLevel}《${scopeTitle}》全文为总结视角${
                  hierarchy.parentTitle
                    ? `（隶属${nodeKindLabel('chapter')}《${hierarchy.parentTitle}》）`
                    : '（全书一级节点）'
                }；要点会讲清来龙去脉。`}
              </Text>
            </>
          ) : null}
        </VStack>
      </Card>
    );
  }

  if (phase === 'error') {
    return (
      <Card data-testid="summary-tab-panel" variant="red" role="alert" padding={4}>
        <VStack gap={2}>
          <Text data-testid="summary-error-text">{error || '生成失败'}</Text>
          <HStack gap={2} vAlign="center">
            <Button
              label="重试"
              variant="secondary"
              size="sm"
              data-testid="retry-summary"
              onClick={() => void generate()}
            />
            <Text type="supporting" color="secondary">
              若持续失败，请去侧栏右上角 ⚙ 检查 AI Provider 配置。
            </Text>
          </HStack>
        </VStack>
      </Card>
    );
  }

  // phase === 'done' (transient) | 'cached'
  return (
    <Card data-testid="summary-tab-panel" padding={4}>
      <VStack gap={2}>
        <VStack gap={2} style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--spacing-2)' }}>
          <HStack justify="between" vAlign="start" gap={2}>
            <ScopeHeader hierarchy={hierarchy} charCount={charCount} titleFallback={nodeTitle || cachedSummary?.nodeTitle || ''} />
            <Button
              label="🔄 重新生成"
              variant="ghost"
              size="sm"
              data-testid="regenerate-summary"
              tooltip="丢弃当前总结并重新生成"
              onClick={() => void generate(true)}
            />
          </HStack>
          {cachedSummary && (
            <Text type="supporting" maxLines={1}>
              模型 {cachedSummary.modelUsed} · 更新于 {formatTimestamp(cachedSummary.updatedAt)}
              {cachedSummary.pipeline === 'map-reduce' ? ' · 分块汇总' : ''}
            </Text>
          )}
        </VStack>
        <SummaryBody content={content} />
      </VStack>
    </Card>
  );
}
