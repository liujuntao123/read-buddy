import { describe, expect, it } from 'vitest';
import type { StreamTextFn } from '@/services/ai/streamClient';
import type { ChapterSummaryRepository } from '@/services/db/repositories';
import { chapterSummaryId, type AISettings, type ChapterSummary } from '@/types/ai';
import { createChapterSummarizer, type SummarizerEvent } from './summarizer';

const SETTINGS: AISettings = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  temperature: 0.6,
  maxTurnsPerTopic: 10,
};

interface RecordedCall {
  prompt: string;
  system?: string;
  signal?: AbortSignal;
}

/** Fake stream: each call replays the next script, yielding piece by piece. */
const makeStream = (scripts: string[][]): { stream: StreamTextFn; calls: RecordedCall[] } => {
  const calls: RecordedCall[] = [];
  const stream: StreamTextFn = async function* (req, settings) {
    const index = calls.length;
    calls.push({ prompt: req.prompt, system: req.system, signal: req.signal });
    void settings;
    for (const piece of scripts[index] ?? []) yield piece;
  };
  return { stream, calls };
};

const makeRepository = () => {
  const saved: ChapterSummary[] = [];
  const repository = {
    get: async (): Promise<ChapterSummary | undefined> => undefined,
    put: async (summary: ChapterSummary) => {
      saved.push(summary);
    },
  } as unknown as ChapterSummaryRepository;
  return { repository, saved };
};

const INPUT = (text: string, signal: AbortSignal, onEvent: (e: SummarizerEvent) => void) => ({
  bookHash: 'book',
  sectionIndex: 0,
  chapterTitle: '第一章 迷雾之城',
  bookTitle: '迷雾之城（演示书）',
  text,
  signal,
  onEvent,
});

