import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IndexingStatusBar from './IndexingStatusBar';
import { EMPTY_SHAPE, useBookIndexStore } from '@/store/bookIndexStore';
import { useReaderStore } from '@/store/readerStore';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { DEFAULT_AI_SETTINGS } from '@/types/ai';
import {
  createAgentBookContext,
  registerAgentBookContext,
  clearAgentBookContext,
} from '@/services/agent/agentContext';
import { shapeOfNodes } from '@/services/bookNodes';
import type { BookNode } from '@/types/readingAgent';

/** 章 › 节 两级结构：1 章 · 2 节，最小节点 = 节（微大纲的单位）。 */
const CHAPTERS: BookNode[] = [
  {
    nodeId: 'pano-bk:n_0',
    bookHash: 'pano-bk',
    nodeIndex: 0,
    title: '第一卷 风云之始',
    startOffset: 0,
    endOffset: 100,
    charCount: 100,
    depth: 0,
    indexStatus: 'ready',
    brief: '卷首：守塔人登场。',
  },
  {
    nodeId: 'pano-bk:n_1',
    bookHash: 'pano-bk',
    nodeIndex: 1,
    title: '第一章 风起',
    startOffset: 100,
    endOffset: 200,
    charCount: 100,
    depth: 1,
    parentNodeId: 'pano-bk:n_0',
    indexStatus: 'ready',
    brief: '第1章微摘要。',
  },
  {
    nodeId: 'pano-bk:n_2',
    bookHash: 'pano-bk',
    nodeIndex: 2,
    title: '第二章 雾锁',
    startOffset: 200,
    endOffset: 300,
    charCount: 100,
    depth: 1,
    parentNodeId: 'pano-bk:n_0',
    indexStatus: 'pending',
    brief: undefined,
  },
];

const registerContext = () => {
  const context = createAgentBookContext({
    bookHash: 'pano-bk',
    nodes: CHAPTERS,
    fullText: CHAPTERS.map((c) => `第${c.nodeIndex + 1}章正文内容`.repeat(20)).join('\n\n'),
    panorama: {
      bookHash: 'pano-bk',
      genre: '悬疑',
      summary: '守夜人追寻灯塔熄灭之谜，跨越双塔的守望约定。',
      worldSetting: '北海孤岛',
      mainCharacters: ['林远', '阿澈'],
      totalNodes: 3,
      isFullyIndexed: true,
      createdAt: 1,
      updatedAt: 1,
    },
  });
  registerAgentBookContext(context);
  return context;
};

beforeEach(() => {
  clearAgentBookContext('pano-bk');
  useBookIndexStore.getState().reset();
  useAISidebarStore.setState({ settingsOpen: false, expanded: false });
  useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } });
  useReaderStore.setState({
    bookHash: 'pano-bk',
    bookTitle: '灯塔之夜',
    spineIndex: 0,
    anchor: undefined,
    nodeTitle: '第一章',
    spineCount: 3,
  });
});

afterEach(() => {
  useBookIndexStore.getState().reset();
  useReaderStore.setState({ bookHash: '', bookTitle: '', spineIndex: 0, anchor: undefined, nodeTitle: '', spineCount: 0 });
  clearAgentBookContext('pano-bk');
});

