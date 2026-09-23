/**
 * Book Ingestion — the segmentation half of preparing a Book (候选 epilogue).
 *
 * Phases 1–2 of the reading-agent architecture doc §4.1: resolve the Book's text,
 * derive its **Book Nodes** (`段` for a structureless book, `章`/`节` from the
 * Directory or the title classifier), and persist them. No model is involved, so
 * this runs on every book open and must stay fast.
 *
 * Why it is a module rather than the first half of the index store's
 * `ensureIndexed` (候选 epilogue):
 *
 * - **The offset-space invariant lives here now.** `ensureIndexed` re-created the
 *   global continuous character space with a literal `join('\n\n')` — a copy of the
 *   segmenter's `SPINE_JOIN` — so a caller was restating the very invariant the
 *   node offsets depend on. The join, the branch order (rehydrate → index-only →
 *   monolithic → spine → nothing) and the `strategy` each branch implies are the
 *   module's business.
 * - **The strategy is a fact it records, not something a caller reconstructs.**
 *   The store used to infer it back as `spineIndex !== undefined ? 'native' :
 *   'regex'`, which relabels a fixed-length index as heading-detected.
 * - **It is testable with plain values.** The store's harness had to build a Dexie
 *   database, an injected stream and hand-made sections to reach this code, and
 *   `defaultSegmentationSource` — the real source resolution — was never exercised
 *   there at all.
 *
 * The three outcomes are explicit rather than a flag:
 * `indexed` (nodes + live text), `index-only` (persisted nodes, no live text — the
 * reader keeps its briefs but loses passage/search until the book re-registers)
 * and `nothing` (no resolvable text source, e.g. demo fixtures).
 */
import type { BookNode, BookNodeRecord, BookTocEntry, SegmentStrategy } from '@/types/readingAgent';
import type { BookNodeShape } from '@/services/bookNodes';
import { shapeOfNodes } from '@/services/bookNodes';
import {
  SPINE_JOIN,
  segmentMonolithic,
  segmentSpineBook,
  type SpineSectionInput,
} from '@/services/segmentation/layeredSegmenter';
import type { BookNodeRepository } from '@/services/db/repositories';

/** Segmentation inputs resolved from an opened book. */
export interface BookSegmentationSource {
  sections: SpineSectionInput[];
  tocEntries: BookTocEntry[];
}

export interface BookIngestionDeps {
  bookNodes: BookNodeRepository;
  /** Monolithic text, when the book is one unbroken document. */
  getMonolithicText: (bookHash: string) => string | undefined;
  /** Spine sections + Directory; may be async (the engine loads sections lazily). */
  getSegmentationSource: (
    bookHash: string,
  ) => BookSegmentationSource | undefined | Promise<BookSegmentationSource | undefined>;
  /** The recorded Segmentation Rule, so it is read back rather than inferred. */
  readBookIndexSummary?: (
    bookHash: string,
  ) => Promise<{ shape: BookNodeShape; strategy: SegmentStrategy } | null>;
  /** Record the shape + rule on the book's shelf row. */
  saveBookIndexSummary?: (
    bookHash: string,
    summary: { shape: BookNodeShape; strategy: SegmentStrategy },
  ) => Promise<void>;
  now?: () => number;
}

/** What ingestion produced for one Book. */
export type IngestionOutcome =
  | {
      status: 'indexed';
      nodes: BookNode[];
      fullText: string;
      strategy: SegmentStrategy;
      shape: BookNodeShape;
      /** True when the nodes came from persisted rows rather than fresh segmentation. */
      rehydrated: boolean;
    }
  | {
      status: 'index-only';
      nodes: BookNode[];
      strategy: SegmentStrategy;
      shape: BookNodeShape;
    }
  | { status: 'nothing' };

export interface BookIngestion {
  /** Phases 1–2 for one book. Persists the nodes and the shelf-row summary. */
  ingest(bookHash: string): Promise<IngestionOutcome>;
}

const toRecords = (nodes: BookNode[], now: () => number): BookNodeRecord[] =>
  nodes.map((node) => ({ ...node, updatedAt: now() }));

/**
 * The rule a rehydrated node list implies **when nothing was recorded**. Not an
 * inference the caller should make: `native` is the only safe reading, because a
 * node carrying a physical section came from the Directory (or the spine itself)
 * and saying `regex` would claim heading detection that may never have run.
 */
const FALLBACK_STRATEGY: SegmentStrategy = 'native';

export function createBookIngestion(deps: BookIngestionDeps): BookIngestion {
  const now = deps.now ?? Date.now;

  return {
    ingest: async (bookHash) => {
      const monolithic = deps.getMonolithicText(bookHash);
      const source = await deps.getSegmentationSource(bookHash);
      const existing = await deps.bookNodes.listByBook(bookHash);

      const hasLiveText =
        monolithic !== undefined || (source !== undefined && source.sections.length > 0);

      // ---- Resume: persisted nodes + live text (offsets already valid) ----
      if (existing.length > 0 && hasLiveText) {
        const recorded = await deps.readBookIndexSummary?.(bookHash);
        const strategy = recorded?.strategy ?? FALLBACK_STRATEGY;
        // The join belongs to the segmenter: SPINE_JOIN is the invariant the
        // offsets were computed against.
        const fullText =
          monolithic ?? (source ? source.sections.map((section) => section.text).join(SPINE_JOIN) : '');
        const shape = shapeOfNodes(existing);
        await deps.saveBookIndexSummary?.(bookHash, { shape, strategy });
        return { status: 'indexed', nodes: existing, fullText, strategy, shape, rehydrated: true };
      }

      // ---- Index-only: persisted nodes but no live text source ----
      if (existing.length > 0) {
        const recorded = await deps.readBookIndexSummary?.(bookHash);
        const strategy = recorded?.strategy ?? FALLBACK_STRATEGY;
        const shape = shapeOfNodes(existing);
        await deps.saveBookIndexSummary?.(bookHash, { shape, strategy });
        return { status: 'index-only', nodes: existing, strategy, shape };
      }

      // ---- Fresh segmentation ----
      if (monolithic !== undefined) {
        const result = segmentMonolithic(bookHash, monolithic);
        await deps.bookNodes.bulkPut(toRecords(result.nodes, now));
        const shape = shapeOfNodes(result.nodes);
        await deps.saveBookIndexSummary?.(bookHash, { shape, strategy: result.strategy });
        return {
          status: 'indexed',
          nodes: result.nodes,
          fullText: monolithic,
          strategy: result.strategy,
          shape,
          rehydrated: false,
        };
      }

      if (source && source.sections.length > 0) {
        const result = segmentSpineBook(bookHash, source.sections, source.tocEntries);
        await deps.bookNodes.bulkPut(toRecords(result.nodes, now));
        const shape = shapeOfNodes(result.nodes);
        await deps.saveBookIndexSummary?.(bookHash, { shape, strategy: result.strategy });
        return {
          status: 'indexed',
          nodes: result.nodes,
          fullText: result.fullText,
          strategy: result.strategy,
          shape,
          rehydrated: false,
        };
      }

      // ---- Nothing to index (demo fixtures, unreadable archive) ----
      return { status: 'nothing' };
    },
  };
}