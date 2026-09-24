/**
 * AI 错误分类与文案——docs/architecture.md「错误分类」的唯一实现。
 *
 * 模型调用失败时，SDK 交出来的是一段面向开发者的英文文本（HTTP 状态码藏在
 * `APICallError.statusCode`、供应商的 JSON 藏在 `responseBody`），直接渲染到
 * 侧栏等于把堆栈递给读者。这里把它压成**一个类别 + 一句中文**：
 *
 *   网络不通 / Key 无效 / 限流或余额不足 / 模型不存在 / 上下文超长 / 服务端 / 未知
 *
 * 类别（`kind`）与文案分开，是因为两者的消费者不同：文案给读者看，类别给界面判断
 * 「该给哪个动作」（Key、模型、网络这三类尤其要把人送到 AI 设置）。
 *
 * 两个刻意的取舍：
 *
 * 1. **不导入 AI SDK。** 判定只做结构识别（`statusCode` / `responseBody` /
 *    `name`），与 `providerReadiness` 同样的理由：store 与组件测试都要引用本模块，
 *    一旦 import 'ai'，每个测试都会被拖进 SDK 的模块加载。结构识别也顺带覆盖了
 *    fetch 直接抛出的错误与测试里的普通对象。
 * 2. **未知类保留原始原因（括号内）。** 分类漏掉的错误恰恰是最需要线索的那些：
 *    只留一句「请求失败」会让读者和我们都无从下手。原始原因取 JSON body 里的
 *    `error.message`（再退到 `message` 字段），压成一行并截断——够定位，不够刷屏。
 */

export type AIErrorKind =
  | 'network'
  | 'auth'
  | 'rate-limit'
  | 'model-not-found'
  | 'context-too-long'
  | 'server'
  | 'unknown';

export interface AIErrorDescription {
  kind: AIErrorKind;
  /** 面向读者的中文文案；已知类别里绝不出现上游的原始英文文本。 */
  message: string;
}

/* ------------------------------------------------------------------ 文案 */

const NETWORK_MESSAGE = '网络连接失败，请检查网络后重试。';
const NETWORK_TIMEOUT_MESSAGE = '连接 AI 服务超时，请检查网络后重试。';
const AUTH_MESSAGE = 'API Key 无效或没有访问权限，请在 AI 设置中检查。';
const RATE_LIMIT_MESSAGE = '请求过于频繁或账户额度不足，请稍后重试，并检查账户余额。';
const MODEL_MESSAGE = '模型不存在或无权访问，请在 AI 设置中检查 Model ID。';
const CONTEXT_TOO_LONG_MESSAGE = '内容超出模型的上下文长度上限，请缩短内容或改用上下文更长的模型。';
const SERVER_MESSAGE = 'AI 服务端暂时不可用（服务端错误），请稍后重试。';
const UNKNOWN_MESSAGE = 'AI 请求失败，请稍后重试。';

/** 未知类的原始原因最多保留这么多字符——够定位，不至于把整页 body 贴出来。 */
const REASON_MAX_CHARS = 120;

/* ------------------------------------------------------------ 结构识别 */

