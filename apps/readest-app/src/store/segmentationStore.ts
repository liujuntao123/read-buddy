/**
 * Segmentation store (ADR 0005): orchestrates segmentation → persisted virtual
 * sections for monolithic TXT books.
 *
 * Flow: `scanAndPrompt` loads any persisted segmentation (idempotent re-scan),
 * otherwise runs the THREE-LEVEL layered segmenter (front TOC-page filter →
 * multi-pattern confidence scan → smooth fixed-length fallback) and applies the
 * result — the pipeline is fully automatic (ADR 0004's manual-trigger
 * philosophy applies to *summaries*, not to segmentation).
 *
 * **There is exactly one segmenter** (候选 10). The legacy interactive confirm
 * flow was unreachable — `banner.visible` was never set outside tests — but it
 * kept a second detector (`detector.ts`) and a second 段 cutter (`chunker.ts`)
 * alive, answering "what is a 段" differently from `layeredSegmenter`
 * (`PREAMBLE_TITLE '序言'` vs `'前言'`; snap window 800 vs
 * `LEVEL3_SNAP_WINDOW 1_200`). Those, the banner component and the store's
 * banner half are gone; `scanContext` went with them (every production write set
 * it to null, so its only readers were tests).
 *
 * The resulting virtual sections share the exact offsets of the agent
 * pipeline's BookNodes (same layered segmenter), so the reader, the DOM
 * selection and the agent tools live in one coordinate space.
 *
 * The repository is injectable so tests can target an isolated
 * ReadestPlusDatabase instead of the app singleton.
 */
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { BookSegmentationRepository } from '@/services/db/repositories';
import { segmentMonolithic } from '@/services/segmentation/layeredSegmenter';
import type { BookSegmentation } from '@/types/ai';

export interface SegmentationState {
  segmentation: BookSegmentation | null;
  scanAndPrompt: (bookHash: string, fullText: string) => Promise<void>;
}

export type SegmentationStoreHook = UseBoundStore<StoreApi<SegmentationState>>;

export interface SegmentationStoreDeps {
  /**
   * Resolve the persistence seam. A **function**, not a value: importing this store
   * must not open IndexedDB by itself, so the app's resolver constructs the real
   * repository on first use.
   */
  repository: () => BookSegmentationRepository;
}

/**
 * Factory, like every other non-`persist` store in this directory (候选 epilogue).
 * It replaces `setSegmentationRepository`, a mutable module global that tests
 * mutated to point the store at an isolated database — the same anti-pattern
 * removed from `summaryStore`. A caller that wants an isolated store builds one.
 */
export function createSegmentationStore(deps: SegmentationStoreDeps): SegmentationStoreHook {
  return create<SegmentationState>()((set) => ({
    segmentation: null,

    scanAndPrompt: async (bookHash, fullText) => {
      const existing = await deps.repository().load(bookHash);
      if (existing) {
        set({ segmentation: existing });
        return;
      }

      // Reading-agent pipeline: auto-apply the three-level layered segmentation
      // (TOC-page filter + confidence + smooth fallback). Only the strategy that
      // actually produced the sections is recorded — the old code stamped
      // `regexPattern: NODE_HEADING_PATTERN.source` even when the layered
      // segmenter's own pattern set had matched, so the persisted artifact could
      // not say which rule ran.
      const result = segmentMonolithic(bookHash, fullText);
      const segmentation: BookSegmentation = {
        bookHash,
        strategy: result.strategy,
        virtualSections: result.nodes.map((node) => ({
          virtualIndex: node.nodeIndex,
          title: node.title,
          charOffset: node.startOffset,
        })),
      };
      await deps.repository().save(segmentation);
      set({ segmentation });
    },
  }));
}

/** App-wide singleton (components and `createLibraryStore` default binding). */
let lazyRepository: BookSegmentationRepository | null = null;

export const useSegmentationStore: SegmentationStoreHook = createSegmentationStore({
  // Lazily created so importing the store never opens IndexedDB by itself.
  repository: () => (lazyRepository ??= new BookSegmentationRepository()),
});
