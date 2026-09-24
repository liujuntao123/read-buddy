import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NodeSummaryRepository } from '@/services/db/repositories';
import {
  MISSING_SETTINGS_ERROR,
  createSummaryStore,
  summaryNodeKey,
  type SummaryNodeContext,
  type SummaryStore,
} from './summaryStore';
import {
  isAbortError,
  type NodeSummarizer,
  type SummarizeInput,
} from '@/services/summary/summarizer';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { describeAIError } from '@/services/ai/errorMessages';
import { nodeSummaryId, DEFAULT_AI_SETTINGS, type AISettings, type NodeSummary } from '@/types/ai';

const VALID_SETTINGS: AISettings = {
  ...DEFAULT_AI_SETTINGS,
  provider: 'deepseek',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
};

const CHAPTER: SummaryNodeContext = {
  bookHash: 'book-x',
  nodeIndex: 2,
  bookTitle: '迷雾之城（演示书）',
  nodeTitle: '第三章 长夜漫漫',
  kind: 'chapter',
  text: '夜'.repeat(9_000),
  charCount: 9_000,
};

const makeRepository = (seed: NodeSummary[] = []): Pick<Harness, 'repository' | 'put' | 'get'> => {
  const table = new Map(seed.map((summary) => [summary.id, summary]));
  const get = vi.fn(async (bookHash: string, nodeIndex: number) =>
    table.get(nodeSummaryId(bookHash, nodeIndex)),
  );
  const put = vi.fn(async (summary: NodeSummary) => {
    table.set(summary.id, summary);
  });
  const repository = { get, put } as unknown as NodeSummaryRepository;
  return { repository, get, put };
};
interface Harness {
  store: SummaryStore;
  factory: Mock<(settings: AISettings) => NodeSummarizer>;
  repository: NodeSummaryRepository;
  put: Mock<(summary: NodeSummary) => Promise<void>>;
  get: Mock<(bookHash: string, nodeIndex: number) => Promise<NodeSummary | undefined>>;
}
/** Fake summarizer mimicking the real one: streams events, persists, returns. */
const makeSummarizer = (
  behavior: (input: SummarizeInput) => Promise<NodeSummary> | void,
): NodeSummarizer => ({
  summarize: vi.fn(async (input: SummarizeInput): Promise<NodeSummary> => {
    const override = await behavior(input);
    if (override) return override;
    const summary: NodeSummary = {
      id: nodeSummaryId(input.bookHash, input.nodeIndex),
      bookHash: input.bookHash,
      nodeIndex: input.nodeIndex,
      nodeTitle: input.nodeTitle,
      modelUsed: 'deepseek-chat',
      summaryContent: '### 📌 核心要义\n新生成的总结',
      pipeline: 'single',
      createdAt: 1,
      updatedAt: 2,
    };
    input.onEvent({ type: 'stage', stage: 'single' });
    input.onEvent({ type: 'delta', text: summary.summaryContent });
    await input.signal.throwIfAborted?.(); // no-op unless aborted
    return summary;
  }),
});

const makeHarness = (seed: NodeSummary[] = []): Harness => {
  const { repository, get, put } = makeRepository(seed);
  const factory = vi.fn(() =>
    makeSummarizer(async () => {
      /* replaced per test via factory.mockImplementation */
      throw new Error('unused');
    }),
  );
  const store = createSummaryStore({
    summarizerFactory: factory as unknown as (settings: AISettings) => NodeSummarizer,
    repository,
    resolveNode: () => ({ ...CHAPTER }),
  });
  return { store, factory, repository, put, get };
};

beforeEach(() => {
  useAISettingsStore.setState({ settings: { ...VALID_SETTINGS }, status: 'ready', toast: null });
});

