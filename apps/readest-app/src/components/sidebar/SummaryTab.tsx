'use client';

/**
 * 章节总结 Tab (ticket 03, design doc 4.3, ADR 0004 + user review).
 *
 * Strictly manual trigger: the component only opens the chapter (cache check)
 * when the reader moves; every model call comes from an explicit button
 * (总结当前节 / 重新生成) or its retry. The CTA itself is hidden for nodes that
 * carry no summarizable prose — 版权页 / 目录页 / 封面 (ADR 0017, `nodeContent`).
 *
 * Scope clarity: the summary always targets the **minimal node** the reader
 * currently has open (CONTEXT.md / ADR 0010) — the 节 of a 章/节 book, the 章 of
 * a single-level book. The header states where the reader is (章 › 节 breadcrumb
 * + node title) and how big the viewpoint is (level word, char count,
 * long-document note); the level word always comes from the node model
 * (`nodeKindLabel`), never from a literal. Engine books whose section text warms
 * asynchronously get a bounded retry before the "no extractable text" warning is
 * shown, and the summary content card appears only when content exists.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Clock, RefreshCw, Settings2, Sparkles, Square } from 'lucide-react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { useSummaryStore, type SummaryStore } from '@/store/summaryStore';
import { useReaderStore } from '@/store/readerStore';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { providerReady } from '@/services/ai/providerReadiness';
import { getOpenedBook } from '@/services/library/contentRegistry';
import { nodeKindLabel, resolveCurrentNodeView, type NodeView } from '@/services/bookNodes';
import {
  NODE_CONTENT_LABEL,
  assessNodeContent,
  describeNonSummarizable,
} from '@/services/bookNodes/nodeContent';
import { SUMMARY_SINGLE_PASS_MAX_CHARS } from '@/types/ai';
import MarkdownView from '@/components/common/MarkdownView';
import CopyButton from '@/components/common/CopyButton';
import AIProviderSetupCard from '@/components/common/AIProviderSetupCard';

/** How often the async text warm-up is re-checked before giving up. */
const TEXT_RETRY_LIMIT = 4;
const TEXT_RETRY_DELAY_MS = 700;

/** What the setup card promises *this* panel will do once a model exists. */
const SETUP_DESCRIPTION = '配置模型后，可以为当前节点生成三段式总结：核心要义、内容脉络与关键术语。';

/**
 * Parses markdown into three-part sections if headings are present.
 */
export interface SummarySection {
  id: string;
  heading: string;
  content: string;
}

