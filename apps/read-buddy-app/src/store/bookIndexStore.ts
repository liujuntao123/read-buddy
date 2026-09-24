/**
 * Whole-book node indexing store (docs/architecture.md).
 *
 * `ensureIndexed` is the Phase 1+2 entry: it resolves the opened book's text
 * (TXT monolithic / engine spine + directory / demo scan context), runs the
 * layered segmenter into `book_nodes`, registers the AgentBookContext, and —
 * only then, fully in the background — kicks off Phase 3 (panorama) and
 * Phase 4 (micro-brief priority queue). The reader is never blocked: reading
 * starts the moment segmentation finishes (< 300ms).
 *
 * **Minimal nodes are the indexing unit** (CONTEXT.md / ADR 0010): micro-briefs
 * are generated for the deepest level the book actually has — the 节 of a
 * 章/节 book, the 章 of a single-level book — never for container 章 rows that
 * exist only to group their 节.
 *
 * AI phases are skipped while no provider is configured, but **not silently**
 * (ADR: the unconfigured-provider defect): the store parks in `awaiting-key` so the
 * status bar can offer the settings action. Re-opening the book (or configuring
 * the key and re-opening) resumes any unfinished briefs exactly where they
 * stopped.
 */
import { create } from 'zustand';
import type { AISettings } from '@/types/ai';
import type { BookNode, BookNodeRecord, BookTocEntry, SegmentStrategy } from '@/types/readingAgent';
import { BookPanoramaRepository, BookNodeRepository } from '@/services/db/repositories';
import {
  clearAgentBookContext,
  createAgentBookContext,
  getAgentBookContext,
  registerAgentBookContext,
  type AgentBookContext,
} from '@/services/agent/agentContext';
import { createReadingAgentIndex } from '@/services/agent/readingAgentIndex';
import {
  createBookIngestion,
  type BookIngestion,
  type BookSegmentationSource,
} from '@/services/agent/bookIngestion';

export type { BookSegmentationSource };
import {
  shapeOfNodes,
  type BookNodeShape,
  type NodeTree,
} from '@/services/bookNodes';
import { nodeKindLabel } from '@/services/bookNodes/nodeKind';
import {
  SPINE_JOIN,
  segmentMonolithic,
  segmentSpineBook,
  type SpineSectionInput,
} from '@/services/segmentation/layeredSegmenter';
import type { StreamTextFn } from '@/services/ai/streamClient';
import { getOpenedBook } from '@/services/library/contentRegistry';
import { readBookIndexSummary, saveBookIndexSummary } from '@/services/library/bookLibrary';
import { useReaderStore } from '@/store/readerStore';
import { useAISettingsStore } from '@/store/aiSettingsStore';

export type IndexPhase =
  | 'idle'
  | 'segmenting'
  | 'panorama'
  | 'briefs'
  | 'ready'
  /** The AI phases are skipped because no provider is configured yet. */
  | 'awaiting-key'
  | 'failed';

/** 尚无节点时的空形状（界面可以无条件读取）。 */
export const EMPTY_SHAPE: BookNodeShape = {
  chapter: 0,
  section: 0,
  chunk: 0,
  total: 0,
  isNested: false,
  minimalKind: 'chapter',
};

