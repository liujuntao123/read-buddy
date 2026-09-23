/**
 * AI Provider 就绪判定——唯一出处。
 *
 * 「配好了没有」曾经有三份定义：`validation.ts`（表单保存）与 `summaryStore`
 * 各自豁免了 Ollama，而 `bookIndexStore` 只看 `apiKey`，于是无 Key 的本地
 * 服务会静默跳过全书画像与微大纲，且没有任何界面提示。
 *
 * 这里把它收成一张 provider 表（`AI_PROVIDERS`）加一个判定函数
 * （`providerReady`）。Ollama 选项下线后，「无 Key 也能用」的例外随之消失：
 * 现在**每个** provider 都需要一个非空 API Key，判定只剩一条规则。保留
 * `providerReady` 而非让调用方直接看 `apiKey`，是因为表单校验、总结、
 * 伴读索引三处必须始终一致。
 *
 * 本模块刻意**不导入 AI SDK**：store 与表单校验都要引用它，必须保持轻量，
 * 否则每个测试都会被拖进 SDK 的模块加载（见 `bookIndexStore` 的惰性 import）。
 */
import type { AIProvider, AISettings } from '@/types/ai';

/** Every provider the settings center offers (single source of truth). */
export const AI_PROVIDERS: readonly AIProvider[] = ['openai-compatible', 'deepseek'];

/**
 * The one readiness rule, shared by the settings form, the summary store and
 * the index pipeline: a non-blank API Key.
 */
export const providerReady = (settings: AISettings): boolean =>
  settings.apiKey.trim().length > 0;
