'use client';

/**
 * 导入索引进度指示条 (docs/architecture.md + user
 * request): a minimal status row above the conversation stream. Clicking the
 * bar opens the whole-book panorama dialog (画像弹窗); the ↻ button on the
 * right re-runs the import pipeline (重新索引) behind a confirmation, for
 * users unsatisfied with the generated panorama / briefs.
 */
import { useState } from 'react';
import { ChevronRight, CircleDot, Compass, KeyRound, Loader2, RotateCw, Sparkles } from 'lucide-react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { useBookIndexStore } from '@/store/bookIndexStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useReaderStore } from '@/store/readerStore';
import { providerReady } from '@/services/ai/providerReadiness';
import { formatBookScale } from '@/services/bookNodes';
import PanoramaDialog from './PanoramaDialog';

export default function IndexingStatusBar() {
  const phase = useBookIndexStore((s) => s.phase);
  const shape = useBookIndexStore((s) => s.shape);
  const briefTotal = useBookIndexStore((s) => s.briefTotal);
  const briefedCount = useBookIndexStore((s) => s.briefedCount);
  const panoramaReady = useBookIndexStore((s) => s.panoramaReady);
  const progressLabel = useBookIndexStore((s) => s.progressLabel);
  const error = useBookIndexStore((s) => s.error);
  const reindex = useBookIndexStore((s) => s.reindex);
  const startIndexing = useBookIndexStore((s) => s.startIndexing);
  const bookHash = useReaderStore((s) => s.bookHash);
  const spineIndex = useReaderStore((s) => s.spineIndex);
  const setSidebarExpanded = useAISidebarStore((s) => s.setExpanded);
  const openSettings = useAISidebarStore((s) => s.openSettings);
  const settings = useAISettingsStore((s) => s.settings);

  const [panoramaOpen, setPanoramaOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Nothing indexed yet (or demo flow): stay invisible.
  if (shape.total === 0) return null;

  const indexing = phase === 'panorama' || phase === 'briefs';
  const reindexing = phase === 'segmenting';
  const awaitingKey = phase === 'awaiting-key';
  const failed = phase === 'failed';
  // Once the reader has configured a provider, the parked state becomes an
  // invitation to start — so the action below is a start button, not a
  // dead-end link back to the settings they just filled in.
  const configured = providerReady(settings);
  const hasStarted = panoramaReady || briefedCount > 0 || indexing || reindexing || phase === 'ready';

  const runReindex = () => {
    if (!bookHash) return;
    void reindex(bookHash, { currentSpineIndex: spineIndex });
  };

  /** Bring the reader to the AI settings panel (the awaiting-key action). */
  const goToSettings = () => {
    setSidebarExpanded(true);
    openSettings();
  };

  /**
   * One line, three kinds of information, each with its own light treatment
   * (user review): the status sentence carries the temperature of the moment
   * (进行中 = accent, 失败 = error, 就绪 = neutral), while the progress and
   * 画像就绪 facts are Tokens whose colour encodes completeness — the row reads
   * as 「在做什么 · 做到哪了 · 有什么可用」 instead of one grey sentence.
   */
  const status: { text: string; testId: string; tone: 'accent' | 'neutral' | 'error' } = reindexing
    ? { text: '● 正在重建全书索引…', testId: 'indexing-progress-label', tone: 'accent' }
    : indexing
      ? {
          text: phase === 'panorama' ? '● 正在构建全书全景画像…' : `● ${progressLabel}`,
          testId: 'indexing-progress-label',
          tone: 'accent',
        }
      : failed
        ? { text: `索引失败：${error ?? '未知错误'}`, testId: 'index-failed-label', tone: 'error' }
        : awaitingKey
          ? {
              text: configured ? 'AI 已就绪 · 点击生成伴读索引' : '配置 API Key 后可生成伴读索引',
              testId: 'index-awaiting-key-label',
              tone: 'accent',
            }
          : hasStarted
            ? { text: formatBookScale(shape), testId: 'index-ready-label', tone: 'neutral' }
            : {
                text: `${formatBookScale(shape)} · 点击建立全书画像与索引`,
                testId: 'index-ready-label',
                tone: 'accent',
              };

  // 微大纲进度：只有索引真的跑过（或有总量）才出现，避免空态多一个 0/0 噪音。
  const showProgress = briefTotal > 0 && (indexing || reindexing || briefedCount > 0);
  const progressComplete = briefTotal > 0 && briefedCount >= briefTotal;

  return (
    <>
      <HStack
        data-testid="indexing-status-bar"
        gap={2}
        vAlign="center"
        role="button"
        tabIndex={0}
        aria-label="查看全书画像"
        onClick={() => setPanoramaOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setPanoramaOpen(true);
          }
        }}
        style={{
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-2)',
          width: '100%',
          boxSizing: 'border-box',
          padding: 'var(--spacing-1) var(--spacing-2)',
          borderRadius: 'var(--radius-container)',
          background: 'var(--color-background-muted)',
          flexShrink: 0,
        }}
      >
        {indexing || reindexing ? (
          <Loader2 size={12} aria-hidden className="panorama-spin-icon" style={{ color: 'var(--color-accent)' }} />
        ) : (
          <Compass size={12} aria-hidden />
        )}
        <Text
          type="supporting"
          color={status.tone === 'neutral' ? 'secondary' : 'accent'}
          data-testid={status.testId}
          maxLines={1}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: 'start',
            ...(status.tone === 'error' ? { color: 'var(--color-error)' } : {}),
          }}
        >
          {status.text}
        </Text>
        {showProgress && (
          <Token
            size="sm"
            color={progressComplete ? 'green' : 'blue'}
            label={`已索引 ${briefedCount}/${briefTotal}`}
            data-testid="index-progress-token"
          />
        )}
        {panoramaReady && (
          <Token size="sm" color="green" label="画像就绪" data-testid="index-panorama-token" />
        )}
        <ChevronRight size={12} aria-hidden style={{ flexShrink: 0 }} />
        {failed || awaitingKey ? (
          <Button
            label={failed ? '重试' : configured ? '生成' : '去设置'}
            variant="secondary"
            size="sm"
            data-testid={
              failed ? 'index-retry-button' : configured ? 'index-start-button' : 'index-settings-button'
            }
            tooltip={
              failed
                ? '重试生成全书画像与索引'
                : configured
                  ? '生成全书画像与索引'
                  : '前往 AI 设置填写 API Key'
            }
            icon={
              failed || configured ? (
                <RotateCw size={12} aria-hidden />
              ) : (
                <KeyRound size={12} aria-hidden />
              )
            }
            onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              if (configured) void startIndexing({ currentSpineIndex: spineIndex });
              else goToSettings();
            }}
          />
        ) : hasStarted ? (
          <Button
            label="重新索引"
            variant="ghost"
            size="sm"
            isIconOnly
            data-testid="reindex-button"
            tooltip="重新索引全书"
            aria-label="重新索引"
            icon={<RotateCw size={12} aria-hidden />}
            onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              setConfirmOpen(true);
            }}
          />
        ) : (
          <Button
            label="生成画像"
            variant="secondary"
            size="sm"
            data-testid="start-indexing-button"
            tooltip="生成全书画像与索引"
            icon={<Sparkles size={12} aria-hidden />}
            onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
              event.stopPropagation();
              void startIndexing({ currentSpineIndex: spineIndex });
            }}
          />
        )}
      </HStack>

      <PanoramaDialog
        isOpen={panoramaOpen}
        onOpenChange={setPanoramaOpen}
        onRequestReindex={() => setConfirmOpen(true)}
      />

      <AlertDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="重新索引全书？"
        description="将重新生成全书画像与章节脉络。阅读进度与对话记录不受影响。"
        actionLabel="重新索引"
        cancelLabel="取消"
        actionVariant="secondary"
        onAction={() => {
          setConfirmOpen(false);
          runReindex();
        }}
        data-testid="reindex-confirm"
      />
    </>
  );
}
