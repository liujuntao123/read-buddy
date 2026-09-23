import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ReaderPane from './ReaderPane';
import { DEMO_MONOLITHIC_TXT, type DemoSection } from '@/services/reader/demoBook';
import { resetReadingPosition } from '@/services/reader/readingPosition';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';

/**
 * TXT 滚动阅读器的一节末尾（ticket 14 item 4）：读到 section 尽头不再是无路可走，
 * 而是一个「下一节 / 下一章」的出口；全书最后一节则是一句「全书完」。
 *
 * 另一条同样属于这里：段切换必须把滚动容器复位到顶部——此前 article 会留着上一
 * 节的 scrollTop，读者翻到下一节落在半空中。
 */

const sections: DemoSection[] = [];

const virtualSectionsOf = (titles: string[]) =>
  titles.map((title, index) => ({ virtualIndex: index, title, charOffset: index * 100 }));

const setSegmentation = (titles: string[]): void => {
  useSegmentationStore.setState({
    segmentation: { bookHash: 'txt-book', strategy: 'regex', virtualSections: virtualSectionsOf(titles) },
  });
};

const article = () => screen.getByTestId('reader-article');

beforeEach(() => {
  resetReadingPosition();
  useReaderStore.getState().loadBook({
    bookHash: 'txt-book',
    bookTitle: '无目录之书',
    spineCount: 3,
  });
  useSegmentationStore.setState({ segmentation: null });
});

afterEach(() => {
  resetReadingPosition();
  useSegmentationStore.setState({ segmentation: null });
});

describe('ReaderPane end-of-section exit', () => {
  it('offers the next 章 with its title, from the node model own wording', async () => {
    setSegmentation(['第一章 起点', '第二章 转折', '第三章 归途']);
    render(<ReaderPane sections={sections} monolithicText={DEMO_MONOLITHIC_TXT} />);

    const next = await screen.findByTestId('reader-next-section');
    // 层词来自节点模型（这里是单层书的「章」），标题是下一节的目录标题。
    expect(next.textContent).toContain('下一章');
    expect(next.textContent).toContain('第二章 转折');

    fireEvent.click(next);
    expect(useReaderStore.getState().spineIndex).toBe(1);
    // …and the exit follows the reader: 第二章 now leads to 第三章.
    expect(screen.getByTestId('reader-next-section').textContent).toContain('第三章 归途');
  });

  it('says 节 for a book whose nodes are nested (the wording is never hardcoded)', async () => {
    setSegmentation(['第一部分 系统1，系统2', '第1章 一张愤怒的脸', '第2章 电影的主角与配角']);
    render(<ReaderPane sections={sections} monolithicText={DEMO_MONOLITHIC_TXT} />);

    const next = await screen.findByTestId('reader-next-section');
    expect(next.textContent).toContain('下一节');
    expect(next.textContent).toContain('第1章 一张愤怒的脸');
  });

  it('ends the book with 全书完 on the last section', async () => {
    setSegmentation(['第一章 起点', '第二章 转折', '第三章 归途']);
    render(<ReaderPane sections={sections} monolithicText={DEMO_MONOLITHIC_TXT} />);
    await screen.findByTestId('reader-next-section');

    act(() => {
      useReaderStore.setState({ spineIndex: 2 });
    });

    expect(screen.queryByTestId('reader-next-section')).toBeNull();
    expect(screen.getByTestId('reader-book-end').textContent).toBe('全书完');
  });

  it('resets the scroll container to the top when the section changes', async () => {
    setSegmentation(['第一章 起点', '第二章 转折', '第三章 归途']);
    render(<ReaderPane sections={sections} monolithicText={DEMO_MONOLITHIC_TXT} />);
    const container = article();
    container.scrollTop = 480;

    act(() => {
      useReaderStore.setState({ spineIndex: 1 });
    });

    // 新的 section 从顶部开始，而不是停在上一节的 480px 处。
    expect(article().scrollTop).toBe(0);
    expect(useReaderStore.getState().sectionFraction).toBe(0);
  });

  it('reports the in-section scroll as the strip’s sub-section progress', async () => {
    setSegmentation(['第一章 起点', '第二章 转折', '第三章 归途']);
    render(<ReaderPane sections={sections} monolithicText={DEMO_MONOLITHIC_TXT} />);

    const container = article();
    Object.defineProperty(container, 'scrollHeight', { value: 1_000, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    container.scrollTop = 300;

    // 上报发生在 rAF 里（滚动事件按帧合并），所以等一帧再断言。
    await act(async () => {
      fireEvent.scroll(container);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    // 300 / (1000 - 400) = 半节——进度条靠它把「第 2 节」细化成一个百分比。
    expect(useReaderStore.getState().sectionFraction).toBeCloseTo(0.5);
  });
});
