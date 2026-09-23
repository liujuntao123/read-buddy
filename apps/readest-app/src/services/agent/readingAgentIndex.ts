/**
 * Reading Agent Index — the AI half of preparing a Book (读书代理索引).
 *
 * The reading-agent architecture doc §4.1 describes four phases: segment the book
 * (1), register the node model (2), build the panorama (3), then queue the
 * per-minimal-node micro-briefs (4). Phases 1–2 need no model and live in the
 * index store's synchronous path; **phases 3–4 are this module**.
 *
 * Why it is a module and not a store function (候选 epilogue):
 *
 * - It used to be a free function in the store that took the store's raw zustand
 *   `set` as an argument. A function holding an unconstrained state-setter is the
 *   opposite of a small interface: it can write any field, and nothing about its
 *   contract says which. It now reports progress through `onProgress` and returns
 *   an outcome, so the store is a *view* of this pipeline rather than its body.
 * - It bypassed its own injected seams, reading `useReaderStore` (for the title)
 *   and `useAISettingsStore` (for the settings a second time) from module globals.
 *   Both arrive as arguments now, so the module can be driven in a test with plain
 *   values.
 * - `ensureIndexed()` resolved before phases 3–4 started (`void runBackgroundPipeline`),
 *   so "the book is ready" could not be awaited — which is why the store's own suite
 *   had to poll `phase === 'ready'`. `run()` returns a settled promise: awaiting
 *   readiness is now a normal thing to do.
 *
 * A missing provider parks in `awaiting-key` and is reported as such: the AI phases
 * are *skipped visibly*, because the silent skip is what hid the unconfigured-provider
 * defect (the reader clicked 「生成全书画像」 and nothing happened at all).
 */
import type { AISettings } from '@/types/ai';
import type { StreamTextFn } from '@/services/ai/streamClient';
import { providerReady } from '@/services/ai/providerReadiness';
import type { AgentBookContext } from './agentContext';
import { createBriefScheduler } from './briefScheduler';
import { createPanoramaGenerator } from './panoramaGenerator';
import type { BookNodeRepository, BookPanoramaRepository } from '@/services/db/repositories';

/** Where the AI half of the index stands. Mirrors the store's phase vocabulary. */
export type IndexRunPhase = 'idle' | 'panorama' | 'briefs' | 'ready' | 'awaiting-key';

/** A progress report; every field is optional so a report only states what changed. */
export interface IndexRunProgress {
  phase?: IndexRunPhase;
  panoramaReady?: boolean;
  briefedCount?: number;
  briefTotal?: number;
  progressLabel?: string;
}

/** The settled state of one run. */
export interface IndexRunOutcome {
  phase: IndexRunPhase;
  panoramaReady: boolean;
  briefedCount: number;
  briefTotal: number;
}

export interface ReadingAgentIndexDeps {
  stream: StreamTextFn;
  getSettings: () => AISettings;
  bookNodes: BookNodeRepository;
  panoramas: BookPanoramaRepository;
  /** Label for the brief queue's progress line, e.g. `正在建立全书微大纲`. */
  progressLabel?: (done: number, total: number) => string;
}

export interface RunReadingAgentIndexInput {
  bookHash: string;
  /** Book title for the panorama prompt; the caller owns where it comes from. */
  bookTitle: string;
  /** The registered node model + full text (phases 1–2 output). */
  context: AgentBookContext;
  signal: AbortSignal;
  /** The reader's physical position when the run started. */
  currentSpineIndex: number;
  /** Live physical position, consulted before each brief pickup. */
  getCurrentSpineIndex: () => number;
  onProgress?: (progress: IndexRunProgress) => void;
}

export interface ReadingAgentIndex {
  /**
   * Run the AI phases. Resolves when the run settles — completed, aborted, or
   * parked awaiting a provider — so a caller can await readiness.
   */
  run(input: RunReadingAgentIndexInput): Promise<IndexRunOutcome>;
}

export function createReadingAgentIndex(deps: ReadingAgentIndexDeps): ReadingAgentIndex {
  const run: ReadingAgentIndex['run'] = async (input) => {
    const { bookHash, bookTitle, context, signal, onProgress } = input;
    const settings = deps.getSettings();
    const ready = providerReady(settings);
    const label = deps.progressLabel ?? ((done, total) => `正在建立微大纲 (${done}/${total})`);

    const minimal = context.getNodeTree().minimalNodes;
    const briefTotal = minimal.length;
    let briefedCount = minimal.filter((node) => node.brief).length;
    let panoramaReady = Boolean(context.getPanorama());

    const report = (progress: IndexRunProgress): void => onProgress?.(progress);

    // The brief queue prioritises by **Book Node ordinal**, while the reader
    // records a physical position. Convert here, where the node tree exists:
    // earlier (before segmentation) the conversion would be a guess that then goes
    // stale.
    const nodeIndexAt = (spineIndex: number): number =>
      context.resolveNodeAt(spineIndex)?.nodeIndex ?? spineIndex;

    const settle = (phase: IndexRunPhase): IndexRunOutcome => {
      const outcome = { phase, panoramaReady, briefedCount, briefTotal };
      report({ phase, panoramaReady, briefedCount, briefTotal, progressLabel: '' });
      return outcome;
    };

    if (signal.aborted) return settle('idle');

    // ---- Phase 3: the whole-book panorama (one model call) ----
    if (!panoramaReady) {
      if (!ready) return settle('awaiting-key');
      report({ phase: 'panorama', progressLabel: '' });
      try {
        const generator = createPanoramaGenerator({
          stream: deps.stream,
          settings,
          repository: deps.panoramas,
        });
        const panorama = await generator.generate(
          { bookHash, bookTitle, nodes: context.nodes, fullText: context.fullText },
          signal,
        );
        if (signal.aborted) return settle('idle');
        if (panorama) {
          context.setPanorama(panorama);
          panoramaReady = true;
          report({ panoramaReady: true });
        }
      } catch {
        // A failed panorama is non-fatal: the briefs can still run.
      }
    }

    // ---- Phase 4: the minimal-node micro-brief queue ----
    const pending = minimal.filter((node) => !(node.indexStatus === 'ready' && node.brief));
    if (pending.length === 0) return settle('ready');
    if (signal.aborted) return settle('idle');
    if (!ready) return settle('awaiting-key');

    report({ phase: 'briefs', briefTotal });
    const scheduler = createBriefScheduler({
      stream: deps.stream,
      // Injected once, not read from a second store inside the scheduler.
      getSettings: deps.getSettings,
      repository: deps.bookNodes,
      getFullText: () => context.fullText,
    });

    try {
      await scheduler.run(bookHash, [...minimal], {
        signal,
        currentNodeIndex: nodeIndexAt(input.currentSpineIndex),
        getCurrentNodeIndex: () => nodeIndexAt(input.getCurrentSpineIndex()),
        onProgress: (progress) => {
          context.updateNodes([progress.node]);
          briefedCount = progress.done;
          report({
            briefedCount: progress.done,
            progressLabel: label(progress.done, progress.total),
          });
        },
      });
    } catch {
      return settle('idle');
    }

    return settle(signal.aborted ? 'idle' : 'ready');
  };

  return { run };
}