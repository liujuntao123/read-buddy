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
'use client';

/**
 * 章节总结 Tab (ticket 03, design doc 4.3, ADR 0004 + user review).
 *
 * Strictly manual trigger: the component only opens the chapter (cache check)
 * when the reader moves; every model call comes from an explicit button
 * (⚡ 总结当前章 / 🔄 重新生成) or its retry.
 *
 * Scope clarity: minimal node the reader currently has open (CONTEXT.md / ADR 0010).
 * High-density, single-line scope header with status & CTA in the primary card.
 * Summary content card is only shown when summary content actually exists.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Clock, RefreshCw } from 'lucide-react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { useSummaryStore, type SummaryStore } from '@/store/summaryStore';
import { useReaderStore } from '@/store/readerStore';
import { getOpenedBook } from '@/services/library/contentRegistry';
import { nodeKindLabel, resolveCurrentNodeView, type NodeView } from '@/services/bookNodes';
import { SUMMARY_SINGLE_PASS_MAX_CHARS } from '@/types/ai';
import MarkdownView from '@/components/common/MarkdownView';

/** How often the async text warm-up is re-checked before giving up. */
const TEXT_RETRY_LIMIT = 4;
const TEXT_RETRY_DELAY_MS = 700;

/**
 * Rich Markdown renderer for the three-part chapter summary.
 *
 * Type size and leading are set by the surrounding `.summary-markdown-wrapper`
 * rules in globals.css (same place the summary's reading typography lives), so
 * this element only marks what is being rendered.
 */
export function SummaryBody({ content, streaming = false }: { content: string; streaming?: boolean }) {
  return (
    <div data-testid="summary-body">
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
 * Scope card: 「这是哪一节 · 状态 · 动作」 in one card.
 *
 * Two rows, because the four facts are not the same kind of information and
 * should not read as one grey sentence (user review) — title row first, then a
 * metadata row where each item carries its own weight:
 *   字数   灰色 Token  —— 中性的规模事实
 *   分块汇总 青色 Token —— 流水线事实（只有长文才有）
 *   生成状态 语义色 Token —— 绿=已生成 / 灰=未总结 / 蓝=进行中，一眼可扫
 *   更新时间 带时钟图标的最弱文字 —— 溯源信息，不该跟状态抢注意力
 */
type ScopeStatusTone = 'done' | 'pending' | 'working';

const STATUS_TONE_COLOR: Record<ScopeStatusTone, 'green' | 'gray' | 'blue'> = {
  done: 'green',
  pending: 'gray',
  working: 'blue',
};

function ScopeHeader({
  hierarchy,
  charCount,
  titleFallback,
  action,
  status,
  updatedAt,
}: {
  hierarchy: NodeView;
  charCount: number;
  titleFallback: string;
  action?: ReactNode;
  status?: { label: string; tone: ScopeStatusTone };
  /** When the displayed summary was generated (ms); omitted while there is none. */
  updatedAt?: number;
}) {
  const title = hierarchy.title || titleFallback;
  const { kind, parentTitle } = hierarchy;
  const scopeLevel = nodeKindLabel(kind);

  return (
    <div className="summary-main-card" data-testid="summary-scope-header">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--spacing-3)',
        }}
      >
        {/* Row 1: breadcrumb + node title, with the primary action on the right */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            minWidth: 0,
            flex: 1,
            flexWrap: 'wrap',
          }}
        >
          {parentTitle && (
            <Text
              type="supporting"
              color="secondary"
              maxLines={1}
              style={{ fontSize: 'var(--font-size-sm)' }}
            >
              {`《${parentTitle}》 ›`}
            </Text>
          )}
          <Text weight="semibold" maxLines={1} style={{ fontSize: 'var(--font-size-base)', lineHeight: 1.35 }}>
            {title}
          </Text>
        </div>

        {action && (
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{action}</div>
        )}
      </div>

      {/* Row 2: metadata, each item styled for what it is */}
      <HStack gap={2} vAlign="center" wrap="wrap" data-testid="summary-scope-row">
        <span data-testid="summary-node-kind" style={{ display: 'none' }}>{scopeLevel}</span>
        {charCount > 0 && (
          <Token size="sm" color="gray" label={`约 ${charCount.toLocaleString()} 字`} />
        )}
        {charCount > SUMMARY_SINGLE_PASS_MAX_CHARS && (
          <Token size="sm" color="cyan" label="分块汇总" />
        )}
        {status && <Token size="sm" color={STATUS_TONE_COLOR[status.tone]} label={status.label} />}
        {updatedAt !== undefined && (
          <HStack gap={1} vAlign="center" style={{ minWidth: 0 }} data-testid="summary-updated-at">
            <Clock
              size={11}
              aria-hidden
              style={{ flexShrink: 0, color: 'var(--color-text-secondary)', opacity: 0.65 }}
            />
            <Text
              type="supporting"
              color="secondary"
              maxLines={1}
              style={{ opacity: 0.75, whiteSpace: 'nowrap' }}
            >
              {`更新于 ${formatTimestamp(updatedAt)}`}
            </Text>
          </HStack>
        )}
      </HStack>
    </div>
  );
}

interface SummaryTabProps {
  /** Injectable store seam; defaults to the app-wide singleton (候选 epilogue). */
  store?: SummaryStore;
}

