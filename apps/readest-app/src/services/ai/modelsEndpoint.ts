/**
 * The one raw-HTTP description of the OpenAI-compatible models endpoint.
 *
 * Two features speak it — `testConnection` (连通性探测) and `listModels`
 * (拉取模型列表). They must agree on URL normalisation and on when the
 * `Authorization` header is attached, otherwise "测试连接成功" and "拉取失败"
 * become possible at the same time, which is exactly the confusing state a
 * settings panel must not produce.
 */
import type { AISettings } from '@/types/ai';

/** Trailing-slash-free Base URL, the identity a fetched model list belongs to. */
export const normalizeBaseUrl = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, '');

/** `GET {baseUrl}/models`, with the trailing slash normalised away. */
export const modelsEndpointUrl = (settings: AISettings): string =>
  `${normalizeBaseUrl(settings.baseUrl)}/models`;

/**
 * Bearer auth is sent whenever a key is present; an unconfigured endpoint is
 * still probeable (that is what 测试连接 is for), so a blank key yields no
 * header rather than an `Authorization: Bearer `.
 */
export const modelsEndpointHeaders = (settings: AISettings): Record<string, string> =>
  settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {};
