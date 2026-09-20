/**
 * Segmentation store (ticket 02): orchestrates detection → user prompt →
 * persisted virtual sections, per design doc 4.2 and ADR 0005.
 *
 * Flow:
 * - `scanAndPrompt`: loads any persisted segmentation (idempotent re-scan),
 *   otherwise runs the regex detector; ≥2 hits show the confirm banner,
 *   anything less falls straight back to fixed-length chunks.
 * - `applyRegex` / `rejectAndFallback`: persist the chosen strategy to the
 *   BookSegmentation table and hide the banner.
 *
 * The repository is injectable so tests can target an isolated
 * ReadestPlusDatabase instead of the app singleton.
 */
import { create } from 'zustand';
import { BookSegmentationRepository } from '@/services/db/repositories';
import { buildVirtualSections, detectChapters, MIN_DETECTED_CHAPTERS } from '@/services/segmentation/detector';
import { buildFixedLengthSections, DEFAULT_CHUNK_LENGTH } from '@/services/segmentation/chunker';
import { CHAPTER_HEADING_PATTERN, type BookSegmentation } from '@/types/ai';

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

    const detected = detectChapters(fullText);
    if (detected.length >= MIN_DETECTED_CHAPTERS) {
      set({
        segmentation: null,
        banner: { visible: true, detectedCount: detected.length },
        applyDecision: 'pending',
        scanContext: { bookHash, fullText },
      });
      return;
    }

    // No usable headings: skip the prompt and apply the fallback directly.
    const segmentation: BookSegmentation = {
      bookHash,
      strategy: 'fixed-length',
      chunkLength: DEFAULT_CHUNK_LENGTH,
      virtualSections: buildFixedLengthSections(fullText),
    };
    await getRepository().save(segmentation);
    set({ segmentation, banner: HIDDEN_BANNER, applyDecision: 'applied', scanContext: null });
  },

  applyRegex: async (bookHash, fullText) => {
    const segmentation: BookSegmentation = {
      bookHash,
      strategy: 'regex',
      regexPattern: CHAPTER_HEADING_PATTERN.source,
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
