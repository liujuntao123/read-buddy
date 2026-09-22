/**
 * Segmentation store (ADR 0005, superseded flow per the reading-agent
 * architecture doc §3.2): orchestrates segmentation → persisted virtual
 * sections for monolithic TXT books.
 *
 * Flow:
 * - `scanAndPrompt`: loads any persisted segmentation (idempotent re-scan),
 *   otherwise runs the THREE-LEVEL layered segmenter (front TOC-page filter
 *   → multi-pattern confidence scan → smooth fixed-length fallback) and
 *   auto-applies the result — the pipeline is fully automatic, so the old
 *   interactive confirm banner no longer triggers. `applyRegex` /
 *   `rejectAndFallback` remain for the legacy banner surfaces.
 *
 * The resulting virtual sections share the exact offsets of the agent
 * pipeline's BookNodes (same layered segmenter), so the reader, the DOM
 * selection and the agent tools live in one coordinate space.
 *
 * The repository is injectable so tests can target an isolated
 * ReadestPlusDatabase instead of the app singleton.
 */
import { create } from 'zustand';
import { BookSegmentationRepository } from '@/services/db/repositories';
import { buildVirtualSections, detectChapters } from '@/services/segmentation/detector';
import { buildFixedLengthSections, DEFAULT_CHUNK_LENGTH } from '@/services/segmentation/chunker';
import { segmentMonolithic } from '@/services/segmentation/layeredSegmenter';
import { NODE_HEADING_PATTERN, type BookSegmentation } from '@/types/ai';

export type ApplyDecision = 'pending' | 'applied' | 'rejected' | null;

export interface SegmentationBannerState {
  visible: boolean;
  detectedCount: number;
}

/** Book/text pair the banner actions operate on (from the last scan). */
export interface SegmentationScanContext {
  bookHash: string;
  fullText: string;
}

export interface SegmentationState {
  segmentation: BookSegmentation | null;
  banner: SegmentationBannerState;
  applyDecision: ApplyDecision;
  scanContext: SegmentationScanContext | null;
  scanAndPrompt: (bookHash: string, fullText: string) => Promise<void>;
  applyRegex: (bookHash: string, fullText: string) => Promise<void>;
  rejectAndFallback: (bookHash: string, fullText: string) => Promise<void>;
  dismiss: () => void;
}

let repository: BookSegmentationRepository | null = null;

/** Lazily created so importing the store never opens IndexedDB by itself. */
const getRepository = (): BookSegmentationRepository =>
  (repository ??= new BookSegmentationRepository());

/** Swap the persistence seam (tests inject a fake or isolated database). */
export function setSegmentationRepository(repo: BookSegmentationRepository): void {
  repository = repo;
}

const HIDDEN_BANNER: SegmentationBannerState = { visible: false, detectedCount: 0 };

export const useSegmentationStore = create<SegmentationState>()((set) => ({
  segmentation: null,
  banner: HIDDEN_BANNER,
  applyDecision: null,
  scanContext: null,

  scanAndPrompt: async (bookHash, fullText) => {
    const existing = await getRepository().load(bookHash);
    if (existing) {
      set({
        segmentation: existing,
        banner: HIDDEN_BANNER,
        applyDecision: 'applied',
        scanContext: null,
      });
      return;
    }

    // Reading-agent pipeline: auto-apply the three-level layered
    // segmentation (TOC-page filter + confidence + smooth fallback).
    const result = segmentMonolithic(bookHash, fullText);
    const segmentation: BookSegmentation = {
      bookHash,
      strategy: result.strategy,
      ...(result.strategy === 'regex'
        ? { regexPattern: NODE_HEADING_PATTERN.source }
        : { chunkLength: DEFAULT_CHUNK_LENGTH }),
      virtualSections: result.nodes.map((node) => ({
        virtualIndex: node.nodeIndex,
        title: node.title,
        charOffset: node.startOffset,
      })),
    };
    await getRepository().save(segmentation);
    set({ segmentation, banner: HIDDEN_BANNER, applyDecision: 'applied', scanContext: null });
  },

  applyRegex: async (bookHash, fullText) => {
    const segmentation: BookSegmentation = {
      bookHash,
      strategy: 'regex',
      regexPattern: NODE_HEADING_PATTERN.source,
      virtualSections: buildVirtualSections(detectChapters(fullText)),
    };
    await getRepository().save(segmentation);
    set({ segmentation, banner: HIDDEN_BANNER, applyDecision: 'applied', scanContext: null });
  },

  rejectAndFallback: async (bookHash, fullText) => {
    const segmentation: BookSegmentation = {
      bookHash,
      strategy: 'fixed-length',
      chunkLength: DEFAULT_CHUNK_LENGTH,
      virtualSections: buildFixedLengthSections(fullText),
    };
    await getRepository().save(segmentation);
    set({ segmentation, banner: HIDDEN_BANNER, applyDecision: 'rejected', scanContext: null });
  },

  dismiss: () => set((state) => ({ banner: { ...state.banner, visible: false } })),
}));