export interface BookIndexState {
  bookHash: string;
  phase: IndexPhase;
  strategy: SegmentStrategy | null;
  /** 全书节点形状：几章几节、最小节点是哪一级。 */
  shape: BookNodeShape;
  /** 需要建立微大纲的最小节点总数。 */
  briefTotal: number;
  /** 已有微大纲的最小节点数。 */
  briefedCount: number;
  panoramaReady: boolean;
  error: string | null;
  /** Progress label, e.g. "正在建立全书微大纲 (15/70 节)". */
  progressLabel: string;
  ensureIndexed: (
    bookHash: string,
    options?: { currentSpineIndex?: number; autoRunAi?: boolean },
  ) => Promise<void>;
  /** 手动触发全书画像与微大纲索引构建流程 */
  startIndexing: (options?: { currentSpineIndex?: number }) => Promise<void>;
  /** 中止当前的索引与画像构建 */
  stopIndexing: () => void;
  /**
   * Wipe the book's index (nodes + panorama) and rebuild it from scratch —
   * the "重新索引" affordance for users unsatisfied with the generated
   * panorama / briefs.
   */
  reindex: (bookHash: string, options?: { currentSpineIndex?: number }) => Promise<void>;
  /**
   * Live priority source consumed by the brief queue (Priority 0 boost).
   * Holds the reader's **physical** position; the pipeline converts it to a
   * Book Node ordinal once the node tree exists.
   */
  currentSpineIndex: number;
  setCurrentSpine: (spineIndex: number) => void;
  /** Testing seam: abort the pipeline and reset the state. */
  reset: () => void;
}

export interface BookIndexDeps {
  /** Phases 1–2: the Book Ingestion module (候选 epilogue). */
  ingestion: BookIngestion;
  bookNodes: BookNodeRepository;
  panoramas: BookPanoramaRepository;
  stream: StreamTextFn;
  getSettings: () => AISettings;
  now?: () => number;
}

/**
 * Segmentation inputs resolved from an opened book. Re-exported so existing
 * callers keep their import; the shape itself is the ingestion module's.
 */


/** Abort controller of the currently running background pipeline. */
let pipelineController: AbortController | null = null;

const indexLabel = (done: number, total: number, kind: BookNodeShape['minimalKind']): string =>
  `正在建立全书微大纲 (${done}/${total} ${nodeKindLabel(kind)})`;

const toRecords = (nodes: BookNode[], now: () => number): BookNodeRecord[] =>
  nodes.map((node) => ({ ...node, updatedAt: now() }));

const defaultMonolithicText = (bookHash: string): string | undefined => {
  const opened = getOpenedBook(bookHash);
  return opened?.getMonolithicText();
};

const defaultSegmentationSource = async (
  bookHash: string,
): Promise<BookSegmentationSource | undefined> => {
  const opened = getOpenedBook(bookHash);
  // `kind`, not a capability probe (候选 8): only a segmented source has spine
  // sections to hand the segmenter.
  if (!opened || opened.kind === 'monolithic') return undefined;
  const count = opened.spineCount;
  const sections = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      // Always loads: asking for a section's text never depends on whether the
      // reader happened to visit it.
      const text = await opened.getSpineText(index);
      // 段内目录锚点（EPUB 的 #sigil_toc_id_N）让「节」有独立文本范围。
      const anchors = opened.getSpineAnchors(index);
      return { title: opened.getSpineTitle(index), text, spineIndex: index, anchors };
    }),
  );
  return { sections, tocEntries: opened.getTocEntries() };
};

/** 最小节点：全书微大纲（索引）的唯一对象。 */
export const minimalNodesOf = (tree: NodeTree): readonly BookNode[] => tree.minimalNodes;

