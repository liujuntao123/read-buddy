import { describe, expect, it } from 'vitest';
import {
  PANORAMA_HEAD_CHARS,
  buildPanoramaPrompt,
  createPanoramaGenerator,
  extractJsonObject,
} from './panoramaGenerator';
import { BookPanoramaRepository } from '@/services/db/repositories';
import { ReadestPlusDatabase } from '@/services/db/database';
import { DEFAULT_AI_SETTINGS } from '@/types/ai';
import type { StreamTextFn } from '@/services/ai/streamClient';

const INPUT = {
  bookHash: 'pano-book',
  bookTitle: '灯塔之夜',
  nodes: [
    { title: '第一章 起源', depth: 0 },
    { title: '第二章 转折', depth: 0 },
    { title: '第三章 远航', depth: 0 },
  ],
  fullText: '灯塔守夜人的独白开篇……'.repeat(400),
};

describe('extractJsonObject', () => {
  it('parses bare JSON objects', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses fenced JSON with surrounding prose', () => {
    const raw = '好的，以下是画像：\n```json\n{"genre":"科幻","summary":"概要"}\n```\n希望有帮助';
    expect(extractJsonObject(raw)).toEqual({ genre: '科幻', summary: '概要' });
  });

  it('parses the first balanced object and ignores trailing braces', () => {
    const raw = '{"summary":"正文}包含花括号","worldSetting":"海岛"}多余文字 {"other":true}';
    expect(extractJsonObject(raw)).toEqual({ summary: '正文}包含花括号', worldSetting: '海岛' });
  });

  it('returns null for garbage', () => {
    expect(extractJsonObject('没有任何结构化内容')).toBeNull();
  });
});

describe('buildPanoramaPrompt', () => {
  it('contains title, node outline and head/tail slices with capped sizes', () => {
    const prompt = buildPanoramaPrompt(INPUT);
    expect(prompt).toContain('【书名】灯塔之夜');
    expect(prompt).toContain('第一章 起源');
    expect(prompt).toContain('共 3 个节点');
    expect(prompt).toContain('【正文开篇切片】');
    expect(prompt).toContain('【正文结尾切片】');
    expect(INPUT.fullText.slice(0, PANORAMA_HEAD_CHARS)).toBe(INPUT.fullText.slice(0, PANORAMA_HEAD_CHARS));
    expect(prompt.length).toBeLessThan(INPUT.fullText.length + 2_000);
  });

  it('indents second-level nodes under their 章 in the rendered outline', () => {
    const prompt = buildPanoramaPrompt({
      ...INPUT,
      nodes: [
        { title: '第一部分 系统1，系统2', depth: 0 },
        { title: '第1章 一张愤怒的脸和一道乘法题', depth: 1 },
        { title: '第2章 电影的主角与配角', depth: 1 },
      ],
    });
    // 章 rows are flush left; 节 rows carry the tree indent marker.
    expect(prompt).toContain('\n第一部分 系统1，系统2\n  └ 第1章 一张愤怒的脸和一道乘法题\n');
    expect(prompt).toContain('\n  └ 第2章 电影的主角与配角\n');
    expect(prompt).not.toContain('  └ 第一部分 系统1，系统2');
  });
});

describe('createPanoramaGenerator', () => {
  it('persists a parsed panorama record', async () => {
    const db = new ReadestPlusDatabase(`pano-test-${Math.random().toString(36).slice(2)}`);
    const repository = new BookPanoramaRepository(db);
    const stream: StreamTextFn = async function* () {
      yield '```json\n{"genre":"悬疑","summary":"守夜人追寻灯塔熄灭之谜。","worldSetting":"北海孤岛","mainCharacters":["林远","阿澈"]}\n```';
    };
    const generator = createPanoramaGenerator({
      stream,
      settings: { ...DEFAULT_AI_SETTINGS },
      repository,
    });

    const panorama = await generator.generate(INPUT);
    expect(panorama).toMatchObject({
      bookHash: 'pano-book',
      genre: '悬疑',
      summary: '守夜人追寻灯塔熄灭之谜。',
      worldSetting: '北海孤岛',
      mainCharacters: ['林远', '阿澈'],
      totalNodes: 3,
    });
    const stored = await repository.get('pano-book');
    expect(stored?.summary).toBe('守夜人追寻灯塔熄灭之谜。');
    await db.delete();
  });

  it('returns null without persisting on unparsable output', async () => {
    const db = new ReadestPlusDatabase(`pano-test-${Math.random().toString(36).slice(2)}`);
    const repository = new BookPanoramaRepository(db);
    const stream: StreamTextFn = async function* () {
      yield '模型拒绝输出 JSON';
    };
    const generator = createPanoramaGenerator({ stream, settings: { ...DEFAULT_AI_SETTINGS }, repository });
    const panorama = await generator.generate(INPUT);
    expect(panorama).toBeNull();
    expect(await repository.get('pano-book')).toBeUndefined();
    await db.delete();
  });
});
