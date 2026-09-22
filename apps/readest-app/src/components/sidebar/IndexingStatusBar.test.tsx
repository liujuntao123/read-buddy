import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IndexingStatusBar from './IndexingStatusBar';
import { EMPTY_SHAPE, useBookIndexStore } from '@/store/bookIndexStore';
import { useReaderStore } from '@/store/readerStore';
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

  it('shows the ready summary as a chapter · section book scale (全书画像就绪)', () => {
    useBookIndexStore.setState({
      bookHash: 'pano-bk',
      phase: 'ready',
      shape: { chapter: 11, section: 70, chunk: 0, total: 81, isNested: true, minimalKind: 'section' },
      briefTotal: 70,
      briefedCount: 70,
      panoramaReady: true,
    });
    render(<IndexingStatusBar />);
    expect(screen.getByTestId('index-ready-label').textContent).toBe(
      '全书 11 章 · 70 节（已索引 70/70） · 全书画像就绪',
    );
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
    expect(screen.getByTestId('index-ready-label').textContent).toBe('全书 1 章 · 2 节（已索引 2/2）');
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
    const briefs = screen.getAllByTestId('panorama-brief-item');
    expect(briefs.length).toBe(3);
    // Row prefix is a level marker from the node model, never a global ordinal.
    const kinds = screen.getAllByTestId('panorama-brief-kind').map((el) => el.textContent);
    expect(kinds).toEqual(['章', '节', '节']);
    expect(briefs[0]!.textContent).toContain('第一卷 风云之始');
    expect(briefs[1]!.textContent).toContain('第一章 风起');
    expect(briefs[1]!.textContent).toContain('第1章微摘要。');
    expect(briefs[2]!.textContent).toContain('（待生成微简介）');
    expect(briefs[1]!.textContent).not.toContain('第 2 节');
    // Progress block counts the minimal nodes in their own unit word.
    expect(screen.getByTestId('panorama-brief-progress').textContent).toContain('2/2 节');
    // Portrait-only content is hidden while the outline tab is active.
    expect(screen.queryByTestId('panorama-summary')).toBeNull();
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
    expect(confirmDialog.textContent).toContain('节点微摘要');

    const confirm = within(confirmDialog).getByRole('button', { name: '重新索引' });
    fireEvent.click(confirm);
    await waitFor(() => expect(reindex).toHaveBeenCalledTimes(1));
    expect(reindex).toHaveBeenCalledWith('pano-bk', expect.objectContaining({ currentSectionIndex: 0 }));
  });
});
