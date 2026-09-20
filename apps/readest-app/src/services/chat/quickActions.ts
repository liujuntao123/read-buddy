/**
 * Selection quick actions (ticket 04 design doc 4.4.3; UI wiring lands in
 * ticket 05). Each action turns the reader's current selection into a chat
 * prompt, except `ask` which only fills the quote into the input box and lets
 * the user type their own question.
 */
export type QuickAction = 'explain' | 'translate' | 'summarize' | 'ask';

export interface QuickActionPrompt {
  displayLabel: string;
  prompt: string;
}

export function buildQuickActionPrompt(action: QuickAction, selection: string): QuickActionPrompt {
  switch (action) {
    case 'explain':
      return { displayLabel: '解释', prompt: `请解释下面这段文字的背景与含义：\n\n${selection}` };
    case 'translate':
      return {
        displayLabel: '翻译',
        prompt: `请将下面这段文字翻译成中文（若原文为中文则翻译成英文），并附简要注释：\n\n${selection}`,
      };
    case 'summarize':
      return { displayLabel: '提炼', prompt: `请提炼下面这段长文字的要点，用简洁的编号列表输出：\n\n${selection}` };
    case 'ask':
      // 追问 only pre-fills the quote; the question itself stays with the user.
      return { displayLabel: '追问', prompt: '' };
  }
}