describe('openNode (strictly manual, cache-first)', () => {
  it('shows a cached summary immediately without ever building a summarizer', async () => {
    const cached: NodeSummary = {
      id: nodeSummaryId(CHAPTER.bookHash, CHAPTER.nodeIndex),
      bookHash: CHAPTER.bookHash,
      nodeIndex: CHAPTER.nodeIndex,
      nodeTitle: CHAPTER.nodeTitle,
      modelUsed: 'deepseek-chat',
      summaryContent: '### 📌 旧的缓存总结',
      pipeline: 'single',
      createdAt: 10,
      updatedAt: 20,
    };
    const harness = makeHarness([cached]);

    await harness.store.getState().openNode(CHAPTER.bookHash, CHAPTER.nodeIndex, CHAPTER.nodeTitle, 9_000);

    const state = harness.store.getState();
    expect(state.phase).toBe('cached');
    expect(state.content).toBe('### 📌 旧的缓存总结');
    expect(state.cachedSummary).toEqual(cached);
    expect(state.activeKey).toBe(summaryNodeKey(CHAPTER.bookHash, CHAPTER.nodeIndex));
    expect(harness.factory).not.toHaveBeenCalled(); // zero model calls
    expect(harness.get).toHaveBeenCalledWith(CHAPTER.bookHash, CHAPTER.nodeIndex);
  });

  it('lands on idle with a clean slate when nothing is cached', async () => {
    const harness = makeHarness();
    await harness.store.getState().openNode('book-y', 0, '第一章', 123);

    const state = harness.store.getState();
    expect(state.phase).toBe('idle');
    expect(state.content).toBe('');
    expect(state.cachedSummary).toBeNull();
    expect(state.charCount).toBe(123);
    expect(state.nodeTitle).toBe('第一章');
  });

  it('switching chapters resets previous content and aborts an in-flight run', async () => {
    const harness = makeHarness();
    const aborted = vi.fn();
    const controller = new AbortController();
    controller.signal.addEventListener('abort', aborted);
    harness.store.setState({ phase: 'generating', content: '部分内容', controller });

    await harness.store.getState().openNode('book-z', 1, '第二章', 456);

    expect(aborted).toHaveBeenCalled();
    const state = harness.store.getState();
    expect(state.phase).not.toBe('generating');
    expect(state.content).toBe('');
    expect(state.activeKey).toBe('book-z:1');
  });
});

