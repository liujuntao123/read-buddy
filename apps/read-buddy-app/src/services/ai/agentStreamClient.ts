/**
 * Agent streaming seam over the Vercel AI SDK with tool calling
 * (docs/architecture.md).
 *
 * This is the single module that binds the real OpenAI-compatible transport
 * to a multi-step tool loop: `streamText` + `stopWhen: stepCountIs(maxSteps)`
 * executes the four reading tools server-of-the-loop, while we walk the
 * `fullStream` and re-emit a normalized event trail (text deltas, tool
 * calls, tool results with durations) that both the chat store and the
 * trace persistence consume. Unit tests inject a fake `AgentStreamFn`.
 */
import { stepCountIs, streamText } from 'ai';
import type { ToolSet } from '@ai-sdk/provider-utils';
import type { AISettings } from '@/types/ai';
import { chatModelOf, temperatureOption } from './providerTransport';

export interface AgentStreamRequest {
  system: string;
  prompt: string;
  tools: ToolSet;
  signal?: AbortSignal;
  /** Max model steps (tool round trips + final answer). Default 6. */
  maxSteps?: number;
}

export interface AgentStreamEvent {
  type: 'text-delta' | 'tool-call' | 'tool-result';
  text?: string;
  id?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  durationMs?: number;
}

/** Produces the normalized event trail for one agent turn. */
export type AgentStreamFn = (req: AgentStreamRequest, settings: AISettings) => AsyncIterable<AgentStreamEvent>;

export const DEFAULT_AGENT_MAX_STEPS = 6;

const asRecord = (value: unknown): Record<string, unknown> =>
  (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;

export const createAgentStreamFn = (): AgentStreamFn => {
  return ({ system, prompt, tools, signal, maxSteps }, settings) => {
    const result = streamText({
      model: chatModelOf(settings),
      system,
      prompt,
      tools,
      stopWhen: stepCountIs(maxSteps ?? DEFAULT_AGENT_MAX_STEPS),
      ...temperatureOption(settings),
      abortSignal: signal,
    });

    async function* events(): AsyncGenerator<AgentStreamEvent> {
      /** toolCallId → start timestamp, for result durations. */
      const startedAt = new Map<string, number>();
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'text-delta': {
            const text = (part as { text?: string }).text;
            if (typeof text === 'string' && text.length > 0) {
              yield { type: 'text-delta', text };
            }
            break;
          }
          case 'tool-call': {
            const call = part as unknown as {
              toolCallId: string;
              toolName: string;
              input?: unknown;
            };
            startedAt.set(call.toolCallId, Date.now());
            yield {
              type: 'tool-call',
              id: call.toolCallId,
              toolName: call.toolName,
              args: asRecord(call.input),
            };
            break;
          }
          case 'tool-result': {
            const done = part as unknown as {
              toolCallId: string;
              toolName: string;
              output?: unknown;
            };
            const start = startedAt.get(done.toolCallId);
            yield {
              type: 'tool-result',
              id: done.toolCallId,
              toolName: done.toolName,
              result: done.output,
              durationMs: start === undefined ? 0 : Date.now() - start,
            };
            break;
          }
          case 'error': {
            const err = (part as { error?: unknown }).error;
            throw err instanceof Error ? err : new Error(String(err ?? 'Agent 流式请求失败'));
          }
          default:
            break;
        }
      }
    }
    return events();
  };
};
