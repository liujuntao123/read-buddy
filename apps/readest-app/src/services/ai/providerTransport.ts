/**
 * The single place that constructs an AI Provider client.
 *
 * `streamClient` (text deltas) and `agentStreamClient` (tool loop events) keep
 * their own seams and signatures — two genuinely different request shapes — but
 * they must not each re-derive the transport. Before this module the
 * `createOpenAICompatible` block was duplicated verbatim in both, so a header,
 * a timeout or a provider quirk had to be added twice (and a third time in
 * `testConnection`, which speaks raw HTTP).
 *
 * Only the two stream clients import this module, so the AI SDK stays out of
 * every unit test that imports a store (see `bookIndexStore`'s lazy import).
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { AISettings } from '@/types/ai';

/** The chat model for the configured provider (base URL normalised once). */
export const chatModelOf = (settings: AISettings) =>
  createOpenAICompatible({
    name: settings.provider,
    baseURL: settings.baseUrl.replace(/\/+$/, ''),
    apiKey: settings.apiKey || undefined,
  }).chatModel(settings.model);

/**
 * Optional temperature, spread into `streamText` options. Returned as an empty
 * object rather than `{ temperature: undefined }` so the SDK's own default
 * applies when the reader left it unset.
 */
export const temperatureOption = (settings: AISettings): { temperature?: number } =>
  typeof settings.temperature === 'number' ? { temperature: settings.temperature } : {};
