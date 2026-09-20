/**
 * Chapter text resolution for the currently open reader section (ticket 03).
 *
 * Two paths (design doc 4.2 / ADR 0005):
 * - Virtual sections: when the active book has a segmentation whose strategy
 *   is not `native` (regex or fixed-length virtual chapters over a
 *   monolithic text), the chapter is the full text sliced at the section's
 *   char offset;
 * - Structured spine: otherwise the section's HTML goes through
 *   `extractChapterText` (the shape a Foliate spine section yields).
 *
 * The structured branch is bound to the demo fixture here; once Foliate is
 * wired in, replace the default `getStructuredHtml` with the spine loader
 * (`renderer.goTo(sectionIndex)` → section `load()` → document string) — the
 * summarizer consumes whatever this resolver returns, unchanged.
 */
import { extractChapterText, type ChapterText } from '@/services/reader/extractor';
import { DEMO_BOOK, DEMO_MONOLITHIC_TXT } from '@/services/reader/demoBook';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';

export type ChapterSourceResult = ChapterText;

export interface ChapterSourceDeps {
  /** Structured spine: HTML of a section index, `undefined` when absent. */
  getStructuredHtml: (sectionIndex: number) => string | undefined;
  /** Full text of a monolithic (virtual-section) book, `undefined` when unknown. */
  getMonolithicText: (bookHash: string) => string | undefined;
}

export function createChapterSource({ getStructuredHtml, getMonolithicText }: ChapterSourceDeps) {
  return (): ChapterSourceResult => {
    const { bookHash, sectionIndex } = useReaderStore.getState();
    const { segmentation, scanContext } = useSegmentationStore.getState();

    if (segmentation && segmentation.bookHash === bookHash && segmentation.strategy !== 'native') {
      let fullText = getMonolithicText(bookHash);
      if (fullText === undefined && scanContext?.bookHash === bookHash) {
        fullText = scanContext.fullText;
      }
      if (fullText === undefined) fullText = '';

      const sections = [...segmentation.virtualSections].sort((a, b) => a.charOffset - b.charOffset);
      const position = sections.findIndex((section) => section.virtualIndex === sectionIndex);
      const title = sections[position]?.title ?? `第 ${sectionIndex + 1} 部分`;
      if (position === -1) return { title, text: '', charCount: 0 };

      const start = sections[position].charOffset;
      const end = sections[position + 1]?.charOffset ?? fullText.length;
      const text = fullText.slice(start, Math.max(start, end));
      return { title, text, charCount: text.length };
    }

    const html = getStructuredHtml(sectionIndex);
    if (html === undefined) return { title: '', text: '', charCount: 0 };
    return extractChapterText(html);
  };
}

/**
 * Default binding to the demo fixtures. `demo-monolithic` is the hash the
 * reader pane uses for the no-TOC TXT demo; every other hash takes the
 * structured DEMO_BOOK path.
 */
export const resolveCurrentChapterText = createChapterSource({
  getStructuredHtml: (sectionIndex) => DEMO_BOOK.sections[sectionIndex]?.html,
  getMonolithicText: (bookHash) => (bookHash === 'demo-monolithic' ? DEMO_MONOLITHIC_TXT : undefined),
});
