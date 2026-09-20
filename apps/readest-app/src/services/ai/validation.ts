import type { AIProvider, AISettings } from '@/types/ai';
import { MAX_TURNS_PER_TOPIC, MIN_TURNS_PER_TOPIC } from '@/types/ai';

/**
 * Field-level validation for the AI provider configuration center
 * (design doc 4.1). An empty error map means the settings are legal to
 * persist; `testConnection` intentionally bypasses the apiKey rule so a
 * half-configured provider can still be probed.
 */

const AI_PROVIDERS: readonly AIProvider[] = [
  'openai-compatible',
  'deepseek',
  'claude',
  'ollama',
];

export type AISettingsErrors = Record<string, string>;

export function validateAISettings(settings: AISettings): AISettingsErrors {
  const errors: AISettingsErrors = {};

  // baseUrl: must be a parseable URL with an http/https scheme.
  let parsed: URL | undefined;
  try {
    parsed = new URL(settings.baseUrl.trim());
  } catch {
    parsed = undefined;
  }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    errors.baseUrl = 'Base URL 必须是合法的 http(s):// 地址';
  }

  if (!settings.model.trim()) {
    errors.model = 'Model ID 不能为空';
  }

  if (!AI_PROVIDERS.includes(settings.provider)) {
    errors.provider = 'Provider 必须是 openai-compatible / deepseek / claude / ollama 之一';
  }

  const { temperature } = settings;
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    errors.temperature = 'Temperature 必须在 0 ~ 2 之间';
  }

  const { maxTurnsPerTopic } = settings;
  if (
    !Number.isInteger(maxTurnsPerTopic) ||
    maxTurnsPerTopic < MIN_TURNS_PER_TOPIC ||
    maxTurnsPerTopic > MAX_TURNS_PER_TOPIC
  ) {
    errors.maxTurnsPerTopic = `轮数配额必须是 ${MIN_TURNS_PER_TOPIC} ~ ${MAX_TURNS_PER_TOPIC} 之间的整数`;
  }

  // ADR 0008: plaintext storage is local-only; ollama runs keyless.
  if (settings.provider !== 'ollama' && !settings.apiKey.trim()) {
    errors.apiKey = 'API Key 不能为空';
  }

  return errors;
}
