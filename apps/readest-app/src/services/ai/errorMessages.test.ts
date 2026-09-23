import { describe, expect, it } from 'vitest';
import { describeAIError, type AIErrorKind } from './errorMessages';

/**
 * `APICallError` 的结构替身：本模块刻意不 import AI SDK（理由见实现文件），
 * 所以测试也用它真正依赖的那几个字段来造错误对象。
 */
const apiError = (statusCode: number, responseBody?: string, message = 'boom') => ({
  name: 'AI_APICallError',
  message,
  statusCode,
  responseBody,
  isRetryable: false,
});

const kinds = (err: unknown): AIErrorKind => describeAIError(err).kind;
const text = (err: unknown): string => describeAIError(err).message;

describe('describeAIError — 类别', () => {
  it('401 / 403 → auth (Key 无效或无权限)', () => {
    expect(kinds(apiError(401, '{"error":{"message":"Incorrect API key provided"}}'))).toBe('auth');
    expect(kinds(apiError(403))).toBe('auth');
    expect(text(apiError(401))).toContain('API Key');
    expect(text(apiError(401))).toContain('AI 设置');
  });

  it('429 与 402 → rate-limit', () => {
    expect(kinds(apiError(429, '{"error":{"message":"Rate limit reached"}}'))).toBe('rate-limit');
    expect(kinds(apiError(402))).toBe('rate-limit');
    expect(text(apiError(429))).toContain('额度');
  });

  it('非 429 的状态码只要正文提到余额/配额，也归 rate-limit', () => {
    expect(kinds(apiError(400, '{"error":{"message":"Insufficient Balance"}}'))).toBe('rate-limit');
    expect(kinds(apiError(400, '{"error":{"message":"You exceeded your current quota"}}'))).toBe(
      'rate-limit',
    );
    expect(kinds(apiError(400, '账户余额不足'))).toBe('rate-limit');
  });

  it('404、model_not_found、以及“model does not exist” → model-not-found', () => {
    expect(kinds(apiError(404, '{"error":{"message":"Not Found"}}'))).toBe('model-not-found');
    expect(kinds(apiError(400, '{"error":{"message":"model_not_found"}}'))).toBe('model-not-found');
    expect(
      kinds(apiError(400, '{"error":{"message":"The model `gpt-9` does not exist"}}')),
    ).toBe('model-not-found');
    expect(text(apiError(404))).toContain('Model ID');
  });

  it('上下文超长 → context-too-long (400 家族的长度措辞)', () => {
    expect(
      kinds(
        apiError(
          400,
          '{"error":{"message":"This model\'s maximum context length is 8192 tokens"}}',
        ),
      ),
    ).toBe('context-too-long');
    expect(
      kinds(apiError(400, '{"error":{"message":"Please reduce the length of the messages"}}')),
    ).toBe('context-too-long');
    expect(text(apiError(400, '{"error":{"message":"too many tokens"}}'))).toContain('上下文');
  });

  it('5xx → server', () => {
    expect(kinds(apiError(500))).toBe('server');
    expect(kinds(apiError(503, '{"error":{"message":"Service Unavailable"}}'))).toBe('server');
    expect(text(apiError(502))).toContain('服务端');
  });

  it('其余 4xx（请求本身不合法）落 unknown，并保留原始原因', () => {
    const described = describeAIError(apiError(400, '{"error":{"message":"messages: at least one"}}'));
    expect(described.kind).toBe('unknown');
    expect(described.message).toContain('messages: at least one');
  });
});

describe('describeAIError — 传输层', () => {
  it('fetch 的 TypeError: Failed to fetch → network', () => {
    const err = new TypeError('Failed to fetch');
    expect(kinds(err)).toBe('network');
    expect(text(err)).toContain('网络');
  });

  it('Safari 的 Load failed / undici 的 fetch failed / ECONNREFUSED → network', () => {
    expect(kinds(new TypeError('Load failed'))).toBe('network');
    expect(kinds(new Error('fetch failed'))).toBe('network');
    expect(kinds(new Error('connect ECONNREFUSED 127.0.0.1:11434'))).toBe('network');
    expect(kinds(new Error('provider unreachable'))).toBe('network');
  });

  it('超时（TimeoutError / timed out / 超时）单独给一句超时文案', () => {
    const timeout = Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
    expect(kinds(timeout)).toBe('network');
    expect(text(timeout)).toContain('超时');
    expect(text(new Error('request timed out after 30000ms'))).toContain('超时');
  });

  it('带状态码的错误不会被当成传输失败', () => {
    expect(kinds(apiError(500, '{"error":{"message":"fetch failed"}}'))).toBe('server');
  });
});

describe('describeAIError — 字符串与未知', () => {
  it('普通字符串走同一套规则', () => {
    expect(kinds('boom: rate limited')).toBe('rate-limit');
    expect(kinds('连接失败')).toBe('network');
    expect(kinds('The model `deepseek-x` does not exist')).toBe('model-not-found');
  });

  it('认不出来的错误保留一句原始原因', () => {
    const described = describeAIError(new Error('E_WEIRD_THING'));
    expect(described.kind).toBe('unknown');
    expect(described.message).toContain('E_WEIRD_THING');
    expect(described.message).toContain('原始信息');
  });

  it('原始原因压成一行并截断，不把整页 body 贴进侧栏', () => {
    const long = `first line\nsecond line ${'x'.repeat(400)}`;
    const described = describeAIError(new Error(long));
    expect(described.message).not.toContain('\n');
    expect(described.message.length).toBeLessThan(220);
    expect(described.message.endsWith('…')).toBe(false); // 截断即可，不额外加省略号
  });

  it('空输入与怪输入不抛错', () => {
    expect(kinds(undefined)).toBe('unknown');
    expect(kinds(null)).toBe('unknown');
    expect(kinds(42)).toBe('unknown');
    expect(kinds({})).toBe('unknown');
    expect(kinds({ responseBody: '{"error":null}' })).toBe('unknown');
    expect(kinds({ responseBody: '<html>502 Bad Gateway</html>' })).toBe('unknown');
  });

  it('没有原因可留时，不给未知文案加空括号', () => {
    expect(text(undefined)).not.toContain('原始信息');
    expect(text(undefined)).toBe('AI 请求失败，请稍后重试。');
  });
});

describe('describeAIError — 文案卫生', () => {
  it('已知类别绝不回显上游的英文原文', () => {
    const cases: Array<[unknown, string]> = [
      [apiError(401, '{"error":{"message":"Incorrect API key provided: sk-***"}}'), 'Incorrect API key'],
      [new TypeError('Failed to fetch'), 'Failed to fetch'],
      [apiError(404, '{"error":{"message":"model_not_found"}}'), 'model_not_found'],
    ];
    for (const [error, leaked] of cases) {
      const described = describeAIError(error);
      expect(described.kind).not.toBe('unknown');
      expect(described.message).not.toContain(leaked);
    }
  });

  it('只在已知类别里取值——类别集合是封闭的', () => {
    const allowed: AIErrorKind[] = [
      'network',
      'auth',
      'rate-limit',
      'model-not-found',
      'context-too-long',
      'server',
      'unknown',
    ];
    for (const error of [apiError(401), apiError(429), new TypeError('Failed to fetch'), 'x']) {
      expect(allowed).toContain(describeAIError(error).kind);
    }
  });
});
