'use client';

/**
 * 章节总结 Tab (ticket 03, design doc 4.3, ADR 0004).
 *
 * Strictly manual trigger: the component only opens the chapter (cache check)
 * when the reader moves; every model call comes from an explicit button
 * (⚡ 生成本章总结 / 🔄 重新生成) or its retry. The store is reached through
 * `getSummaryStore()` so tests can inject a factory-built store before mount.
 */
import { useEffect } from 'react';
import { getSummaryStore } from '@/store/summaryStore';
import { useReaderStore } from '@/store/readerStore';
import { resolveCurrentChapterText } from '@/services/summary/chapterSource';

/** Minimal `**bold**` inline renderer — no markdown dependency. */
function InlineText({ text }: { text: string }) {
  const parts = text.split('**');
  if (parts.length <= 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index}>{part}</strong>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * Line-based renderer for the three-part summary: `### ` headings become bold
 * h3 titles, `- ` and `1. ` lines become list items, everything else renders
 * as a pre-wrapped paragraph.
 */
export function SummaryBody({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const lines = content.split('\n');
  return (
    <div className="space-y-1.5 text-sm leading-relaxed" data-testid="summary-body">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        const key = `${index}:${trimmed.slice(0, 12)}`;
        if (trimmed === '') return null;

        if (trimmed.startsWith('### ')) {
          return (
            <h3 key={key} className="mt-3 text-sm font-bold text-base-content">
              <InlineText text={trimmed.slice(4)} />
            </h3>
          );
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
          return (
            <div key={key} className="flex gap-1.5 pl-2">
              <span aria-hidden="true" className="select-none text-base-content/50">
                •
              </span>
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                <InlineText text={trimmed.slice(2)} />
              </p>
            </div>
          );
        }
        const ordered = /^(\d+)[.、)]\s+(.*)$/.exec(trimmed);
        if (ordered) {
          return (
            <div key={key} className="flex gap-1.5 pl-2">
              <span aria-hidden="true" className="select-none text-base-content/50">
                {ordered[1]}.
              </span>
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                <InlineText text={ordered[2]} />
              </p>
            </div>
          );
        }
        return (
          <p key={key} className="whitespace-pre-wrap break-words">
            <InlineText text={trimmed} />
          </p>
        );
      })}
      {streaming && (
        <span aria-hidden="true" className="inline-block animate-pulse font-semibold">
          ▍
        </span>
      )}
    </div>
  );
}

const formatTimestamp = (ms: number): string => {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export default function SummaryTab() {
  const useSummary = getSummaryStore();
  const phase = useSummary((s) => s.phase);
  const content = useSummary((s) => s.content);
  const cachedSummary = useSummary((s) => s.cachedSummary);
  const chapterTitle = useSummary((s) => s.chapterTitle);
  const charCount = useSummary((s) => s.charCount);
  const stageLabel = useSummary((s) => s.stageLabel);
  const error = useSummary((s) => s.error);
  const openChapter = useSummary((s) => s.openChapter);
  const generate = useSummary((s) => s.generate);
  const stop = useSummary((s) => s.stop);

  const bookHash = useReaderStore((s) => s.bookHash);
  const sectionIndex = useReaderStore((s) => s.sectionIndex);
  const readerChapterTitle = useReaderStore((s) => s.chapterTitle);

  // Cache check only — never auto-generates (ADR 0004).
  useEffect(() => {
    if (!bookHash) return;
    const { title, charCount: resolved } = resolveCurrentChapterText();
    void openChapter(bookHash, sectionIndex, readerChapterTitle || title, resolved);
  }, [bookHash, sectionIndex, readerChapterTitle, openChapter]);

  if (!bookHash) {
    return (
      <div
        data-testid="summary-tab-panel"
        className="rounded-box border border-dashed border-base-300 p-4 text-sm text-base-content/60"
      >
        尚未打开书籍，先在阅读器中选择一本书吧。
      </div>
    );
  }

  if (phase === 'checking-cache') {
    return (
      <div
        data-testid="summary-tab-panel"
        className="flex items-center gap-2 rounded-box border border-base-300 p-4 text-sm text-base-content/60"
      >
        <span className="loading loading-spinner loading-sm" aria-hidden="true" />
        正在检查本地总结缓存...
      </div>
    );
  }

  if (phase === 'generating') {
    return (
      <div data-testid="summary-tab-panel" className="card bg-base-100 shadow-sm">
        <div className="card-body gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-semibold">{chapterTitle || '当前章节'}</h3>
            <button
              type="button"
              data-testid="stop-generation"
              className="btn btn-outline btn-xs shrink-0"
              onClick={stop}
            >
              ⏹ 停止生成
            </button>
          </div>
          {stageLabel && (
            <div role="status" data-testid="summary-stage-label" className="text-xs text-base-content/60">
              {stageLabel}
            </div>
          )}
          {content ? (
            <SummaryBody content={content} streaming />
          ) : (
            <p className="text-xs text-base-content/50">模型正在阅读本章，稍等片刻...</p>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'idle' || phase === 'aborted') {
    return (
      <div data-testid="summary-tab-panel" className="card border border-base-300 bg-base-100">
        <div className="card-body gap-2 p-4">
          <h3 className="card-title text-sm">{chapterTitle || '当前章节'}</h3>
          <p className="text-xs text-base-content/60">
            约 {charCount} 字 · 本章还没有总结
          </p>
          {phase === 'aborted' && (
            <p data-testid="summary-aborted-note" className="text-xs text-warning">
              已停止生成，已产出的部分保留在下方，可随时重新发起。
            </p>
          )}
          {phase === 'aborted' && content ? <SummaryBody content={content} /> : null}
          <button
            type="button"
            data-testid="generate-summary"
            className="btn btn-primary btn-sm mt-1 w-full"
            onClick={() => void generate()}
          >
            ⚡ 生成本章总结
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div data-testid="summary-tab-panel" role="alert" className="alert alert-error flex flex-col items-start gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">⚠️</span>
          <span data-testid="summary-error-text">{error || '生成失败'}</span>
        </div>
        <button
          type="button"
          data-testid="retry-summary"
          className="btn btn-sm"
          onClick={() => void generate()}
        >
          重试
        </button>
        <p className="text-xs opacity-80">若持续失败，请去侧栏右上角 ⚙ 检查 AI Provider 配置。</p>
      </div>
    );
  }

  // phase === 'done' (transient) | 'cached'
  return (
    <div data-testid="summary-tab-panel" className="card bg-base-100 shadow-sm">
      <div className="card-body gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold">{chapterTitle || cachedSummary?.chapterTitle}</h3>
          <button
            type="button"
            data-testid="regenerate-summary"
            className="btn btn-ghost btn-xs shrink-0"
            title="丢弃当前总结并重新生成"
            onClick={() => void generate(true)}
          >
            🔄 重新生成
          </button>
        </div>
        {cachedSummary && (
          <p className="text-xs text-base-content/50">
            模型 {cachedSummary.modelUsed} · 更新于 {formatTimestamp(cachedSummary.updatedAt)}
            {cachedSummary.pipeline === 'map-reduce' ? ' · 长章节分块汇总' : ''}
          </p>
        )}
        <SummaryBody content={content} />
      </div>
    </div>
  );
}
