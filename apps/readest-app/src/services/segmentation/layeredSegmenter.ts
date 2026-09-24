/**
 * Three-level progressive node segmentation engine
 * (ADR 0005 / ADR 0010, replacing the single-regex detector
 * as the import-time segmentation backbone).
 *
 * Level 1 — the book's own directory (`buildTocNodes`): nodes come from the
 *           TOC entries, anchors included, so a TOC that is finer than the
 *           spine yields per-节 nodes. Falls back to one node per spine when
 *           the directory is unusable.
 * Level 2 — heuristic multi-pattern heading scan with front TOC-page
 *           filtering + confidence scoring (adopt at ≥ 0.75).
 * Level 3 — semantic smooth fixed-length segmentation snapped to paragraph
 *           boundaries (guaranteed fallback).
 *
 * All outputs are `BookNode`s over the unified global continuous
 * character space: [startOffset, endOffset) slices of the cleaned full text
 * reproduce each node exactly. 章 / 节 wording is owned by
 * `@/services/bookNodes`, never hard-coded here.
 *
 * **Interface.** Production depends on exactly three names —
 * `segmentMonolithic`, `segmentSpineBook` and `SpineSectionInput`. 候选 5 measured
 * the old surface at 31 exports with 3 production consumers; the remaining
 * exported names below are **internal seams** (the scan / score / TOC-page
 * filter / snap-cut phases and their tuning constants) that exist so this
 * module's own suite can drive one phase at a time. Nothing outside
 * `services/segmentation` should import them. The 14 exports nothing imported at
 * all were made private.
 */
import {
  NODE_DEPTH,
  bookNodeId,
  type BookNode,
  type BookTocEntry,
  type NodeAnchor,
  type SegmentStrategy,
} from '@/types/readingAgent';
// The level classifier is owned by the node model (ADR 0010 ¶1). Before 候选 5 it
// lived here and `bookNodes` re-exported it back out to dodge a cycle; the
// dependency now points one way: segmenter → node model.
import { classifyHeadingLevel, placeholderTitle } from '@/services/bookNodes/nodeKind';

/** Candidate heading found by the multi-pattern matrix. */
interface HeadingCandidate {
  /** Trimmed heading line text. */
  title: string;
  /** Character offset of the line start inside the full text. */
  offset: number;
  /** Extracted numeric ordinal (第X章 → X); null when absent. */
  ordinal: number | null;
  /** Index of the pattern that matched (A=0..D=3). */
  patternIndex: number;
}

/** Scan only the first N chars for the front TOC-page filter. */
const TOC_PAGE_SCAN_WINDOW = 12_000;
/** ≥N consecutive candidates with tiny body spans form a TOC page. */
const TOC_PAGE_MIN_RUN = 5;
/** Body span between two TOC lines must be smaller than this. */
const TOC_PAGE_MAX_GAP = 100;
/** Adopt Level-2 results at or above this confidence. */
export const CONFIDENCE_ADOPT_THRESHOLD = 0.75;
/** Normal chapter length band for confidence scoring. */
const CHAPTER_LENGTH_BAND: readonly [number, number] = [1_500, 12_000];
/** Normal chapter-count band for confidence scoring. */
const CHAPTER_COUNT_BAND: readonly [number, number] = [10, 300];
/** A spine this small with giant sections is a monolithic book. */
const DEGENERATE_SPINE_MAX_SECTIONS = 2;
const DEGENERATE_SPINE_MIN_CHARS = 25_000;
/** Level-3 target chunk length (between 6,000 and 8,000). */
export const LEVEL3_TARGET_CHARS = 7_000;
/** How far back from the ideal cut to search a paragraph boundary. */
const LEVEL3_SNAP_WINDOW = 1_200;
/** Non-blank preamble longer than this becomes its own 前言 chapter. */
const PREAMBLE_MIN_CHARS = 100;

/**
 * Multi-pattern heading regex matrix (ADR 0005). Each pattern is
 * line-anchored; `matchAll` over the full text yields every candidate.
 */
