import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SummaryTab from './SummaryTab';
import {
  createSummaryStore,
  useSummaryStore,
  type SummaryNodeContext,
  type SummaryStore,
} from '@/store/summaryStore';
import type { NodeSummarizer, SummarizeInput } from '@/services/summary/summarizer';
import type { NodeSummaryRepository } from '@/services/db/repositories';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import {
  clearAgentBookContext,
  createAgentBookContext,
  registerAgentBookContext,
} from '@/services/agent/agentContext';
import { bookNodeId, type BookNode } from '@/types/readingAgent';
import { DEMO_BOOK } from '@/services/reader/demoBook';
import { nodeSummaryId, DEFAULT_AI_SETTINGS, type NodeSummary } from '@/types/ai';

const CHAPTER: SummaryNodeContext = {
  bookHash: DEMO_BOOK.bookHash,
  nodeIndex: 1,
  bookTitle: DEMO_BOOK.title,
  nodeTitle: '第二章 图书馆的密语',
  kind: 'chapter',
  text: '图书馆的木门在她身后合上时，穹顶上的星图亮了起来，一行行微光顺着书架流淌，像有人在低声读书。林晚握紧了信纸，想起父亲失踪前留下的最后一页手稿。',
  charCount: 71,
};

interface Setup {
  store: SummaryStore;
  factory: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

/** The store the next ender(<SummaryTab …/>) should use; set by setup(). */
let currentStore: SummaryStore;

const setup = (seed: NodeSummary[] = []): Setup => {
  const table = new Map(seed.map((summary) => [summary.id, summary]));
  const put = vi.fn(async (summary: NodeSummary) => {
    table.set(summary.id, summary);
  });
  const repository = {
    get: async (bookHash: string, nodeIndex: number) => table.get(nodeSummaryId(bookHash, nodeIndex)),
    put,
  } as unknown as NodeSummaryRepository;
  const factory = vi.fn(
    (): NodeSummarizer => ({
      summarize: vi.fn(async () => {
        throw new Error('factory not configured for this test');
      }),
    }),
  );
  const store = createSummaryStore({
    summarizerFactory: factory,
    repository,
    resolveNode: () => ({ ...CHAPTER }),
  });
  currentStore = store;
  return { store, factory, put };
};

beforeEach(() => {
  useReaderStore.setState({
    bookHash: DEMO_BOOK.bookHash,
    bookTitle: DEMO_BOOK.title,
    spineIndex: 1,
    anchor: undefined,
    nodeTitle: DEMO_BOOK.sections[1].title,
    spineCount: DEMO_BOOK.sections.length,
  });
  useSegmentationStore.setState({
    segmentation: null,
  });
  useAISettingsStore.setState({
    settings: { ...DEFAULT_AI_SETTINGS, provider: 'deepseek', apiKey: 'sk-test', model: 'deepseek-chat' },
    status: 'ready',
    toast: null,
  });
});

afterEach(() => {
  clearAgentBookContext(DEMO_BOOK.bookHash);
});

describe('SummaryTab', () => {
  it('shows the hierarchical node-model scope (章 › 节 breadcrumb, no mechanical pills)', async () => {
    const hierarchical: BookNode[] = [
      {
        nodeId: bookNodeId(DEMO_BOOK.bookHash, 0),
        bookHash: DEMO_BOOK.bookHash,
        nodeIndex: 0,
        title: '第一卷 风云之始',
        startOffset: 0,
        endOffset: 50,
        charCount: 50,
        depth: 0,
        spineIndex: 0,
        indexStatus: 'ready',
      },
      {
        nodeId: bookNodeId(DEMO_BOOK.bookHash, 1),
        bookHash: DEMO_BOOK.bookHash,
        nodeIndex: 1,
        title: '第一章 图书馆的密语',
        startOffset: 50,
        endOffset: 150,
        charCount: 100,
        depth: 1,
        parentNodeId: bookNodeId(DEMO_BOOK.bookHash, 0),
        spineIndex: 1,
        indexStatus: 'ready',
      },
    ];
    registerAgentBookContext(
      createAgentBookContext({ bookHash: DEMO_BOOK.bookHash, nodes: hierarchical, fullText: 'x'.repeat(150) }),
    );
    const { factory } = setup();
    render(<SummaryTab store={currentStore} />);

    await waitFor(() => {
      expect(screen.getByTestId('generate-summary')).toBeTruthy();
    });
    // Level word pill: the node nested under a 卷 container is a 节.
    expect(screen.getByTestId('summary-node-kind').textContent).toBe('节');
    const panel = screen.getByTestId('summary-tab-panel');
    // Line 1: the 章 ancestor breadcrumb › the current node title.
    expect(panel.textContent).toContain('《第一卷 风云之始》 ›');
    expect(panel.textContent).toContain('第一章 图书馆的密语');
    // Line 2: level word + size facts, and nothing mechanical.
    const facts = screen.getByTestId('summary-scope-row').textContent ?? '';
    expect(facts).toContain('节');
    expect(facts).toContain('约 100 字');
    expect(facts).not.toContain('当前节点');
    expect(panel.textContent).not.toContain('个节点');
    expect(panel.textContent).not.toContain('隶属《');
    // The viewpoint description names the leaf level explicitly.
    expect(panel.textContent).toContain('当前节《第一章 图书馆的密语》暂无总结');
    expect(panel.textContent).toContain('⚡ 总结当前节');
    expect(panel.textContent).toContain('提炼当前节的核心内容与脉络');
    expect(factory).not.toHaveBeenCalled();
  });

  it('renders the flat single-level case as a 章 viewpoint (no breadcrumb)', async () => {
    const { factory } = setup();
    render(<SummaryTab store={currentStore} />);

    await waitFor(() => {
      expect(screen.getByTestId('generate-summary')).toBeTruthy();
    });
    // With no node model the level falls back to the title: a 章, top of book.
    expect(screen.getByTestId('summary-node-kind').textContent).toBe('章');
    const panel = screen.getByTestId('summary-tab-panel');
    expect(panel.textContent).toContain('第二章 图书馆的密语');
    expect(panel.textContent).not.toContain('›');
    expect(panel.textContent).toContain('⚡ 总结当前章');
    expect(panel.textContent).toContain('提炼当前章的核心内容与脉络');
    // demo chapter 2 extracted char count, resolved from the real nodeSource
    const chapterTwoChars = screen.getByText(/约 \d+ 字/);
    expect(chapterTwoChars.textContent).toMatch(/约 \d{2,} 字/);

    expect(factory).not.toHaveBeenCalled();
    expect(screen.queryByTestId('stop-generation')).toBeNull();
  });

  it('warns instead of offering generation when the chapter has <50 extractable chars', async () => {
    const { store, factory } = setup();
    render(<SummaryTab store={currentStore} />);

    await waitFor(() => {
      expect(screen.getByTestId('generate-summary')).toBeTruthy();
    });

    act(() => {
      store.getState().openNode(DEMO_BOOK.bookHash, 0, '扫描版第一章（纯图像）', 12);
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
      const summary: NodeSummary = {
        id: nodeSummaryId(input.bookHash, input.nodeIndex),
        bookHash: input.bookHash,
        nodeIndex: input.nodeIndex,
        nodeTitle: input.nodeTitle,
        modelUsed: 'deepseek-chat',
        summaryContent: '### 📌 章节核心要义\n林晚进入图书馆。',
        pipeline: 'single',
        createdAt: 1,
        updatedAt: 2,
      };
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return summary;
    });
    render(<SummaryTab store={currentStore} />);
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

    render(<SummaryTab store={currentStore} />);
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
    const cached: NodeSummary = {
      id: nodeSummaryId(CHAPTER.bookHash, CHAPTER.nodeIndex),
      bookHash: CHAPTER.bookHash,
      nodeIndex: CHAPTER.nodeIndex,
      nodeTitle: CHAPTER.nodeTitle,
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
        const summary: NodeSummary = {
          id: nodeSummaryId(input.bookHash, input.nodeIndex),
          bookHash: input.bookHash,
          nodeIndex: input.nodeIndex,
          nodeTitle: input.nodeTitle,
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

    render(<SummaryTab store={currentStore} />);

    // Cached view: heading + list rendered, regenerate visible.
    expect(await screen.findByText('cached-content-甲')).toBeTruthy();
    expect(screen.getByTestId('regenerate-summary')).toBeTruthy();
    expect(screen.getByText('星图')).toBeTruthy(); // **bold** inline text
    expect(screen.queryByTestId('generate-summary')).toBeNull();

    // 重新生成 is an icon-only button inside the scope card (no separate meta
    // strip repeating the same 「这是哪一节 / 状态 / 动作」 story). The model name
    // is NOT here: it is rendered once at the sidebar tab level
    // (AISidebar's `sidebar-model-chip`), shared by 总结 and 伴读.
    const regenerate = screen.getByTestId('regenerate-summary');
    const scopeCard = screen.getByTestId('summary-scope-header');
    expect(scopeCard.contains(regenerate)).toBe(true);
    expect(regenerate.textContent?.trim()).toBe('');
    expect(screen.getByRole('button', { name: '重新生成' })).toBe(regenerate);
    expect(screen.queryByTestId('summary-meta-bar')).toBeNull();
    // Metadata is one item per fact, each with its own style: word count and
    // status are Tokens, the update time is the quietest of the three.
    expect(scopeCard.textContent).toContain('已生成');
    const facts = screen.getByTestId('summary-scope-row');
    expect(facts.textContent).toContain('约');
    expect(facts.textContent).toContain('已生成');
    expect(facts.querySelectorAll('.astryx-token').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('summary-updated-at').textContent).toContain('更新于');
    expect(scopeCard.textContent).not.toContain('deepseek-chat');

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

    render(<SummaryTab store={currentStore} />);
    await waitFor(() => screen.getByTestId('generate-summary'));

    fireEvent.click(screen.getByTestId('generate-summary'));

    await waitFor(() => {
      expect(screen.getByTestId('summary-error-text').textContent).toBe('请先在侧栏右上角 ⚙ 完成 AI 设置');
    });
    expect(screen.getByTestId('retry-summary')).toBeTruthy();
    expect(screen.getByText(/⚙ 检查 AI 设置/)).toBeTruthy();
    expect(store.getState().phase).toBe('error');
  });

  it('re-opens (cache check only) when the reader moves to another node', async () => {
    const { factory, store } = setup();
    const openNode = vi.spyOn(store.getState(), 'openNode');

    render(<SummaryTab store={currentStore} />);
    await waitFor(() => screen.getByTestId('generate-summary'));
    expect(openNode).toHaveBeenCalledTimes(1);

    act(() => {
      useReaderStore.getState().setPosition(2, DEMO_BOOK.sections[2].title);
    });
    await waitFor(() => expect(openNode).toHaveBeenCalledTimes(2));
    expect(factory).not.toHaveBeenCalled(); // node switching never generates
    expect(store.getState().nodeTitle).toBe('第三章 长夜漫漫');
  });
});

/** setup() + a factory behaviour, sharing one injected store. */
function setupWithFactory(
  behavior: (input: SummarizeInput) => Promise<NodeSummary>,
  seed: NodeSummary[] = [],
): { store: SummaryStore; factory: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> } {
  const base = setup(seed);
  base.factory.mockImplementation(
    (): NodeSummarizer => ({
      summarize: async (input: SummarizeInput) => behavior(input),
    }),
  );
  return base;
}
