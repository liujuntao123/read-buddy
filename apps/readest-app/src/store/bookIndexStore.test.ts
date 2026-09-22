import { describe, expect, it, vi } from 'vitest';
import { createBookIndexStore, type BookIndexDeps } from './bookIndexStore';
import { BookPanoramaRepository, BookNodeRepository } from '@/services/db/repositories';
import { ReadestPlusDatabase } from '@/services/db/database';
import { DEFAULT_AI_SETTINGS, type AISettings } from '@/types/ai';
import type { StreamTextFn } from '@/services/ai/streamClient';
import { getAgentBookContext } from '@/services/agent/agentContext';
import { subscribeLocate } from '@/services/reader/readerLink';
import { formatNodeCounts } from '@/services/bookNodes';
import type { BookTocEntry, NodeAnchor } from '@/types/readingAgent';

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const paragraph = (seed: string): string =>
  Array.from({ length: 60 }, (_, i) => `${seed}段落${i + 1}：夜色中的城市依旧喧嚣，灯火沿着河岸铺陈开来。`).join('\n');

/** A well-formed 12-chapter monolithic TXT (~24k chars). */
const MONO_TEXT = NUMERALS.map((numeral, i) => `第${numeral}章 标题${i}\n${paragraph(`c${i}`)}`).join('\n');

/**
 * One spine file whose directory anchors cut it into a 部分 container (章)
 * plus two 第N章 leaves (节) — the minimal-node rule's canonical shape.
 */
const TOC_PART_TITLE = '第一部分 系统1，系统2';
const TOC_TEXT = [
  TOC_PART_TITLE,
  '本部分导读：两套系统如何分工。',
  '第1章 一张愤怒的脸和一道乘法题',
  paragraph('t1'),
  '第2章 电影的主角与配角',
  paragraph('t2'),
].join('\n');
const TOC_ANCHORS: NodeAnchor[] = [
  { id: 'toc_part', offset: TOC_TEXT.indexOf(TOC_PART_TITLE) },
  { id: 'toc_1', offset: TOC_TEXT.indexOf('第1章') },
  { id: 'toc_2', offset: TOC_TEXT.indexOf('第2章') },
];
const TOC_ENTRIES: BookTocEntry[] = [
  { label: TOC_PART_TITLE, depth: 0, spineIndex: 0, anchor: 'toc_part', href: 'text.xhtml#toc_part' },
  {
    label: '第1章 一张愤怒的脸和一道乘法题',
    depth: 0,
    spineIndex: 0,
    anchor: 'toc_1',
    href: 'text.xhtml#toc_1',
  },
  { label: '第2章 电影的主角与配角', depth: 0, spineIndex: 0, anchor: 'toc_2', href: 'text.xhtml#toc_2' },
];

const PANORAMA_JSON =
  '{"genre":"悬疑","summary":"守夜人追寻灯塔熄灭之谜。","worldSetting":"北海孤岛","mainCharacters":["林远"]}';

interface Harness {
  store: ReturnType<typeof createBookIndexStore>;
  db: ReadestPlusDatabase;
  setSettings: (settings: AISettings) => void;
  /** Prompts the micro-brief queue sent to the model. */
  briefPrompts: string[];
}