const HEADING_PATTERNS: readonly RegExp[] = [
  // A: canonical Chinese chapters (第X章/回/节/卷/集/幕/篇/部 + optional title)
  /^[ \t]*(第[0-9一二三四五六七八九十百千零两]+[章回节卷集幕篇部])[ \t]*([^\n]{0,35})$/m,
  // B: ordinal + punctuation ("1. 风起之地" / "一、绪论")
  /^[ \t]*([0-9一二三四五六七八九十百千]+[、.])[ \t]*([^\n]{1,30})$/m,
  // C: English / academic chapters (Chapter 1 / Part I / Section 3)
  /^[ \t]*(Chapter|SECTION|Part|Book)[ \t]+([0-9IVXLCDM]+|[A-Z]+)\b[ \t]*([^\n]{0,40})$/im,
  // D: special附属 chapters (引子/序言/尾声/番外/...)
  /^[ \t]*(引子|序言|自序|前言|尾声|后记|番外|结语|附录)[ \t]*([^\n]{0,25})$/m,
];

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  百: 100,
  千: 1000,
};

const ROMAN_DIGITS: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/** Parse a Chinese numeral (支持 十/百/千 组合, e.g. 二十三 → 23). */
export function parseChineseNumeral(raw: string): number | null {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (!/^[一二三四五六七八九十百千零两]+$/.test(raw)) return null;
  let total = 0;
  let current = 0;
  for (const ch of raw) {
    const digit = CHINESE_DIGITS[ch];
    if (digit === undefined) return null;
    if (digit === 0) continue;
    if (digit >= 10) {
      // 十 as leading multiplier (十=10, 二十=20); 百/千 multiply current.
      current = current === 0 ? 1 : current;
      total += current * digit;
      current = 0;
    } else {
      current = digit;
    }
  }
  return total + current;
}