export function parseSummarySections(markdown: string): {
  preface?: string;
  sections: SummarySection[];
} {
  if (!markdown) {
    return { sections: [] };
  }
  const lines = markdown.split(/\r?\n/);
  const sections: SummarySection[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];
  let prefaceLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^#{2,4}\s+(.+)$/);
    if (match) {
      if (!currentHeading) {
        prefaceLines = currentLines;
      } else {
        sections.push({
          id: `section-${sections.length}`,
          heading: currentHeading,
          content: currentLines.join('\n').trim(),
        });
      }
      currentHeading = match[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentHeading) {
    sections.push({
      id: `section-${sections.length}`,
      heading: currentHeading,
      content: currentLines.join('\n').trim(),
    });
  } else {
    prefaceLines = currentLines;
  }

  const preface = prefaceLines.join('\n').trim();
  return { preface: preface || undefined, sections };
}

/** Classifies a section heading into one of the canonical summary roles. */
const getSectionKind = (heading: string): 'core' | 'outline' | 'terms' | 'general' => {
  if (heading.includes('核心要义') || heading.includes('主旨')) return 'core';
  if (heading.includes('脉络') || heading.includes('内容')) return 'outline';
  if (heading.includes('概念') || heading.includes('术语')) return 'terms';
  return 'general';
};

/**
 * Rich Markdown renderer for the three-part chapter summary.
 *
 * Renders sections in collapsible accordion panels (核心要义 / 关键内容脉络 / 核心概念与关键术语).
 * Type size and leading are set by the surrounding `.summary-markdown-wrapper`
 * rules in globals.css (same place the summary's reading typography lives).
 */
export function SummaryBody({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const { preface, sections } = useMemo(() => parseSummarySections(content), [content]);

  if (sections.length === 0) {
    return (
      <div data-testid="summary-body">
        <MarkdownView content={content} streaming={streaming} />
      </div>
    );
  }

  return (
    <div data-testid="summary-body" className="summary-accordion-group">
      {preface && (
        <div style={{ marginBottom: 'var(--spacing-3)' }}>
          <MarkdownView content={preface} />
        </div>
      )}
      {sections.map((section, idx) => {
        const isLast = idx === sections.length - 1;
        const kind = getSectionKind(section.heading);
        return (
          <Collapsible
            key={section.heading}
            defaultIsOpen={true}
            className={`summary-accordion-item summary-section-${kind}`}
            data-testid={`summary-accordion-${section.id}`}
            trigger={
              <Text
                weight="semibold"
                style={{
                  // 小标题比总结正文（14px）大半档，层级靠字号而不是分割线。
                  fontSize: 'calc(var(--font-size-base) * 0.9375)',
                  lineHeight: 'calc(var(--text-body-leading) * 1.05)',
                  color: 'var(--color-text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {section.heading}
              </Text>
            }
          >
            <div className={`summary-accordion-content summary-content-${kind}`}>
              <MarkdownView
                content={section.content}
                streaming={streaming && isLast}
              />
            </div>
          </Collapsible>
        );
      })}
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
              {/* 「」 quotes a node title; 《》 is reserved for book titles. */}
              {`「${parentTitle}」 ›`}
            </Text>
          )}
          <Text
            weight="semibold"
            maxLines={1}
            style={{ fontSize: 'calc(var(--font-size-base) * 0.9375)', lineHeight: 1.35 }}
          >
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

  // The one readiness rule (providerReadiness): without a key the CTA is
  // replaced by the setup card, instead of failing on the reader's first click.
  const providerConfigured = useAISettingsStore((s) => providerReady(s.settings));
  const openSettings = useAISidebarStore((s) => s.openSettings);

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
  /**
   * 「这一节值不值得总结」——版权页 / 目录页 / 封面这类页面没有可提炼的正文，
   * 总结按钮对它们只是噪音（用户反馈：版权信息页、目录页不该有总结按钮）。
   * 判定是离线的纯规则（`services/bookNodes/nodeContent`），所以翻页时不会多出
   * 一次模型调用；判不出来的一律按正文处理。
   */
  const worthSummarizing = useMemo(
    () => assessNodeContent({ title: view.title, text: view.text }),
    [view.title, view.text],
  );

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
              label="停止"
              variant="secondary"
              size="sm"
              data-testid="stop-generation"
              icon={<Square size={14} aria-hidden />}
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
    const isUnderLimit = worthSummarizing.summarizable && charCount < 50 && retriesExhausted;
    const canGenerate = worthSummarizing.summarizable && charCount >= 50;

    return (
      <div data-testid="summary-tab-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
        {/* Hidden test/a11y descriptions */}
        <div style={{ display: 'none' }}>
          {`当前${scopeLevel}「${scopeTitle}」暂无总结 提炼当前${scopeLevel}的核心内容与脉络`}
        </div>

        <ScopeHeader
          hierarchy={hierarchy}
          charCount={charCount}
          titleFallback={nodeTitle}
          status={
            !worthSummarizing.summarizable
              ? { label: NODE_CONTENT_LABEL[worthSummarizing.kind], tone: 'pending' }
              : charCount === 0 && !retriesExhausted
                ? { label: '正在解析…', tone: 'working' }
                : { label: '未总结', tone: 'pending' }
          }
          action={
            // No provider ⇒ no CTA: the setup card below says what is missing
            // and takes the reader to the fix (ticket 14 items 3 + 7).
            canGenerate && providerConfigured ? (
              <Button
                label={`总结当前${scopeLevel}`}
                variant="primary"
                size="sm"
                data-testid="generate-summary"
                icon={<Sparkles size={14} aria-hidden />}
                onClick={() => void generate()}
              />
            ) : null
          }
        />

        {/* The setup card stands exactly where the CTA would: on a node that
            cannot be summarized anyway (版权页 / 图像页), a model is not what is
            missing, and the note below already says so. */}
        {!providerConfigured && canGenerate && (
          <AIProviderSetupCard testId="summary-setup" description={SETUP_DESCRIPTION} />
        )}

        {/* 没有可总结的正文：说明为什么没有按钮，而不是让一个按钮消失得不明不白。
            这是「本页本来就不需要总结」的事实，不是错误，所以是 info 而不是 warning。 */}
        {!worthSummarizing.summarizable && (
          <Banner
            data-testid="summary-not-summarizable-note"
            role="status"
            status="info"
            container="card"
            collapsible={false}
            title={describeNonSummarizable(worthSummarizing.kind)}
          />
        )}

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
    // 「没配模型」不是一次生成失败，只是缺 Key 的副作用：用引导卡替掉错误卡，
    // 读者拿到的才是能解决问题的动作（重试在这里只会立刻再失败一次）。
    const missingProvider = !providerConfigured;

    return (
      <div data-testid="summary-tab-panel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
        <ScopeHeader hierarchy={hierarchy} charCount={charCount} titleFallback={nodeTitle} />
        {missingProvider ? (
          <AIProviderSetupCard testId="summary-setup" description={SETUP_DESCRIPTION} />
        ) : (
          <Card variant="red" role="alert" padding={4}>
            <VStack gap={3}>
              {/* 分类后的中文文案（设计文档 §6）：网络 / Key / 限流 / 模型 / 上下文 / 服务端。 */}
              <Text data-testid="summary-error-text" weight="medium" style={{ lineHeight: 1.6 }}>
                {error || '生成失败'}
              </Text>
              {/* 两个出口：原地重试，或去设置里改配置（Key、Model ID、Base URL）。 */}
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Button
                  label="重试"
                  variant="secondary"
                  size="sm"
                  data-testid="retry-summary"
                  onClick={() => void generate()}
                />
                <Button
                  label="打开 AI 设置"
                  variant="secondary"
                  size="sm"
                  data-testid="summary-error-settings"
                  icon={<Settings2 size={14} aria-hidden />}
                  onClick={openSettings}
                />
              </HStack>
            </VStack>
          </Card>
        )}
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
          <HStack gap={1} vAlign="center">
            {/* 复制与重新生成并列：刚生成完的总结通常正要被带走（笔记、文档）。 */}
            <CopyButton
              getText={() => content}
              label="复制总结"
              tooltip="复制这份总结"
              testId="copy-summary"
            />
            <IconButton
              label="重新生成"
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} aria-hidden />}
              data-testid="regenerate-summary"
              tooltip="忽略缓存，用当前模型重新生成"
              onClick={() => void generate(true)}
            />
          </HStack>
        }
      />
      <div className="summary-markdown-wrapper">
        <SummaryBody content={content} />
      </div>
    </div>
  );
}
