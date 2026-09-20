import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';
import type { AISettings } from '@/types/ai';

/**
 * Streaming seam over the Vercel AI SDK.
 *
 * Features (summaries, chat) depend on the `StreamTextFn` signature only, so
 * unit tests inject a fake async-iterable producer and never touch the SDK.
 * This module is the single place that binds the real OpenAI-compatible
 * transport (DeepSeek, OpenAI, Claude via proxy, local Ollama, ...).
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
    const provider = createOpenAICompatible({
      name: settings.provider,
      baseURL: settings.baseUrl.replace(/\/+$/, ''),
      apiKey: settings.apiKey || undefined,
    });
    const result = streamText({
      model: provider.chatModel(settings.model),
      system,
      prompt,
      temperature: settings.temperature,
      abortSignal: signal,
    });
    return result.textStream;
  };
};