/** Parse a Roman numeral (I..MMM); returns null for anything else. */
export function parseRomanNumeral(raw: string): number | null {
  if (!/^[IVXLCDM]+$/.test(raw)) return null;
  let total = 0;
  for (let i = 0; i < raw.length; i++) {
    const current = ROMAN_DIGITS[raw[i]!]!;
    const next = ROMAN_DIGITS[raw[i + 1]!] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

/** Extract the numeric ordinal from a heading line, best-effort. */
function extractOrdinal(title: string, patternIndex: number): number | null {
  if (patternIndex === 0) {
    const match = title.match(/第([0-9一二三四五六七八九十百千零两]+)[章回节卷集幕篇部]/);
    return match ? parseChineseNumeral(match[1]!) : null;
  }
  if (patternIndex === 1) {
    const match = title.match(/^([0-9一二三四五六七八九十百千]+)[、.]/);
    if (!match) return null;
    return /^\d+$/.test(match[1]!) ? Number.parseInt(match[1]!, 10) : parseChineseNumeral(match[1]!);
  }
  if (patternIndex === 2) {
    const match = title.match(/(?:Chapter|SECTION|Part|Book)\s+([0-9IVXLCDM]+|[A-Z]+)\b/i);
    if (!match) return null;
    return /^\d+$/.test(match[1]!) ? Number.parseInt(match[1]!, 10) : parseRomanNumeral(match[1]!);
  }
  return null;
}

/**
 * Run the multi-pattern matrix over the full text and return deduplicated
 * candidates ordered by offset. Overlapping matches from different patterns
 * keep the longest title.
 */
export function scanHeadingCandidates(
  fullText: string,
  patterns: readonly RegExp[] = HEADING_PATTERNS,
): HeadingCandidate[] {
  const byOffset = new Map<number, HeadingCandidate>();
  patterns.forEach((pattern, patternIndex) => {
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of fullText.matchAll(regex)) {
      const offset = match.index ?? 0;
      const title = match[0].trim();
      if (!title) continue;
      const ordinal = extractOrdinal(title, patternIndex);
      const candidate: HeadingCandidate = { title, offset, ordinal, patternIndex };
      const existing = byOffset.get(offset);
      if (!existing || title.length > existing.title.length) byOffset.set(offset, candidate);
    }
  });
  return [...byOffset.values()].sort((a, b) => a.offset - b.offset);
}

/** End offset (exclusive) of the heading line starting at `offset`. */
const lineEnd = (fullText: string, offset: number): number => {
  const newlineIndex = fullText.indexOf('\n', offset);
  return newlineIndex === -1 ? fullText.length : newlineIndex;
};

/**
 * Front TOC-page filter (ADR 0005): inside the first
 * `TOC_PAGE_SCAN_WINDOW` chars, a run of ≥5 consecutive candidates whose
 * body spans are < `TOC_PAGE_MAX_GAP` is a table-of-contents manifest.
 * Returns the offset after which real chapter headings must be searched.
 */
export function detectTocPageEnd(
  fullText: string,
  candidates: HeadingCandidate[] = scanHeadingCandidates(fullText),
): number {
  const windowEnd = Math.min(fullText.length, TOC_PAGE_SCAN_WINDOW);
  const inWindow = candidates.filter((candidate) => candidate.offset < windowEnd);

  let bestEnd = 0;
  let runStart = -1;
  let runLength = 0;

  const flush = (endIndex: number): void => {
    if (runLength >= TOC_PAGE_MIN_RUN) {
      const last = inWindow[endIndex]!;
      const end = lineEnd(fullText, last.offset);
      if (end > bestEnd) bestEnd = end;
    }
    runStart = -1;
    runLength = 0;
  };

  for (let i = 0; i < inWindow.length; i++) {
    const current = inWindow[i]!;
    if (runStart === -1) {
      runStart = i;
      runLength = 1;
      continue;
    }
    const previous = inWindow[i - 1]!;
    const gap = current.offset - lineEnd(fullText, previous.offset);
    if (gap < TOC_PAGE_MAX_GAP) {
      runLength += 1;
    } else {
      flush(i - 1);
      runStart = i;
      runLength = 1;
    }
  }
  if (runStart !== -1) flush(inWindow.length - 1);

  return bestEnd;
}

interface ConfidenceBreakdown {
  /** 0~1 weighted total. */
  total: number;
  monotonicity: number;
  lengthSanity: number;
  density: number;
}

/** Fraction of chapters whose char count sits inside the normal band. */
const lengthSanityScore = (lengths: number[]): number => {
  if (lengths.length === 0) return 0;
  const [min, max] = CHAPTER_LENGTH_BAND;
  const inside = lengths.filter((length) => length >= min && length <= max).length;
  return inside / lengths.length;
};

/** Chapter-count plausibility (10~300 full score; tiny/huge get less). */
const densityScore = (count: number): number => {
  const [min, max] = CHAPTER_COUNT_BAND;
  if (count >= min && count <= max) return 1;
  if (count < 3) return 0;
  if (count < min || count > max) return 0.5;
  return 1;
};

/**
 * Ordinal monotonicity, computed PER HIERARCHY LEVEL (卷-series and 章-series
 * each progress independently in hierarchical books, so the flat
 * interleaving 1,1,2,2,3,4 is correct, not a violation). Falls back to a
 * single series when no levels are given.
 */
export const monotonicityScore = (
  ordinals: (number | null)[],
  levels?: Array<string | null>,
): number => {
  const present = ordinals
    .map((value, index) => ({
      ordinal: value,
      level: levels?.[index] ?? 'plain',
    }))
    .filter((item): item is { ordinal: number; level: string } =>
      typeof item.ordinal === 'number',
  );
  if (present.length < 2) return 0.5; // not enough signal: neutral-ish

  const series = new Map<string, number[]>();
  for (const item of present) {
    series.set(item.level, [...(series.get(item.level) ?? []), item.ordinal]);
  }
  let increasing = 0;
  let pairs = 0;
  for (const values of series.values()) {
    for (let i = 1; i < values.length; i++) {
      pairs += 1;
      if (values[i]! > values[i - 1]!) increasing += 1;
    }
  }
  return pairs === 0 ? 0.5 : increasing / pairs;
};

/**
 * Confidence scoring (ADR 0005): monotonic ordinals 40%
 * (per hierarchy level), chapter length sanity 30%, chapter density 30%.
 */
export function scoreConfidence(
  chapters: Array<{
    ordinal: number | null;
    charCount: number;
    /** Heading level of the candidate (container/leaf), when known. */
    level?: string | null;
  }>,
): ConfidenceBreakdown {
  const monotonicity = monotonicityScore(
    chapters.map((chapter) => chapter.ordinal),
    chapters.map((chapter) => chapter.level ?? null),
  );
  const lengthSanity = lengthSanityScore(chapters.map((chapter) => chapter.charCount));
  const density = densityScore(chapters.length);
  const total = monotonicity * 0.4 + lengthSanity * 0.3 + density * 0.3;
  return { total, monotonicity, lengthSanity, density };
}

/** 一个节点在全局字符空间中的起点，以及它的物理归属。 */
interface NodeStart {
  title: string;
  offset: number;
  /** 目录声明的层深（未声明 = 0，交由标题分级补层）。 */
  declaredDepth?: number;
  spineIndex?: number;
  /** 本节点**起始**物理段的末尾偏移（用于剥掉段间分隔符）。 */
  spineEndOffset?: number;
  anchor?: string;
  href?: string;
}

interface NodeDraft {
  title: string;
  startOffset: number;
  endOffset: number;
  charCount: number;
  depth: number;
  /** 标题被认成卷/部/篇/部分容器（结构性占位，即使没有正文也保留）。 */
  isContainer: boolean;
  spineIndex?: number;
  anchor?: string;
  href?: string;
}

/**
 * 把一串**按文档顺序**的起点盖成 BookNode 树（章 › 节）。
 *
 * 层级 = `max(目录声明的层深, 位置层深)`：容器（卷/部/篇/部分）是第一层的
 * 「章」，容器之后的条目是第二层的「节」，容器之前的内容保持第一层。成员判定
 * 是位置式的，不看后缀——《看见孩子》的「准则2…」「实战2…」自己没有章/节后缀，
 * 照样进第二层。
 *
 * 归属由**最终层深**决定，而不是由标题像不像容器决定：第二层节点的父节点就是
 * 它前面最近的一个第一层节点。目录已经用嵌套声明了层级、标题里却没有「卷/部/
 * 篇」字样的书（《何为良好生活》的 70 个 §节）因此仍然有章可依。
 *
 * 保留规则：有正文的保留；没有正文但是容器、或者是某些节的父节点也保留（子节点
 * 需要归属）；其余空节点是排版留白，丢弃后编号重新连续。无标题的物理段拿到与
 * 自身层级一致的占位标题（第 N 章 / 第 N 节），不再一律叫「节」。
 */
function toBookNodes(bookHash: string, fullText: string, starts: readonly NodeStart[]): BookNode[] {
  const drafts: NodeDraft[] = [];
  let hasContainerAbove = false;

  starts.forEach((start, index) => {
    // 节点范围到下一个节点起点为止。目录比正文文件更糙时，一个节点横跨多个
    // 物理段（《思考快与慢》的第 1 章 = 5 个碎片文件），跨段的分隔符因此留在
    // 节点内部；而「下一个节点恰好从紧随本段的下一段开始」时，那个分隔符不属
    // 于任何节点，必须剥掉——否则字数、微摘要切片与总结正文都会多出一行空行。
    const nextStart = starts[index + 1]?.offset;
    let endOffset: number;
    if (nextStart === undefined) {
      endOffset = fullText.length;
    } else if (
      start.spineEndOffset !== undefined &&
      nextStart - start.spineEndOffset === SPINE_JOIN.length
    ) {
      endOffset = start.spineEndOffset;
    } else {
      endOffset = nextStart;
    }
    const isContainer = classifyHeadingLevel(start.title) === 'container';
    const depth = Math.max(
      start.declaredDepth ?? 0,
      !isContainer && hasContainerAbove ? NODE_DEPTH.section : 0,
    );
    if (isContainer) hasContainerAbove = true;
    drafts.push({
      title: start.title.trim(),
      startOffset: start.offset,
      endOffset,
      charCount: Math.max(0, endOffset - start.offset),
      depth,
      isContainer,
      ...(start.spineIndex !== undefined ? { spineIndex: start.spineIndex } : {}),
      ...(start.anchor !== undefined ? { anchor: start.anchor } : {}),
      ...(start.href !== undefined ? { href: start.href } : {}),
    });
  });

  // 归属：第二层节点挂到它前面最近的一个第一层节点上。
  let lastFirstLevelRef = -1;
  const parentRefs = drafts.map((draft, index) => {
    const parentRef = draft.depth > 0 && lastFirstLevelRef >= 0 ? lastFirstLevelRef : -1;
    if (draft.depth === 0) lastFirstLevelRef = index;
    return parentRef;
  });
  const isParent = drafts.map(() => false);
  for (const parentRef of parentRefs) if (parentRef >= 0) isParent[parentRef] = true;

  const keptRefs = drafts
    .map((draft, index) => ({ draft, index }))
    .filter(({ draft, index }) => draft.charCount > 0 || draft.isContainer || isParent[index]);

  /** 草稿下标 → 最终节点序号（丢弃的行不占号）。 */
  const remap = new Map<number, number>();
  keptRefs.forEach(({ index }, newIndex) => remap.set(index, newIndex));

  const levelCounts = [0, 0];
  return keptRefs.map(({ draft, index }) => {
    const parentRef = parentRefs[index]!;
    const parentNodeIndex = parentRef >= 0 ? remap.get(parentRef) : undefined;
    // 父节点被丢弃时空节点自己也不该再声称自己是第二层。
    const depth = draft.depth > 0 && parentNodeIndex === undefined ? 0 : draft.depth;
    const level = Math.min(depth, 1);
    levelCounts[level] = (levelCounts[level] ?? 0) + 1;
    return {
      nodeId: bookNodeId(bookHash, remap.get(index)!),
      bookHash,
      nodeIndex: remap.get(index)!,
      title:
        draft.title ||
        placeholderTitle(level === 1 ? 'section' : 'chapter', levelCounts[level]),
      depth,
      ...(parentNodeIndex !== undefined
        ? { parentNodeId: bookNodeId(bookHash, parentNodeIndex) }
        : {}),
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
      charCount: draft.charCount,
      ...(draft.spineIndex !== undefined ? { spineIndex: draft.spineIndex } : {}),
      ...(draft.anchor !== undefined ? { anchor: draft.anchor } : {}),
      ...(draft.href !== undefined ? { href: draft.href } : {}),
      indexStatus: 'pending' as const,
    };
  });
}

export interface MonolithicSegmentResult {
  strategy: Extract<SegmentStrategy, 'regex' | 'fixed-length'>;
  nodes: BookNode[];
  confidence: ConfidenceBreakdown | null;
}

/**
 * Level 2 + Level 3 pipeline over a monolithic plain text (TXT, or a
 * degenerate single-spine EPUB's concatenated text). Level 2 runs the
 * pattern matrix after the front TOC-page filter; ≥ 0.75 confidence adopts
 * the regex chapters, anything less falls back to Level 3 smooth chunks.
 */
export function segmentMonolithic(
  bookHash: string,
  fullText: string,
  options: { confidenceThreshold?: number } = {},
): MonolithicSegmentResult {
  const threshold = options.confidenceThreshold ?? CONFIDENCE_ADOPT_THRESHOLD;

  // ---- Level 2: heuristic scan after TOC-page filtering ----
  const allCandidates = scanHeadingCandidates(fullText);
  const tocEnd = detectTocPageEnd(fullText, allCandidates);
  const candidates = allCandidates.filter((candidate) => candidate.offset >= tocEnd);

  if (candidates.length >= 2) {
    const starts: Array<{ title: string; offset: number; ordinal: number | null }> = [];
    const preamble = fullText.slice(tocEnd, candidates[0]!.offset);
    const preambleLength = preamble.replace(/\s/g, '').length;
    if (candidates[0]!.offset - tocEnd > 0 && preambleLength >= PREAMBLE_MIN_CHARS) {
      starts.push({ title: '前言', offset: tocEnd, ordinal: null });
    }
    for (const candidate of candidates) starts.push(candidate);

    const provisional = starts.map((start, index) => ({
      ordinal: start.ordinal,
      charCount: (starts[index + 1]?.offset ?? fullText.length) - start.offset,
      level: classifyHeadingLevel(start.title),
    }));
    const confidence = scoreConfidence(provisional);

    if (confidence.total >= threshold) {
      return {
        strategy: 'regex',
        nodes: toBookNodes(bookHash, fullText, starts),
        confidence,
      };
    }
  }

  // ---- Level 3: semantic smooth fixed-length fallback ----
  return {
    strategy: 'fixed-length',
    nodes: buildFixedLengthNodes(bookHash, fullText),
    confidence: null,
  };
}

/**
 * Level 3: fixed-length segmentation snapped to paragraph boundaries
 * (`\n\n` first, then `\n`) inside the snap window; never cuts mid-sentence.
 * Nodes tile [0, length) without gaps or overlaps.
 */
export function buildFixedLengthNodes(bookHash: string, fullText: string): BookNode[] {
  const total = fullText.length;
  const starts: NodeStart[] = [];
  let cursor = 0;
  let index = 0;
  while (cursor < total) {
    starts.push({ title: `第 ${index + 1} 部分`, offset: cursor });
    index += 1;
    const ideal = cursor + LEVEL3_TARGET_CHARS;
    if (ideal >= total) break;
    const windowStart = cursor + Math.floor(LEVEL3_TARGET_CHARS / 2);
    const double = fullText.lastIndexOf('\n\n', ideal);
    const single = fullText.lastIndexOf('\n', ideal);
    if (double >= windowStart) cursor = Math.min(double + 2, total);
    else if (single >= windowStart) cursor = single + 1;
    else cursor = ideal;
  }
  return toBookNodes(bookHash, fullText, starts);
}

/** True when a spine is a degenerate monolith (≤2 giant sections). */
export function isDegenerateSpine(sectionCharCounts: number[]): boolean {
  if (sectionCharCounts.length === 0) return false;
  if (sectionCharCounts.length > DEGENERATE_SPINE_MAX_SECTIONS) return false;
  return sectionCharCounts.some((count) => count > DEGENERATE_SPINE_MIN_CHARS);
}

export interface SpineSectionInput {
  title: string;
  text: string;
  spineIndex: number;
  /** 段内目录锚点（行首偏移，与 `text` 同一坐标系）。 */
  anchors?: NodeAnchor[];
}

export interface SpineSegmentResult {
  strategy: SegmentStrategy;
  nodes: BookNode[];
}

/** Join separator for the global continuous character space. */
export const SPINE_JOIN = '\n\n';

/** 每个物理段在全局字符空间中的起点。 */
function spineStartOffsets(sections: readonly SpineSectionInput[]): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const section of sections) {
    starts.push(cursor);
    cursor += section.text.length + SPINE_JOIN.length;
  }
  return starts;
}

