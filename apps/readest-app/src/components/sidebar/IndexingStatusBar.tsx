'use client';

/**
 * 导入索引进度指示条 (reading-agent architecture doc §7.2 item 3 + user
 * request): a minimal status row above the conversation stream. Clicking the
 * bar opens the whole-book panorama dialog (画像弹窗); the ↻ button on the
 * right re-runs the import pipeline (重新索引) behind a confirmation, for
 * users unsatisfied with the generated panorama / briefs.
 */
import { useState } from 'react';
import { BookOpen, ChevronRight, CircleDot, RotateCw } from 'lucide-react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { useBookIndexStore } from '@/store/bookIndexStore';
import { useReaderStore } from '@/store/readerStore';
import { formatBookScale } from '@/services/bookNodes';
import PanoramaDialog from './PanoramaDialog';

export default function IndexingStatusBar() {
  const phase = useBookIndexStore((s) => s.phase);
  const shape = useBookIndexStore((s) => s.shape);
  const briefTotal = useBookIndexStore((s) => s.briefTotal);
  const briefedCount = useBookIndexStore((s) => s.briefedCount);
  const panoramaReady = useBookIndexStore((s) => s.panoramaReady);
  const progressLabel = useBookIndexStore((s) => s.progressLabel);
  const reindex = useBookIndexStore((s) => s.reindex);
  const bookHash = useReaderStore((s) => s.bookHash);
  const spineIndex = useReaderStore((s) => s.spineIndex);

  const [panoramaOpen, setPanoramaOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Nothing indexed yet (or demo flow): stay invisible.
  if (shape.total === 0) return null;

  const indexing = phase === 'panorama' || phase === 'briefs';
  const ready = phase === 'ready' || (!indexing && briefedCount >= briefTotal);
  const reindexing = phase === 'segmenting';

  const runReindex = () => {
    if (!bookHash) return;
    void reindex(bookHash, { currentSectionIndex: spineIndex });
  };

  return (
    <>
      <HStack
        data-testid="indexing-status-bar"
        gap={2}
        vAlign="center"
        as="button"
        aria-label="查看全书画像"
        onClick={() => setPanoramaOpen(true)}
        style={{
          all: 'unset',
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
          <CircleDot size={12} aria-hidden />
        ) : (
          <BookOpen size={12} aria-hidden />
        )}
        {indexing || reindexing ? (
          <Text type="supporting" color="accent" data-testid="indexing-progress-label" maxLines={1} style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
            {reindexing
              ? '● 正在重建全书索引…'
              : `● ${phase === 'panorama' ? '正在构建全书全景画像…' : progressLabel}`}
          </Text>
        ) : (
          <Text type="supporting" color="secondary" data-testid="index-ready-label" maxLines={1} style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
            {`${formatBookScale(shape)}（已索引 ${briefedCount}/${briefTotal}）${panoramaReady ? ' · 全书画像就绪' : ''}`}
          </Text>
        )}
        <ChevronRight size={12} aria-hidden style={{ flexShrink: 0 }} />
        <Button
          label="重新索引"
          variant="ghost"
          size="sm"
          isIconOnly
          data-testid="reindex-button"
          tooltip="丢弃当前画像与微摘要，重新索引全书"
          aria-label="重新索引"
          icon={<RotateCw size={12} aria-hidden />}
          onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            setConfirmOpen(true);
          }}
        />
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
        description="将丢弃当前的全书画像与节点微摘要，并重新调用模型生成（会产生相应的 Token 消耗）。书架、阅读进度与对话记录不受影响。"
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