describe('IndexingStatusBar', () => {
  it('stays invisible before any indexing happened', () => {
    useBookIndexStore.setState({ shape: EMPTY_SHAPE, phase: 'idle' });
    render(<IndexingStatusBar />);
    expect(screen.queryByTestId('indexing-status-bar')).toBeNull();
  });

  it('shows the silent micro-outline progress while briefing', () => {
    useBookIndexStore.setState({
      bookHash: 'pano-bk',
      phase: 'briefs',
      shape: shapeOfNodes(CHAPTERS),
      briefTotal: 2,
      briefedCount: 1,
      progressLabel: '正在建立全书微大纲 (1/2 节)',
    });
    render(<IndexingStatusBar />);
    expect(screen.getByTestId('indexing-progress-label').textContent).toBe(
      '● 正在建立全书微大纲 (1/2 节)',
    );
  });
  it('shows the panorama phase while portraiting', () => {
    useBookIndexStore.setState({ bookHash: 'pano-bk', phase: 'panorama', shape: shapeOfNodes(CHAPTERS) });
    render(<IndexingStatusBar />);
    expect(screen.getByTestId('indexing-progress-label').textContent).toContain('全景画像');
  });

  it('shows the ready summary as a book scale plus progress / panorama tokens', () => {
    useBookIndexStore.setState({
      bookHash: 'pano-bk',
      phase: 'ready',
      shape: { chapter: 11, section: 70, chunk: 0, total: 81, isNested: true, minimalKind: 'section' },
      briefTotal: 70,
      briefedCount: 70,
      panoramaReady: true,
    });
    render(<IndexingStatusBar />);
    // Three facts, three treatments: the scale is the neutral sentence, the
    // progress and the panorama readiness are Tokens (green = complete/ready).
    expect(screen.getByTestId('index-ready-label').textContent).toBe('全书 11 章 · 70 节');
    expect(screen.getByTestId('index-progress-token').textContent).toBe('已索引 70/70');
    expect(screen.getByTestId('index-progress-token').getAttribute('data-color')).toBe('green');
    expect(screen.getByTestId('index-panorama-token').textContent).toBe('画像就绪');
  });

  it('derives the ready scale from the fixture node shape (章 · 节, minimal = 节)', () => {
    useBookIndexStore.setState({
      bookHash: 'pano-bk',
      phase: 'ready',
      shape: shapeOfNodes(CHAPTERS),
      briefTotal: 2,
      briefedCount: 2,
      panoramaReady: false,
    });
    render(<IndexingStatusBar />);
    expect(screen.getByTestId('index-ready-label').textContent).toBe('全书 1 章 · 2 节');
    expect(screen.getByTestId('index-progress-token').textContent).toBe('已索引 2/2');
    // Nothing to report about the panorama yet: no chip, no noise.
    expect(screen.queryByTestId('index-panorama-token')).toBeNull();
  });

  it('marks a partially indexed book with the in-progress token colour', () => {
    useBookIndexStore.setState({
      bookHash: 'pano-bk',
      phase: 'briefs',
      shape: shapeOfNodes(CHAPTERS),
      briefTotal: 2,
      briefedCount: 1,
      progressLabel: '正在建立全书微大纲 (1/2 节)',
      panoramaReady: false,
    });
    render(<IndexingStatusBar />);

    // Busy sentence in accent, progress chip still blue (not done yet) …
    expect(screen.getByTestId('indexing-progress-label').textContent).toBe(
      '● 正在建立全书微大纲 (1/2 节)',
    );
    expect(screen.getByTestId('index-progress-token').textContent).toBe('已索引 1/2');
    expect(screen.getByTestId('index-progress-token').getAttribute('data-color')).toBe('blue');
    expect(screen.queryByTestId('index-panorama-token')).toBeNull();
  });

  it('offers the AI settings action when the provider is not configured yet', () => {
    useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } });
    useBookIndexStore.setState({
      bookHash: 'pano-bk',
      phase: 'awaiting-key',
      shape: shapeOfNodes(CHAPTERS),
      briefTotal: 2,
      briefedCount: 0,
      panoramaReady: false,
    });
    render(<IndexingStatusBar />);

    // The skipped AI phases are visible, not silent …
    expect(screen.getByTestId('index-awaiting-key-label').textContent).toBe(
      '配置 API Key 后可生成伴读索引',
    );
    // … and there is an action that leads somewhere, instead of a button that
    // silently does nothing (the unconfigured-provider symptom).
    fireEvent.click(screen.getByTestId('index-settings-button'));
    expect(useAISidebarStore.getState().settingsOpen).toBe(true);
    expect(useAISidebarStore.getState().expanded).toBe(true);
  });

  it('turns the parked state into a start action once a provider is configured', () => {
    // Configured means a key is present — the index pipeline and the settings
    // form share that one rule (providerReadiness).
    useAISettingsStore.setState({
      settings: { ...DEFAULT_AI_SETTINGS, provider: 'deepseek', apiKey: 'sk-test' },
    });
    useBookIndexStore.setState({
      bookHash: 'pano-bk',
      phase: 'awaiting-key',
      shape: shapeOfNodes(CHAPTERS),
      briefTotal: 2,
      briefedCount: 0,
      panoramaReady: false,
    });
    render(<IndexingStatusBar />);

    expect(screen.getByTestId('index-awaiting-key-label').textContent).toBe(
      'AI 已就绪 · 点击生成伴读索引',
    );
    expect(screen.queryByTestId('index-settings-button')).toBeNull();
    expect(screen.getByTestId('index-start-button')).toBeTruthy();
  });

  it('renders the error instead of the neutral call-to-action when indexing failed', () => {
    useBookIndexStore.setState({
      bookHash: 'pano-bk',
      phase: 'failed',
      shape: shapeOfNodes(CHAPTERS),
      error: '模型服务不可用',
    });
    render(<IndexingStatusBar />);

    expect(screen.getByTestId('index-failed-label').textContent).toBe('索引失败：模型服务不可用');
    expect(screen.queryByTestId('index-ready-label')).toBeNull();
    expect(screen.getByTestId('index-retry-button')).toBeTruthy();
  });

  it('opens the panorama dialog with tabs: 画像 portrait + complete 全书脉络 outline', async () => {
    registerContext();
    useBookIndexStore.setState({
      bookHash: 'pano-bk',
      phase: 'ready',
      shape: shapeOfNodes(CHAPTERS),
      briefTotal: 2,
      briefedCount: 2,
      panoramaReady: true,
      strategy: 'regex',
    });
    render(<IndexingStatusBar />);

    fireEvent.click(screen.getByTestId('indexing-status-bar'));
    const dialog = await screen.findByTestId('panorama-dialog');
    expect(dialog.textContent).toContain('全书全景画像');
    expect(dialog.textContent).toContain('《灯塔之夜》');

    // ---- Tab 1 (画像, default): stats strip + quote + world card + chips.
    const stats = screen.getByTestId('panorama-stats').textContent ?? '';
    expect(stats).toContain('当前书名');
    expect(stats).toContain('《灯塔之夜》');
    expect(stats).toContain('悬疑');
    expect(stats).toContain('节点划分');
    expect(screen.getByTestId('panorama-node-counts').textContent).toBe('1 章 · 2 节');
    expect(screen.getByTestId('panorama-summary').textContent).toContain('守夜人追寻灯塔熄灭之谜');
    expect(screen.getByTestId('panorama-world').textContent).toContain('北海孤岛');
    const characters = screen.getByTestId('panorama-characters').textContent ?? '';
    expect(characters).toContain('林远');
    expect(characters).toContain('阿澈');
    // The outline lives behind its tab — not rendered while 画像 is active.
    expect(screen.queryByTestId('panorama-briefs')).toBeNull();

    // ---- Tab 2 (全书脉络): progress + COMPLETE hierarchical brief list.
    fireEvent.click(screen.getByRole('tab', { name: /全书脉络（3）/ }));
    expect(screen.getByTestId('panorama-briefs')).toBeTruthy();
    let briefs = screen.getAllByTestId('panorama-brief-item');
    expect(briefs.length).toBe(3);
    // Rows carry no 章 / 节 badge: the accordion nesting is the hierarchy, and
    // the folding header states its own child count instead.
    expect(screen.queryByTestId('panorama-brief-kind')).toBeNull();
    expect(briefs[0]!.textContent).toContain('第一卷 风云之始');
    expect(briefs[0]!.textContent).toContain('2 节');
    expect(briefs[1]!.textContent).toContain('第一章 风起');
    expect(briefs[1]!.textContent).toContain('第1章微摘要。');
    expect(briefs[2]!.textContent).toContain('（待生成微简介）');
    expect(briefs[1]!.textContent).not.toContain('第 2 节');
    // Progress block counts the minimal nodes in their own unit word.
    expect(screen.getByTestId('panorama-brief-progress').textContent).toContain('2/2 节');
    // Portrait-only content is hidden while the outline tab is active.
    expect(screen.queryByTestId('panorama-summary')).toBeNull();

    // Chapter folding: folding the first chapter hides its 2 child sections
    const foldToggle = screen.getByTestId('panorama-fold-toggle-0');
    expect(foldToggle.closest('button')?.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(foldToggle);
    briefs = screen.getAllByTestId('panorama-brief-item');
    expect(briefs.length).toBe(1);
    expect(foldToggle.closest('button')?.getAttribute('aria-expanded')).toBe('false');

    // Unfold by clicking the toggle again
    fireEvent.click(foldToggle);
    briefs = screen.getAllByTestId('panorama-brief-item');
    expect(briefs.length).toBe(3);

    // Toggle all: one icon button, whose label states the action it performs.
    const toggleAllBtn = screen.getByTestId('toggle-all-panorama-chapters');
    expect(toggleAllBtn.getAttribute('aria-label')).toBe('全部折叠');
    fireEvent.click(toggleAllBtn);
    briefs = screen.getAllByTestId('panorama-brief-item');
    expect(briefs.length).toBe(1);

    expect(toggleAllBtn.getAttribute('aria-label')).toBe('全部展开');
    fireEvent.click(toggleAllBtn);
    briefs = screen.getAllByTestId('panorama-brief-item');
    expect(briefs.length).toBe(3);
  });

  it('never shows a pending placeholder on a container 章 (it is never briefed)', async () => {
    // A 章 that owns 节 is a structural grouping: the brief queue only ever
    // visits minimal nodes, so a placeholder here would read as a stuck job.
    const containerOnly: BookNode[] = [
      { ...CHAPTERS[0]!, brief: undefined, indexStatus: 'ready' },
      CHAPTERS[1]!,
      CHAPTERS[2]!,
    ];
    registerAgentBookContext(
      createAgentBookContext({
        bookHash: 'pano-bk',
        nodes: containerOnly,
        fullText: '正文'.repeat(200),
        panorama: {
          bookHash: 'pano-bk',
          genre: '悬疑',
          summary: '概要',
          totalNodes: 3,
          isFullyIndexed: true,
          createdAt: 1,
          updatedAt: 1,
        },
      }),
    );
    useBookIndexStore.setState({
      bookHash: 'pano-bk',
      phase: 'ready',
      shape: shapeOfNodes(containerOnly),
      briefTotal: 2,
      briefedCount: 1,
      panoramaReady: true,
      strategy: 'regex',
    });
    render(<IndexingStatusBar />);

    fireEvent.click(screen.getByTestId('indexing-status-bar'));
    await screen.findByTestId('panorama-dialog');
    fireEvent.click(screen.getByRole('tab', { name: /全书脉络（3）/ }));

    const briefs = screen.getAllByTestId('panorama-brief-item');
    // Container 章: title only, no pending placeholder.
    expect(briefs[0]!.textContent).toContain('第一卷 风云之始');
    expect(briefs[0]!.textContent).not.toContain('待生成微简介');
    // Its two 节 are minimal nodes, so the un-briefed one still says pending.
    expect(briefs[2]!.textContent).toContain('（待生成微简介）');
  });

  it('renders a single-level book as flat rows (nothing to fold)', async () => {
    // 章-only book (native directory without 节, or fixed-length 段): every row
    // is a minimal node, so the row itself carries the brief and no accordion
    // control exists at all.
    const flat: BookNode[] = [
      { ...CHAPTERS[1]!, depth: 0, parentNodeId: undefined, title: '第一章 风起' },
      { ...CHAPTERS[2]!, depth: 0, parentNodeId: undefined, title: '第二章 雾锁' },
    ];
    registerAgentBookContext(
      createAgentBookContext({
        bookHash: 'pano-bk',
        nodes: flat,
        fullText: '正文'.repeat(200),
        panorama: {
          bookHash: 'pano-bk',
          genre: '悬疑',
          summary: '概要',
          totalNodes: 2,
          isFullyIndexed: true,
          createdAt: 1,
          updatedAt: 1,
        },
      }),
    );
    useBookIndexStore.setState({
      bookHash: 'pano-bk',
      phase: 'ready',
      shape: shapeOfNodes(flat),
      briefTotal: 2,
      briefedCount: 1,
      panoramaReady: true,
      strategy: 'native',
    });
    render(<IndexingStatusBar />);

    fireEvent.click(screen.getByTestId('indexing-status-bar'));
    await screen.findByTestId('panorama-dialog');
    fireEvent.click(screen.getByRole('tab', { name: /全书脉络（2）/ }));

    const rows = screen.getAllByTestId('panorama-brief-item');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('第1章微摘要。');
    expect(rows[1]!.textContent).toContain('（待生成微简介）');
    // No foldable group → no fold handle and no 全部折叠 control.
    expect(screen.queryByTestId('toggle-all-panorama-chapters')).toBeNull();
    expect(screen.queryByTestId('panorama-fold-toggle-0')).toBeNull();
  });

  it('reindex button asks for confirmation, then triggers the pipeline reset', async () => {
    registerContext();
    const reindex = vi.fn();
    useBookIndexStore.setState({
      bookHash: 'pano-bk',
      phase: 'ready',
      shape: shapeOfNodes(CHAPTERS),
      briefTotal: 2,
      briefedCount: 2,
      panoramaReady: true,
      reindex,
    });
    render(<IndexingStatusBar />);

    fireEvent.click(screen.getByTestId('reindex-button'));
    expect(reindex).not.toHaveBeenCalled();
    const confirmDialog = await screen.findByTestId('reindex-confirm');
    expect(confirmDialog.textContent).toContain('重新索引全书');
    expect(confirmDialog.textContent).toContain('全书画像与章节脉络');

    const confirm = within(confirmDialog).getByRole('button', { name: '重新索引' });
    fireEvent.click(confirm);
    await waitFor(() => expect(reindex).toHaveBeenCalledTimes(1));
    expect(reindex).toHaveBeenCalledWith('pano-bk', expect.objectContaining({ currentSpineIndex: 0 }));
  });
});
