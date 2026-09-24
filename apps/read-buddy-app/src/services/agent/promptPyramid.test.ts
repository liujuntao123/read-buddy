import { describe, expect, it } from 'vitest';
import type { BookNodeShape } from '@/services/bookNodes';
import {
  assembleAgentSystemPrompt,
  buildCurrentChapterExcerpt,
  renderTocMatrix,
} from './promptPyramid';

const CHAPTERS = [
  { nodeIndex: 0, title: '第一章 风起之地', brief: '主角发现异常信号。' },
  { nodeIndex: 1, title: '第二章 雾锁孤城', brief: undefined },
];

describe('renderTocMatrix', () => {
  it('renders 1-based ordinals, the level word and pending placeholders', () => {
    const matrix = renderTocMatrix([
      { nodeIndex: 0, title: '第一章 风起之地', brief: '主角发现异常信号。' },
      { nodeIndex: 1, title: '第二章 雾锁孤城', brief: undefined },
    ]);
    expect(matrix).toContain('• 第 1 章《第一章 风起之地》：主角发现异常信号。');
    expect(matrix).toContain('• 第 2 章《第二章 雾锁孤城》：（待生成微简介）');
    expect(matrix).not.toContain('节点');
  });

  it('indents depth-1 节 nodes under their 章 container', () => {
    const matrix = renderTocMatrix([
      { nodeIndex: 0, title: '第一卷 风云', brief: '开卷。' },
      { nodeIndex: 1, title: '第一章 风起', brief: '启程。', depth: 1, parentTitle: '第一卷 风云' },
    ]);
    expect(matrix).toContain('• 第 1 章《第一卷 风云》：开卷。');
    expect(matrix).toContain('  └ • 第 2 节《第一章 风起》：启程。（隶属《第一卷 风云》）');
  });

  it('labels fixed-length nodes as 段 instead of 章', () => {
    const matrix = renderTocMatrix([
      { nodeIndex: 0, title: '第 1 / 3 部分', brief: '第一段。' },
    ]);
    expect(matrix).toContain('• 第 1 段《第 1 / 3 部分》：第一段。');
  });

  it('names a container 章 as a structural grouping instead of a pending brief', () => {
    const matrix = renderTocMatrix([
      { nodeIndex: 0, title: '第一卷 风云', brief: undefined, isContainer: true },
      { nodeIndex: 1, title: '第一章 风起', brief: undefined, depth: 1, parentTitle: '第一卷 风云' },
    ]);
    expect(matrix).toContain('• 第 1 章《第一卷 风云》：（结构分组节点，微简介见其下各级节点）');
    expect(matrix.split('\n')[0]).not.toContain('待生成微简介');
    // Its 节 is a minimal node, so the pending wording still belongs there.
    expect(matrix).toContain('└ • 第 2 节《第一章 风起》：（待生成微简介）');
  });
});

/**
 * A Book Node Shape built straight from counts — the field is required since
 * 候选 6, because the shape must come from the book's own node list rather than
 * from the micro-brief list the prompt happens to carry.
 */
const shapeOf = (chapter: number, section = 0): BookNodeShape => ({
  chapter,
  section,
  chunk: 0,
  total: chapter + section,
  isNested: section > 0,
  minimalKind: section > 0 ? 'section' : 'chapter',
});

describe('assembleAgentSystemPrompt', () => {
  it('embeds viewport, panorama, full TOC and behaviour rules', () => {
    const prompt = assembleAgentSystemPrompt({
      bookTitle: '灯塔之夜',
      currentNodeIndex: 4,
      currentNodeTitle: '第五章 远航',
      panorama: {
        genre: '悬疑',
        summary: '守夜人追寻灯塔熄灭之谜。',
        worldSetting: '北海孤岛',
        mainCharacters: ['林远', '阿澈'],
      },
      allNodeBriefs: CHAPTERS,
      shape: shapeOf(2),
    });
    expect(prompt).toContain('《灯塔之夜》');
    // The L1 viewport line names the level with the node model's word and uses
    // the same global-node-ordinal numbering as the TOC matrix below it — one
    // numbering system per prompt, not two.
    expect(prompt).toContain('读者目前停留在：第 5 章');
    expect(prompt).not.toContain('读者目前停留在：第 5 节点');
    expect(prompt).toContain('章《第五章 远航》（全书一级节点）');
    expect(prompt).toContain('所属领域与体裁：悬疑');
    expect(prompt).toContain('核心概念与关键主体：林远、阿澈');
    expect(prompt).toContain('【全书节点脉络（共 2 个：2 章，└ 缩进行为第二层节点）】');
    expect(prompt).toContain('search_book_text');
    expect(prompt).toContain('read_node_passage');
    expect(prompt).toContain('locate_in_reader');
    expect(prompt).toContain('全书视角洞察');
  });

  it('renders the hierarchical (章 › 节) breadcrumb for 节 viewpoints', () => {
    const prompt = assembleAgentSystemPrompt({
      bookTitle: '灯塔之夜',
      currentNodeIndex: 1,
      currentNodeTitle: '第一章 风起',
      parentNodeTitle: '第一卷 风云之始',
      currentNodeKind: 'section',
      allNodeBriefs: [],
      shape: shapeOf(0),
    });
    expect(prompt).toContain('《第一卷 风云之始》 › 节《第一章 风起》');
  });

  it('renders the flat single-level 章 breadcrumb when there is no container', () => {
    const prompt = assembleAgentSystemPrompt({
      bookTitle: '灯塔之夜',
      currentNodeIndex: 2,
      currentNodeTitle: '第三章 孤灯',
      currentNodeKind: 'chapter',
      allNodeBriefs: [],
      shape: shapeOf(0),
    });
    expect(prompt).toContain('章《第三章 孤灯》（全书一级节点）');
    expect(prompt).not.toContain('›');
  });

  it('uses the supplied node shape for the outline heading counts', () => {
    const prompt = assembleAgentSystemPrompt({
      bookTitle: '灯塔之夜',
      currentNodeIndex: 0,
      currentNodeTitle: '第一章',
      allNodeBriefs: CHAPTERS,
      shape: {
        chapter: 11,
        section: 70,
        chunk: 0,
        total: 81,
        isNested: true,
        minimalKind: 'section',
      },
    });
    expect(prompt).toContain('【全书节点脉络（共 2 个：11 章 · 70 节，└ 缩进行为第二层节点）】');
  });

  it('tolerates a missing panorama and injects the L0 quote block', () => {
    const prompt = assembleAgentSystemPrompt({
      bookTitle: '灯塔之夜',
      currentNodeIndex: 0,
      currentNodeTitle: '第一章',
      allNodeBriefs: [],
      shape: shapeOf(0),
      quoteText: '物理学不存在了',
    });
    expect(prompt).toContain('所属领域与体裁：未标注');
    expect(prompt).toContain('暂无全景概要');
    expect(prompt).toContain('【读者划选的原文片段】');
    expect(prompt).toContain('物理学不存在了');
    expect(prompt).toContain('【全书节点脉络（共 0 个：尚无节点，└ 缩进行为第二层节点）】');
  });
});

describe('buildCurrentChapterExcerpt', () => {
  it('collapses whitespace and caps length', () => {
    const long = `第一段。   \n\n  第二段。${'长'.repeat(3_000)}`;
    const excerpt = buildCurrentChapterExcerpt(long, 100);
    expect(excerpt.length).toBeLessThanOrEqual(101);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(buildCurrentChapterExcerpt('短 章节')).toBe('短 章节');
  });
});
