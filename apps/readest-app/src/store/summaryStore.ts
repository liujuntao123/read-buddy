/**
 * Summary store (ticket 03, ADR 0004: strictly manual trigger).
 *
 * Per-chapter UI state keyed by `${bookHash}:${sectionIndex}`:
 * - `openChapter` only checks the local cache — it NEVER starts a model call;
 * - `generate` is the only entry into the pipeline and is always user-fired
 *   (the ⚡ button or 🔄 regenerate); `force=true` bypasses the cache;
 * - `stop` aborts the in-flight run; partial streamed content is kept.
 *
 * The factory injects the summarizer factory, the repository and the chapter
 * resolver so tests run hermetically; the app uses the singleton at the
 * bottom, and `SummaryTab` reaches the active store through
 * `getSummaryStore()` (swappable in tests via `setSummaryStore`).
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { AISettings, ChapterSummary } from '@/types/ai';
import { ChapterSummaryRepository } from '@/services/db/repositories';
import {
  createChapterSummarizer,
  isAbortError,
  type ChapterSummarizer,
  type SummarizeInput,
  type SummarizerStage,
} from '@/services/summary/summarizer';
import { resolveCurrentChapterText } from '@/services/summary/chapterSource';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useReaderStore } from '@/store/readerStore';

export type SummaryPhase =
  | 'idle'
  | 'checking-cache'
  | 'cached'
  | 'generating'
  | 'done'
  | 'aborted'
  | 'error';

export interface SummaryChapterContext {
  bookHash: string;
  sectionIndex: number;
  bookTitle: string;
  chapterTitle: string;
  text: string;
  charCount: number;
}

export interface SummaryState {
  phase: SummaryPhase;
  /** Streamed (or cached) three-part summary text. */
  content: string;
  cachedSummary: ChapterSummary | null;
  chapterTitle: string;
  charCount: number;
  /** e.g. `正在分块提炼 (1/2)...` / `正在合成整章脉络...`. */
  stageLabel: string;
  error: string | null;
  /** `${bookHash}:${sectionIndex}` of the chapter this state belongs to. */
  activeKey: string;
  /** AbortController of the in-flight generation, if any. */
  controller: AbortController | null;
  openChapter: (
    bookHash: string,
    sectionIndex: number,
    chapterTitle: string,
    charCount: number,
  ) => Promise<void>;
  generate: (force?: boolean) => Promise<void>;
  stop: () => void;
}

export type SummaryStore = UseBoundStore<StoreApi<SummaryState>>;

export interface SummaryStoreDeps {
  summarizerFactory: (settings: AISettings) => ChapterSummarizer;
  repository: ChapterSummaryRepository;
  /** Chapter resolver seam; defaults to readerStore + chapterSource. */
  resolveChapter?: () => SummaryChapterContext;
}

export const summaryChapterKey = (bookHash: string, sectionIndex: number): string =>
  `${bookHash}:${sectionIndex}`;

export const MISSING_SETTINGS_ERROR = '请先在侧栏右上角 ⚙ 完成 AI Provider 配置';

const stageLabelFor = (stage: SummarizerStage): string => {
  if (stage === 'mapping') return '正在分块提炼...';
  if (stage === 'reducing') return '正在合成整章脉络...';
  return '';
};

/** Chapter context for the section currently open in the reader. */
export const resolveCurrentChapterContext = (): SummaryChapterContext => {
  const { bookHash, bookTitle, sectionIndex, chapterTitle } = useReaderStore.getState();
  const { title, text, charCount } = resolveCurrentChapterText();
  return {
    bookHash,
    bookTitle,
    sectionIndex,
    chapterTitle: chapterTitle || title,
    text,
    charCount,
  };
};

/**
 * Real-pipeline summarizer factory. The AI SDK transport is imported lazily
 * on first generation so importing this module (and every component test)
 * stays light and offline.
 */
const createRealSummarizer = async (settings: AISettings): Promise<ChapterSummarizer> => {
  const { createAiSdkStreamFn } = await import('@/services/ai/streamClient');
  return createChapterSummarizer({
    stream: createAiSdkStreamFn(),
    settings,
    repository: new ChapterSummaryRepository(),
  });
};

