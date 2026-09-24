import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './promptAssembly';

/**
 * The degraded (no node model) system prompt. The `buildChatPrompt` suite that
 * used to live here was asserting a builder with **no production caller**; its
 * assertions (full verbatim history, quote block, truncation marker) moved to
 * `agentOrchestrator.test.ts`, where the live user-turn builder runs.
 */
describe('buildSystemPrompt', () => {
  it('names the current node level from the shared vocabulary', () => {
    const prompt = buildSystemPrompt({
      bookTitle: '迷雾之城',
      nodeTitle: '长夜漫漫',
      nodeKind: 'chapter',
    });
    expect(prompt).toContain('当前用户正在阅读《迷雾之城》的章「长夜漫漫」');
    expect(prompt).toContain('请围绕当前章的内容展开解答与剖析。');
  });

  it('renders a 节 viewpoint with the 节 level word', () => {
    const prompt = buildSystemPrompt({
      bookTitle: '迷雾之城',
      nodeTitle: '第三节 雾中钟楼',
      nodeKind: 'section',
    });
    expect(prompt).toContain('当前用户正在阅读《迷雾之城》的节「第三节 雾中钟楼」');
    expect(prompt).toContain('请围绕当前节的内容展开解答与剖析。');
  });

  it('renders a 段 viewpoint for a structureless book and contains no spoiler constraints', () => {
    const prompt = buildSystemPrompt({
      bookTitle: '迷雾之城',
      nodeTitle: '第 3/12 部分',
      nodeKind: 'chunk',
    });
    expect(prompt).toContain('当前用户正在阅读《迷雾之城》的段「第 3/12 部分」');
    expect(prompt).toContain('请围绕当前段的内容展开解答与剖析。');
    expect(prompt).not.toContain('剧透');
  });

  it('never falls back to a generic 节点 wording — the level word is always known', () => {
    for (const nodeKind of ['chapter', 'section', 'chunk'] as const) {
      const prompt = buildSystemPrompt({ bookTitle: 'B', nodeTitle: 'T', nodeKind });
      expect(prompt).not.toContain('节点《');
    }
  });
});
