export interface Concept {
  id: string;
  label: string;
  description: string;
  parentId: string | null;
  quote: string;
  /** Verified, node-relative offset. Absent when the quote cannot be verified. */
  charOffset?: number;
  anchor?: { prefix: string; suffix: string };
}
export interface ConceptRelation { source: string; target: string; label: string }
export interface ConceptMapData { concepts: Concept[]; relations: ConceptRelation[] }
export interface ConceptMapRecord extends ConceptMapData {
  id: string;
  bookHash: string;
  nodeIndex: number;
  title: string;
  fingerprint: string;
  model: string;
  updatedAt: number;
}

export function visibleConcepts(data: ConceptMapData, collapsed: ReadonlySet<string>): Concept[] {
  const children = new Map<string | null, Concept[]>();
  for (const c of data.concepts) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
  const result: Concept[] = [];
  const visit = (parent: string | null) => {
    for (const c of children.get(parent) ?? []) {
      result.push(c);
      if (!collapsed.has(c.id)) visit(c.id);
    }
  };
  visit(null);
  return result;
}

export function conceptMapMarkdown(data: ConceptMapRecord): string {
  const lines = [`# ${data.title} · 概念地图`, ''];
  const walk = (parent: string | null, depth: number) => {
    for (const c of data.concepts.filter((item) => item.parentId === parent)) {
      lines.push(`${'  '.repeat(depth)}- ${c.label}：${c.description}`);
      if (c.charOffset !== undefined) lines.push(`${'  '.repeat(depth + 1)}> ${c.quote}`);
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  if (data.relations.length) lines.push('', '## 概念关系', ...data.relations.map((r) =>
    `- ${data.concepts.find((c) => c.id === r.source)?.label} → ${r.label} → ${data.concepts.find((c) => c.id === r.target)?.label}`));
  return lines.join('\n');
}

