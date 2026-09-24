/**
 * Selection quick actions (ticket 04, ADR 0007; UI wiring lands in
 * ticket 05). Each action turns the reader's current selection into a chat
 * turn, except `ask` which only fills the quote into the composer and lets the
 * user type their own question.
 *
 * The selection is **never** baked into the instruction: it travels as
 * `quoteText`, which already reaches the model twice by design (L0 block in the
 * system prompt, `> 原文` directly above the question in the user turn) and
 * already renders as its own quote block above the bubble. Copying it into the
 * instruction too made the model read the same passage twice and put the same
 * text on screen twice — the 「引用了一遍，气泡里又显示一遍」 redundancy.
 */
export type QuickAction = 'explain' | 'translate' | 'summarize' | 'ask';

export interface QuickActionPrompt {
  displayLabel: string;
  /** The instruction alone; the quoted原文 is carried by `quoteText`. */
  instruction: string;
}

export function buildQuickActionPrompt(action: QuickAction): QuickActionPrompt {
  switch (action) {
    case 'explain':
      return { displayLabel: '解释', instruction: '请解释下面这段文字的背景与含义。' };
    case 'translate':
      return {
        displayLabel: '翻译',
        instruction: '请将下面这段文字翻译成中文（若原文为中文则翻译成英文），并附简要注释。',
      };
    case 'summarize':
      return { displayLabel: '提炼', instruction: '请提炼下面这段文字的要点，用简洁的编号列表输出。' };
    case 'ask':
      // 追问 only pre-fills the quote; the question itself stays with the user.
      return { displayLabel: '追问', instruction: '' };
  }
}
