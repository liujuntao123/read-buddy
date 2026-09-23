import { describe, expect, it } from 'vitest';
import {
  CAUSALITY_RULE,
  CAUSAL_CHAIN_RULE,
  CORE_RULE,
  MAP_SYSTEM_PROMPT,
  PERSPECTIVE_RULE,
  SUMMARY_HEADING_CORE,
  SUMMARY_HEADING_OUTLINE,
  SUMMARY_HEADING_TERMS,
  SUMMARY_SYSTEM_PROMPT,
  TERMS_RULE,
  THREE_PART_RULE,
  THREE_PART_TEMPLATE,
  buildMapPrompt,
  buildReducePrompt,
  buildSinglePassPrompt,
} from './prompts';

const INPUT = {
  bookTitle: '迷雾之城（演示书）',
  nodeTitle: '第二章 图书馆的密语',
  nodeKind: 'chapter' as const,
  text: '',
};

/** Occurrences of `needle` inside `haystack`; 0 when absent. */
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/** The prompts that must carry the mandated three-part structure. */
const finalAnswerPrompts = (): string[] => [
  buildSinglePassPrompt({ ...INPUT, text: '正文' }),
  buildReducePrompt({ ...INPUT, subSummaries: ['要点'] }),
];

const HEADINGS = [SUMMARY_HEADING_CORE, SUMMARY_HEADING_OUTLINE, SUMMARY_HEADING_TERMS];

