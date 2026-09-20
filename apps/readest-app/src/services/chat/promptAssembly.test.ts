import { describe, expect, it } from 'vitest';
import type { Message } from '@/types/ai';
import { buildChatPrompt, buildSystemPrompt } from './promptAssembly';

const historyMessage = (id: number, role: 'user' | 'assistant', content: string): Message => ({
  id: `m${id}`,
  conversationId: 'c1',
  role,
  content,
  createdAt: id,
});

describe('buildSystemPrompt', () => {
  it('embeds the exact companion role sentence with a 1-based chapter ordinal', () => {
    const prompt = buildSystemPrompt({ bookTitle: '迷雾之城', chapterIndex: 2, chapterTitle: '长夜漫漫' });
    expect(prompt).toContain(
      '你是一位渊博、敏锐且富有启发性的伴读助手。当前用户正在阅读《迷雾之城》第 3 章《长夜漫漫》。',
    );
    expect(prompt).toContain('第 3 章');
  });

  it('embeds the exact anti-spoiler constraint sentence', () => {
    const prompt = buildSystemPrompt({ bookTitle: '迷雾之城', chapterIndex: 0, chapterTitle: '迷雾之城' });
    expect(prompt).toContain(
      '请主要围绕当前章节的内容展开解答与剖析。除非用户明确要求透露后续情节，否则严禁主动剧透后续章节内容。',
    );
  });
});

describe('buildChatPrompt', () => {
  it('assembles the three labelled sections around the question', () => {
    const prompt = buildChatPrompt({
      chapterText: '灯火在雾中摇曳。',
      history: [historyMessage(1, 'user', '第一章讲了什么？'), historyMessage(2, 'assistant', '讲了迷雾。')],
      userMessage: '那钟楼呢？',
    });

    expect(prompt).toContain('【本章正文】\n灯火在雾中摇曳。');
    expect(prompt).toContain('【对话历史】\n读者：第一章讲了什么？\n助手：讲了迷雾。');
    expect(prompt).toContain('【本轮提问】\n那钟楼呢？');
    expect(prompt.indexOf('【本章正文】')).toBeLessThan(prompt.indexOf('【对话历史】'));
    expect(prompt.indexOf('【对话历史】')).toBeLessThan(prompt.indexOf('【本轮提问】'));
  });

  it('includes the FULL history verbatim — 20 messages, no sliding window', () => {
    const history: Message[] = Array.from({ length: 20 }, (_, i) =>
      historyMessage(i + 1, i % 2 === 0 ? 'user' : 'assistant', i % 2 === 0 ? `读者问题${i}` : `助手回答${i}`),
    );
    const prompt = buildChatPrompt({ chapterText: '正文', history, userMessage: '最后追问' });

    for (const message of history) {
      expect(prompt).toContain(
        `${message.role === 'user' ? '读者' : '助手'}：${message.content}`,
      );
    }
    // Order preserved: first history entry before the last one.
    expect(prompt.indexOf('读者：读者问题0')).toBeLessThan(prompt.indexOf('助手：助手回答19'));
  });

  it('renders the selection quote as a `> ` block directly above the question', () => {
    const prompt = buildChatPrompt({
      chapterText: '正文',
      history: [],
      userMessage: '这是什么意思？',
      quoteText: '古老的钟楼敲响了第三声',
    });

    const questionSection = prompt.slice(prompt.indexOf('【本轮提问】'));
    expect(questionSection).toBe('【本轮提问】\n> 古老的钟楼敲响了第三声\n\n这是什么意思？');
  });

  it('truncates only the chapter text, with the explicit extractor marker', () => {
    const longChapter = 'x'.repeat(13_000);
    const prompt = buildChatPrompt({
      chapterText: longChapter,
      history: [historyMessage(1, 'user', '问题')],
      userMessage: '追问',
    });

    expect(prompt).toContain('x'.repeat(12_000));
    expect(prompt).toContain('…[已截断：原文共 13000 字，此处仅保留前 12000 字]');
    expect(prompt).not.toContain('x'.repeat(12_001));
    // The history is untouched by the chapter-text truncation.
    expect(prompt).toContain('读者：问题');
  });
});
