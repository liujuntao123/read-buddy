import { describe, expect, it } from 'vitest';
import {
  MAP_SYSTEM_PROMPT,
  SUMMARY_HEADING_CORE,
  SUMMARY_HEADING_OUTLINE,
  SUMMARY_HEADING_TERMS,
  SUMMARY_SYSTEM_PROMPT,
  THREE_PART_TEMPLATE,
  buildMapPrompt,
  buildReducePrompt,
  buildSinglePassPrompt,
} from './prompts';

const INPUT = { bookTitle: '迷雾之城（演示书）', chapterTitle: '第二章 图书馆的密语' };

describe('THREE_PART_TEMPLATE', () => {
  it('contains exactly the three mandated section headings in order', () => {
    const headings = [SUMMARY_HEADING_CORE, SUMMARY_HEADING_OUTLINE, SUMMARY_HEADING_TERMS];
    headings.forEach((heading) => expect(THREE_PART_TEMPLATE).toContain(heading));
    const positions = headings.map((heading) => THREE_PART_TEMPLATE.indexOf(heading));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('specifies the numbered outline list and the term list shapes', () => {
    expect(THREE_PART_TEMPLATE).toContain('1. **[阶段/论点一]**：');
    expect(THREE_PART_TEMPLATE).toContain('- **[概念/术语名]**：');
  });
});

describe('buildSinglePassPrompt', () => {
  it('embeds book title, chapter title, the full text and the three-part rule', () => {
    const text = '图书馆的木门在她身后合上时，穹顶上的星图亮了起来。';
    const prompt = buildSinglePassPrompt({ ...INPUT, text });

    expect(prompt).toContain('《迷雾之城（演示书）》');
    expect(prompt).toContain('「第二章 图书馆的密语」');
    expect(prompt).toContain(text);
    expect(prompt).toContain(SUMMARY_HEADING_CORE);
    expect(prompt).toContain(SUMMARY_HEADING_OUTLINE);
    expect(prompt).toContain(SUMMARY_HEADING_TERMS);
  });

  it('truncates oversized text with the explicit marker instead of overflowing', () => {
    const text = '夜'.repeat(13_000);
    const prompt = buildSinglePassPrompt({ ...INPUT, text });

    expect(prompt).toContain('已截断：原文共 13000 字，此处仅保留前 12000 字');
    expect(prompt.length).toBeLessThan(text.length + 500);
  });
});

describe('buildMapPrompt', () => {
  it('describes the chunk position and embeds the chunk without the three-part rule', () => {
    const chunk = '长夜第1节：守夜人发现星图移动了位置。';
    const prompt = buildMapPrompt({ ...INPUT, chunk, index: 1, total: 2 });

    expect(prompt).toContain('《迷雾之城（演示书）》');
    expect(prompt).toContain('「第二章 图书馆的密语」');
    expect(prompt).toContain('第 1/2 个片段');
    expect(prompt).toContain(chunk);
    expect(prompt).toContain('不需要三段式结构');
    expect(prompt).not.toContain(SUMMARY_HEADING_CORE);
    expect(prompt).not.toContain(SUMMARY_HEADING_TERMS);
  });
});

describe('buildReducePrompt', () => {
  it('merges every sub-summary and re-imposes the three-part structure', () => {
    const subSummaries = ['- 守夜人发现星图移动', '林晚得到父亲的手稿线索'];
    const prompt = buildReducePrompt({ ...INPUT, subSummaries });

    expect(prompt).toContain('《迷雾之城（演示书）》');
    expect(prompt).toContain('「第二章 图书馆的密语」');
    expect(prompt).toContain('【片段 1 要点】');
    expect(prompt).toContain('- 守夜人发现星图移动');
    expect(prompt).toContain('【片段 2 要点】');
    expect(prompt).toContain('林晚得到父亲的手稿线索');
    expect(prompt).toContain(SUMMARY_HEADING_CORE);
    expect(prompt).toContain(SUMMARY_HEADING_OUTLINE);
    expect(prompt).toContain(SUMMARY_HEADING_TERMS);
  });

  it('handles an empty sub-summary list without throwing', () => {
    const prompt = buildReducePrompt({ ...INPUT, subSummaries: [] });
    expect(prompt).toContain('【各片段要点】');
  });
});

describe('system prompts', () => {
  it('are non-empty and role-scoped', () => {
    expect(SUMMARY_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(MAP_SYSTEM_PROMPT).toContain('分块提炼');
  });
});
