import { describe, expect, it } from 'vitest';
import { buildQuickActionPrompt } from './quickActions';

describe('buildQuickActionPrompt', () => {
  it('explain: 只给指令，原文由 quoteText 承载', () => {
    expect(buildQuickActionPrompt('explain')).toEqual({
      displayLabel: '解释',
      instruction: '请解释下面这段文字的背景与含义。',
    });
  });

  it('translate: 双向翻译并附简要注释', () => {
    expect(buildQuickActionPrompt('translate')).toEqual({
      displayLabel: '翻译',
      instruction: '请将下面这段文字翻译成中文（若原文为中文则翻译成英文），并附简要注释。',
    });
  });

  it('summarize: 编号列表提炼要点', () => {
    expect(buildQuickActionPrompt('summarize')).toEqual({
      displayLabel: '提炼',
      instruction: '请提炼下面这段文字的要点，用简洁的编号列表输出。',
    });
  });

  it('ask: 只填引用，不预设问题', () => {
    expect(buildQuickActionPrompt('ask')).toEqual({ displayLabel: '追问', instruction: '' });
  });

  it('每条指令都不含被划选的原文（引用只出现一次）', () => {
    const selection = '这座城市的雾从来不是为了遮住什么。';
    for (const action of ['explain', 'translate', 'summarize'] as const) {
      expect(buildQuickActionPrompt(action).instruction).not.toContain(selection);
    }
  });
});