describe('generate', () => {
  it('runs the full single-pass flow: idle → generating → done → cached', async () => {
    const harness = makeHarness();
    const phases: string[] = [];
    const unsubscribe = harness.store.subscribe((state) => {
      if (phases[phases.length - 1] !== state.phase) phases.push(state.phase);
    });

    await harness.store.getState().openNode(CHAPTER.bookHash, CHAPTER.nodeIndex, CHAPTER.nodeTitle, 9_000);
    expect(harness.store.getState().phase).toBe('idle');

    const received: string[] = [];
    harness.factory.mockImplementation(() =>
      makeSummarizer(async (input) => {
        input.onEvent({ type: 'stage', stage: 'single' });
        for (const piece of ['### 📌 ', '新的总结']) {
          input.onEvent({ type: 'delta', text: piece });
          received.push(piece);
        }
        const summary: NodeSummary = {
          id: nodeSummaryId(input.bookHash, input.nodeIndex),
          bookHash: input.bookHash,
          nodeIndex: input.nodeIndex,
          nodeTitle: input.nodeTitle,
          modelUsed: input.bookHash === CHAPTER.bookHash ? 'deepseek-chat' : 'other',
          summaryContent: '### 📌 新的总结',
          pipeline: 'single',
          createdAt: 1,
          updatedAt: 2,
        };
        await harness.put(summary); // mimic the real summarizer persisting
        input.onEvent({ type: 'done', summary });
        return summary;
      }),
    );

    await harness.store.getState().generate();

    const state = harness.store.getState();
    expect(state.phase).toBe('cached');
    expect(state.content).toBe('### 📌 新的总结');
    expect(state.cachedSummary?.summaryContent).toBe('### 📌 新的总结');
    expect(received.join('')).toBe('### 📌 新的总结');
    expect(phases).toEqual(['checking-cache', 'idle', 'generating', 'done', 'cached']);
    expect(harness.factory).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not regenerate when a cache appears between openNode and the click', async () => {
    const harness = makeHarness();
    await harness.store.getState().openNode(CHAPTER.bookHash, CHAPTER.nodeIndex, CHAPTER.nodeTitle, 9_000);

    const cached: NodeSummary = {
      id: nodeSummaryId(CHAPTER.bookHash, CHAPTER.nodeIndex),
      bookHash: CHAPTER.bookHash,
      nodeIndex: CHAPTER.nodeIndex,
      nodeTitle: CHAPTER.nodeTitle,
      modelUsed: 'deepseek-chat',
      summaryContent: '### 📌 迟到的缓存',
      pipeline: 'single',
      createdAt: 1,
      updatedAt: 2,
    };
    await harness.put(cached);

    await harness.store.getState().generate();

    expect(harness.store.getState().phase).toBe('cached');
    expect(harness.store.getState().content).toBe('### 📌 迟到的缓存');
    expect(harness.factory).not.toHaveBeenCalled();
  });

  it('force=true skips the cache, regenerates and overwrites the stored summary', async () => {
    const old: NodeSummary = {
      id: nodeSummaryId(CHAPTER.bookHash, CHAPTER.nodeIndex),
      bookHash: CHAPTER.bookHash,
      nodeIndex: CHAPTER.nodeIndex,
      nodeTitle: CHAPTER.nodeTitle,
      modelUsed: 'old-model',
      summaryContent: '### 📌 旧总结',
      pipeline: 'single',
      createdAt: 1,
      updatedAt: 1,
    };
    const harness = makeHarness([old]);
    await harness.store.getState().openNode(CHAPTER.bookHash, CHAPTER.nodeIndex, CHAPTER.nodeTitle, 9_000);
    expect(harness.store.getState().phase).toBe('cached');
    expect(harness.store.getState().cachedSummary?.modelUsed).toBe('old-model');

    harness.factory.mockImplementation(() =>
      makeSummarizer(async (input) => {
        input.onEvent({ type: 'stage', stage: 'single' });
        input.onEvent({ type: 'delta', text: '### 📌 重写后的总结' });
        const summary: NodeSummary = {
          id: nodeSummaryId(input.bookHash, input.nodeIndex),
          bookHash: input.bookHash,
          nodeIndex: input.nodeIndex,
          nodeTitle: input.nodeTitle,
          modelUsed: 'deepseek-chat',
          summaryContent: '### 📌 重写后的总结',
          pipeline: 'single',
          createdAt: 5,
          updatedAt: 6,
        };
        await harness.put(summary);
        return summary;
      }),
    );

    await harness.store.getState().generate(true);

    const state = harness.store.getState();
    expect(harness.factory).toHaveBeenCalledTimes(1);
    expect(state.phase).toBe('cached');
    expect(state.content).toBe('### 📌 重写后的总结');
    expect(state.cachedSummary?.modelUsed).toBe('deepseek-chat');
    expect(await harness.repository.get(CHAPTER.bookHash, CHAPTER.nodeIndex)).toMatchObject({
      summaryContent: '### 📌 重写后的总结',
    });
  });

  it('stop() aborts: phase aborted, partial content kept, nothing persisted', async () => {
    const harness = makeHarness();
    await harness.store.getState().openNode(CHAPTER.bookHash, CHAPTER.nodeIndex, CHAPTER.nodeTitle, 9_000);

    harness.factory.mockImplementation(() => ({
      summarize: async (input: SummarizeInput): Promise<NodeSummary> => {
        input.onEvent({ type: 'stage', stage: 'single' });
        input.onEvent({ type: 'delta', text: '### 📌 已流出的部分' });
        // Simulate the user pressing stop mid-stream: the stream aborts.
        harness.store.getState().stop();
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (input.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        throw new Error('should have aborted');
      },
    }));

    await harness.store.getState().generate();

    const state = harness.store.getState();
    expect(state.phase).toBe('aborted');
    expect(state.content).toBe('### 📌 已流出的部分'); // preserved partial output
    expect(harness.put).not.toHaveBeenCalled();
    expect(state.controller).toBeNull();
  });

  it('surfaces model failures as phase error with classified, readable copy', async () => {
    const harness = makeHarness();
    await harness.store.getState().openNode(CHAPTER.bookHash, CHAPTER.nodeIndex, CHAPTER.nodeTitle, 9_000);

    harness.factory.mockImplementation(() => ({
      summarize: async () => {
        throw new Error('boom: rate limited');
      },
    }));

    await harness.store.getState().generate();

    const state = harness.store.getState();
    expect(state.phase).toBe('error');
    // 分类后的一句话；SDK 原文不外露（docs/architecture.md）。
    expect(state.error).toBe(describeAIError(new Error('boom: rate limited')).message);
    expect(state.error).toContain('额度');
    expect(state.error).not.toContain('boom');
    expect(harness.put).not.toHaveBeenCalled();
  });

  it('classifies an APICallError-shaped failure by its status code', async () => {
    const harness = makeHarness();
    await harness.store.getState().openNode(CHAPTER.bookHash, CHAPTER.nodeIndex, CHAPTER.nodeTitle, 9_000);

    harness.factory.mockImplementation(() => ({
      summarize: async () => {
        throw {
          name: 'AI_APICallError',
          message: 'Unauthorized',
          statusCode: 401,
          responseBody: '{"error":{"message":"Incorrect API key provided: sk-***"}}',
        };
      },
    }));

    await harness.store.getState().generate();

    const state = harness.store.getState();
    expect(state.phase).toBe('error');
    expect(state.error).toContain('API Key');
    expect(state.error).not.toContain('Incorrect API key provided');
  });

  it('rejects generation with a hint when AI settings are unconfigured', async () => {
    useAISettingsStore.setState({ settings: { ...DEFAULT_AI_SETTINGS } }); // empty apiKey
    const harness = makeHarness();
    await harness.store.getState().openNode(CHAPTER.bookHash, CHAPTER.nodeIndex, CHAPTER.nodeTitle, 9_000);

    await harness.store.getState().generate();

    const state = harness.store.getState();
    expect(state.phase).toBe('error');
    expect(state.error).toBe(MISSING_SETTINGS_ERROR);
    expect(harness.factory).not.toHaveBeenCalled();
  });

  it('maps map-reduce progress events onto stageLabel', async () => {
    const harness = makeHarness();
    await harness.store.getState().openNode(CHAPTER.bookHash, CHAPTER.nodeIndex, CHAPTER.nodeTitle, 15_000);

    const labels: string[] = [];
    const unsubscribe = harness.store.subscribe((state) => labels.push(state.stageLabel));

    harness.factory.mockImplementation(() =>
      makeSummarizer(async (input) => {
        input.onEvent({ type: 'stage', stage: 'mapping' });
        input.onEvent({ type: 'progress', stage: 'mapping', index: 1, total: 2 });
        input.onEvent({ type: 'progress', stage: 'mapping', index: 2, total: 2 });
        input.onEvent({ type: 'stage', stage: 'reducing' });
        input.onEvent({ type: 'delta', text: '### 📌 整章总结' });
        const summary: NodeSummary = {
          id: nodeSummaryId(input.bookHash, input.nodeIndex),
          bookHash: input.bookHash,
          nodeIndex: input.nodeIndex,
          nodeTitle: input.nodeTitle,
          modelUsed: 'deepseek-chat',
          summaryContent: '### 📌 整章总结',
          pipeline: 'map-reduce',
          createdAt: 1,
          updatedAt: 1,
        };
        await harness.put(summary);
        return summary;
      }),
    );

    await harness.store.getState().generate();
    unsubscribe();

    expect(labels).toContain('正在分块提炼 (1/2)...');
    expect(labels).toContain('正在分块提炼 (2/2)...');
    expect(labels).toContain('正在合成整章脉络...');
    expect(harness.store.getState().cachedSummary?.pipeline).toBe('map-reduce');
  });
});

describe('isAbortError re-export sanity', () => {
  it('recognizes DOMException aborts', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('boom'))).toBe(false);
  });
});
