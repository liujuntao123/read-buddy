/**
 * Summary store (ticket 03, ADR 0004: strictly manual trigger).
 *
 * Per-chapter UI state keyed by `${bookHash}:${nodeIndex}`:
 * - `openChapter` only checks the local cache — it NEVER starts a model call;
 * - `generate` is the only entry into the pipeline and is always user-fired
 *   (the 总结当前节 button or 重新生成); `force=true` bypasses the cache;
 * - `stop` aborts the in-flight run; partial streamed content is kept.
 *
 * The factory injects the summarizer factory, the repository and the node resolver
 * so tests run hermetically; the app uses the singleton at the bottom, and
 * `SummaryTab` reaches it through a **store prop defaulted to that singleton** — the
 * convention `ChatTab` and `Bookshelf` already use (候选 epilogue).
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
import { resolveCurrentNodeView, nodeKindLabel } from '@/services/bookNodes';
import { providerReady } from '@/services/ai/providerReadiness';
import { describeAIError } from '@/services/ai/errorMessages';
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

export const MISSING_SETTINGS_ERROR = '请先在侧栏右上角 ⚙ 完成 AI 设置';

const stageLabelFor = (stage: SummarizerStage, kind: NodeKind): string => {
  if (stage === 'mapping') return '正在分块提炼...';
  if (stage === 'reducing') return `正在合成整${nodeKindLabel(kind)}脉络...`;
  return '';
};

/** 当前阅读位置的节点上下文（最小节点 = 总结视角）。 */
export const resolveCurrentNodeContext = (): SummaryNodeContext => {
  const { bookTitle } = useReaderStore.getState();
  // One resolver, one answer (CONTEXT.md「Node View」/ 候选 3): the second
  // node-index lookup that used to live here existed only because
  // `NodeSourceResult` carried no `nodeIndex`.
  const view = resolveCurrentNodeView();
  return {
    bookHash: view.bookHash,
    nodeIndex: view.nodeIndex,
    bookTitle,
    nodeTitle: view.title,
    kind: view.kind,
    text: view.text,
    charCount: view.charCount,
  };
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
      // The one readiness rule (providerReadiness): a non-blank API Key.
      if (!providerReady(settings)) {
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
          // 分类先于读者看到（docs/architecture.md）——the SDK's own
          // English message (with an HTTP status buried in it) becomes one
          // readable Chinese sentence (`services/ai/errorMessages`).
          set({
            phase: 'error',
            error: describeAIError(error).message,
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
 *
 * `SummaryTab` reaches it through a **prop defaulted to this value**, the same
 * convention `ChatTab` and `Bookshelf` already use (候选 epilogue). It used to be
 * reached through a module-global that tests mutated with `setSummaryStore`, which
 * meant a component read a mutable global *inside render* — three ways to reach a
 * store across the app, for no benefit over the one that already worked.
 */
export const useSummaryStore: SummaryStore = createSummaryStore({
  summarizerFactory: (settings) => ({
    summarize: (input) => createRealSummarizer(settings).then((s) => s.summarize(input)),
  }),
  repository: new NodeSummaryRepository(),
});
