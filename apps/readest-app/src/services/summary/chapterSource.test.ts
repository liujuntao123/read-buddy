import { beforeEach, describe, expect, it } from 'vitest';
import { createChapterSource, resolveCurrentChapterText } from './chapterSource';
import { DEMO_BOOK } from '@/services/reader/demoBook';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';

const resetStores = () => {
  useReaderStore.setState({
    bookHash: DEMO_BOOK.bookHash,
    bookTitle: DEMO_BOOK.title,
    sectionIndex: 1,
    chapterTitle: '',
    sectionCount: DEMO_BOOK.sections.length,
  });
  useSegmentationStore.setState({
    segmentation: null,
    banner: { visible: false, detectedCount: 0 },
    applyDecision: null,
    scanContext: null,
  });
};

beforeEach(resetStores);

describe('structured path (default demo binding)', () => {
  it('extracts demo chapter 2 with its heading title and no HTML residue', () => {
    const result = resolveCurrentChapterText();

    expect(result.title).toBe('第二章 图书馆的密语');
    expect(result.text).not.toContain('<');
    expect(result.text).not.toContain('style');
    expect(result.text).toContain('穹顶上的星图亮了起来');
    expect(result.charCount).toBe(result.text.length);
    expect(result.charCount).toBeGreaterThan(0);
  });

  it('ignores a native segmentation and keeps using the structured spine', () => {
    useSegmentationStore.setState({
      segmentation: { bookHash: DEMO_BOOK.bookHash, strategy: 'native', virtualSections: [] },
    });
    expect(resolveCurrentChapterText().title).toBe('第二章 图书馆的密语');
  });

  it('returns an empty result for a missing section index', () => {
    useReaderStore.setState({ sectionIndex: 99 });
    expect(resolveCurrentChapterText()).toEqual({ title: '', text: '', charCount: 0 });
  });
});

describe('virtual-section path', () => {
  const FULL_TEXT = '0123456789abcdefghij'; // 20 chars, 3 virtual sections of 10

  const segmentation = {
    bookHash: 'book-mono',
    strategy: 'fixed-length' as const,
    chunkLength: 10,
    virtualSections: [
      { virtualIndex: 0, title: '第 1/3 部分', charOffset: 0 },
      { virtualIndex: 1, title: '第 2/3 部分', charOffset: 10 },
      { virtualIndex: 2, title: '第 3/3 部分', charOffset: 20 },
    ],
  };

  const openVirtual = () => {
    useReaderStore.setState({ bookHash: 'book-mono', sectionIndex: 1 });
    useSegmentationStore.setState({ segmentation });
  };

  it('slices the monolithic full text at the active virtual section offsets', () => {
    openVirtual();
    const resolve = createChapterSource({
      getStructuredHtml: () => undefined,
      getMonolithicText: (bookHash) => (bookHash === 'book-mono' ? FULL_TEXT : undefined),
    });

    expect(resolve()).toEqual({ title: '第 2/3 部分', text: 'abcdefghij', charCount: 10 });

    useReaderStore.setState({ sectionIndex: 2 });
    expect(resolve()).toEqual({ title: '第 3/3 部分', text: '', charCount: 0 });

    useReaderStore.setState({ sectionIndex: 0 });
    expect(resolve().text).toBe('0123456789');
  });

  it('falls back to the segmentation scan context when no fixture text is bound', () => {
    openVirtual();
    useSegmentationStore.setState({
      segmentation,
      scanContext: { bookHash: 'book-mono', fullText: FULL_TEXT },
    });
    const resolve = createChapterSource({
      getStructuredHtml: () => undefined,
      getMonolithicText: () => undefined,
    });

    expect(resolve()).toEqual({ title: '第 2/3 部分', text: 'abcdefghij', charCount: 10 });
  });

  it('returns empty text (not a crash) when the full text is unavailable', () => {
    openVirtual();
    const resolve = createChapterSource({
      getStructuredHtml: () => undefined,
      getMonolithicText: () => undefined,
    });
    expect(resolve()).toEqual({ title: '第 2/3 部分', text: '', charCount: 0 });
  });

  it('ignores a segmentation belonging to another book', () => {
    useReaderStore.setState({ bookHash: 'other-book', sectionIndex: 0 });
    const resolve = createChapterSource({
      getStructuredHtml: (index) => DEMO_BOOK.sections[index]?.html,
      getMonolithicText: () => FULL_TEXT,
    });
    // other-book has no segmentation of its own → structured path.
    expect(resolve().title).toBe('第一章 迷雾之城');
  });
});
