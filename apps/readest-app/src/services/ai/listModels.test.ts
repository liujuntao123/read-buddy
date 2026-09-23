import { describe, expect, it, vi } from 'vitest';
import type { AISettings } from '@/types/ai';
import { listModels } from './listModels';

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

const jsonFetch = (body: unknown, status = 200) => {
  const calls: RecordedCall[] = [];
  const impl: typeof fetch = (input, init) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { impl, calls };
};

const headersOf = (call: RecordedCall): Record<string, string> =>
  (call.init?.headers ?? {}) as Record<string, string>;

describe('listModels', () => {
  it('reads the OpenAI shape, hitting `${baseUrl}/models` with the bearer key', async () => {
    const { impl, calls } = jsonFetch({
      object: 'list',
      data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'a-model' }],
    });

    const result = await listModels(settings({ baseUrl: 'https://api.example.com/v1/' }), impl);

    expect(result).toEqual({
      ok: true,
      models: ['a-model', 'b-model'],
      message: '已拉取 2 个模型，可在下方选择',
    });
    expect(calls[0]?.url).toBe('https://api.example.com/v1/models');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(headersOf(calls[0]!)).toMatchObject({ Authorization: 'Bearer sk-test' });
  });

  it('accepts the other shapes self-hosted gateways answer with', async () => {
    await expect(listModels(settings(), jsonFetch(['m1', 'm2']).impl)).resolves.toMatchObject({
      ok: true,
      models: ['m1', 'm2'],
    });
    await expect(
      listModels(settings(), jsonFetch({ models: [{ name: 'named-model' }] }).impl),
    ).resolves.toMatchObject({ ok: true, models: ['named-model'] });
    await expect(
      listModels(settings(), jsonFetch({ data: [{ model: 'keyed-model' }] }).impl),
    ).resolves.toMatchObject({ ok: true, models: ['keyed-model'] });
  });

  it('omits the Authorization header while the key is still blank', async () => {
    const { impl, calls } = jsonFetch({ data: [{ id: 'm' }] });
    await listModels(settings({ apiKey: '' }), impl);
    expect(headersOf(calls[0]!).Authorization).toBeUndefined();
  });

  it('maps status codes onto the messages the connection probe already uses', async () => {
    for (const status of [401, 403]) {
      await expect(listModels(settings(), jsonFetch({}, status).impl)).resolves.toMatchObject({
        ok: false,
        models: [],
        message: 'API Key 无效或未授权',
      });
    }
    await expect(listModels(settings(), jsonFetch({}, 404).impl)).resolves.toMatchObject({
      ok: false,
      message: 'Base URL 不正确或服务不存在',
    });
    await expect(listModels(settings(), jsonFetch({}, 500).impl)).resolves.toMatchObject({
      ok: false,
      message: '服务返回异常状态码：500',
    });
  });

  it('reports malformed and empty payloads rather than an empty picker', async () => {
    const notJson: typeof fetch = () => Promise.resolve(new Response('nope', { status: 200 }));
    await expect(listModels(settings(), notJson)).resolves.toMatchObject({
      ok: false,
      models: [],
      message: '模型列表响应不是合法的 JSON',
    });
    await expect(listModels(settings(), jsonFetch({ data: [] }).impl)).resolves.toMatchObject({
      ok: false,
      models: [],
      message: '连接成功，但服务未返回任何模型',
    });
  });

  it('reports network failure when fetch rejects', async () => {
    const impl: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    const result = await listModels(settings(), impl);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('拉取模型列表失败：Failed to fetch');
  });

  it('aborts the request after its timeout', async () => {
    vi.useFakeTimers();
    try {
      const impl: typeof fetch = (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
        });
      const pending = listModels(settings(), impl);
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;
      expect(result.ok).toBe(false);
      expect(result.message).toContain('拉取模型列表失败');
    } finally {
      vi.useRealTimers();
    }
  });
});
