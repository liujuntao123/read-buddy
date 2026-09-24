/**
 * Chapter summarizer (ticket 03, ADR 0004/0005).
 *
 * One stream seam call per model turn:
 * - chapters ≤ 12,000 chars: single streaming call emitting `delta` events;
 * - longer chapters: Map-Reduce — one key-point call per chunk (no `delta`,
 *   only `progress` i/N), then one streaming reduce call whose output is the
 *   final three-part summary and the only source of `delta` events.
 *
 * The finished NodeSummary is persisted through the injected repository
 * and returned. Aborts never persist; model errors propagate unchanged so the
 * UI can offer a retry.
 */
import {
  SUMMARY_SINGLE_PASS_MAX_CHARS,
  nodeSummaryId,
  type AISettings,
  type NodeSummary,
} from '@/types/ai';
import type { NodeKind } from '@/types/readingAgent';
import type { StreamTextFn } from '@/services/ai/streamClient';
import type { NodeSummaryRepository } from '@/services/db/repositories';
import { chunkNodeText } from './chunkText';
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
  | { type: 'done'; summary: NodeSummary };

export interface SummarizeInput {
  bookHash: string;
  nodeIndex: number;
  nodeTitle: string;
  /** 视角节点的层级：节 / 章 / 段（最小节点）。 */
  nodeKind: NodeKind;
  bookTitle: string;
  text: string;
  signal: AbortSignal;
  onEvent: (event: SummarizerEvent) => void;
}

export interface NodeSummarizer {
  summarize(input: SummarizeInput): Promise<NodeSummary>;
}

export interface NodeSummarizerDeps {
  stream: StreamTextFn;
  settings: AISettings;
  repository: NodeSummaryRepository;
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

export function createNodeSummarizer({
  stream,
  settings,
  repository,
}: NodeSummarizerDeps): NodeSummarizer {
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
      nodeIndex,
      nodeTitle,
      nodeKind,
      bookTitle,
      text,
      signal,
      onEvent,
    }: SummarizeInput): Promise<NodeSummary> {
      try {
        throwIfAborted(signal);

        let pipeline: NodeSummary['pipeline'];
        let content: string;

        if (text.length <= SUMMARY_SINGLE_PASS_MAX_CHARS) {
          onEvent({ type: 'stage', stage: 'single' });
          pipeline = 'single';
          content = await consume(
            buildSinglePassPrompt({ bookTitle, nodeTitle, nodeKind, text }),
            SUMMARY_SYSTEM_PROMPT,
            signal,
            (chunk) => onEvent({ type: 'delta', text: chunk }),
          );
        } else {
          const chunks = chunkNodeText(text);
          onEvent({ type: 'stage', stage: 'mapping' });
          const subSummaries: string[] = [];
          for (const [index, chunk] of chunks.entries()) {
            throwIfAborted(signal);
            onEvent({ type: 'progress', stage: 'mapping', index: index + 1, total: chunks.length });
            // Map phase: accumulate silently — only the reduce output streams.
            subSummaries.push(
              await consume(
                buildMapPrompt({
                  bookTitle,
                  nodeTitle,
                  nodeKind,
                  chunk,
                  index: index + 1,
                  total: chunks.length,
                }),
                MAP_SYSTEM_PROMPT,
                signal,
              ),
            );
          }

          onEvent({ type: 'stage', stage: 'reducing' });
          pipeline = 'map-reduce';
          content = await consume(
            buildReducePrompt({ bookTitle, nodeTitle, nodeKind, subSummaries }),
            SUMMARY_SYSTEM_PROMPT,
            signal,
            (chunk) => onEvent({ type: 'delta', text: chunk }),
          );
        }

        throwIfAborted(signal);
        const now = Date.now();
        const summary: NodeSummary = {
          id: nodeSummaryId(bookHash, nodeIndex),
          bookHash,
          nodeIndex,
          nodeTitle,
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
