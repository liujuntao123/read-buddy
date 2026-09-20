 'use client';

 import { useEffect, useRef, useState } from 'react';
 import { useReaderStore } from '@/store/readerStore';
 import { useSegmentationStore } from '@/store/segmentationStore';
 import { DEMO_MONOLITHIC_TXT, type DemoSection } from '@/services/reader/demoBook';
 import SegmentationBanner from './SegmentationBanner';

/**
 * Placeholder reading viewport. Renders demo-book sections as selectable
 * text so later tickets (02/05) can exercise extraction and selection
 * features before Foliate is wired in.
 */
 export default function ReaderPane({ sections }: { sections: DemoSection[] }) {
   const sectionIndex = useReaderStore((s) => s.sectionIndex);
   const setSection = useReaderStore((s) => s.setSection);
   const segmentation = useSegmentationStore((s) => s.segmentation);
   const scanAndPrompt = useSegmentationStore((s) => s.scanAndPrompt);
   const [toast, setToast] = useState<string | null>(null);
   const lastToastKey = useRef<string | null>(null);
   const section = sections[sectionIndex];

   // Dev-demo feedback: surface the generated virtual-section count after the
   // user answers the segmentation banner (or the fallback applies directly).
   useEffect(() => {
     if (!segmentation || segmentation.virtualSections.length === 0) return;
     const key = `${segmentation.bookHash}:${segmentation.strategy}:${segmentation.virtualSections.length}`;
     if (lastToastKey.current === key) return;
     lastToastKey.current = key;
     setToast(`已生成 ${segmentation.virtualSections.length} 个虚拟章节`);
     const timer = window.setTimeout(() => setToast(null), 5_000);
     return () => window.clearTimeout(timer);
   }, [segmentation]);

  if (!section) {
    return <div className="flex-1 overflow-auto p-8 text-base-content/60">暂无内容</div>;
  }

  const go = (delta: number) => {
    const next = sections[sectionIndex + delta];
    if (next) setSection(next.index, next.title);
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="阅读视窗" data-testid="reader-pane">
      <SegmentationBanner />
      {toast && (
        <div
          role="status"
          data-testid="segmentation-toast"
          className="alert alert-success mx-4 mt-2 py-2 text-sm"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}
      <div className="flex items-center justify-between border-b border-base-300 bg-base-100 px-4 py-2">
        <span className="truncate text-sm font-medium text-base-content/80">{section.title}</span>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-xs btn-outline"
            title="开发演示：以无目录 TXT 触发章节探测流程"
            onClick={() => void scanAndPrompt('demo-monolithic', DEMO_MONOLITHIC_TXT)}
          >
            加载无目录 TXT
          </button>
          <button
            type="button"
            className="btn btn-xs"
            disabled={sectionIndex === 0}
            onClick={() => go(-1)}
          >
            上一章
          </button>
          <button
            type="button"
            className="btn btn-xs"
            disabled={sectionIndex === sections.length - 1}
            onClick={() => go(1)}
          >
            下一章
          </button>
        </div>
      </div>
      <article
        className="flex-1 overflow-auto px-6 py-6 leading-loose text-base-content"
        // Static fixture content owned by this app (demoBook.ts), not user input.
        dangerouslySetInnerHTML={{ __html: section.html }}
      />
    </section>
  );
}