describe('createChapterSummarizer', () => {
  it('single-passes an 8,000-char chapter: one stream call, persisted, deltas join into the content', async () => {
    const script = ['### 📌 ', '章节核心要义', '\n正文行'];
    const { stream, calls } = makeStream([script]);
    const { repository, saved } = makeRepository();
    const summarizer = createChapterSummarizer({ stream, settings: SETTINGS, repository });

    const events: SummarizerEvent[] = [];
    const controller = new AbortController();
    const summary = await summarizer.summarize(
      INPUT('雾'.repeat(8_000), controller.signal, (event) => events.push(event)),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain('第一章 迷雾之城');
    expect(calls[0].prompt).toContain('《迷雾之城（演示书）》');
    expect(calls[0].system).toBeTruthy();
    expect(calls[0].signal).toBe(controller.signal);

    expect(summary.pipeline).toBe('single');
    expect(summary.id).toBe('book:0');
    expect(summary.chapterTitle).toBe('第一章 迷雾之城');
    expect(summary.modelUsed).toBe('deepseek-chat');
    expect(summary.summaryContent).toBe('### 📌 章节核心要义\n正文行');

    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas.map((e) => (e.type === 'delta' ? e.text : '')).join('')).toBe(summary.summaryContent);
    expect(events[0]).toEqual({ type: 'stage', stage: 'single' });
    expect(events[events.length - 1]).toEqual({ type: 'done', summary });

    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(summary);
    expect(saved[0].id).toBe(chapterSummaryId('book', 0));
  });

  it('map-reduces a 15,000-char chapter: 2 map + 1 reduce calls, progress (1,2)(2,2), deltas only from reduce', async () => {
    const { stream, calls } = makeStream([
      ['守夜人发现星图移动。'],
      ['林晚找到父亲手稿。'],
      ['### 📌 ', '整章核心要义'],
    ]);
    const { repository, saved } = makeRepository();
    const summarizer = createChapterSummarizer({ stream, settings: SETTINGS, repository });

    const events: SummarizerEvent[] = [];
    const controller = new AbortController();
    const summary = await summarizer.summarize(
      INPUT('卷'.repeat(15_000), controller.signal, (event) => events.push(event)),
    );

    // 2 map calls + 1 reduce call.
    expect(calls).toHaveLength(3);
    expect(calls[0].prompt).toContain('第 1/2 个片段');
    expect(calls[1].prompt).toContain('第 2/2 个片段');
    // Reduce sees both sub-summaries.
    expect(calls[2].prompt).toContain('守夜人发现星图移动。');
    expect(calls[2].prompt).toContain('林晚找到父亲手稿。');
    expect(calls[2].prompt).toContain('### 📌 章节核心要义');
    // Every call carries the abort signal.
    calls.forEach((call) => expect(call.signal).toBe(controller.signal));

    // Progress sequence is exactly (1,2) then (2,2).
    const progress = events.filter((e) => e.type === 'progress');
    expect(progress).toEqual([
      { type: 'progress', stage: 'mapping', index: 1, total: 2 },
      { type: 'progress', stage: 'mapping', index: 2, total: 2 },
    ]);

    // Stage order: mapping → reducing; deltas only from the reduce output.
    expect(events[0]).toEqual({ type: 'stage', stage: 'mapping' });
    expect(events.filter((e) => e.type === 'stage')).toEqual([
      { type: 'stage', stage: 'mapping' },
      { type: 'stage', stage: 'reducing' },
    ]);
    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas).toHaveLength(2);

    expect(summary.pipeline).toBe('map-reduce');
    expect(summary.summaryContent).toBe('### 📌 整章核心要义');
    expect(saved).toHaveLength(1);
    expect(saved[0].pipeline).toBe('map-reduce');
    expect(saved[0].id).toBe('book:0');
  });

  it('aborts during the reduce phase: throws AbortError and never persists', async () => {
    let call = 0;
    const stream: StreamTextFn = async function* () {
      call += 1;
      if (call <= 2) {
        yield `子摘要${call}`;
        return;
      }
      yield '### 📌 ';
      throw new DOMException('Aborted', 'AbortError');
    };
    const { repository, saved } = makeRepository();
    const summarizer = createChapterSummarizer({ stream, settings: SETTINGS, repository });

    const controller = new AbortController();
    await expect(
      summarizer.summarize(INPUT('卷'.repeat(15_000), controller.signal, () => {})),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(call).toBe(3); // both maps finished, reduce started then aborted
    expect(saved).toHaveLength(0);
  });

  it('aborts between map calls when the user signals stop: no further model call, nothing persisted', async () => {
    const { stream, calls } = makeStream([['子摘要一'], ['子摘要二']]);
    const { repository, saved } = makeRepository();
    const summarizer = createChapterSummarizer({ stream, settings: SETTINGS, repository });

    const controller = new AbortController();
    await expect(
      summarizer.summarize(
        INPUT('卷'.repeat(15_000), controller.signal, (event) => {
          if (event.type === 'progress' && event.index === 1) controller.abort();
        }),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(calls).toHaveLength(0); // abort observed before the first map call runs
    expect(saved).toHaveLength(0);
  });

  it('refuses to start at all when the signal is already aborted', async () => {
    const { stream, calls } = makeStream([['never']]);
    const { repository, saved } = makeRepository();
    const summarizer = createChapterSummarizer({ stream, settings: SETTINGS, repository });

    const controller = new AbortController();
    controller.abort();
    await expect(
      summarizer.summarize(INPUT('雾'.repeat(500), controller.signal, () => {})),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it('propagates model errors unchanged so the UI can offer a retry', async () => {
    const stream: StreamTextFn = async function* () {
      throw new Error('boom: 401 unauthorized');
    };
    const { repository, saved } = makeRepository();
    const summarizer = createChapterSummarizer({ stream, settings: SETTINGS, repository });

    const controller = new AbortController();
    await expect(
      summarizer.summarize(INPUT('雾'.repeat(500), controller.signal, () => {})),
    ).rejects.toThrow('boom: 401 unauthorized');
    expect(saved).toHaveLength(0);
  });
});
