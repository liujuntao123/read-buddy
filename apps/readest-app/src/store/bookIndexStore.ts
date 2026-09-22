/**
 * Whole-book node indexing store (reading-agent architecture doc §4.1).
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
 * AI phases are skipped silently while no API key is configured; re-opening
 * the book (or configuring the key and re-opening) resumes any unfinished
 * briefs exactly where they stopped.
 */
import { create } from 'zustand';
import type { AISettings } from '@/types/ai';
import type { BookNode, BookNodeRecord, BookTocEntry, SegmentStrategy } from '@/types/readingAgent';
import { BookPanoramaRepository, BookNodeRepository } from '@/services/db/repositories';
import {
  clearAgentBookContext,
  createAgentBookContext,
  registerAgentBookContext,
  type AgentBookContext,
} from '@/services/agent/agentContext';
import { createBriefScheduler } from '@/services/agent/briefScheduler';
import { createPanoramaGenerator } from '@/services/agent/panoramaGenerator';
import {
  shapeOfNodes,
  type BookNodeShape,
  type NodeTree,
} from '@/services/bookNodes';
import { nodeKindLabel } from '@/services/bookNodes/nodeKind';
import {
  segmentMonolithic,
  segmentSpineBook,
  type SpineSectionInput,
} from '@/services/segmentation/layeredSegmenter';
import type { StreamTextFn } from '@/services/ai/streamClient';
import { getOpenedBook } from '@/services/library/contentRegistry';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { useAISettingsStore } from '@/store/aiSettingsStore';

export type IndexPhase = 'idle' | 'segmenting' | 'panorama' | 'briefs' | 'ready' | 'failed';

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
  ensureIndexed: (bookHash: string, options?: { currentSectionIndex?: number }) => Promise<void>;
  /**
   * Wipe the book's index (nodes + panorama) and rebuild it from scratch —
   * the "重新索引" affordance for users unsatisfied with the generated
   * panorama / briefs.
   */
  reindex: (bookHash: string, options?: { currentSectionIndex?: number }) => Promise<void>;
  /** Live priority source consumed by the brief queue (Priority 0 boost). */
  currentSectionIndex: number;
  setCurrentSection: (sectionIndex: number) => void;
  /** Testing seam: abort the pipeline and reset the state. */
  reset: () => void;
}

/** Segmentation inputs resolved from an opened book. */
export interface BookSegmentationSource {
  sections: SpineSectionInput[];
  tocEntries: BookTocEntry[];
}

export interface BookIndexDeps {
  bookNodes: BookNodeRepository;
  panoramas: BookPanoramaRepository;
  stream: StreamTextFn;
  getSettings: () => AISettings;
  /** Monolithic text source (defaults to the opened-book registry). */
  getMonolithicText?: (bookHash: string) => string | undefined;
  /** Spine sections + directory; may be async (engine loads sections on demand). */
  getSegmentationSource?: (
    bookHash: string,
  ) => BookSegmentationSource | undefined | Promise<BookSegmentationSource | undefined>;
  now?: () => number;
}

/** Abort controller of the currently running background pipeline. */
let pipelineController: AbortController | null = null;

const indexLabel = (done: number, total: number, kind: BookNodeShape['minimalKind']): string =>
  `正在建立全书微大纲 (${done}/${total} ${nodeKindLabel(kind)})`;

const toRecords = (nodes: BookNode[], now: () => number): BookNodeRecord[] =>
  nodes.map((node) => ({ ...node, updatedAt: now() }));

const defaultMonolithicText = (bookHash: string): string | undefined => {
  const opened = getOpenedBook(bookHash);
  if (opened?.getMonolithicText) return opened.getMonolithicText();
  // Demo monolithic flow keeps its text inside the segmentation scan context.
  const { scanContext } = useSegmentationStore.getState();
  if (scanContext?.bookHash === bookHash) return scanContext.fullText;
  return undefined;
};

