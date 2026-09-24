import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SummaryTab, { parseSummarySections } from './SummaryTab';
import {
  createSummaryStore,
  useSummaryStore,
  MISSING_SETTINGS_ERROR,
  type SummaryNodeContext,
  type SummaryStore,
} from '@/store/summaryStore';
import type { NodeSummarizer, SummarizeInput } from '@/services/summary/summarizer';
import type { NodeSummaryRepository } from '@/services/db/repositories';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';
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

/**
 * 《说理》's 版权信息 page shape (用户反馈：这类页面不该有总结按钮): a list of
 * bibliographic fields, long enough to pass the 50-character gate — which is
 * exactly why the character gate could never catch it.
 */
const COPYRIGHT_PAGE = `图书在版编目（CIP）数据

说理 / 陈嘉映著. — 北京：华夏出版社，2011.1
ISBN 978-7-5080-6234-5

中国版本图书馆CIP数据核字（2010）第234567号

责任编辑：李某某
封面设计：某某某
出版发行：华夏出版社
经销：新华书店
印刷：北京某某印刷有限公司
开本：880×1230 1/32
印张：12.5
字数：300千字
版次：2011年1月第1版
印次：2011年1月第1次印刷
定价：38.00元

版权所有·侵权必究`;


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
  useAISidebarStore.setState({ settingsOpen: false });
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
    // Line 1: the 章 ancestor breadcrumb › the current node title. 「」 quotes
    // the node title; 《》 is reserved for book titles.
    expect(panel.textContent).toContain('「第一卷 风云之始」 ›');
    expect(panel.textContent).toContain('第一章 图书馆的密语');
    // Line 2: level word + size facts, and nothing mechanical.
    const facts = screen.getByTestId('summary-scope-row').textContent ?? '';
    expect(facts).toContain('节');
    expect(facts).toContain('约 100 字');
    expect(facts).not.toContain('当前节点');
    expect(panel.textContent).not.toContain('个节点');
    expect(panel.textContent).not.toContain('隶属《');
    // The viewpoint description names the leaf level explicitly.
    expect(panel.textContent).toContain('当前节「第一章 图书馆的密语」暂无总结');
    // The CTA is a real labelled button whose icon is a design-system icon, not
    // an emoji baked into the label (the sidebar's other actions read the same way).
    expect(screen.getByRole('button', { name: '总结当前节' })).toBeTruthy();
    expect(panel.textContent).toContain('总结当前节');
    expect(panel.textContent).not.toContain('⚡');
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
    expect(screen.getByRole('button', { name: '总结当前章' })).toBeTruthy();
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

  it('hides the CTA on a 版权页 and says why, instead of offering a pointless summary', async () => {
    // A 版权页 has plenty of extractable characters, so the old `charCount >= 50`
    // gate offered to summarize it. The node-content rule is what knows better —
    // and here the title is the node model's *placeholder* (「第 2 节」, what an
    // unlabelled spine section gets), so this only passes if the panel really
    // hands the node's text to the classifier.
    const fullText = `${COPYRIGHT_PAGE}\n\n${CHAPTER.text}`;
    const nodes: BookNode[] = [
      {
        nodeId: bookNodeId(DEMO_BOOK.bookHash, 0),
        bookHash: DEMO_BOOK.bookHash,
        nodeIndex: 0,
        title: '第 2 节',
        startOffset: 0,
        endOffset: COPYRIGHT_PAGE.length,
        charCount: COPYRIGHT_PAGE.length,
        depth: 0,
        spineIndex: 0,
        indexStatus: 'ready',
      },
      {
        nodeId: bookNodeId(DEMO_BOOK.bookHash, 1),
        bookHash: DEMO_BOOK.bookHash,
        nodeIndex: 1,
        title: CHAPTER.nodeTitle,
        startOffset: COPYRIGHT_PAGE.length + 2,
        endOffset: fullText.length,
        charCount: CHAPTER.text.length,
        depth: 0,
        spineIndex: 1,
        indexStatus: 'ready',
      },
    ];
    registerAgentBookContext(
      createAgentBookContext({ bookHash: DEMO_BOOK.bookHash, nodes, fullText }),
    );
    const { factory } = setup();
    useReaderStore.setState({ spineIndex: 0, anchor: undefined, nodeTitle: '第 2 节' });
    render(<SummaryTab store={currentStore} />);

    expect(await screen.findByTestId('summary-not-summarizable-note')).toBeTruthy();
    // No button, but not a mystery either: the note names the page kind.
    expect(screen.queryByTestId('generate-summary')).toBeNull();
    expect(screen.getByTestId('summary-not-summarizable-note').textContent).toContain(
      '本页是版权页，没有可提炼的正文内容，无需总结。',
    );
    // The scope row still reports where the reader is and how big the page is;
    // the status token says what kind of page it is instead of 「未总结」.
    const facts = screen.getByTestId('summary-scope-row').textContent ?? '';
    expect(facts).toContain('版权页');
    expect(facts).not.toContain('未总结');
    expect(factory).not.toHaveBeenCalled();
  });

  it('keeps the CTA on prose front matter — 序言 is content, not furniture', async () => {
    // The narrowest part of the rule: only structural pages lose the button.
    // 《何为良好生活》's 「序言」 node even *opens* with a copyright page (the NCX
    // points both entries at one anchor), so a title-based or text-prefix-only
    // rule would silently remove the button from real preface prose.
    const nodes: BookNode[] = [
      {
        nodeId: bookNodeId(DEMO_BOOK.bookHash, 0),
        bookHash: DEMO_BOOK.bookHash,
        nodeIndex: 0,
        title: '序言',
        startOffset: 0,
        endOffset: CHAPTER.text.length,
        charCount: CHAPTER.text.length,
        depth: 0,
        spineIndex: 0,
        indexStatus: 'ready',
      },
    ];
    registerAgentBookContext(
      createAgentBookContext({
        bookHash: DEMO_BOOK.bookHash,
        nodes,
        fullText: `${CHAPTER.text}${'x'.repeat(20)}`,
      }),
    );
    setup();
    useReaderStore.setState({ spineIndex: 0, anchor: undefined, nodeTitle: '序言' });
    render(<SummaryTab store={currentStore} />);

    expect(await screen.findByTestId('generate-summary')).toBeTruthy();
    expect(screen.queryByTestId('summary-not-summarizable-note')).toBeNull();
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

  it('copies the summary from a button beside 重新生成', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const cached: NodeSummary = {
      id: nodeSummaryId(CHAPTER.bookHash, CHAPTER.nodeIndex),
      bookHash: CHAPTER.bookHash,
      nodeIndex: CHAPTER.nodeIndex,
      nodeTitle: CHAPTER.nodeTitle,
      modelUsed: 'deepseek-chat',
      summaryContent: '### 📌 章节核心要义\n可复制的总结正文',
      pipeline: 'single',
      createdAt: 1,
      updatedAt: 2,
    };
    setup([cached]);

    render(<SummaryTab store={currentStore} />);

    const copy = await screen.findByTestId('copy-summary');
    // It lives with 重新生成 in the scope card, not in a second action strip.
    expect(screen.getByTestId('summary-scope-header').contains(copy)).toBe(true);
    expect(screen.getByTestId('regenerate-summary')).toBeTruthy();

    fireEvent.click(copy);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(cached.summaryContent));
    await waitFor(() =>
      expect(screen.getByTestId('copy-summary-feedback').getAttribute('data-copied')).toBe('true'),
    );
  });

  it('has no copy action before a summary exists', async () => {
    setup();
    render(<SummaryTab store={currentStore} />);

    await screen.findByTestId('generate-summary');
    expect(screen.queryByTestId('copy-summary')).toBeNull();
  });

  it('offers the setup card instead of the CTA when no provider is configured', async () => {
    useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } }); // no apiKey
    const { factory } = setup();

    render(<SummaryTab store={currentStore} />);

    const card = await screen.findByTestId('summary-setup');
    expect(card.textContent).toContain('先配置一个 AI 模型');
    expect(card.textContent).toContain('配置模型后，可以为当前节点生成三段式总结');
    // No CTA that could only lead to a guaranteed failure (ADR 0004: nothing is
    // called until the reader asks, and here the asking is the settings panel).
    expect(screen.queryByTestId('generate-summary')).toBeNull();
    expect(factory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('summary-setup-button'));
    expect(useAISidebarStore.getState().settingsOpen).toBe(true);
  });

  it('does not offer the setup card on a page that needs no summary at all', async () => {
    useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } }); // no apiKey
    const nodes: BookNode[] = [
      {
        nodeId: bookNodeId(DEMO_BOOK.bookHash, 0),
        bookHash: DEMO_BOOK.bookHash,
        nodeIndex: 0,
        title: '第 2 节',
        startOffset: 0,
        endOffset: COPYRIGHT_PAGE.length,
        charCount: COPYRIGHT_PAGE.length,
        depth: 0,
        spineIndex: 0,
        indexStatus: 'ready',
      },
    ];
    registerAgentBookContext(
      createAgentBookContext({ bookHash: DEMO_BOOK.bookHash, nodes, fullText: COPYRIGHT_PAGE }),
    );
    setup();
    useReaderStore.setState({ spineIndex: 0, anchor: undefined, nodeTitle: '第 2 节' });
    render(<SummaryTab store={currentStore} />);

    expect(await screen.findByTestId('summary-not-summarizable-note')).toBeTruthy();
    // A missing model is not this page's problem: no CTA, so no setup card —
    // the note above already says why there is nothing to generate.
    expect(screen.queryByTestId('summary-setup')).toBeNull();
  });

  it('answers a missing-key failure with the setup card, not a red error card', async () => {
    useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } }); // no apiKey
    setup();
    render(<SummaryTab store={currentStore} />);
    await screen.findByTestId('summary-setup');

    // The store still reports the missing-settings error on its own path; the
    // panel's answer to it is the way out, not a red card with a dead retry.
    act(() => {
      currentStore.setState({ phase: 'error', error: MISSING_SETTINGS_ERROR });
    });

    expect(screen.getByTestId('summary-setup')).toBeTruthy();
    expect(screen.queryByTestId('summary-error-text')).toBeNull();
    expect(screen.queryByTestId('retry-summary')).toBeNull();
  });

  it('shows a classified error card with 重试 and 打开 AI 设置', async () => {
    const apiFailure = {
      name: 'AI_APICallError',
      message: 'Unauthorized',
      statusCode: 401,
      responseBody: '{"error":{"message":"Incorrect API key provided: sk-***"}}',
    };
    let attempts = 0;
    const { factory } = setupWithFactory(async () => {
      attempts += 1;
      throw apiFailure;
    });

    render(<SummaryTab store={currentStore} />);
    fireEvent.click(await screen.findByTestId('generate-summary'));

    const text = await screen.findByTestId('summary-error-text');
    // Classified Chinese copy; the upstream English never reaches the reader.
    expect(text.textContent).toContain('API Key');
    expect(text.textContent).not.toContain('Incorrect API key provided');
    expect(currentStore.getState().phase).toBe('error');
    expect(factory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('retry-summary'));
    await waitFor(() => expect(factory).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTestId('summary-error-settings'));
    expect(useAISidebarStore.getState().settingsOpen).toBe(true);
  });

  it('renders three-part summary sections as collapsible accordion items', async () => {
    const cached: NodeSummary = {
      id: nodeSummaryId(CHAPTER.bookHash, CHAPTER.nodeIndex),
      bookHash: CHAPTER.bookHash,
      nodeIndex: CHAPTER.nodeIndex,
      nodeTitle: CHAPTER.nodeTitle,
      modelUsed: 'deepseek-chat',
      summaryContent: [
        '### 📌 核心要义',
        '这是本章核心要义。',
        '',
        '### 🗺️ 关键内容脉络',
        '1. **要点一**：脉络展开一',
        '2. **要点二**：脉络展开二',
        '',
        '### 💡 核心概念与关键术语',
        '- **概念一**：术语解释',
      ].join('\n'),
      pipeline: 'single',
      createdAt: 1,
      updatedAt: 2,
    };
    setup([cached]);

    render(<SummaryTab store={currentStore} />);

    // Check all three accordion headers exist
    const triggerCore = await screen.findByText('📌 核心要义');
    const triggerOutline = screen.getByText('🗺️ 关键内容脉络');
    const triggerTerms = screen.getByText('💡 核心概念与关键术语');

    expect(triggerCore).toBeTruthy();
    expect(triggerOutline).toBeTruthy();
    expect(triggerTerms).toBeTruthy();

    // The buttons have aria-expanded="true" by default
    const buttonOutline = triggerOutline.closest('button')!;
    expect(buttonOutline.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/脉络展开一/)).toBeTruthy();

    // Clicking trigger collapses the section
    fireEvent.click(buttonOutline);
    expect(buttonOutline.getAttribute('aria-expanded')).toBe('false');

    // Clicking again expands it
    fireEvent.click(buttonOutline);
    expect(buttonOutline.getAttribute('aria-expanded')).toBe('true');

    // Section count badges are displayed on triggers
    expect(screen.getByText('2 个要点')).toBeTruthy();
    expect(screen.getByText('1 个术语')).toBeTruthy();

    // Title in toolbar is displayed with truncation-friendly styling
    const toolbarTitle = screen.getByTestId('summary-toolbar-title');
    expect(toolbarTitle).toBeTruthy();
    expect(toolbarTitle.textContent).toBe(CHAPTER.nodeTitle);

    // Toggle all button collapses and expands all sections
    const toggleAllBtn = screen.getByTestId('summary-toggle-all');
    expect(toggleAllBtn.textContent).toContain('全部折叠');

    fireEvent.click(toggleAllBtn);
    expect(toggleAllBtn.textContent).toContain('全部展开');
    expect(triggerCore.closest('button')!.getAttribute('aria-expanded')).toBe('false');
    expect(triggerOutline.closest('button')!.getAttribute('aria-expanded')).toBe('false');
    expect(triggerTerms.closest('button')!.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggleAllBtn);
    expect(toggleAllBtn.textContent).toContain('全部折叠');
    expect(triggerCore.closest('button')!.getAttribute('aria-expanded')).toBe('true');
    expect(triggerOutline.closest('button')!.getAttribute('aria-expanded')).toBe('true');
    expect(triggerTerms.closest('button')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('strips markdown horizontal rules (---) so no dividers appear in summary sections', () => {
    const raw = [
      '### 📌 核心要义',
      '核心要义内容。',
      '---',
      '',
      '### 🗺️ 关键内容脉络',
      '1. 脉络一',
      '---',
    ].join('\n');
    const { sections } = parseSummarySections(raw);
    expect(sections).toHaveLength(2);
    expect(sections[0].content).not.toContain('---');
    expect(sections[0].content).toBe('核心要义内容。');
    expect(sections[1].content).not.toContain('---');
    expect(sections[1].content).toBe('1. 脉络一');
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
