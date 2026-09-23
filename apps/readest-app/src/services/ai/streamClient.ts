import { streamText } from 'ai';
import type { AISettings } from '@/types/ai';
import { chatModelOf, temperatureOption } from './providerTransport';

/**
 * Streaming seam over the Vercel AI SDK.
 *
 * Features (summaries, chat) depend on the `StreamTextFn` signature only, so
 * unit tests inject a fake async-iterable producer and never touch the SDK.
 * The transport itself lives in `providerTransport` (shared with the agent
 * stream); this module owns the text-delta shape alone.
 */

export interface StreamRequest {
  system?: string;
  prompt: string;
  signal?: AbortSignal;
}

/** Produces an async iterable of text deltas for one model call. */
export type StreamTextFn = (req: StreamRequest, settings: AISettings) => AsyncIterable<string>;

export const createAiSdkStreamFn = (): StreamTextFn => {
  return ({ system, prompt, signal }, settings) => {
    const result = streamText({
      model: chatModelOf(settings),
      system,
      prompt,
      ...temperatureOption(settings),
      abortSignal: signal,
    });
    return result.textStream;
  };
};