const defaultSegmentationSource = async (
  bookHash: string,
): Promise<BookSegmentationSource | undefined> => {
  const opened = getOpenedBook(bookHash);
  if (!opened || opened.getMonolithicText) return undefined;
  const count = opened.spineCount;
  const sections = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const text = opened.getSpineTextAsync
        ? await opened.getSpineTextAsync(index)
        : opened.getSpineText(index);
      // 段内目录锚点（EPUB 的 #sigil_toc_id_N）让「节」有独立文本范围。
      const anchors = opened.getSpineAnchors?.(index) ?? [];
      return { title: opened.getSpineTitle(index), text, spineIndex: index, anchors };
    }),
  );
  return { sections, tocEntries: opened.getTocEntries?.() ?? [] };
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
    currentSectionIndex: 0,

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
        currentSectionIndex: options?.currentSectionIndex ?? 0,
      });

      try {
        const monolithic = (deps.getMonolithicText ?? defaultMonolithicText)(bookHash);
        const source = await (deps.getSegmentationSource ?? defaultSegmentationSource)(bookHash);
        const existing = await deps.bookNodes.listByBook(bookHash);

        let nodes: BookNode[];
        let strategy: SegmentStrategy;
        let fullText: string;

        if (
          existing.length > 0 &&
          (monolithic !== undefined || (source && source.sections.length > 0))
        ) {
          // Rehydrate persisted nodes (resume path): offsets already valid.
          nodes = existing;
          strategy = existing[0]?.spineIndex !== undefined ? 'native' : 'regex';
          fullText = monolithic ?? source!.sections.map((section) => section.text).join('\n\n');
        } else if (existing.length > 0) {
          // Nodes exist but no text source is live: index-only mode (no
          // passage/search until the book re-registers, still better than
          // wiping the briefs).
          const context = createAgentBookContext({ bookHash, nodes: existing, fullText: '' });
          registerAgentBookContext(context);
          const minimal = context.getNodeTree().minimalNodes;
          set({
            strategy: existing[0]?.spineIndex !== undefined ? 'native' : 'regex',
            shape: shapeOfNodes(existing),
            briefTotal: minimal.length,
            briefedCount: minimal.filter((node) => node.brief).length,
            phase: 'idle',
          });
          return;
        } else if (monolithic !== undefined) {
          const result = segmentMonolithic(bookHash, monolithic);
          nodes = result.nodes;
          strategy = result.strategy;
          fullText = monolithic;
          await deps.bookNodes.bulkPut(toRecords(nodes, now));
        } else if (source && source.sections.length > 0) {
          const result = segmentSpineBook(bookHash, source.sections, source.tocEntries);
          nodes = result.nodes;
          strategy = result.strategy;
          fullText = result.fullText;
          await deps.bookNodes.bulkPut(toRecords(nodes, now));
        } else {
          // No resolvable text source (demo fixtures etc.): nothing to index.
          set({ phase: 'idle' });
          return;
        }

        const panorama = await deps.panoramas.get(bookHash);
        const context = createAgentBookContext({ bookHash, nodes, fullText, panorama });
        registerAgentBookContext(context);

        const shape = shapeOfNodes(nodes);
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

        // ---- Background Phase 3 + 4 (never block the reader) ----
        void runBackgroundPipeline({
          deps,
          bookHash,
          context,
          signal: controller.signal,
          currentSectionIndex: options?.currentSectionIndex ?? 0,
          getCurrentSectionIndex: () => get().currentSectionIndex,
          set,
        });
      } catch (error) {
        set({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
      }
    },

    setCurrentSection: (sectionIndex) => set({ currentSectionIndex: sectionIndex }),

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
        currentSectionIndex: options?.currentSectionIndex ?? 0,
      });
      // Drop every persisted index artifact for this book, forget the live
      // context, then run the full pipeline again from the source text.
      await deps.bookNodes.deleteByBook(bookHash);
      await deps.panoramas.delete(bookHash);
      clearAgentBookContext(bookHash);
      await get().ensureIndexed(bookHash, options);
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
        currentSectionIndex: 0,
      });
    },
  }));
}

interface BackgroundRunInput {
  deps: BookIndexDeps;
  bookHash: string;
  context: AgentBookContext;
  signal: AbortSignal;
  currentSectionIndex: number;
  getCurrentSectionIndex: () => number;
  set: (partial: Partial<BookIndexState>) => void;
}

/**
 * Phase 3 (panorama, one call) then Phase 4 (brief queue). Each phase checks
 * the AI settings and the abort signal; failures degrade to a silent skip so
 * reading is never disturbed.
 */
async function runBackgroundPipeline(input: BackgroundRunInput): Promise<void> {
  const { deps, bookHash, context, signal, set } = input;
  const settings = deps.getSettings();
  const hasApiKey = settings.apiKey.trim().length > 0;

  // Phase 3: panorama portrait.
  if (!context.getPanorama()) {
    if (!hasApiKey || signal.aborted) return;
    set({ phase: 'panorama' });
    try {
      const generator = createPanoramaGenerator({
        stream: deps.stream,
        settings,
        repository: deps.panoramas,
      });
      const panorama = await generator.generate(
        {
          bookHash,
          bookTitle: useReaderStore.getState().bookTitle || bookHash,
          nodes: context.nodes,
          fullText: context.fullText,
        },
        signal,
      );
      if (signal.aborted) return;
      if (panorama) {
        context.setPanorama(panorama);
        set({ panoramaReady: true });
      }
    } catch {
      // Panorama failure is non-fatal: briefs can still run.
    }
  }

  // Phase 4: minimal-node micro-brief queue (container 章 are never briefed).
  const minimal = context.getNodeTree().minimalNodes;
  const pendingBriefs = minimal.filter((node) => !(node.indexStatus === 'ready' && node.brief));
  const kind = shapeOfNodes(context.nodes).minimalKind;
  if (pendingBriefs.length === 0) {
    set({ phase: 'ready', progressLabel: '' });
    return;
  }
  if (!hasApiKey || signal.aborted) {
    set({ phase: 'idle', progressLabel: '' });
    return;
  }

  set({ phase: 'briefs' });
  const scheduler = createBriefScheduler({
    stream: deps.stream,
    getSettings: () => useAISettingsStore.getState().settings,
    repository: deps.bookNodes,
    getFullText: () => context.fullText,
  });

  try {
    await scheduler.run(bookHash, [...minimal], {
      signal,
      currentSectionIndex: input.currentSectionIndex,
      getCurrentSectionIndex: input.getCurrentSectionIndex,
      onProgress: (progress) => {
        context.updateNodes([progress.node]);
        set({
          briefedCount: progress.done,
          progressLabel: indexLabel(progress.done, progress.total, kind),
        });
      },
    });
    if (signal.aborted) return;
    set({ phase: 'ready', progressLabel: '' });
  } catch {
    set({ phase: 'idle', progressLabel: '' });
  }
}

/** App-wide singleton bound to the real Dexie repositories. */
export const useBookIndexStore = createBookIndexStore({
  bookNodes: new BookNodeRepository(),
  panoramas: new BookPanoramaRepository(),
  // Lazy dynamic import keeps the AI SDK out of unit-test module load.
  stream: async function* (req, settings) {
    const { createAiSdkStreamFn } = await import('@/services/ai/streamClient');
    yield* createAiSdkStreamFn()(req, settings);
  },
  getSettings: () => useAISettingsStore.getState().settings,
});