/**
 * 目录驱动的节点构建——节点模型的**首选**来源。
 *
 * 节点取自书籍自己的目录条目：目录比正文文件更细时（《何为良好生活》11 个
 * 正文文件 / 81 条目录，70 个「节」是同文件内的锚点），锚点让每个节都有独立
 * 的文本范围；目录比正文文件更糙时（《思考快与慢》182 段 / 48 条目录），相邻
 * 的碎片段并入同一条目，反而消除了「第 N 节」填充标题。
 *
 * 返回 null 表示目录不足以建节点（条目太少或锚点无法定位），由调用方回退到
 * 物理段分段。
 */
export function buildTocNodes(
  bookHash: string,
  sections: readonly SpineSectionInput[],
  entries: readonly BookTocEntry[],
  fullText: string,
): BookNode[] | null {
  if (entries.length < 2) return null;
  const starts = spineStartOffsets(sections);
  const indexBySpine = new Map<number, number>();
  sections.forEach((section, index) => indexBySpine.set(section.spineIndex, index));

  const anchorOffsets = new Map<string, number>();
  for (const section of sections) {
    for (const anchor of section.anchors ?? []) {
      anchorOffsets.set(`${section.spineIndex}#${anchor.id}`, anchor.offset);
    }
  }

  const rows: NodeStart[] = [];
  for (const entry of entries) {
    const sectionIndex = indexBySpine.get(entry.spineIndex);
    if (sectionIndex === undefined) continue;
    const section = sections[sectionIndex]!;
    const base = starts[sectionIndex]!;
    const spineEndOffset = base + section.text.length;
    let offset = base;
    if (entry.anchor) {
      const found = anchorOffsets.get(`${entry.spineIndex}#${entry.anchor}`);
      // 锚点定位不到就不造节点：宁可少一层，也不要凭空生出假章节。
      if (found === undefined) continue;
      offset = base + found;
    }
    rows.push({
      title: entry.label,
      offset,
      declaredDepth: entry.depth,
      spineIndex: entry.spineIndex,
      spineEndOffset,
      ...(entry.anchor !== undefined ? { anchor: entry.anchor } : {}),
      ...(entry.href !== undefined ? { href: entry.href } : {}),
    });
  }
  if (rows.length < 2) return null;

  // 文档顺序。同一位置的多条目录要分开处理：
  // - **同一层**的多条（《何为良好生活》指向同一个文件的「版权页」/「序言」）只留
  //   最后一条，更靠后的条目通常更具体；
  // - **不同层**的全部保留：第二层的节点需要它上面的章作为归属，而章本身退回物理
  //   段首——它的标题行就在那里，正好成为章自己的正文。这条规则来自真实的
  //   《何为良好生活》：它的 NCX 把「第一章」和「§1」指向同一个 `#sigil_toc_id_1`，
  //   若只留一条，8 个章会只剩最后 1 个，70 个节全部挂到「序言」名下。
  const sorted = [...rows].sort((a, b) => a.offset - b.offset);
  const deduped: NodeStart[] = [];
  let cursor = 0;
  while (cursor < sorted.length) {
    const offset = sorted[cursor]!.offset;
    const group: NodeStart[] = [];
    while (cursor < sorted.length && sorted[cursor]!.offset === offset) {
      group.push(sorted[cursor]!);
      cursor += 1;
    }
    const byDepth = new Map<number, NodeStart>();
    for (const row of group) byDepth.set(row.declaredDepth ?? 0, row);
    const deepest = Math.max(...byDepth.keys());
    for (const [depth, row] of byDepth) {
      if (depth === deepest || byDepth.size === 1) {
        deduped.push(row);
        continue;
      }
      // 更浅的一层退到段首，锚点归它下面的节点：读者定位到该锚点时落进节而不是章。
      const { anchor: _drop, ...rest } = row;
      const sectionIndex = row.spineIndex !== undefined ? indexBySpine.get(row.spineIndex) : undefined;
      deduped.push(
        sectionIndex !== undefined ? { ...rest, offset: starts[sectionIndex]! } : { ...rest },
      );
    }
  }
  return toBookNodes(bookHash, fullText, deduped);
}

