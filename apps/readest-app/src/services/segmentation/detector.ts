/**
 * Regex heuristic chapter detector for unstructured / TOC-less books
 * (ticket 02, design doc 4.2, ADR 0005).
 *
 * Scans a monolithic plain-text document line by line; a line whose start
 * matches the canonical chapter-heading heuristic becomes a candidate
 * chapter anchor. Fewer than two anchors cannot form a multi-chapter
 * segmentation, so the detector reports failure with an empty array.
 */
import { CHAPTER_HEADING_PATTERN, type VirtualSection } from '@/types/ai';

export interface DetectedChapter {
  /** Trimmed heading line, e.g. "第一章 风起之地". */
  title: string;
  /** Character offset of the heading line's start within the full text. */
  charOffset: number;
}

/** A single heading cannot segment a book; require at least two anchors. */
export const MIN_DETECTED_CHAPTERS = 2;

/** Title used when non-blank text precedes the first detected heading. */
export const PREAMBLE_TITLE = '序言';

/**
 * Builds the line-level matcher from a token pattern: the line must START
 * with the chapter number token, optionally followed by title text,
 * whitespace, CJK/Latin punctuation or end of line. Always case-insensitive
 * ("chapter 2" hits like "Chapter 2").
 */
const buildHeadingLinePattern = (pattern: RegExp): RegExp =>
  new RegExp(`^(?:${pattern.source})(\\s|$|：|:|、|\\S*$)`, 'i');

/**
 * Detect chapter anchors in a full plain-text document.
 * Returns chapters ordered by ascending charOffset, prefixed with a
 * preamble pseudo-chapter when non-blank text precedes the first heading.
 * Returns [] when fewer than two headings are found.
 */
export function detectChapters(
  fullText: string,
  pattern: RegExp = CHAPTER_HEADING_PATTERN,
): DetectedChapter[] {
  const headingLine = buildHeadingLinePattern(pattern);
  const found: DetectedChapter[] = [];

  let lineStart = 0;
  for (const line of fullText.split('\n')) {
    const title = line.trim();
    if (title.length > 0 && headingLine.test(title)) {
      found.push({ title, charOffset: lineStart });
    }
    lineStart += line.length + 1; // +1 consumed '\n'
  }

  if (found.length < MIN_DETECTED_CHAPTERS) return [];

  const preambleText = fullText.slice(0, found[0]!.charOffset);
  const chapters: DetectedChapter[] =
    found[0]!.charOffset > 0 && preambleText.trim().length > 0
      ? [{ title: PREAMBLE_TITLE, charOffset: 0 }, ...found]
      : [...found];

  return chapters.sort((a, b) => a.charOffset - b.charOffset);
}

/**
 * Map detected chapters to persisted virtual sections: 0-based
 * virtualIndex, title and charOffset carried over, startCfi omitted
 * (plain-text books have no CFI anchors).
 */
export function buildVirtualSections(chapters: DetectedChapter[]): VirtualSection[] {
  return [...chapters]
    .sort((a, b) => a.charOffset - b.charOffset)
    .map((chapter, index) => ({
      virtualIndex: index,
      title: chapter.title,
      charOffset: chapter.charOffset,
    }));
}
