import { describe, expect, it, vi } from 'vitest';
import type { AISettings } from '@/types/ai';
import { testConnection } from './testConnection';

const settings = (overrides: Partial<AISettings> = {}): AISettings => ({
  provider: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  temperature: 0.6,
  maxTurnsPerTopic: 10,
  ...overrides,
});

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

const statusFetch = (status: number) => {
  const calls: RecordedCall[] = [];
  const impl: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response('{}', { status }));
  };
  return { impl, calls };
};

const headersOf = (call: RecordedCall): Record<string, string> =>
  (call.init?.headers ?? {}) as Record<string, string>;

describe('testConnection', () => {
  it('reports success on HTTP 200 and hits `${baseUrl}/models`', async () => {
    const { impl, calls } = statusFetch(200);
    const result = await testConnection(settings({ baseUrl: 'https://api.example.com/v1/' }), impl);
    expect(result).toEqual({ ok: true, message: '连接成功：模型服务可用' });
    expect(calls[0]?.url).toBe('https://api.example.com/v1/models');
    expect(calls[0]?.init?.method).toBe('GET');
  });

  it('sends an Authorization Bearer header for remote providers', async () => {
    const { impl, calls } = statusFetch(200);
    await testConnection(settings({ provider: 'deepseek', apiKey: 'sk-deep' }), impl);
    expect(headersOf(calls[0]!)).toMatchObject({ Authorization: 'Bearer sk-deep' });
  });

  it('omits the Authorization header when no key is set yet', async () => {
    const { impl, calls } = statusFetch(200);
    await testConnection(settings({ apiKey: '' }), impl);
    expect(headersOf(calls[0]!).Authorization).toBeUndefined();
  });

  it('reports invalid credentials on 401 and 403', async () => {
    for (const status of [401, 403]) {
      const { impl } = statusFetch(status);
      const result = await testConnection(settings(), impl);
      expect(result).toEqual({ ok: false, message: 'API Key 无效或未授权' });
    }
  });

  it('reports a wrong base URL on 404', async () => {
    const { impl } = statusFetch(404);
    const result = await testConnection(settings(), impl);
    expect(result).toEqual({ ok: false, message: 'Base URL 不正确或服务不存在' });
  });

  it('reports network failure when fetch rejects', async () => {
    const impl: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    const result = await testConnection(settings(), impl);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('网络连接失败：Failed to fetch');
  });

  it('aborts the request after a 10s timeout', async () => {
    vi.useFakeTimers();
    try {
      const impl: typeof fetch = (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
        });
      const pending = testConnection(settings(), impl);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.message).toContain('网络连接失败');
    } finally {
      vi.useRealTimers();
    }
  });
});
