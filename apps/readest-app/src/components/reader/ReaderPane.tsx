'use client';

import { useReaderStore } from '@/store/readerStore';
import type { DemoSection } from '@/services/reader/demoBook';

/**
 * Placeholder reading viewport. Renders demo-book sections as selectable
 * text so later tickets (02/05) can exercise extraction and selection
 * features before Foliate is wired in.
 */
export default function ReaderPane({ sections }: { sections: DemoSection[] }) {
  const sectionIndex = useReaderStore((s) => s.sectionIndex);
  const setSection = useReaderStore((s) => s.setSection);
  const section = sections[sectionIndex];

  if (!section) {
    return <div className="flex-1 overflow-auto p-8 text-base-content/60">暂无内容</div>;
  }

  const go = (delta: number) => {
    const next = sections[sectionIndex + delta];
    if (next) setSection(next.index, next.title);
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label="阅读视窗" data-testid="reader-pane">
      <div className="flex items-center justify-between border-b border-base-300 bg-base-100 px-4 py-2">
        <span className="truncate text-sm font-medium text-base-content/80">{section.title}</span>
        <div className="flex gap-2">
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