/**
 * Level 1: build nodes straight from a healthy native spine. Each spine
 * section becomes one node; offsets live in the joined-text space.
 * Hierarchy uses the same positional classifier: 卷/部/篇/部分 (Part/Book)
 * spine titles are first-level 章 containers; everything after them nests as a
 * 节 until the next container.
 */
function buildSpineNodes(
  bookHash: string,
  sections: SpineSectionInput[],
  fullText: string,
): SpineSegmentResult {
  const starts = spineStartOffsets(sections);
  const rows: NodeStart[] = sections.map((section, index) => ({
    title: section.title,
    offset: starts[index]!,
    spineIndex: section.spineIndex,
    spineEndOffset: starts[index]! + section.text.length,
  }));
  return { strategy: 'native', nodes: toBookNodes(bookHash, fullText, rows) };
}

/**
 * Segment an engine book: the book's own directory wins (Level 1, anchors
 * included); a healthy spine maps 1:1 when there is no usable directory;
 * degenerate monolithic spines fall through the Level 2/3 pipeline.
 */
export function segmentSpineBook(
  bookHash: string,
  sections: SpineSectionInput[],
  entries: readonly BookTocEntry[] = [],
): SpineSegmentResult & { fullText: string } {
  const fullText = sections.map((section) => section.text).join(SPINE_JOIN);
  const fromToc = buildTocNodes(bookHash, sections, entries, fullText);
  if (fromToc) return { strategy: 'native', nodes: fromToc, fullText };

  const charCounts = sections.map((section) => section.text.length);
  if (!isDegenerateSpine(charCounts)) {
    return { ...buildSpineNodes(bookHash, sections, fullText), fullText };
  }
  const monolithic = segmentMonolithic(bookHash, fullText);
  return { strategy: monolithic.strategy, nodes: monolithic.nodes, fullText };
}