export function createSummaryStore({
  summarizerFactory,
  repository,
  resolveChapter = resolveCurrentChapterContext,
}: SummaryStoreDeps): SummaryStore {
  /**
   * Generation run token: bumped by `openChapter` and every new `generate`,
   * so events from a stale run (chapter switched mid-flight) are dropped.
   */
  let runToken = 0;

  return create<SummaryState>()((set, get) => ({
    phase: 'idle',
    content: '',
    cachedSummary: null,
    chapterTitle: '',
    charCount: 0,
    stageLabel: '',
    error: null,
    activeKey: '',
    controller: null,

    // Strictly manual trigger (ADR 0004): cache check only, never generates.
    openChapter: async (bookHash, sectionIndex, chapterTitle, charCount) => {
      runToken += 1;
      get().controller?.abort();
      const key = summaryChapterKey(bookHash, sectionIndex);
      set({
        phase: 'checking-cache',
        activeKey: key,
        content: '',
        cachedSummary: null,
        chapterTitle,
        charCount,
        stageLabel: '',
        error: null,
        controller: null,
      });

      const cached = await repository.get(bookHash, sectionIndex);
      if (get().activeKey !== key) return; // user already moved on
      if (cached) {
        set({ phase: 'cached', content: cached.summaryContent, cachedSummary: cached });
      } else {
        set({ phase: 'idle' });
      }
    },

    generate: async (force = false) => {
      if (get().phase === 'generating') return;
      const token = (runToken += 1);

      const settings = useAISettingsStore.getState().settings;
      if (!settings.apiKey && settings.provider !== 'ollama') {
        set({ phase: 'error', error: MISSING_SETTINGS_ERROR, stageLabel: '' });
        return;
      }

      const chapter = resolveChapter();
      const key = summaryChapterKey(chapter.bookHash, chapter.sectionIndex);

      if (!force) {
        const cached = await repository.get(chapter.bookHash, chapter.sectionIndex);
        if (token !== runToken) return;
        if (cached) {
          set({ phase: 'cached', content: cached.summaryContent, cachedSummary: cached });
          return;
        }
      }

      const controller = new AbortController();
      set({
        phase: 'generating',
        activeKey: key,
        content: '',
        error: null,
        stageLabel: '',
        chapterTitle: chapter.chapterTitle,
        charCount: chapter.charCount,
        cachedSummary: null,
        controller,
      });

      const summarize: SummarizeInput['onEvent'] = (event) => {
        if (token !== runToken) return;
        switch (event.type) {
          case 'stage':
            set({ stageLabel: stageLabelFor(event.stage) });
            return;
          case 'progress':
            set({ stageLabel: `正在分块提炼 (${event.index}/${event.total})...` });
            return;
          case 'delta':
            set((state) => ({ content: state.content + event.text }));
            return;
          case 'done':
            return; // handled below, after the repository write completes
        }
      };

      try {
        const summarizer = summarizerFactory(settings);
        const summary = await summarizer.summarize({
          bookHash: chapter.bookHash,
          sectionIndex: chapter.sectionIndex,
          chapterTitle: chapter.chapterTitle,
          bookTitle: chapter.bookTitle,
          text: chapter.text,
          signal: controller.signal,
          onEvent: summarize,
        });
        if (token !== runToken) return;

        set({ phase: 'done', content: summary.summaryContent, stageLabel: '' });
        const stored = await repository.get(chapter.bookHash, chapter.sectionIndex);
        if (token !== runToken) return;
        set({ phase: 'cached', cachedSummary: stored ?? summary });
      } catch (error) {
        if (token !== runToken) return;
        if (isAbortError(error)) {
          // Keep whatever streamed before the stop; user can restart.
          set({ phase: 'aborted', stageLabel: '' });
        } else {
          set({
            phase: 'error',
            error: error instanceof Error ? error.message : String(error),
            stageLabel: '',
          });
        }
      } finally {
        if (get().controller === controller) set({ controller: null });
      }
    },

    stop: () => {
      get().controller?.abort();
    },
  }));
}

/**
 * App-wide singleton. Uses the real AI SDK stream (lazily imported) and the
 * Dexie-backed ChapterSummaryRepository.
 */
export const useSummaryStore: SummaryStore = createSummaryStore({
  summarizerFactory: (settings) => ({
    summarize: (input) => createRealSummarizer(settings).then((s) => s.summarize(input)),
  }),
  repository: new ChapterSummaryRepository(),
});

let activeStore: SummaryStore = useSummaryStore;

/** Store consumed by SummaryTab; tests swap in a factory-built store. */
export const getSummaryStore = (): SummaryStore => activeStore;

/** Test seam for the module-level store injection point. */
export function setSummaryStore(store: SummaryStore): void {
  activeStore = store;
}