const makeHarness = (options: { stream?: StreamTextFn; db?: ReadestPlusDatabase; spineAsync?: boolean } = {}): Harness => {
  const db = options.db ?? new ReadestPlusDatabase(`index-store-test-${Math.random().toString(36).slice(2)}`);
  let settings: AISettings = { ...DEFAULT_AI_SETTINGS, apiKey: 'sk-test' };
  const briefPrompts: string[] = [];
  const stream: StreamTextFn =
    options.stream ??
    (async function* (req) {
      await Promise.resolve();
      const system = req.system ?? '';
      if (system.includes('全景画像') || system.includes('书籍档案管理员')) {
        yield PANORAMA_JSON;
      } else {
        briefPrompts.push(req.prompt);
        yield `第N章推进了主线剧情。\n【实体】林远`;
      }
    });
  const spineSections = [
    { title: '第一章', text: paragraph('a'), spineIndex: 0 },
    { title: '第二章', text: paragraph('b'), spineIndex: 1 },
    { title: '第三章', text: paragraph('c'), spineIndex: 2 },
  ];
  const deps: BookIndexDeps = {
    bookNodes: new BookNodeRepository(db),
    panoramas: new BookPanoramaRepository(db),
    stream,
    getSettings: () => settings,
    getMonolithicText: (hash) => (hash === 'mono' ? MONO_TEXT : undefined),
    getSegmentationSource: (hash) => {
      if (hash === 'spine') {
        const source = { sections: spineSections, tocEntries: [] };
        // Engine-shaped seam: async resolution of lazily loaded sections.
        return options.spineAsync ? Promise.resolve(source) : source;
      }
      if (hash === 'toc') {
        return {
          sections: [{ title: '正文', text: TOC_TEXT, spineIndex: 0, anchors: TOC_ANCHORS }],
          tocEntries: TOC_ENTRIES,
        };
      }
      return undefined;
    },
    now: () => 1_000,
  };
  const store = createBookIndexStore(deps);
  return { store, db, setSettings: (next) => { settings = next; }, briefPrompts };
};

