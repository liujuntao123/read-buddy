import { describe, expect, it } from 'vitest';
import { buildQuickActionPrompt } from './quickActions';

const SELECTION = '这座城市的雾从来不是为了遮住什么，而是为了让人习惯看不见。';

describe('buildQuickActionPrompt', () => {
  it('explain: 解析背景与含义并附上原文', () => {
    expect(buildQuickActionPrompt('explain', SELECTION)).toEqual({
      displayLabel: '解释',
      prompt: `请解释下面这段文字的背景与含义：\n\n${SELECTION}`,
    });
  });

  it('translate: 双向翻译并附简要注释', () => {
    expect(buildQuickActionPrompt('translate', SELECTION)).toEqual({
      displayLabel: '翻译',
      prompt: `请将下面这段文字翻译成中文（若原文为中文则翻译成英文），并附简要注释：\n\n${SELECTION}`,
    });
  });

  it('summarize: 编号列表提炼要点', () => {
    expect(buildQuickActionPrompt('summarize', SELECTION)).toEqual({
      displayLabel: '提炼',
      prompt: `请提炼下面这段长文字的要点，用简洁的编号列表输出：\n\n${SELECTION}`,
    });
  });

  it('ask: 只填引用，不预设问题', () => {
    expect(buildQuickActionPrompt('ask', SELECTION)).toEqual({ displayLabel: '追问', prompt: '' });
  });
});
