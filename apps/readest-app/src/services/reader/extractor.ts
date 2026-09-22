/**
 * NodeTextExtractor (ticket 02).
 *
 * Turns a spine section's HTML string into normalized plain text:
 * non-content nodes stripped, block-level elements joined by single
 * newlines, inline whitespace collapsed.
 *
 * `extractAnchoredNodeText` additionally reports, for a caller-supplied set of
 * directory anchor ids, the character offset at which each anchor's line
 * begins in that very text. Both come out of ONE DOM walk, so the offsets are
 * aligned with `text` by construction: a book whose table of contents points
 * at anchors *inside* one spine file (EPUB `#sigil_toc_id_N`) can therefore be
 * split into per-节 nodes over the unified global character space.
 */
import type { NodeAnchor } from '@/types/readingAgent';

/** Elements that never contribute reader-facing text. */
const NON_CONTENT_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'SVG',
  'IMG',
  'IFRAME',
  'NOSCRIPT',
  'LINK',
  'META',
  'TEMPLATE',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'OBJECT',
  'EMBED',
]);

/** Elements that start a new visual line of extracted text. */
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'DD',
  'FIGURE',
  'FIGCAPTION',
  'FOOTER',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TR',
  'TD',
  'TH',
  'UL',
]);

export interface NodeText {
  /** Text of the first h1~h6 heading, empty string when absent. */
  title: string;
  /** Normalized plain text, paragraphs joined by single newlines. */
  text: string;
  /** Convenience equal to `text.length`. */
  charCount: number;
}

export interface AnchoredNodeText extends NodeText {
  /** Requested anchor id → offset of its line start inside `text`. */
  anchorOffsets: Record<string, number>;
}

/** Collapse runs of whitespace (incl. &nbsp;) into one space and trim. */
const collapseInline = (value: string): string => value.replace(/\s+/g, ' ').trim();

function stripNonContent(root: Element): void {
  // querySelectorAll returns a static snapshot, safe to mutate while iterating.
  root.querySelectorAll('*').forEach((el) => {
    if (NON_CONTENT_TAGS.has(el.tagName.toUpperCase())) el.remove();
  });
}

/**
 * Depth-first walk emitting normalized lines, reporting anchor line offsets.
 *
 * Offset rule: an anchor id (or legacy `name`) is reported at the start of the
 * line its element belongs to. Directory anchors sit on block headings
 * (`<h2 id="sigil_toc_id_1">§1 …</h2>`), so the reported offset is exactly the
 * heading's line start; an anchor on an inline element degrades to the start
 * of the line containing it, which keeps the offset a valid line boundary.
 */
function collectLines(
  root: Node,
  anchorIds: ReadonlySet<string>,
  onAnchor: (id: string, offset: number) => void,
): string[] {
  const lines: string[] = [];
  let buffer = '';
  /** Length of `lines.join('\n')` so far. */
  let outLength = 0;

  /** Offset at which the next flushed line will start. */
  const nextLineStart = (): number => outLength + (outLength > 0 ? 1 : 0);

  const flush = (): void => {
    const collapsed = collapseInline(buffer);
    buffer = '';
    if (collapsed.length === 0) return;
    outLength = nextLineStart() + collapsed.length;
    lines.push(collapsed);
  };

  const visit = (el: Element): void => {
    const id = el.getAttribute('id');
    if (id && anchorIds.has(id)) onAnchor(id, nextLineStart());
    const name = el.getAttribute('name');
    if (name && anchorIds.has(name)) onAnchor(name, nextLineStart());
    walk(el);
  };

  const walk = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        buffer += child.nodeValue ?? '';
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const el = child as Element;
      if (el.tagName === 'BR') {
        flush();
        return;
      }
      if (BLOCK_TAGS.has(el.tagName)) {
        flush();
        visit(el);
        flush();
        return;
      }
      visit(el);
    });
  };

  walk(root);
  flush();
  return lines;
}

/**
 * Extract normalized plain text from a spine section HTML string.
 * Line-level rules: inline whitespace collapsed to one space, lines
 * trimmed, at most single newlines between paragraphs (no blank lines).
 */
export function extractNodeText(html: string): NodeText {
  const { title, text, charCount } = extractAnchoredNodeText(html, []);
  return { title, text, charCount };
}

/**
 * Same normalization as `extractNodeText`, plus the line offsets of the given
 * directory anchors. `extractAnchoredNodeText(html, []).text` is always
 * identical to `extractNodeText(html).text`.
 */
export function extractAnchoredNodeText(
  html: string,
  anchorIds: readonly string[],
): AnchoredNodeText {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const heading = doc.querySelector('h1, h2, h3, h4, h5, h6');
  const title = heading ? collapseInline(heading.textContent ?? '') : '';

  const body = doc.body;
  if (!body) return { title, text: '', charCount: 0, anchorOffsets: {} };

  stripNonContent(body);

  const wanted = new Set(anchorIds);
  const anchorOffsets: Record<string, number> = {};
  const lines = collectLines(body, wanted, (id, offset) => {
    // First occurrence wins: a duplicated id must not move the boundary.
    if (!(id in anchorOffsets)) anchorOffsets[id] = offset;
  });

  const text = lines.join('\n');
  return { title, text, charCount: text.length, anchorOffsets };
}

/** Line-start offsets of every resolved anchor, ordered by offset. */
export function resolveSpineAnchors(anchorOffsets: Record<string, number>): NodeAnchor[] {
  return Object.entries(anchorOffsets)
    .map(([id, offset]) => ({ id, offset }))
    .sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id));
}

/** Default prompt budget: text at or below this length feeds a single call. */
export const PROMPT_TEXT_MAX_CHARS = 12_000;

const TRUNCATION_MARKER = (total: number, kept: number): string =>
  `\n…[已截断：原文共 ${total} 字，此处仅保留前 ${kept} 字]`;

/**
 * Prepare node text for injection into a model prompt: returns the text
 * unchanged when within budget, otherwise truncates and appends an explicit
 * ellipsis marker so the model knows content was cut.
 */
export function extractPlainTextForPrompt(
  text: string,
  maxChars: number = PROMPT_TEXT_MAX_CHARS,
): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + TRUNCATION_MARKER(text.length, maxChars);
}