interface RawFacts {
  /** `APICallError.statusCode`；`status` 是给裸 fetch 响应对象留的别名。 */
  statusCode?: number;
  responseBody?: string;
  /** Error.name（TimeoutError / AbortError …）。 */
  name?: string;
  /** 原始错误文本：Error.message 或字符串本身。 */
  text: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const numberOrUndefined = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

const messageOf = (err: unknown): string => {
  if (typeof err === 'string') return err;
  const record = asRecord(err);
  if (record) return stringOrUndefined(record.message) ?? '';
  return err === undefined || err === null ? '' : String(err);
};

const readFacts = (err: unknown): RawFacts => {
  const record = asRecord(err);
  return {
    statusCode: numberOrUndefined(record?.statusCode) ?? numberOrUndefined(record?.status),
    responseBody: stringOrUndefined(record?.responseBody),
    name: stringOrUndefined(record?.name),
    text: messageOf(err),
  };
};

/* ---------------------------------------------------------------- 规则 */

/** 请求根本没到达服务：DNS / 连接被拒 / 离线 / 代理层报错。 */
const NETWORK_PATTERN =
  /failed to fetch|networkerror|network error|load failed|fetch failed|econnrefused|econnreset|enotfound|socket hang up|net::err|unreachable|connection refused|连接失败|网络/i;

const TIMEOUT_PATTERN = /timeout|timed out|etimedout|超时/i;

/** 供应商在 body 里说额度：429/402 之外，有的网关用 400 表示欠费。 */
const QUOTA_PATTERN =
  /insufficient_quota|insufficient balance|exceeded your current quota|quota exceeded|out of credit|no credits|billing|余额|额度|欠费/i;

/** 没有状态码时的限流措辞（我们自己包装过的错误、代理层的纯文本提示）。 */
const RATE_LIMIT_PATTERN = /rate limit|rate-limit|too many requests|限流|请求过于频繁|请求频率/i;

const MODEL_NOT_FOUND_PATTERN =
  /model_not_found|model not found|no such model|unknown model|invalid model|模型不存在|找不到模型/i;

/** OpenAI 的 404 文案是 “The model `x` does not exist”，模型名不一定带 "model" 前缀。 */
const MODEL_MISSING_PATTERN = /does not exist|not exist|不存在/i;

const LENGTH_PATTERN =
  /context[_ ]length|context window|maximum context|too many tokens|token limit|reduce the length|maximum number of tokens|上下文|长度上限/i;

const isModelMissing = (haystack: string): boolean =>
  MODEL_NOT_FOUND_PATTERN.test(haystack) ||
  (/\bmodel\b/i.test(haystack) && MODEL_MISSING_PATTERN.test(haystack));

/** 「原始信息」：body 里的 error.message 优先，其次 body / message 原文。 */
const extractBodyMessage = (body: string | undefined): string => {
  if (!body) return '';
  try {
    const parsed = asRecord(JSON.parse(body) as unknown);
    const error = asRecord(parsed?.error);
    return stringOrUndefined(error?.message) ?? stringOrUndefined(parsed?.message) ?? '';
  } catch {
    // 不是 JSON：body 本身就是线索（HTML 错误页、纯文本提示）。
    return '';
  }
};

const toReason = ({ text, responseBody }: RawFacts): string => {
  const raw = extractBodyMessage(responseBody) || text || responseBody || '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, REASON_MAX_CHARS);
};

/* ------------------------------------------------------------- 入口 */

/**
 * 原始错误 → `{ kind, message }`。纯函数：不读 store、不碰网络、不 import SDK。
 */
export function describeAIError(err: unknown): AIErrorDescription {
  const facts = readFacts(err);
  const status = facts.statusCode;
  const haystack = `${facts.text}\n${facts.responseBody ?? ''}`;

  // 1. 传输层：没有状态码，说明请求没能走完。超时单独给一句（读者能做的事一样，
  //    但「超时」比「连接失败」更贴近他刚才看到的现象）。
  if (status === undefined) {
    const timeout = facts.name === 'TimeoutError' || TIMEOUT_PATTERN.test(haystack);
    if (timeout) return { kind: 'network', message: NETWORK_TIMEOUT_MESSAGE };
    if (NETWORK_PATTERN.test(haystack)) return { kind: 'network', message: NETWORK_MESSAGE };
  }

  // 2. 身份：401 / 403。Key 的问题只能去设置里解决，所以类别要让界面知道。
  if (status === 401 || status === 403) return { kind: 'auth', message: AUTH_MESSAGE };

  // 3. 限流与余额：状态码 (402 / 429) 或正文里的限流/额度措辞。余额不足在语义上
  //    是配额问题（docs/architecture.md 的「配额用尽/429」是一条），所以归同一类。
  if (
    status === 402 ||
    status === 429 ||
    QUOTA_PATTERN.test(haystack) ||
    RATE_LIMIT_PATTERN.test(haystack)
  ) {
    return { kind: 'rate-limit', message: RATE_LIMIT_MESSAGE };
  }

  // 4. 模型不存在：404，或 body 明说 model 不存在（网关常用 400）。
  if (status === 404 || isModelMissing(haystack)) {
    return { kind: 'model-not-found', message: MODEL_MESSAGE };
  }

  // 5. 上下文超长：400 家族的正文长度问题。
  if (LENGTH_PATTERN.test(haystack)) {
    return { kind: 'context-too-long', message: CONTEXT_TOO_LONG_MESSAGE };
  }

  // 6. 服务端：5xx。
  if (status !== undefined && status >= 500) return { kind: 'server', message: SERVER_MESSAGE };

  // 7. 其余 4xx（请求本身不合法）与认不出来的错误：保留一句原始原因。
  return { kind: 'unknown', message: withReason(UNKNOWN_MESSAGE, toReason(facts)) };
}

/** 未知类的文案带括号原因；没有原因就不加括号，不留一个空壳。 */
function withReason(base: string, reason: string): string {
  return reason ? `${base}（原始信息：${reason}）` : base;
}
