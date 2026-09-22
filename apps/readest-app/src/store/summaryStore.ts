/**
 * Summary store (ticket 03, ADR 0004: strictly manual trigger).
 *
 * Per-chapter UI state keyed by `${bookHash}:${nodeIndex}`:
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
import type { AISettings, NodeSummary } from '@/types/ai';
import type { NodeKind } from '@/types/readingAgent';
import { NodeSummaryRepository } from '@/services/db/repositories';
import {
  createNodeSummarizer,
  isAbortError,
  type NodeSummarizer,
  type SummarizeInput,
  type SummarizerStage,
} from '@/services/summary/summarizer';
import { resolveCurrentNodeText } from '@/services/summary/nodeSource';
import { getAgentBookContext } from '@/services/agent/agentContext';
import { nodeKindLabel } from '@/services/bookNodes';
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

export interface SummaryNodeContext {
  bookHash: string;
  nodeIndex: number;
  bookTitle: string;
  nodeTitle: string;
  /** 本次总结视角的节点层级（最小节点：有节就是节）。 */
  kind: NodeKind;
  text: string;
  charCount: number;
}

export interface SummaryState {
  phase: SummaryPhase;
  /** Streamed (or cached) three-part summary text. */
  content: string;
  cachedSummary: NodeSummary | null;
  nodeTitle: string;
  /** 当前视角的节点层级，用于阶段文案（「正在合成整节脉络…」）。 */
  kind: NodeKind;
  charCount: number;
  /** e.g. `正在分块提炼 (1/2)...` / `正在合成整节脉络...`. */
  stageLabel: string;
  error: string | null;
  /** `${bookHash}:${nodeIndex}` of the node this state belongs to. */
  activeKey: string;
  /** AbortController of the in-flight generation, if any. */
  controller: AbortController | null;
  openNode: (
    bookHash: string,
    nodeIndex: number,
    nodeTitle: string,
    charCount: number,
  ) => Promise<void>;
  generate: (force?: boolean) => Promise<void>;
  stop: () => void;
}

export type SummaryStore = UseBoundStore<StoreApi<SummaryState>>;

export interface SummaryStoreDeps {
  summarizerFactory: (settings: AISettings) => NodeSummarizer;
  repository: NodeSummaryRepository;
  /** Node resolver seam; defaults to readerStore + nodeSource. */
  resolveNode?: () => SummaryNodeContext;
}

export const summaryNodeKey = (bookHash: string, nodeIndex: number): string =>
  `${bookHash}:${nodeIndex}`;

export const MISSING_SETTINGS_ERROR = '请先在侧栏右上角 ⚙ 完成 AI Provider 配置';

const stageLabelFor = (stage: SummarizerStage, kind: NodeKind): string => {
  if (stage === 'mapping') return '正在分块提炼...';
  if (stage === 'reducing') return `正在合成整${nodeKindLabel(kind)}脉络...`;
  return '';
};

/** 当前阅读位置的节点上下文（最小节点 = 总结视角）。 */
export const resolveCurrentNodeContext = (): SummaryNodeContext => {
  const { bookHash, bookTitle, spineIndex, nodeTitle } = useReaderStore.getState();
  const { title, text, charCount, kind } = resolveCurrentNodeText();
  return {
    bookHash,
    // 物理段序号是缓存键的兜底；建好索引时由节点模型给出节点序号。
    nodeIndex: resolveNodeIndexForCache(spineIndex),
    bookTitle,
    nodeTitle: nodeTitle || title,
    kind,
    text,
    charCount,
  };
};

/**
 * 缓存键里用的节点序号：优先取节点模型解析出的节点序号（目录比正文文件更细
 * 时物理段序号会与节点序号错位），没有索引时退回物理段序号。
 */
const resolveNodeIndexForCache = (spineIndex: number): number => {
  const { bookHash, anchor } = useReaderStore.getState();
  const context = bookHash ? getAgentBookContext(bookHash) : undefined;
  const node = context?.resolveNodeAt(spineIndex, anchor);
  return node ? node.nodeIndex : spineIndex;
};

/**
 * Real-pipeline summarizer factory. The AI SDK transport is imported lazily
 * on first generation so importing this module (and every component test)
 * stays light and offline.
 */
const createRealSummarizer = async (settings: AISettings): Promise<NodeSummarizer> => {
  const { createAiSdkStreamFn } = await import('@/services/ai/streamClient');
  return createNodeSummarizer({
    stream: createAiSdkStreamFn(),
    settings,
    repository: new NodeSummaryRepository(),
  });
};

export function createSummaryStore({
  summarizerFactory,
  repository,
  resolveNode = resolveCurrentNodeContext,
}: SummaryStoreDeps): SummaryStore {
  /**
   * Generation run token: bumped by `openNode` and every new `generate`,
   * so events from a stale run (node switched mid-flight) are dropped.
   */
  let runToken = 0;

  return create<SummaryState>()((set, get) => ({
    phase: 'idle',
    content: '',
    cachedSummary: null,
    nodeTitle: '',
    kind: 'chapter',
    charCount: 0,
    stageLabel: '',
    error: null,
    activeKey: '',
    controller: null,

    // Strictly manual trigger (ADR 0004): cache check only, never generates.
    openNode: async (bookHash, nodeIndex, nodeTitle, charCount) => {
      runToken += 1;
      get().controller?.abort();
      const key = summaryNodeKey(bookHash, nodeIndex);
      set({
        phase: 'checking-cache',
        activeKey: key,
        content: '',
        cachedSummary: null,
        nodeTitle,
        charCount,
        stageLabel: '',
        error: null,
        controller: null,
      });

      const cached = await repository.get(bookHash, nodeIndex);
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

      const node = resolveNode();
      const key = summaryNodeKey(node.bookHash, node.nodeIndex);

      if (!force) {
        const cached = await repository.get(node.bookHash, node.nodeIndex);
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
        nodeTitle: node.nodeTitle,
        kind: node.kind,
        charCount: node.charCount,
        cachedSummary: null,
        controller,
      });

      const summarize: SummarizeInput['onEvent'] = (event) => {
        if (token !== runToken) return;
        switch (event.type) {
          case 'stage':
            set({ stageLabel: stageLabelFor(event.stage, node.kind) });
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
          bookHash: node.bookHash,
          nodeIndex: node.nodeIndex,
          nodeTitle: node.nodeTitle,
          nodeKind: node.kind,
          bookTitle: node.bookTitle,
          text: node.text,
          signal: controller.signal,
          onEvent: summarize,
        });
        if (token !== runToken) return;

        set({ phase: 'done', content: summary.summaryContent, stageLabel: '' });
        const stored = await repository.get(node.bookHash, node.nodeIndex);
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
 * Dexie-backed NodeSummaryRepository.
 */
export const useSummaryStore: SummaryStore = createSummaryStore({
  summarizerFactory: (settings) => ({
    summarize: (input) => createRealSummarizer(settings).then((s) => s.summarize(input)),
  }),
  repository: new NodeSummaryRepository(),
});

let activeStore: SummaryStore = useSummaryStore;

/** Store consumed by SummaryTab; tests swap in a factory-built store. */
export const getSummaryStore = (): SummaryStore => activeStore;

/** Test seam for the module-level store injection point. */
export function setSummaryStore(store: SummaryStore): void {
  activeStore = store;
}