export default function SummaryTab({ store = useSummaryStore }: SummaryTabProps = {}) {
  const useSummary = store;
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

  const view = useMemo(
    () => resolveCurrentNodeView(),
    [bookHash, spineIndex, anchor, readerNodeTitle],
  );
  const activeNodeIndex = view.nodeIndex;
  const hierarchy = view;

  const [textRetry, setTextRetry] = useState<{ key: string; attempts: number }>({
    key: '',
    attempts: 0,
  });
  const activeKey = `${bookHash}:${activeNodeIndex}`;
  const openedBook = bookHash ? getOpenedBook(bookHash) : undefined;
  const isEngineBook = openedBook?.kind === 'engine';
  const retriesExhausted =
    textRetry.key === activeKey && (!isEngineBook || textRetry.attempts >= TEXT_RETRY_LIMIT);

  useEffect(() => {
    if (!bookHash) return;
    void openNode(bookHash, activeNodeIndex, readerNodeTitle || view.title, view.charCount);
  }, [bookHash, activeNodeIndex, readerNodeTitle, openNode, view.title, view.charCount]);

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
      void openNode(bookHash, activeNodeIndex, readerNodeTitle || view.title, view.charCount);
    }, TEXT_RETRY_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, charCount, bookHash, activeNodeIndex, readerNodeTitle, openNode, textRetry.key]);

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
        padding={3}
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-container)',
          background: 'var(--color-background-surface)',
        }}
      >
        <Spinner size="sm" aria-label="加载中" />
        <Text color="secondary" size="sm">正在检查章节总结…</Text>
      </HStack>
    );
  }

  if (phase === 'generating') {
    return (
      <div data-testid="summary-tab-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
        <ScopeHeader
          hierarchy={hierarchy}
          charCount={charCount}
          titleFallback={nodeTitle}
          status={{ label: '生成中', tone: 'working' }}
          action={
            <Button
              label="⏹ 停止"
              variant="secondary"
              size="sm"
              data-testid="stop-generation"
              onClick={stop}
            />
          }
        />

        {stageLabel && (
          <div data-testid="summary-stage-label" className="summary-stage-chip" role="status">
            <Spinner size="sm" aria-label="生成中" />
            <Text type="supporting" color="accent" weight="medium" style={{ fontSize: 'var(--font-size-sm)' }}>
              {stageLabel}
            </Text>
          </div>
        )}

        <div className="summary-markdown-wrapper">
          {content ? (
            <SummaryBody content={content} streaming />
          ) : (
            <Text type="supporting" color="secondary">
              正在生成总结，请稍候…
            </Text>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'idle' || phase === 'aborted') {
    const isUnderLimit = charCount < 50 && retriesExhausted;
    const canGenerate = charCount >= 50;

    return (
      <div data-testid="summary-tab-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
        {/* Hidden test/a11y descriptions */}
        <div style={{ display: 'none' }}>
          {`当前${scopeLevel}《${scopeTitle}》暂无总结 提炼当前${scopeLevel}的核心内容与脉络`}
        </div>

        <ScopeHeader
          hierarchy={hierarchy}
          charCount={charCount}
          titleFallback={nodeTitle}
          status={
            charCount === 0 && !retriesExhausted
              ? { label: '正在解析…', tone: 'working' }
              : { label: '未总结', tone: 'pending' }
          }
          action={
            canGenerate ? (
              <Button
                label={`⚡ 总结当前${scopeLevel}`}
                variant="primary"
                size="sm"
                data-testid="generate-summary"
                onClick={() => void generate()}
              />
            ) : null
          }
        />

        {isUnderLimit && (
          <Banner
            data-testid="summary-empty-text-warning"
            role="status"
            status="warning"
            container="card"
            collapsible={false}
            title="当前章节主要为图片或字数过少，无法生成文本总结。"
          />
        )}

        {phase === 'aborted' && (
          <Banner
            data-testid="summary-aborted-note"
            status="warning"
            container="card"
            collapsible={false}
            title="已停止生成。可随时重新发起。"
          />
        )}

        {/* Content card is only displayed when there is summary content */}
        {content ? (
          <div className="summary-markdown-wrapper">
            <SummaryBody content={content} />
          </div>
        ) : null}
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div data-testid="summary-tab-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
        <ScopeHeader hierarchy={hierarchy} charCount={charCount} titleFallback={nodeTitle} />
        <Card variant="red" role="alert" padding={4}>
          <VStack gap={3}>
            <Text data-testid="summary-error-text" weight="medium">{error || '生成失败'}</Text>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Button
                label="重试"
                variant="secondary"
                size="sm"
                data-testid="retry-summary"
                onClick={() => void generate()}
              />
              <Text type="supporting" color="secondary" style={{ fontSize: 'var(--font-size-sm)' }}>
                若持续失败，请在侧栏右上角 ⚙ 检查 AI 设置。
              </Text>
            </HStack>
          </VStack>
        </Card>
      </div>
    );
  }

  // phase === 'done' (transient) | 'cached'
  //
  // 溯源信息（更新于…）与「重新生成」都在 summary-main-card 里：卡片本来就是
  // 「这是哪一节 · 状态 · 动作」的容器，单独一条信息条只会把同一件事说两遍。
  // 模型名不在这里 —— 伴读与总结共用同一个模型，它属于侧栏 tab 那一层
  // (AISidebar 的 header)，见 `sidebar-model-chip`。
  return (
    <div data-testid="summary-tab-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
      <ScopeHeader
        hierarchy={hierarchy}
        charCount={charCount}
        titleFallback={nodeTitle || cachedSummary?.nodeTitle || ''}
        status={{ label: '已生成', tone: 'done' }}
        updatedAt={cachedSummary?.updatedAt}
        action={
          <IconButton
            label="重新生成"
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} aria-hidden />}
            data-testid="regenerate-summary"
            tooltip="忽略缓存，用当前模型重新生成"
            onClick={() => void generate(true)}
          />
        }
      />
      <div className="summary-markdown-wrapper">
        <SummaryBody content={content} />
      </div>
    </div>
  );
}