describe('THREE_PART_TEMPLATE', () => {
  it('contains exactly the three mandated section headings in order', () => {
    HEADINGS.forEach((heading) => expect(THREE_PART_TEMPLATE).toContain(heading));
    const positions = HEADINGS.map((heading) => THREE_PART_TEMPLATE.indexOf(heading));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('opens with a bullet list without fixing the bullet labels', () => {
    expect(THREE_PART_TEMPLATE).toContain('- **[小标题一]**：一句话说明这条要点');
    expect(THREE_PART_TEMPLATE).toContain('- **[小标题二]**：一句话说明这条要点');
    expect(THREE_PART_TEMPLATE).not.toContain('核心主旨');
    expect(THREE_PART_TEMPLATE).not.toContain('主要论点或事件');
    expect(THREE_PART_TEMPLATE).not.toContain('结论或走向');
  });

  it('specifies the outline item and term list shapes', () => {
    expect(THREE_PART_TEMPLATE).toContain('1. **[要点一]**：阐述该要点核心内容');
    expect(THREE_PART_TEMPLATE).toContain('2. **[要点二]**：写法同第 1 条');
    expect(THREE_PART_TEMPLATE).toContain('- **[概念/术语名]**：在原文中的具体含义、语境与作用');
  });

  it('continues the outline and sizes the count by content, never by node length', () => {
    expect(THREE_PART_TEMPLATE).toContain('写法同第 1 条');
    expect(THREE_PART_TEMPLATE).toContain('以上是格式示意，不是条数');
    expect(THREE_PART_TEMPLATE).toContain('短则 2~3 条，长则 10 条以上');
    expect(THREE_PART_TEMPLATE).not.toContain('3 条左右');
  });

  it('keeps the outline a parallel list instead of one continuous narrative', () => {
    expect(THREE_PART_TEMPLATE).toContain('一串并列的要点');
    expect(THREE_PART_TEMPLATE).toContain('不要写成一段连续叙述');
  });

  it('shows the shape only, leaving the content requirements to the rules', () => {
    expect(THREE_PART_TEMPLATE).not.toContain(PERSPECTIVE_RULE);
    expect(THREE_PART_TEMPLATE).not.toContain(CAUSAL_CHAIN_RULE);
    expect(THREE_PART_TEMPLATE).not.toContain('人名');
    expect(THREE_PART_TEMPLATE).not.toContain('连贯');
  });
});

describe('CAUSALITY_RULE', () => {
  it('states every fidelity lever the summary is graded on', () => {
    expect(CAUSALITY_RULE).toContain(PERSPECTIVE_RULE);
    expect(CAUSALITY_RULE).toContain('忠实原文');
    expect(CAUSALITY_RULE).toContain('只改措辞，不改事实');
    expect(CAUSALITY_RULE).toContain(CAUSAL_CHAIN_RULE);
    expect(CAUSALITY_RULE).toContain('保留细节');
    expect(CAUSALITY_RULE).toContain('人名、地名、组织、时间、数量');
    expect(CAUSALITY_RULE).toContain('不得替换成');
    expect(CAUSALITY_RULE).toContain('并列枚举');
    expect(CAUSALITY_RULE).toContain('反常与张力');
    expect(CAUSALITY_RULE).toContain('相互强化');
    expect(CAUSALITY_RULE).toContain('分点粒度');
    expect(CAUSALITY_RULE).toContain('脉络连贯');
    expect(CAUSALITY_RULE).toContain('覆盖自查');
    expect(CAUSALITY_RULE).toContain('宁可写长');
  });

  it('numbers its items 1..8', () => {
    ['1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. '].forEach((ordinal) =>
      expect(CAUSALITY_RULE).toContain(ordinal),
    );
  });

  it('gives the granularity rule a test the model can apply to its own draft', () => {
    expect(CAUSALITY_RULE).toContain('一个要点只讲一件事');
    expect(CAUSALITY_RULE).toContain('串起两件以上');
    expect(CAUSALITY_RULE).toContain('拆成两条');
    expect(CAUSALITY_RULE).toContain('有几件可独立成立的事，就应有几条要点');
  });

  it('keeps continuity from turning the outline into a single narrative', () => {
    expect(CAUSALITY_RULE).toContain('每条仍独立成条');
    expect(CAUSALITY_RULE).toContain('不要因为「连贯」把整节写成一段连续叙述');
  });

  it('reuses the shared wording instead of restating it', () => {
    expect(count(CAUSALITY_RULE, PERSPECTIVE_RULE)).toBe(1);
    expect(count(CAUSALITY_RULE, CAUSAL_CHAIN_RULE)).toBe(1);
  });
});

describe('CORE_RULE', () => {
  it('gives the opening section a direction instead of a form to fill in', () => {
    expect(CORE_RULE).toContain('通常用 2~4 条要点概括');
    expect(CORE_RULE).toContain('本节点讲了什么');
    expect(CORE_RULE).toContain('最终落到哪里');
    expect(CORE_RULE).toContain('不必逐条对应');
    expect(CORE_RULE).toContain('也不必凑满条数');
  });

  it('leaves the bullet labels to the model', () => {
    expect(CORE_RULE).toContain('小标题按内容自己拟');
    expect(CORE_RULE).toContain('不要套用固定用词');
    expect(CORE_RULE).not.toContain('核心主旨');
    expect(CORE_RULE).not.toContain('主要论点或事件');
    expect(CORE_RULE).not.toContain('结论或走向');
  });

  it('keeps the section to an overview', () => {
    expect(CORE_RULE).toContain('只做概括');
    expect(CORE_RULE).toContain('不展开脉络细节');
    expect(CORE_RULE).toContain('不写术语定义');
  });
});

describe('TERMS_RULE', () => {
  it('selects terms instead of padding the section', () => {
    expect(TERMS_RULE).toContain('只收录');
    expect(TERMS_RULE).toContain('给出定义、反复出现或影响理解');
    expect(TERMS_RULE).toContain('（无特别术语）');
    expect(TERMS_RULE).toContain('不要凑数');
  });

  it('leaves what each entry says to the template', () => {
    expect(TERMS_RULE).not.toContain('含义');
    expect(THREE_PART_TEMPLATE).toContain('具体含义、语境与作用');
  });
});

describe('THREE_PART_RULE', () => {
  it('bundles the template, the three section rules and one Markdown instruction', () => {
    expect(THREE_PART_RULE).toContain(THREE_PART_TEMPLATE);
    expect(THREE_PART_RULE).toContain(CORE_RULE);
    expect(THREE_PART_RULE).toContain(CAUSALITY_RULE);
    expect(THREE_PART_RULE).toContain(TERMS_RULE);
    expect(count(THREE_PART_RULE, 'Markdown')).toBe(1);
  });

  it('tells the model not to print the writing notes', () => {
    expect(THREE_PART_RULE).toContain('都是写法说明，不要出现在输出里');
  });

  it('rides along with every final-answer prompt', () => {
    finalAnswerPrompts().forEach((prompt) => expect(prompt).toContain(THREE_PART_RULE));
  });
});

describe('one rule, one statement per call', () => {
  it('states the narrative perspective exactly once, in every phase', () => {
    const prompts = [
      ...finalAnswerPrompts(),
      buildMapPrompt({ ...INPUT, chunk: '片段', index: 1, total: 2 }),
    ];
    prompts.forEach((prompt) => expect(count(prompt, PERSPECTIVE_RULE)).toBe(1));
  });

  it('states each heading and rule block exactly once in the final answers', () => {
    finalAnswerPrompts().forEach((prompt) => {
      HEADINGS.forEach((heading) => expect(count(prompt, heading)).toBe(1));
      expect(count(prompt, CORE_RULE)).toBe(1);
      expect(count(prompt, CAUSALITY_RULE)).toBe(1);
      expect(count(prompt, TERMS_RULE)).toBe(1);
      // Rule wording occurs only inside the rule block: no task sentence restates it.
      ['连贯', '保留细节', '拆成两条'].forEach((phrase) =>
        expect(count(prompt, phrase)).toBe(count(CAUSALITY_RULE, phrase)),
      );
    });
  });

  it('states the causal chain once per phase, in the layer that owns it', () => {
    finalAnswerPrompts().forEach((prompt) => expect(count(prompt, CAUSAL_CHAIN_RULE)).toBe(1));
    expect(count(MAP_SYSTEM_PROMPT, CAUSAL_CHAIN_RULE)).toBe(1);

    const mapPrompt = buildMapPrompt({ ...INPUT, chunk: '片段', index: 1, total: 2 });
    expect(count(mapPrompt, CAUSAL_CHAIN_RULE)).toBe(0);
  });

  it('keeps the final-answer system prompt to the single standing priority', () => {
    expect(SUMMARY_SYSTEM_PROMPT).toContain('忠实优先于简洁');
    expect(SUMMARY_SYSTEM_PROMPT).toContain('不可以压缩事实');
    expect(SUMMARY_SYSTEM_PROMPT).not.toContain(PERSPECTIVE_RULE);
    expect(SUMMARY_SYSTEM_PROMPT).not.toContain(CAUSAL_CHAIN_RULE);
    expect(SUMMARY_SYSTEM_PROMPT).not.toContain('人名');
    expect(SUMMARY_SYSTEM_PROMPT).not.toContain('Markdown');
  });

  it('owns the map-phase extraction slots in the map system prompt alone', () => {
    expect(MAP_SYSTEM_PROMPT).toContain('本阶段不需要三段式结构');
    expect(MAP_SYSTEM_PROMPT).toContain('1. 事件与论点脉络');
    expect(MAP_SYSTEM_PROMPT).toContain('2. 人物、地点、设定与专名');
    expect(MAP_SYSTEM_PROMPT).toContain('3. 关键细节');
    expect(MAP_SYSTEM_PROMPT).toContain('4. 概念与术语');
    expect(MAP_SYSTEM_PROMPT).toContain('宁可多列几条，不要合并不同事件');
    expect(MAP_SYSTEM_PROMPT).toContain('直接输出要点列表');

    const mapPrompt = buildMapPrompt({ ...INPUT, chunk: '片段', index: 1, total: 2 });
    expect(mapPrompt).not.toContain('事件与论点脉络');
    expect(mapPrompt).not.toContain('关键细节');
    expect(mapPrompt).not.toContain('直接输出要点列表');
  });
});

describe('node level wording', () => {
  it('names the viewpoint with the node model level word, never a blanket 「章节」', () => {
    const asChapter = buildSinglePassPrompt({ ...INPUT, text: '正文' });
    const asSection = buildSinglePassPrompt({
      ...INPUT,
      nodeKind: 'section',
      nodeTitle: '§1 伦理学这个名称',
      text: '正文',
    });

    expect(asChapter).toContain('的章「第二章 图书馆的密语」');
    expect(asSection).toContain('的节「§1 伦理学这个名称」');
    expect(asSection).toContain('【节全文】');
    expect(asChapter).not.toContain('章节');
    expect(asSection).not.toContain('章节');
  });

  it('uses the same level word in the map and reduce prompts', () => {
    expect(
      buildMapPrompt({ ...INPUT, nodeKind: 'section', chunk: '片段', index: 1, total: 2 }),
    ).toContain('超长节「第二章 图书馆的密语」');
    expect(buildReducePrompt({ ...INPUT, nodeKind: 'section', subSummaries: ['要点'] })).toContain(
      '整节总结',
    );
  });
});

describe('buildSinglePassPrompt', () => {
  it('embeds book title, chapter title, the full text and the three-part rule', () => {
    const text = '图书馆的木门在她身后合上时，穹顶上的星图亮了起来。';
    const prompt = buildSinglePassPrompt({ ...INPUT, text });

    expect(prompt).toContain('《迷雾之城（演示书）》');
    expect(prompt).toContain('「第二章 图书馆的密语」');
    expect(prompt).toContain(text);
    expect(prompt).toContain(THREE_PART_RULE);
    HEADINGS.forEach((heading) => expect(prompt).toContain(heading));
  });

  it('sizes the answer to the source instead of leaving the detail budget implicit', () => {
    const text = '图书馆的木门在她身后合上时，穹顶上的星图亮了起来。';
    const prompt = buildSinglePassPrompt({ ...INPUT, text });

    expect(prompt).toContain(`原文约 ${text.length} 字`);
    expect(prompt).toContain('请完整覆盖其中的要点与关键细节');
  });

  it('truncates oversized text with the explicit marker instead of overflowing', () => {
    const text = '夜'.repeat(13_000);
    const prompt = buildSinglePassPrompt({ ...INPUT, text });

    expect(prompt).toContain('已截断：原文共 13000 字，此处仅保留前 12000 字');
    expect(prompt.length).toBeLessThan(text.length + 500);
  });
});

describe('buildMapPrompt', () => {
  it('names the chunk position, the overlap and the chunk-specific task, without the three-part rule', () => {
    const chunk = '长夜第1节：守夜人发现星图移动了位置。';
    const prompt = buildMapPrompt({ ...INPUT, chunk, index: 1, total: 2 });

    expect(prompt).toContain('《迷雾之城（演示书）》');
    expect(prompt).toContain('「第二章 图书馆的密语」');
    expect(prompt).toContain('第 1/2 个片段');
    expect(prompt).toContain('重叠');
    expect(prompt).toContain(chunk);
    expect(prompt).not.toContain(THREE_PART_RULE);
    expect(prompt).not.toContain(CAUSALITY_RULE);
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
    expect(prompt).toContain(THREE_PART_RULE);
    HEADINGS.forEach((heading) => expect(prompt).toContain(heading));
  });

  it('forbids merging away the details and skipping a chunk', () => {
    const prompt = buildReducePrompt({ ...INPUT, subSummaries: ['要点'] });

    expect(prompt).toContain('逐一覆盖每个片段的要点');
    expect(prompt).toContain('合并重复项时保留各自的细节与结论');
    expect(prompt).toContain('按叙事/论证顺序重组');
  });

  it('handles an empty sub-summary list without throwing', () => {
    const prompt = buildReducePrompt({ ...INPUT, subSummaries: [] });
    expect(prompt).toContain('【各片段要点】');
  });
});
