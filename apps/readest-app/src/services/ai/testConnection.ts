import type { AISettings } from '@/types/ai';
import { modelsEndpointHeaders, modelsEndpointUrl } from './modelsEndpoint';

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}

/** Abort the probe after 10s so a dead endpoint cannot hang the UI. */
const TEST_CONNECTION_TIMEOUT_MS = 10_000;

/**
 * Lightweight OpenAI-compatible health probe: `GET {baseUrl}/models`
 * (design doc 4.1 "健康检测"). The fetch implementation is injectable so
 * unit tests never touch the real network.
 */
export async function testConnection(
  settings: AISettings,
  fetchImpl: typeof fetch = fetch,
): Promise<TestConnectionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_CONNECTION_TIMEOUT_MS);

  try {
    const response = await fetchImpl(modelsEndpointUrl(settings), {
      method: 'GET',
      headers: modelsEndpointHeaders(settings),
      signal: controller.signal,
    });
    if (response.status === 200) {
      return { ok: true, message: '连接成功：模型服务可用' };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'API Key 无效或未授权' };
    }
    if (response.status === 404) {
      return { ok: false, message: 'Base URL 不正确或服务不存在' };
    }
    return { ok: false, message: `服务返回异常状态码：${response.status}` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `网络连接失败：${reason}` };
  } finally {
    clearTimeout(timeout);
  }
}
