'use client';

import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { useSegmentationStore } from '@/store/segmentationStore';

/**
 * Confirmation banner shown when the regex detector found node boundaries in a
 * directory-less book (design doc 4.2). Applying persists the regex-derived
 * nodes; cancelling falls back to fixed-length chunks (分段节点).
 */
export default function SegmentationBanner() {
  const banner = useSegmentationStore((s) => s.banner);
  const scanContext = useSegmentationStore((s) => s.scanContext);
  const applyRegex = useSegmentationStore((s) => s.applyRegex);
  const rejectAndFallback = useSegmentationStore((s) => s.rejectAndFallback);

  if (!banner.visible || !scanContext) return null;
  const { bookHash, fullText } = scanContext;

  return (
    <Banner
      data-testid="segmentation-banner"
      status="info"
      container="section"
      title={`检测到本书无目录，已自动识别 ${banner.detectedCount} 个节点，是否应用？`}
      endContent={
        <>
          <Button
            label="应用"
            variant="primary"
            size="sm"
            aria-label="应用识别出的节点"
            onClick={() => void applyRegex(bookHash, fullText)}
          />
          <Button
            label="取消"
            variant="ghost"
            size="sm"
            aria-label="取消并使用定长分段"
            onClick={() => void rejectAndFallback(bookHash, fullText)}
          />
        </>
      }
    />
  );
}
