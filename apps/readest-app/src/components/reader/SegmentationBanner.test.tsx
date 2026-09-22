import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import SegmentationBanner from './SegmentationBanner';
import { setSegmentationRepository, useSegmentationStore } from '@/store/segmentationStore';
import { BookSegmentationRepository } from '@/services/db/repositories';
import { DEMO_MONOLITHIC_TXT } from '@/services/reader/demoBook';
import type { BookSegmentation } from '@/types/ai';

/** In-memory capture of what the store tried to persist. */
let saved: BookSegmentation[] = [];

const fakeRepository = {
  load: async () => undefined,
  save: async (segmentation: BookSegmentation) => {
    saved.push(segmentation);
  },
} as unknown as BookSegmentationRepository;

const seedBanner = (detectedCount: number): void => {
  useSegmentationStore.setState({
    segmentation: null,
    banner: { visible: true, detectedCount },
    applyDecision: 'pending',
    scanContext: { bookHash: 'demo-monolithic', fullText: DEMO_MONOLITHIC_TXT },
  });
};

beforeEach(() => {
  saved = [];
  setSegmentationRepository(fakeRepository);
  useSegmentationStore.setState({
    segmentation: null,
    banner: { visible: false, detectedCount: 0 },
    applyDecision: null,
    scanContext: null,
  });
});

describe('SegmentationBanner', () => {
  it('renders nothing while the banner is hidden', () => {
    render(<SegmentationBanner />);
    expect(screen.queryByTestId('segmentation-banner')).toBeNull();
  });

  it('shows the detected chapter count with apply/cancel actions', () => {
    seedBanner(5);
    render(<SegmentationBanner />);

    expect(screen.getByTestId('segmentation-banner')).toBeDefined();
    expect(screen.getByText('检测到本书无目录，已自动识别 5 个节点，是否应用？')).toBeDefined();
    expect(screen.getByRole('button', { name: '应用识别出的节点' })).toBeDefined();
    expect(screen.getByRole('button', { name: '取消并使用定长分段' })).toBeDefined();
  });

  it('applying persists regex virtual sections with contiguous offsets', async () => {
    seedBanner(5);
    render(<SegmentationBanner />);

    fireEvent.click(screen.getByRole('button', { name: '应用识别出的节点' }));

    await waitFor(() => expect(saved.length).toBe(1));
    const persisted = saved[0]!;
    expect(persisted.bookHash).toBe('demo-monolithic');
    expect(persisted.strategy).toBe('regex');
    expect(persisted.virtualSections.length).toBe(5);

    const offsets = persisted.virtualSections.map((s) => s.charOffset);
    expect(offsets[0]).toBe(0);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]!);
    }
    expect(useSegmentationStore.getState().applyDecision).toBe('applied');
    await waitFor(() =>
      expect(screen.queryByTestId('segmentation-banner')).toBeNull(),
    );
  });

  it('cancelling persists fixed-length fallback sections', async () => {
    seedBanner(5);
    render(<SegmentationBanner />);

    fireEvent.click(screen.getByRole('button', { name: '取消并使用定长分段' }));

    await waitFor(() => expect(saved.length).toBe(1));
    const persisted = saved[0]!;
    expect(persisted.strategy).toBe('fixed-length');
    expect(persisted.chunkLength).toBe(7_000);
    expect(persisted.virtualSections.length).toBeGreaterThanOrEqual(2);

    // Offsets tile the source text with no gap or overlap.
    const offsets = persisted.virtualSections.map((s) => s.charOffset);
    expect(offsets[0]).toBe(0);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]!);
    }

    expect(useSegmentationStore.getState().applyDecision).toBe('rejected');
    await waitFor(() =>
      expect(screen.queryByTestId('segmentation-banner')).toBeNull(),
    );
  });
});