const waitFor = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('bookIndexStore.ensureIndexed', () => {
  it('segments a monolithic TXT, registers the context and runs the AI pipeline', async () => {
    const { store, db } = makeHarness();
    await store.getState().ensureIndexed('mono', { currentSectionIndex: 0 });

    // Phase 2 finished synchronously: nodes persisted and context live.
    expect(store.getState().strategy).toBe('regex');
    expect(store.getState().shape.total).toBe(12);
    expect(store.getState().briefTotal).toBe(12);
    const context = getAgentBookContext('mono');
    expect(context).toBeDefined();
    expect(context!.nodes).toHaveLength(12);
    expect(context!.readPassage(0, 0, 10)!.text).toBe(MONO_TEXT.slice(0, 10));

    // Background phases complete.
    await waitFor(() => store.getState().phase === 'ready');
    expect(store.getState().panoramaReady).toBe(true);
    expect(store.getState().briefedCount).toBe(12);
    expect(context!.getPanorama()?.summary).toBe('守夜人追寻灯塔熄灭之谜。');
    expect(context!.nodes.every((node) => node.indexStatus === 'ready')).toBe(true);
    const rows = await new BookNodeRepository(db).listByBook('mono');
    expect(rows.every((row) => row.brief)).toBe(true);
    await db.delete();
  });

  it('maps a healthy EPUB spine natively', async () => {
    const { store, db } = makeHarness();
    await store.getState().ensureIndexed('spine');
    expect(store.getState().strategy).toBe('native');
    expect(store.getState().shape.total).toBe(3);
    await waitFor(() => store.getState().phase === 'ready');
    await db.delete();
  });

  it('supports async spine text sources (engine loads sections on demand)', async () => {
    const { store, db } = makeHarness({
      spineAsync: true,
    });
    await store.getState().ensureIndexed('spine');
    expect(store.getState().strategy).toBe('native');
    const context = getAgentBookContext('spine')!;
    // The passage reflects the asynchronously loaded text, not an empty cache.
    expect(context.readPassage(1, 0, 5)!.text.length).toBe(5);
    await db.delete();
  });

  it('resumes persisted nodes without re-segmenting and skips done briefs', async () => {
    const { store, db } = makeHarness();
    await store.getState().ensureIndexed('mono');
    await waitFor(() => store.getState().phase === 'ready');

    // Second open (same DB): nodes rehydrated, briefs all ready → no model calls.
    const calls = vi.fn();
    const second = makeHarness({
      db,
      stream: async function* () {
        calls();
        yield '不应被调用';
      },
    });
    await second.store.getState().ensureIndexed('mono');
    expect(second.store.getState().shape.total).toBe(12);
    expect(second.store.getState().briefedCount).toBe(12);
    await waitFor(() => second.store.getState().phase === 'ready');
    expect(calls).not.toHaveBeenCalled();
    await db.delete();
  });

  it('skips AI phases silently without an API key', async () => {
    const { store, db, setSettings } = makeHarness();
    setSettings({ ...DEFAULT_AI_SETTINGS, apiKey: '' });
    await store.getState().ensureIndexed('mono');
    // Segmentation still happened, but no background AI phases run.
    expect(store.getState().shape.total).toBe(12);
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().panoramaReady).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.getState().briefedCount).toBe(0);
    await db.delete();
  });

  it('is a silent no-op when no text source resolves', async () => {
    const { store, db } = makeHarness();
    await store.getState().ensureIndexed('unknown-book');
    expect(store.getState().phase).toBe('idle');
    expect(getAgentBookContext('unknown-book')).toBeUndefined();
    await db.delete();
  });

  it('locate flows through the registered context to the reader link', async () => {
    const { store, db } = makeHarness();
    const listener = vi.fn();
    const unsubscribe = subscribeLocate(listener);
    await store.getState().ensureIndexed('mono');
    const context = getAgentBookContext('mono')!;
    context.locate(3, 10, '灯火沿着河岸');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ nodeIndex: 3, bookHash: 'mono' }));
    unsubscribe();
    await db.delete();
  });

  it('reindex wipes the book nodes + panorama and rebuilds from scratch', async () => {
    let panoramaCalls = 0;
    const { store, db } = makeHarness({
      stream: async function* (req) {
        await Promise.resolve();
        const system = req.system ?? '';
        if (system.includes('书籍档案管理员')) {
          panoramaCalls += 1;
          yield PANORAMA_JSON;
        } else {
          yield `第N章推进了主线剧情。\n【实体】林远`;
        }
      },
    });
    await store.getState().ensureIndexed('mono');
    await waitFor(() => store.getState().phase === 'ready');
    expect(panoramaCalls).toBe(1);

    await store.getState().reindex('mono');
    expect(store.getState().shape.total).toBe(12);
    await waitFor(() => store.getState().phase === 'ready');
    expect(panoramaCalls).toBe(2);
    // Rebuilt context carries fresh briefs + panorama.
    const context = getAgentBookContext('mono')!;
    expect(context.getPanorama()?.summary).toBe('守夜人追寻灯塔熄灭之谜。');
    expect(context.nodes.every((node) => node.indexStatus === 'ready')).toBe(true);
    const rows = await new BookNodeRepository(db).listByBook('mono');
    expect(rows).toHaveLength(12);
    await db.delete();
  });

  it('briefs the minimal nodes only: a container 章 never reaches the model', async () => {
    const harness = makeHarness();
    const { store, db } = harness;
    await store.getState().ensureIndexed('toc', { currentSectionIndex: 0 });

    // Shape: one 章 container (第一部分) over two 节, so the minimal node is 节.
    const shape = store.getState().shape;
    expect(shape).toMatchObject({
      chapter: 1,
      section: 2,
      chunk: 0,
      total: 3,
      isNested: true,
      minimalKind: 'section',
    });
    expect(formatNodeCounts(shape)).toBe('1 章 · 2 节');
    expect(store.getState().briefTotal).toBe(2);

    await waitFor(() => store.getState().phase === 'ready');
    expect(store.getState().briefedCount).toBe(2);

    // The queue was driven over the two 节 only — the container consumed no call.
    expect(harness.briefPrompts).toHaveLength(2);
    const prompts = harness.briefPrompts.join('\n');
    expect(prompts).toContain('第1章 一张愤怒的脸和一道乘法题');
    expect(prompts).toContain('第2章 电影的主角与配角');
    expect(prompts).not.toContain(TOC_PART_TITLE);

    // The container is persisted as an un-briefed structural parent row.
    const rows = await new BookNodeRepository(db).listByBook('toc');
    expect(rows.map((row) => row.title)).toEqual([
      TOC_PART_TITLE,
      '第1章 一张愤怒的脸和一道乘法题',
      '第2章 电影的主角与配角',
    ]);
    expect(rows[0]!.depth).toBe(0);
    expect(rows[0]!.brief).toBeUndefined();
    expect(rows[0]!.indexStatus).toBe('pending');
    expect(rows[1]!.parentNodeId).toBe(rows[0]!.nodeId);
    expect(rows[2]!.parentNodeId).toBe(rows[0]!.nodeId);
    expect(rows.slice(1).every((row) => row.brief && row.indexStatus === 'ready')).toBe(true);
    await db.delete();
  });
});
