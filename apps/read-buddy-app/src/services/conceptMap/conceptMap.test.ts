import { describe, expect, it } from 'vitest';
import { buildSummaryMap, revealConcept } from './summaryMap';
import { conceptMapMarkdown, visibleConcepts } from './conceptMap';
const text = '主动回忆有助于保持知识。';
const summary = `## 核心要义\n- ${text}\n## 关键内容脉络\n1. **建立联系**：主动回忆连接已有知识。\n2. **检验理解**：用问题检查理解。\n## 核心概念与关键术语\n- **主动回忆**：从记忆中提取信息。`;
const build = (source = summary, original = text) => buildSummaryMap({ summary: source, text: original, title: '学习', bookHash: 'book', nodeIndex: 1, updatedAt: 1 });
describe('summary projection', () => {
  it('preserves every summary item and all three section identities', () => {
    const map = build();
    expect(map.concepts.filter((c) => c.parentId === 'root').map((c) => c.role)).toEqual(['core', 'outline', 'terms']);
    expect(map.concepts.filter((c) => !c.isGroup)).toHaveLength(4);
    expect(map.concepts.find((c) => c.label === '建立联系')).toMatchObject({ sectionId: 'section-1', sourceText: '**建立联系**：主动回忆连接已有知识。' });
    expect(map.relations).toContainEqual({ source: 'section-1:0', target: 'section-2:0', label: '涉及' });
  });
  it('never turns a repeated or paraphrased sentence into an exact evidence link', () => {
    expect(build().concepts.find((c) => c.id === 'section-0:0')?.charOffset).toBe(0);
    expect(build(summary, text + text).concepts.find((c) => c.id === 'section-0:0')?.charOffset).toBeUndefined();
    expect(build(summary, '完全无关的正文').concepts.every((c) => c.charOffset === undefined)).toBe(true);
  });
  it('retains full descriptions and derives a new map when summary changes', () => {
    const long = '一个很长的解释'.repeat(100);
    expect(build(`## 核心要义\n- ${long}`).concepts.find((c) => !c.isGroup)?.description).toBe(long);
    expect(build(summary.replace('建立联系', '连接概念')).concepts.some((c) => c.label === '连接概念')).toBe(true);
  });
  it('reveals selected descendants without disturbing unrelated collapsed branches', () => {
    const map = build(); const folded = new Set(['group:section-0', 'group:section-1']);
    expect(visibleConcepts(map, folded).some((c) => c.id === 'section-1:0')).toBe(false);
    const next = revealConcept(map, 'section-1:0', folded);
    expect(next.has('group:section-0')).toBe(true);
    expect(visibleConcepts(map, next).some((c) => c.id === 'section-1:0')).toBe(true);
    expect(conceptMapMarkdown(map)).toContain('检验理解');
  });
  it('supports unstructured summaries without silently hiding their content', () => {
    expect(build('这是没有标题的完整总结。').concepts.find((c) => !c.isGroup)?.description).toBe('这是没有标题的完整总结。');
  });
});
