'use client';

import { useSegmentationStore } from '@/store/segmentationStore';

/**
 * Confirmation banner shown when the regex detector found chapter
 * anchors in a TOC-less book (design doc 4.2). Applying persists the
 * regex virtual sections; cancelling falls back to fixed-length chunks.
 */
export default function SegmentationBanner() {
  const banner = useSegmentationStore((s) => s.banner);
  const scanContext = useSegmentationStore((s) => s.scanContext);
  const applyRegex = useSegmentationStore((s) => s.applyRegex);
  const rejectAndFallback = useSegmentationStore((s) => s.rejectAndFallback);

  if (!banner.visible || !scanContext) return null;
  const { bookHash, fullText } = scanContext;

  return (
    <div
      role="alert"
      data-testid="segmentation-banner"
      className="alert alert-info m-4 flex items-center justify-between py-2 text-sm"
    >
      <span>
        检测到本书无目录，已自动识别 {banner.detectedCount} 个章节，是否应用？
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-xs btn-primary"
          aria-label="应用虚拟章节"
          onClick={() => void applyRegex(bookHash, fullText)}
        >
          应用
        </button>
        <button
          type="button"
          className="btn btn-xs btn-ghost"
          aria-label="取消并使用定长分段"
          onClick={() => void rejectAndFallback(bookHash, fullText)}
        >
          取消
        </button>
      </div>
    </div>
  );
}
