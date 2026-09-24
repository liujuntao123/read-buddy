import type { AISettings } from '@/types/ai';
import { modelsEndpointHeaders, modelsEndpointUrl } from './modelsEndpoint';

export interface ListModelsResult {
  ok: boolean;
  /** Model ids as the endpoint reported them, deduplicated and sorted. */
  models: string[];
  message: string;
}

/** Abort the pull after 15s: some gateways fan out to several upstreams. */
const LIST_MODELS_TIMEOUT_MS = 15_000;

/**
 * Reads the model ids a configured endpoint advertises (`GET {baseUrl}/models`).
 *
 * The reader is not expected to remember model ids, so the settings center can
 * offer what the endpoint actually serves — while the Model ID field stays a
 * plain text input, because gateways routinely expose models the list does not
 * mention (and vice versa). Parsing is tolerant on purpose: the OpenAI shape is
 * `{ data: [{ id }] }`, but self-hosted gateways also answer with a bare array,
 * with `{ models: [...] }`, or with `id`-less objects keyed by `name`/`model`.
 */
export async function listModels(
  settings: AISettings,
  fetchImpl: typeof fetch = fetch,
): Promise<ListModelsResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIST_MODELS_TIMEOUT_MS);

  try {
    const response = await fetchImpl(modelsEndpointUrl(settings), {
      method: 'GET',
      headers: modelsEndpointHeaders(settings),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, models: [], message: 'API Key 无效或未授权' };
    }
    if (response.status === 404) {
      return { ok: false, models: [], message: 'Base URL 不正确或服务不存在' };
    }
    if (response.status !== 200) {
      return { ok: false, models: [], message: `服务返回异常状态码：${response.status}` };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, models: [], message: '模型列表响应不是合法的 JSON' };
    }

    const models = extractModelIds(payload);
    if (models.length === 0) {
      return { ok: false, models: [], message: '连接成功，但服务未返回任何模型' };
    }
    return { ok: true, models, message: `已拉取 ${models.length} 个模型，可在下方选择` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, models: [], message: `拉取模型列表失败：${reason}` };
  } finally {
    clearTimeout(timeout);
  }
}

/** Pulls every plausible model id out of an unknown `/models` body. */
function extractModelIds(payload: unknown): string[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload)
      ? firstArray(payload.data) ?? firstArray(payload.models) ?? firstArray(payload.result)
      : undefined;
  if (!rows) return [];

  const ids = new Set<string>();
  for (const row of rows) {
    const id = typeof row === 'string' ? row : pickId(row);
    if (id) ids.add(id);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function pickId(row: unknown): string {
  if (!isRecord(row)) return '';
  for (const key of ['id', 'name', 'model']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function firstArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
