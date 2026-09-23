import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ReaderPane from './ReaderPane';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import { requestLocate, clearLocateListeners } from '@/services/reader/readerLink';
import { HIGHLIGHT_CLASS } from '@/services/reader/highlight';
import { DEMO_MONOLITHIC_TXT, type DemoSection } from '@/services/reader/demoBook';
import type { BookSegmentation } from '@/types/ai';

const sections: DemoSection[] = [];

const segmentationFor = (): BookSegmentation => ({
  bookHash: 'demo-monolithic',
  strategy: 'regex',
  virtualSections: [
    { virtualIndex: 0, title: '第一章 风起之地1', charOffset: 0 },
    { virtualIndex: 1, title: '第二章 风起之地2', charOffset: DEMO_MONOLITHIC_TXT.indexOf('第二章') },
    { virtualIndex: 2, title: '第三章 风起之地3', charOffset: DEMO_MONOLITHIC_TXT.indexOf('第三章') },
  ],
});

beforeEach(() => {
  clearLocateListeners();
  useSegmentationStore.setState({
    segmentation: segmentationFor(),
  });
  useReaderStore.getState().loadBook({
    bookHash: 'demo-monolithic',
    bookTitle: '风起之地（无目录 TXT）',
    spineCount: 3,
  });
  useReaderStore.getState().setPosition(0, '第一章 风起之地1');
});

afterEach(() => {
  clearLocateListeners();
  document.body.innerHTML = '';
});

describe('ReaderPane agent locate integration', () => {
  it('jumps to the target virtual section and breathe-highlights the quote', async () => {
    render(<ReaderPane sections={sections} monolithicText={DEMO_MONOLITHIC_TXT} />);
    expect(screen.getByTestId('reader-article')).toBeTruthy();

    act(() => {
      requestLocate({
        bookHash: 'demo-monolithic',
        nodeIndex: 1,
        charOffset: 10,
        quoteSnippet: '风起之地2',
      });
    });

    // The reader hopped to chapter 2 and the quote got marked (rAF paint).
    await waitFor(() => {
      expect(useReaderStore.getState().spineIndex).toBe(1);
      const mark = screen.getByTestId('reader-article').querySelector(`mark.${HIGHLIGHT_CLASS}`);
      expect(mark?.textContent).toContain('风起之地2');
    });
  });

  it('ignores locate requests for other books', async () => {
    render(<ReaderPane sections={sections} monolithicText={DEMO_MONOLITHIC_TXT} />);
    act(() => {
      requestLocate({ bookHash: 'other-book', nodeIndex: 2, quoteSnippet: '风起之地3' });
    });
    await act(async () => {});
    expect(useReaderStore.getState().spineIndex).toBe(0);
    expect(
      screen.getByTestId('reader-article').querySelector(`mark.${HIGHLIGHT_CLASS}`),
    ).toBeNull();
  });

  it('highlights inside the current section without a section change', async () => {
    render(<ReaderPane sections={sections} monolithicText={DEMO_MONOLITHIC_TXT} />);
    act(() => {
      requestLocate({ bookHash: 'demo-monolithic', nodeIndex: 0, quoteSnippet: '风起之地1' });
    });
    await waitFor(() => {
      expect(useReaderStore.getState().spineIndex).toBe(0);
      expect(
        screen.getByTestId('reader-article').querySelector(`mark.${HIGHLIGHT_CLASS}`)?.textContent,
      ).toContain('风起之地1');
    });
  });
});
