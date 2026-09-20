import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SummaryTab from './SummaryTab';
import {
  createSummaryStore,
  setSummaryStore,
  useSummaryStore,
  type SummaryChapterContext,
  type SummaryStore,
} from '@/store/summaryStore';
import type { ChapterSummarizer, SummarizeInput } from '@/services/summary/summarizer';
import type { ChapterSummaryRepository } from '@/services/db/repositories';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { DEMO_BOOK } from '@/services/reader/demoBook';
import { chapterSummaryId, DEFAULT_AI_SETTINGS, type ChapterSummary } from '@/types/ai';

const CHAPTER: SummaryChapterContext = {
  bookHash: DEMO_BOOK.bookHash,
  sectionIndex: 1,
  bookTitle: DEMO_BOOK.title,
  chapterTitle: '第二章 图书馆的密语',
  text: '图书馆的木门在她身后合上时，穹顶上的星图亮了起来，一行行微光顺着书架流淌，像有人在低声读书。林晚握紧了信纸，想起父亲失踪前留下的最后一页手稿。',
  charCount: 71,
};

interface Setup {
  store: SummaryStore;
  factory: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

const setup = (seed: ChapterSummary[] = []): Setup => {
  const table = new Map(seed.map((summary) => [summary.id, summary]));
  const put = vi.fn(async (summary: ChapterSummary) => {
    table.set(summary.id, summary);
  });
  const repository = {
    get: async (bookHash: string, sectionIndex: number) => table.get(chapterSummaryId(bookHash, sectionIndex)),
    put,
  } as unknown as ChapterSummaryRepository;
  const factory = vi.fn(
    (): ChapterSummarizer => ({
      summarize: vi.fn(async () => {
        throw new Error('factory not configured for this test');
      }),
    }),
  );
  const store = createSummaryStore({
    summarizerFactory: factory,
    repository,
    resolveChapter: () => ({ ...CHAPTER }),
  });
  setSummaryStore(store);
  return { store, factory, put };
};

beforeEach(() => {
  useReaderStore.setState({
    bookHash: DEMO_BOOK.bookHash,
    bookTitle: DEMO_BOOK.title,
    sectionIndex: 1,
    chapterTitle: DEMO_BOOK.sections[1].title,
    sectionCount: DEMO_BOOK.sections.length,
  });
  useSegmentationStore.setState({
    segmentation: null,
    banner: { visible: false, detectedCount: 0 },
    applyDecision: null,
    scanContext: null,
  });
  useAISettingsStore.setState({
    settings: { ...DEFAULT_AI_SETTINGS, provider: 'deepseek', apiKey: 'sk-test', model: 'deepseek-chat' },
    status: 'ready',
    toast: null,
  });
});

afterEach(() => {
  setSummaryStore(useSummaryStore); // restore the app singleton
});

describe('SummaryTab', () => {
  it('shows the empty-state card (title, char count, ⚡ button) and never auto-generates', async () => {
    const { factory } = setup();
    render(<SummaryTab />);

    await waitFor(() => {
      expect(screen.getByTestId('generate-summary')).toBeTruthy();
    });
    expect(screen.getByTestId('summary-tab-panel')).toBeTruthy();
    expect(screen.getByText('第二章 图书馆的密语')).toBeTruthy();
    // demo chapter 2 extracted char count, resolved from the real chapterSource
    const chapterTwoChars = screen.getByText(/约 \d+ 字/);
    expect(chapterTwoChars.textContent).toMatch(/约 \d{2,} 字/);

    expect(factory).not.toHaveBeenCalled();
    expect(screen.queryByTestId('stop-generation')).toBeNull();
  });

  it('warns instead of offering generation when the chapter has <50 extractable chars', async () => {
    const { store, factory } = setup();
    render(<SummaryTab />);

    await waitFor(() => {
      expect(screen.getByTestId('generate-summary')).toBeTruthy();
    });

    act(() => {
      store.getState().openChapter(DEMO_BOOK.bookHash, 0, '扫描版第一章（纯图像）', 12);
    });

    expect(await screen.findByTestId('summary-empty-text-warning')).toBeTruthy();
    expect(screen.queryByTestId('generate-summary')).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('streams a generation: stop button + content while generating, then cached with regenerate', async () => {
    let proceed!: () => void;
    const gate = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    setupWithFactory(async (input) => {
      input.onEvent({ type: 'stage', stage: 'single' });
      input.onEvent({ type: 'delta', text: '### 📌 章节核心要义\n林晚进入图书馆。' });
      await gate;
      const summary: ChapterSummary = {
        id: chapterSummaryId(input.bookHash, input.sectionIndex),
        bookHash: input.bookHash,
        sectionIndex: input.sectionIndex,
        chapterTitle: input.chapterTitle,
        modelUsed: 'deepseek-chat',
        summaryContent: '### 📌 章节核心要义\n林晚进入图书馆。',
        pipeline: 'single',
        createdAt: 1,
        updatedAt: 2,
      };
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return summary;
    });
    render(<SummaryTab />);
    await waitFor(() => screen.getByTestId('generate-summary'));

    fireEvent.click(screen.getByTestId('generate-summary'));

    // Streaming mid-flight: stop button, streamed heading text visible.
    expect(await screen.findByTestId('stop-generation')).toBeTruthy();
    expect(await screen.findByText('📌 章节核心要义')).toBeTruthy();

    proceed();
    await waitFor(() => {
      expect(screen.getByTestId('regenerate-summary')).toBeTruthy();
    });
    expect(screen.getByTestId('summary-tab-panel')).toBeTruthy();
    expect(screen.queryByTestId('stop-generation')).toBeNull();
  });

  it('stop button aborts the run and returns to the action card with a stopped note', async () => {
    let releaseStream!: () => void;
    const parked = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const { store } = setupWithFactory(async (input) => {
      input.onEvent({ type: 'stage', stage: 'single' });
      input.onEvent({ type: 'delta', text: '### 📌 部分' });
      await parked; // hold mid-stream until the test has clicked stop
      if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      throw new Error('should have aborted');
    });

    render(<SummaryTab />);
    await waitFor(() => screen.getByTestId('generate-summary'));
    fireEvent.click(screen.getByTestId('generate-summary'));

    const stopButton = await screen.findByTestId('stop-generation');
    fireEvent.click(stopButton);
    releaseStream(); // the abort already fired; let the fake observe it

    await waitFor(() => {
      expect(screen.getByTestId('summary-aborted-note')).toBeTruthy();
    });
    expect(screen.getByTestId('generate-summary')).toBeTruthy();
    expect(store.getState().phase).toBe('aborted');
  });

  it('renders a cached summary with the model name and a working regenerate (force) button', async () => {
    const cached: ChapterSummary = {
      id: chapterSummaryId(CHAPTER.bookHash, CHAPTER.sectionIndex),
      bookHash: CHAPTER.bookHash,
      sectionIndex: CHAPTER.sectionIndex,
      chapterTitle: CHAPTER.chapterTitle,
      modelUsed: 'deepseek-chat',
      summaryContent: '### 📌 章节核心要义\n cached-content-甲\n\n### 💡 核心概念与关键术语\n- **星图**：图书馆穹顶的照明谜题',
      pipeline: 'map-reduce',
      createdAt: 1,
      updatedAt: 2,
    };
    const { factory } = setupWithFactory(
      async (input) => {
        input.onEvent({ type: 'stage', stage: 'single' });
        input.onEvent({ type: 'delta', text: '### 📌 重写后的总结' });
        const summary: ChapterSummary = {
          id: chapterSummaryId(input.bookHash, input.sectionIndex),
          bookHash: input.bookHash,
          sectionIndex: input.sectionIndex,
          chapterTitle: input.chapterTitle,
          modelUsed: 'deepseek-chat',
          summaryContent: '### 📌 重写后的总结',
          pipeline: 'single',
          createdAt: 3,
          updatedAt: 4,
        };
        return summary;
      },
      [cached],
    );

    render(<SummaryTab />);

    // Cached view: heading + list rendered, model + regenerate visible.
    expect(await screen.findByText('cached-content-甲')).toBeTruthy();
    expect(screen.getByTestId('regenerate-summary')).toBeTruthy();
    expect(screen.getByText(/deepseek-chat/)).toBeTruthy();
    expect(screen.getByText('星图')).toBeTruthy(); // **bold** inline text
    expect(screen.queryByTestId('generate-summary')).toBeNull();

    // Regenerate is force=true: streams even though a cache exists.
    fireEvent.click(screen.getByTestId('regenerate-summary'));
    await waitFor(() => {
      expect(screen.getByText('📌 重写后的总结')).toBeTruthy();
    });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('shows the error card with a retry button and the settings hint', async () => {
    useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } }); // no apiKey
    const { store } = setup();

    render(<SummaryTab />);
    await waitFor(() => screen.getByTestId('generate-summary'));

    fireEvent.click(screen.getByTestId('generate-summary'));

    await waitFor(() => {
      expect(screen.getByTestId('summary-error-text').textContent).toBe('请先在侧栏右上角 ⚙ 完成 AI Provider 配置');
    });
    expect(screen.getByTestId('retry-summary')).toBeTruthy();
    expect(screen.getByText(/⚙ 检查 AI Provider 配置/)).toBeTruthy();
    expect(store.getState().phase).toBe('error');
  });

  it('re-opens (cache check only) when the reader moves to another chapter', async () => {
    const { factory, store } = setup();
    const openChapter = vi.spyOn(store.getState(), 'openChapter');

    render(<SummaryTab />);
    await waitFor(() => screen.getByTestId('generate-summary'));
    expect(openChapter).toHaveBeenCalledTimes(1);

    act(() => {
      useReaderStore.getState().setSection(2, DEMO_BOOK.sections[2].title);
    });
    await waitFor(() => expect(openChapter).toHaveBeenCalledTimes(2));
    expect(factory).not.toHaveBeenCalled(); // chapter switching never generates
    expect(store.getState().chapterTitle).toBe('第三章 长夜漫漫');
  });
});

/** setup() + a factory behaviour, sharing one injected store. */
function setupWithFactory(
  behavior: (input: SummarizeInput) => Promise<ChapterSummary>,
  seed: ChapterSummary[] = [],
): { store: SummaryStore; factory: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> } {
  const base = setup(seed);
  base.factory.mockImplementation(
    (): ChapterSummarizer => ({
      summarize: async (input: SummarizeInput) => behavior(input),
    }),
  );
  return base;
}
