/**
 * ChapterTextExtractor (ticket 02).
 *
 * Turns a Foliate spine section's HTML string into normalized plain text:
 * non-content nodes stripped, block-level elements joined by single
 * newlines, inline whitespace collapsed. Ticket 03 (chapter summaries)
 * consumes `extractChapterText` / `extractPlainTextForPrompt` to build
 * model prompts for the section currently open in the reader.
 */

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

export interface ChapterText {
  /** Text of the first h1~h6 heading, empty string when absent. */
  title: string;
  /** Normalized plain text, paragraphs joined by single newlines. */
  text: string;
  /** Convenience equal to `text.length`. */
  charCount: number;
}

/** Collapse runs of whitespace (incl. &nbsp;) into one space and trim. */
const collapseInline = (value: string): string => value.replace(/\s+/g, ' ').trim();

function stripNonContent(root: Element): void {
  // querySelectorAll returns a static snapshot, safe to mutate while iterating.
  root.querySelectorAll('*').forEach((el) => {
    if (NON_CONTENT_TAGS.has(el.tagName.toUpperCase())) el.remove();
  });
}

/** Depth-first walk emitting raw text with '\n' markers at block boundaries. */
function collectBlocks(node: Node, parts: string[]): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(child.nodeValue ?? '');
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const el = child as Element;
    if (el.tagName === 'BR') {
      parts.push('\n');
      return;
    }
    if (BLOCK_TAGS.has(el.tagName)) {
      parts.push('\n');
      collectBlocks(el, parts);
      parts.push('\n');
      return;
    }
    collectBlocks(el, parts);
  });
}

/**
 * Extract normalized plain text from a spine section HTML string.
 * Line-level rules: inline whitespace collapsed to one space, lines
 * trimmed, at most single newlines between paragraphs (no blank lines).
 */
export function extractChapterText(html: string): ChapterText {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const heading = doc.querySelector('h1, h2, h3, h4, h5, h6');
  const title = heading ? collapseInline(heading.textContent ?? '') : '';

  const body = doc.body;
  if (!body) return { title, text: '', charCount: 0 };

  stripNonContent(body);
  const parts: string[] = ['\n'];
  collectBlocks(body, parts);
  parts.push('\n');

  const text = parts
    .join('')
    .split('\n')
    .map(collapseInline)
    .filter((line) => line.length > 0)
    .join('\n');

  return { title, text, charCount: text.length };
}

/** Default prompt budget: text at or below this length feeds a single call. */
export const PROMPT_TEXT_MAX_CHARS = 12_000;

const TRUNCATION_MARKER = (total: number, kept: number): string =>
  `\n…[已截断：原文共 ${total} 字，此处仅保留前 ${kept} 字]`;

/**
 * Prepare chapter text for injection into a model prompt: returns the text
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
