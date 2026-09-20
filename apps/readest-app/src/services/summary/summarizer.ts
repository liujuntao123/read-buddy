/**
 * Chapter summarizer (ticket 03, design doc 4.3, ADR 0004/0005).
 *
 * One stream seam call per model turn:
 * - chapters ≤ 12,000 chars: single streaming call emitting `delta` events;
 * - longer chapters: Map-Reduce — one key-point call per chunk (no `delta`,
 *   only `progress` i/N), then one streaming reduce call whose output is the
 *   final three-part summary and the only source of `delta` events.
 *
 * The finished ChapterSummary is persisted through the injected repository
 * and returned. Aborts never persist; model errors propagate unchanged so the
 * UI can offer a retry.
 */
import {
  SUMMARY_SINGLE_PASS_MAX_CHARS,
  chapterSummaryId,
  type AISettings,
  type ChapterSummary,
} from '@/types/ai';
import type { StreamTextFn } from '@/services/ai/streamClient';
import type { ChapterSummaryRepository } from '@/services/db/repositories';
import { chunkChapterText } from './chunkText';
import {
  MAP_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildMapPrompt,
  buildReducePrompt,
  buildSinglePassPrompt,
} from './prompts';

export type SummarizerStage = 'single' | 'mapping' | 'reducing';

export type SummarizerEvent =
  | { type: 'stage'; stage: SummarizerStage }
  | { type: 'progress'; stage: 'mapping'; index: number; total: number }
  | { type: 'delta'; text: string }
  | { type: 'done'; summary: ChapterSummary };

export interface SummarizeInput {
  bookHash: string;
  sectionIndex: number;
  chapterTitle: string;
  bookTitle: string;
  text: string;
  signal: AbortSignal;
  onEvent: (event: SummarizerEvent) => void;
}

export interface ChapterSummarizer {
  summarize(input: SummarizeInput): Promise<ChapterSummary>;
}

export interface ChapterSummarizerDeps {
  stream: StreamTextFn;
  settings: AISettings;
  repository: ChapterSummaryRepository;
}

/** True for AbortError-shaped errors (DOMException or plain Error). */
export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError');

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw abortError();
};

export function createChapterSummarizer({
  stream,
  settings,
  repository,
}: ChapterSummarizerDeps): ChapterSummarizer {
  /** Consume one streaming call; every delta is forwarded to `onDelta`. */
  const consume = async (
    prompt: string,
    system: string,
    signal: AbortSignal,
    onDelta?: (text: string) => void,
  ): Promise<string> => {
    throwIfAborted(signal);
    let content = '';
    for await (const delta of stream({ system, prompt, signal }, settings)) {
      throwIfAborted(signal);
      content += delta;
      onDelta?.(delta);
    }
    throwIfAborted(signal);
    return content;
  };

  return {
    async summarize({
      bookHash,
      sectionIndex,
      chapterTitle,
      bookTitle,
      text,
      signal,
      onEvent,
    }: SummarizeInput): Promise<ChapterSummary> {
      try {
        throwIfAborted(signal);

        let pipeline: ChapterSummary['pipeline'];
        let content: string;

        if (text.length <= SUMMARY_SINGLE_PASS_MAX_CHARS) {
          onEvent({ type: 'stage', stage: 'single' });
          pipeline = 'single';
          content = await consume(
            buildSinglePassPrompt({ bookTitle, chapterTitle, text }),
            SUMMARY_SYSTEM_PROMPT,
            signal,
            (chunk) => onEvent({ type: 'delta', text: chunk }),
          );
        } else {
          const chunks = chunkChapterText(text);
          onEvent({ type: 'stage', stage: 'mapping' });
          const subSummaries: string[] = [];
          for (const [index, chunk] of chunks.entries()) {
            throwIfAborted(signal);
            onEvent({ type: 'progress', stage: 'mapping', index: index + 1, total: chunks.length });
            // Map phase: accumulate silently — only the reduce output streams.
            subSummaries.push(
              await consume(
                buildMapPrompt({ bookTitle, chapterTitle, chunk, index: index + 1, total: chunks.length }),
                MAP_SYSTEM_PROMPT,
                signal,
              ),
            );
          }

          onEvent({ type: 'stage', stage: 'reducing' });
          pipeline = 'map-reduce';
          content = await consume(
            buildReducePrompt({ bookTitle, chapterTitle, subSummaries }),
            SUMMARY_SYSTEM_PROMPT,
            signal,
            (chunk) => onEvent({ type: 'delta', text: chunk }),
          );
        }

        throwIfAborted(signal);
        const now = Date.now();
        const summary: ChapterSummary = {
          id: chapterSummaryId(bookHash, sectionIndex),
          bookHash,
          sectionIndex,
          chapterTitle,
          modelUsed: settings.model,
          summaryContent: content,
          pipeline,
          createdAt: now,
          updatedAt: now,
        };
        await repository.put(summary);
        onEvent({ type: 'done', summary });
        return summary;
      } catch (error) {
        // Normalize every abort shape; anything else (model/network failure)
        // propagates unchanged so the UI can surface a retry affordance.
        if (signal.aborted || isAbortError(error)) throw abortError();
        throw error;
      }
    },
  };
}