export function createBookIndexStore(deps: BookIndexDeps) {
  return create<BookIndexState>()((set, get) => ({
    bookHash: '',
    phase: 'idle',
    strategy: null,
    shape: EMPTY_SHAPE,
    briefTotal: 0,
    briefedCount: 0,
    panoramaReady: false,
    error: null,
    progressLabel: '',
    currentSpineIndex: 0,

    ensureIndexed: async (bookHash, options) => {
      if (!bookHash) return;
      pipelineController?.abort();
      const controller = new AbortController();
      pipelineController = controller;
      const now = deps.now ?? Date.now;

      set({
        bookHash,
        phase: 'segmenting',
        strategy: null,
        shape: EMPTY_SHAPE,
        briefTotal: 0,
        briefedCount: 0,
        panoramaReady: false,
        error: null,
        progressLabel: '',
        currentSpineIndex: options?.currentSpineIndex ?? 0,
      });

      try {
        // Phases 1–2 are the Book Ingestion module's job (候选 epilogue): source
        // resolution, the branch order, the offset-space join and the recorded
        // Segmentation Rule all live there. This store maps the outcome onto view
        // state and registers the node model.
        const outcome = await deps.ingestion.ingest(bookHash);

        if (outcome.status === 'nothing') {
          set({ phase: 'idle' });
          return;
        }

        if (outcome.status === 'index-only') {
          // Nodes exist but no text source is live: the reader keeps its briefs,
          // and passage/search are unavailable until the book re-registers.
          const context = createAgentBookContext({ bookHash, nodes: outcome.nodes, fullText: '' });
          registerAgentBookContext(context);
          const minimal = context.getNodeTree().minimalNodes;
          set({
            strategy: outcome.strategy,
            shape: outcome.shape,
            briefTotal: minimal.length,
            briefedCount: minimal.filter((node) => node.brief).length,
            phase: 'idle',
          });
          return;
        }

        const { nodes, fullText, strategy, shape } = outcome;
        const panorama = await deps.panoramas.get(bookHash);
        const context = createAgentBookContext({ bookHash, nodes, fullText, panorama });
        registerAgentBookContext(context);

        const minimal = context.getNodeTree().minimalNodes;
        const briefedCount = minimal.filter((node) => node.brief).length;
        set({
          strategy,
          shape,
          briefTotal: minimal.length,
          briefedCount,
          panoramaReady: Boolean(panorama),
          phase: 'idle',
          progressLabel:
            minimal.length > briefedCount
              ? indexLabel(briefedCount, minimal.length, shape.minimalKind)
              : '',
        });

        if (controller.signal.aborted) return;

        // Background Phase 3 + 4 (only run when autoRunAi is explicitly requested)
        if (options?.autoRunAi) {
          void runBackgroundPipeline({
            deps,
            bookHash,
            context,
            signal: controller.signal,
            currentSpineIndex: options?.currentSpineIndex ?? 0,
            getCurrentSpineIndex: () => get().currentSpineIndex,
            bookTitle: useReaderStore.getState().bookTitle || bookHash,
            set,
          });
        }
      } catch (error) {
        set({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
      }
    },

    startIndexing: async (options) => {
      const { bookHash, currentSpineIndex } = get();
      if (!bookHash) return;
      const context = getAgentBookContext(bookHash);
      if (!context) return;
      pipelineController?.abort();
      const controller = new AbortController();
      pipelineController = controller;

      void runBackgroundPipeline({
        deps,
        bookHash,
        context,
        signal: controller.signal,
        currentSpineIndex: options?.currentSpineIndex ?? currentSpineIndex,
        getCurrentSpineIndex: () => get().currentSpineIndex,
        bookTitle: useReaderStore.getState().bookTitle || bookHash,
        set,
      });
    },

    stopIndexing: () => {
      pipelineController?.abort();
      pipelineController = null;
      set({ phase: 'idle' });
    },

    setCurrentSpine: (sectionIndex) => set({ currentSpineIndex: sectionIndex }),

    reindex: async (bookHash, options) => {
      if (!bookHash) return;
      pipelineController?.abort();
      pipelineController = null;
      set({
        bookHash,
        phase: 'segmenting',
        strategy: null,
        shape: EMPTY_SHAPE,
        briefTotal: 0,
        briefedCount: 0,
        panoramaReady: false,
        error: null,
        progressLabel: '',
        currentSpineIndex: options?.currentSpineIndex ?? 0,
      });
      // Drop every persisted index artifact for this book, forget the live
      // context, then run the full pipeline again from the source text.
      await deps.bookNodes.deleteByBook(bookHash);
      await deps.panoramas.delete(bookHash);
      clearAgentBookContext(bookHash);
      await get().ensureIndexed(bookHash, { ...options, autoRunAi: true });
    },

    reset: () => {
      pipelineController?.abort();
      pipelineController = null;
      set({
        bookHash: '',
        phase: 'idle',
        strategy: null,
        shape: EMPTY_SHAPE,
        briefTotal: 0,
        briefedCount: 0,
        panoramaReady: false,
        error: null,
        progressLabel: '',
        currentSpineIndex: 0,
      });
    },
  }));
}

interface BackgroundRunInput {
  deps: BookIndexDeps;
  bookHash: string;
  context: AgentBookContext;
  signal: AbortSignal;
  /** The reader's physical position when the run started. */
  currentSpineIndex: number;
  /** Live physical position, consulted before each node pickup. */
  getCurrentSpineIndex: () => number;
  /** Book title for the panorama prompt; the caller owns where it comes from. */
  bookTitle: string;
  set: (partial: Partial<BookIndexState>) => void;
}

/**
 * `runReadingAgentIndex` is Phase 3 + Phase 4 (候选 epilogue): the pipeline is a
 * module now, not a store function. It reports through `onProgress` and resolves
 * with the settled outcome, so this store is a **view** of it — it maps one report
 * onto its own state fields and holds no pipeline logic. It also means
 * `ensureIndexed` can, if a caller ever needs to, await the AI half instead of
 * resolving before it starts.
 */
async function runBackgroundPipeline(input: BackgroundRunInput): Promise<void> {
  const { deps, bookHash, context, signal, set } = input;
  const index = createReadingAgentIndex({
    stream: deps.stream,
    getSettings: deps.getSettings,
    bookNodes: deps.bookNodes,
    panoramas: deps.panoramas,
    progressLabel: (done, total) =>
      indexLabel(done, total, shapeOfNodes(context.nodes).minimalKind),
  });

  const outcome = await index.run({
    bookHash,
    // The title is the caller's fact, not something the pipeline reads from a store.
    bookTitle: input.bookTitle,
    context,
    signal,
    currentSpineIndex: input.currentSpineIndex,
    getCurrentSpineIndex: input.getCurrentSpineIndex,
    onProgress: (progress) => {
      // Only the fields a report names are written, so a progress tick cannot
      // clobber the phase another tick just set.
      const patch: Partial<BookIndexState> = {};
      if (progress.phase !== undefined) patch.phase = progress.phase;
      if (progress.panoramaReady !== undefined) patch.panoramaReady = progress.panoramaReady;
      if (progress.briefedCount !== undefined) patch.briefedCount = progress.briefedCount;
      if (progress.briefTotal !== undefined) patch.briefTotal = progress.briefTotal;
      if (progress.progressLabel !== undefined) patch.progressLabel = progress.progressLabel;
      set(patch);
    },
  });

  void outcome;
}

/** App-wide singleton bound to the real Dexie repositories. */
export const useBookIndexStore = createBookIndexStore({
  // Phase 1+2 waits for no model, and its sources are the opened-book registry:
  // an engine book loads section text lazily, a TXT book is one document.
  ingestion: createBookIngestion({
    bookNodes: new BookNodeRepository(),
    getMonolithicText: (bookHash) => getOpenedBook(bookHash)?.getMonolithicText(),
    getSegmentationSource: defaultSegmentationSource,
    readBookIndexSummary: (bookHash) => readBookIndexSummary(bookHash),
    saveBookIndexSummary: (bookHash, summary) => saveBookIndexSummary(bookHash, summary),
  }),
  bookNodes: new BookNodeRepository(),
  panoramas: new BookPanoramaRepository(),
  // Lazy dynamic import keeps the AI SDK out of unit-test module load.
  stream: async function* (req, settings) {
    const { createAiSdkStreamFn } = await import('@/services/ai/streamClient');
    yield* createAiSdkStreamFn()(req, settings);
  },
  getSettings: () => useAISettingsStore.getState().settings,
});
