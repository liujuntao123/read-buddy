import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeSource, resolveCurrentNodeText } from './nodeSource';
import { DEMO_BOOK } from '@/services/reader/demoBook';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';
import {
  clearAgentBookContext,
  createAgentBookContext,
  registerAgentBookContext,
} from '@/services/agent/agentContext';
import { buildTocNodes } from '@/services/segmentation/layeredSegmenter';
import type { BookNode } from '@/types/readingAgent';

const resetStores = () => {
  useReaderStore.setState({
    bookHash: DEMO_BOOK.bookHash,
    bookTitle: DEMO_BOOK.title,
    spineIndex: 1,
    anchor: undefined,
    nodeTitle: '',
    spineCount: DEMO_BOOK.sections.length,
  });
  useSegmentationStore.setState({
    segmentation: null,
    banner: { visible: false, detectedCount: 0 },
    applyDecision: null,
    scanContext: null,
  });
};

beforeEach(resetStores);
afterEach(() => {
  clearAgentBookContext('book-nodes');
});

describe('structured path (default demo binding)', () => {
  it('extracts demo chapter 2 with its heading title and no HTML residue', () => {
    const result = resolveCurrentNodeText();

    expect(result.title).toBe('第二章 图书馆的密语');
    expect(result.kind).toBe('chapter');
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
    expect(resolveCurrentNodeText().title).toBe('第二章 图书馆的密语');
  });

  it('returns an empty result for a missing section index', () => {
    useReaderStore.setState({ spineIndex: 99 });
    expect(resolveCurrentNodeText()).toMatchObject({ title: '', text: '', charCount: 0 });
  });
});

describe('node-model path (directory-derived nodes)', () => {
  /** 一个正文段里放两个目录锚点 → 章 + 两个节。 */
  const SECTION_TEXT = ['第一章 伦理与伦理学', '§1 伦理学这个名称', '正文甲。', '§2 伦理与道德', '正文乙。'].join(
    '\n',
  );
  const FIRST = SECTION_TEXT.indexOf('§1 伦理学这个名称');
  const SECOND = SECTION_TEXT.indexOf('§2 伦理与道德');

  const registerBookNodes = (): BookNode[] => {
    const nodes =
      buildTocNodes(
        'book-nodes',
        [
          {
            title: '第一章 伦理与伦理学',
            text: SECTION_TEXT,
            spineIndex: 0,
            anchors: [
              { id: 'sigil_toc_id_1', offset: FIRST },
              { id: 'sigil_toc_id_2', offset: SECOND },
            ],
          },
        ],
        [
          { label: '第一章 伦理与伦理学', depth: 0, spineIndex: 0 },
          { label: '§1 伦理学这个名称', depth: 1, spineIndex: 0, anchor: 'sigil_toc_id_1' },
          { label: '§2 伦理与道德', depth: 1, spineIndex: 0, anchor: 'sigil_toc_id_2' },
        ],
        SECTION_TEXT,
      ) ?? [];
    registerAgentBookContext(
      createAgentBookContext({ bookHash: 'book-nodes', nodes, fullText: SECTION_TEXT }),
    );
    return nodes;
  };

  it('resolves the 节 the reader is actually in and slices only its text', () => {
    const nodes = registerBookNodes();
    expect(nodes).toHaveLength(3);

    useReaderStore.setState({
      bookHash: 'book-nodes',
      spineIndex: 0,
      anchor: 'sigil_toc_id_2',
      nodeTitle: '§2 伦理与道德',
    });

    const result = resolveCurrentNodeText();
    expect(result.title).toBe('§2 伦理与道德');
    expect(result.kind).toBe('section');
    expect(result.parentTitle).toBe('第一章 伦理与伦理学');
    expect(result.text).toContain('§2 伦理与道德');
    expect(result.text).toContain('正文乙');
    expect(result.text).not.toContain('正文甲');
  });

  it('falls back to the 章 when the position carries no anchor', () => {
    registerBookNodes();
    useReaderStore.setState({ bookHash: 'book-nodes', spineIndex: 0, anchor: undefined });

    const result = resolveCurrentNodeText();
    expect(result.title).toBe('第一章 伦理与伦理学');
    expect(result.kind).toBe('chapter');
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
    useReaderStore.setState({ bookHash: 'book-mono', spineIndex: 1, anchor: undefined });
    useSegmentationStore.setState({ segmentation });
  };

  it('slices the monolithic full text at the active virtual section offsets', () => {
    openVirtual();
    const resolve = createNodeSource({
      getStructuredHtml: () => undefined,
      getMonolithicText: (bookHash) => (bookHash === 'book-mono' ? FULL_TEXT : undefined),
      getContext: () => undefined,
    });

    expect(resolve()).toEqual({
      title: '第 2/3 部分',
      text: 'abcdefghij',
      charCount: 10,
      kind: 'chunk',
    });

    useReaderStore.setState({ spineIndex: 2 });
    expect(resolve()).toMatchObject({ title: '第 3/3 部分', text: '', charCount: 0 });

    useReaderStore.setState({ spineIndex: 0 });
    expect(resolve().text).toBe('0123456789');
  });

  it('falls back to the segmentation scan context when no fixture text is bound', () => {
    openVirtual();
    useSegmentationStore.setState({
      segmentation,
      scanContext: { bookHash: 'book-mono', fullText: FULL_TEXT },
    });
    const resolve = createNodeSource({
      getStructuredHtml: () => undefined,
      getMonolithicText: () => undefined,
      getContext: () => undefined,
    });

    expect(resolve()).toMatchObject({ title: '第 2/3 部分', text: 'abcdefghij', charCount: 10 });
  });

  it('returns empty text (not a crash) when the full text is unavailable', () => {
    openVirtual();
    const resolve = createNodeSource({
      getStructuredHtml: () => undefined,
      getMonolithicText: () => undefined,
      getContext: () => undefined,
    });
    expect(resolve()).toMatchObject({ title: '第 2/3 部分', text: '', charCount: 0 });
  });

  it('ignores a segmentation belonging to another book', () => {
    useReaderStore.setState({ bookHash: 'other-book', spineIndex: 0, anchor: undefined });
    const resolve = createNodeSource({
      getStructuredHtml: (index) => DEMO_BOOK.sections[index]?.html,
      getMonolithicText: () => FULL_TEXT,
      getContext: () => undefined,
    });
    // other-book has no segmentation of its own → structured path.
    expect(resolve().title).toBe('第一章 迷雾之城');
  });
});
