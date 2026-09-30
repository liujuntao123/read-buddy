import { lexer, type Tokens } from 'marked';
import { parseSummarySections } from '@/services/summary/summaryStructure';
import type { Concept, ConceptMapRecord } from './conceptMap';

export type SummaryRole = 'theme' | 'core' | 'outline' | 'terms';
export const ROLE_LABEL: Record<SummaryRole, string> = {
  theme: '中心主题', core: '核心要义', outline: '内容脉络', terms: '关键概念',
};
export const ROLE_COLOR = { theme: 'gray', core: 'blue', outline: 'cyan', terms: 'orange' } as const;
export interface SummaryConcept extends Concept {
  role: SummaryRole;
  sectionId?: string;
  sourceText: string;
  isGroup: boolean;
  order?: number;
}
export interface SummaryMap extends ConceptMapRecord { concepts: SummaryConcept[] }

const plain = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]*>/g, '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
const shortLabel = (text: string) => {
  const lead = text.split(/[：:。！？；\n]/)[0]!.trim();
  return lead.length <= 22 ? lead : `${lead.slice(0, 21)}…`;
};
function itemsOf(markdown: string): string[] {
  const items: string[] = [];
  for (const token of lexer(markdown)) {
    if (token.type === 'list') items.push(...(token as Tokens.List).items.map((item) => item.text));
    else if ('text' in token && typeof token.text === 'string' && token.text.trim()) items.push(token.text);
  }
  return items;
}

/** A projection of the exact displayed summary. No second AI interpretation or extra model call. */
export function buildSummaryMap(input: {
  summary: string; text: string; title: string; bookHash: string; nodeIndex: number; updatedAt: number;
}): SummaryMap {
  const { sections, preface } = parseSummarySections(input.summary);
  const concepts: SummaryConcept[] = [{ id: 'root', label: input.title || '阅读总结',
    description: '从核心要义出发，沿内容脉络理解关键概念。', parentId: null, quote: '',
    sourceText: '', role: 'theme', isGroup: true }];
  const sourceSections = sections.length ? sections : [{ id: 'section-0', heading: '核心要义', content: input.summary }];
  for (const [index, section] of sourceSections.entries()) {
    const role: SummaryRole = /概念|术语/.test(section.heading) ? 'terms'
      : /脉络|内容|要点/.test(section.heading) ? 'outline' : 'core';
    const groupId = `group:${section.id}`;
    const items = itemsOf(section.content);
    if (index === 0 && preface) items.unshift(preface);
    concepts.push({ id: groupId, parentId: 'root', label: section.heading,
      description: plain(section.content), sourceText: section.content,
      role, sectionId: section.id, quote: '', isGroup: true });
    items.forEach((raw, i) => {
      const sourceText = plain(raw);
      if (!sourceText) return;
      const emphasis = raw.match(/^\s*\*\*(.+?)\*\*/)?.[1];
      const label = shortLabel(plain(emphasis || sourceText));
      // Only literal, unique excerpts can become direct reader links.
      const explanation = sourceText.replace(/^[^：:]{1,40}[：:]\s*/, '');
      const candidates = [sourceText, explanation, ...explanation.split(/[。！？]/).filter((s) => s.length >= 12)];
      const quote = candidates.find((candidate) => {
        const at = input.text.indexOf(candidate);
        return at >= 0 && input.text.indexOf(candidate, at + 1) < 0;
      }) ?? '';
      const charOffset = quote ? input.text.indexOf(quote) : undefined;
      concepts.push({ id: `${section.id}:${i}`, label, parentId: groupId,
        description: sourceText, sourceText: raw, role, sectionId: section.id,
        quote, isGroup: false, order: i + 1,
        ...(charOffset === undefined ? {} : { charOffset, anchor: {
          prefix: input.text.slice(Math.max(0, charOffset - 40), charOffset),
          suffix: input.text.slice(charOffset + quote.length, charOffset + quote.length + 40),
        } }),
      });
    });
  }
  const relations: SummaryMap['relations'] = [];
  const terms = concepts.filter((c) => c.role === 'terms' && !c.isGroup && c.label.length >= 2 && !c.label.endsWith('…'));
  for (const term of terms) {
    for (const item of concepts.filter((c) => !c.isGroup && c.role !== 'terms')) {
      if (item.description.includes(term.label)) relations.push({ source: item.id, target: term.id, label: '涉及' });
    }
  }
  return { id: `${input.bookHash}:${input.nodeIndex}`, bookHash: input.bookHash,
    nodeIndex: input.nodeIndex, title: input.title, fingerprint: '', model: '', updatedAt: input.updatedAt,
    concepts, relations };
}

/** Include hidden ancestors when selecting from the summary or search. */
export function revealConcept(data: SummaryMap, id: string, collapsed: ReadonlySet<string>): Set<string> {
  const next = new Set(collapsed);
  let parent = data.concepts.find((c) => c.id === id)?.parentId;
  while (parent) { next.delete(parent); parent = data.concepts.find((c) => c.id === parent)?.parentId; }
  return next;
}
