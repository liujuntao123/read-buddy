/**
 * Reader highlights (划线) — painting, and reading a text anchor off a selection.
 *
 * The agent's cue (`services/reader/highlight`) breathes for two seconds and
 * clears itself; this module paints **persistent** marks and repaints them every
 * time the chapter is loaded again. Both are built on the same primitives
 * (`services/reader/textMarks`), so the two can never wrap text differently.
 *
 * A highlight is found again by its **text anchor** (quote + surrounding
 * context), because the engine throws a chapter's document away on every load and
 * the host article is re-rendered whenever the reader changes typography. When
 * two identical sentences sit in one chapter, the context decides which one the
 * mark belongs to — and each highlight consumes the occurrence it matched, so a
 * third identical sentence does not steal the first one's mark.
 */
import {
  collectTextSegments,
  findAnchoredQuote,
  findQuote,
  injectStyleOnce,
  textRangeOfDomRange,
  unwrapMarks,
  wrapTextRange,
  type DocumentText,
} from './textMarks';
import {
  TEXT_ANCHOR_CONTEXT_CHARS,
  type ReaderHighlight,
} from '@/types/highlight';

export const READER_HIGHLIGHT_CLASS = 'read-buddy-reader-highlight';
const STYLE_ID = 'read-buddy-reader-highlight-style';
/** Marks that the reader just jumped to get a short, stronger emphasis. */
export const READER_HIGHLIGHT_ACTIVE_CLASS = 'is-jump-target';

/**
 * Which highlight a painted `<mark>` belongs to. One highlight can be painted as
 * **several** marks (a quote that crosses a paragraph boundary is wrapped once per
 * text node), so identity has to travel on the element: the reader clicking a mark
 * must be able to name the row it came from without guessing from the text.
 */
export const READER_HIGHLIGHT_ID_ATTRIBUTE = 'data-highlight-id';

/** Every painted reader mark, in document order. */
export const READER_HIGHLIGHT_SELECTOR = `mark.${READER_HIGHLIGHT_CLASS}`;

/**
 * The mark's look: a soft amber wash plus a solid underline — 「划线」 reads as a
 * line, not as a second background colour, and the amber pair stays legible on
 * all three reading themes (light / sepia / dark) without depending on a token
 * that the chapter iframe may not define.
 *
 * `cursor: pointer` is not decoration: a mark is clickable (it re-opens the
 * selection toolbar with 取消划线), and nothing else on the page says so.
 */
const HIGHLIGHT_CSS = `
mark.${READER_HIGHLIGHT_CLASS} {
  background-color: rgba(250, 204, 21, 0.3);
  border-bottom: 2px solid rgba(202, 138, 4, 0.85);
  border-radius: 2px;
  color: inherit;
  padding-bottom: 0.06em;
  cursor: pointer;
}
mark.${READER_HIGHLIGHT_CLASS}.${READER_HIGHLIGHT_ACTIVE_CLASS} {
  background-color: rgba(250, 204, 21, 0.55);
  animation: read-buddy-reader-highlight-pulse 1.1s ease-in-out 2;
}
@keyframes read-buddy-reader-highlight-pulse {
  0%, 100% { background-color: rgba(250, 204, 21, 0.55); }
  50% { background-color: rgba(250, 204, 21, 0.22); }
}
`;

/** Inject the mark stylesheet into a document once (host document or iframe). */
export function injectReaderHighlightStyles(doc: Document): void {
  injectStyleOnce(doc, STYLE_ID, HIGHLIGHT_CSS);
}

/** The text anchor of a quote inside a rendered document, or null when absent. */
export function textAnchorOf(
  docText: DocumentText,
  quote: string,
  context = TEXT_ANCHOR_CONTEXT_CHARS,
): { quote: string; prefix?: string; suffix?: string } | null {
  const match = findAnchoredQuote(docText, { quote }, context);
  if (!match) return null;
  return anchorAround(docText, match, quote, context);
}

/** The anchor for a known range, with the surrounding context read off it. */
const anchorAround = (
  docText: DocumentText,
  range: { start: number; end: number },
  quote: string,
  context: number,
): { quote: string; prefix?: string; suffix?: string } => {
  const prefix = docText.text.slice(Math.max(0, range.start - context), range.start);
  const suffix = docText.text.slice(range.end, range.end + context);
  return {
    quote,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  };
};

/**
 * Read the text anchor for a selection made in `root`.
 *
 * The live `range` is used whenever it is available: it is the only way to know
 * *which* of several identical sentences the reader marked, and the context is
 * then read from that exact occurrence. Without a range the first occurrence is
 * assumed — degraded, but a highlight is never lost over it.
 *
 * The selection's own string is the quote (`Selection.toString()` inserts block
 * separators the concatenated text does not have, which is why matching ignores
 * whitespace on both sides).
 */
export function anchorForSelection(
  root: HTMLElement | null | undefined,
  quote: string,
  range?: Range,
  context = TEXT_ANCHOR_CONTEXT_CHARS,
): { quote: string; prefix?: string; suffix?: string } | null {
  if (!root) return null;
  const trimmed = quote.trim();
  if (!trimmed) return null;
  const docText = collectTextSegments(root);
  if (range) {
    const precise = textRangeOfDomRange(docText, range);
    if (precise) return anchorAround(docText, precise, trimmed, context);
  }
  const fallback = findAnchoredQuote(docText, { quote: trimmed }, context);
  return fallback ? anchorAround(docText, fallback, trimmed, context) : null;
}

export interface MarkReaderHighlightsResult {
  /** Ids of the highlights that were painted. */
  applied: string[];
  /** Ids whose text could not be found in this document (another chapter?). */
  missing: string[];
  /** Every mark element created, in document order. */
  marks: HTMLElement[];
}

/**
 * Paint `highlights` onto `root`, replacing whatever was painted before.
 *
 * Idempotent by construction: existing marks are unwrapped first, so this can be
 * called on every chapter load, on every store change and after a typography
 * change without accumulating nested marks. Highlights are matched in the order
 * given (document order — see `compareHighlights`), each consuming the
 * occurrence it matched.
 */
export function markReaderHighlights(
  root: HTMLElement | null | undefined,
  highlights: readonly ReaderHighlight[],
  options: { activeIds?: readonly string[] } = {},
): MarkReaderHighlightsResult {
  const result: MarkReaderHighlightsResult = { applied: [], missing: [], marks: [] };
  if (!root) return result;

  unwrapMarks(root, READER_HIGHLIGHT_CLASS);
  if (highlights.length === 0) return result;
  injectReaderHighlightStyles(root.ownerDocument);

  const docText = collectTextSegments(root);
  /** Ranges already claimed, so duplicate quotes do not overlap. */
  const claimed: Array<{ start: number; end: number }> = [];
  const active = new Set(options.activeIds ?? []);

  for (const highlight of highlights) {
    const matches = candidateRanges(docText, highlight);
    const match = matches.find(
      (candidate) =>
        !claimed.some((used) => candidate.start < used.end && candidate.end > used.start),
    );
    if (!match) {
      result.missing.push(highlight.id);
      continue;
    }
    claimed.push(match);
    const marks = wrapTextRange(docText, match, READER_HIGHLIGHT_CLASS);
    for (const mark of marks) {
      // Identity for the click path: a mark that cannot say which row it paints
      // cannot offer 取消划线.
      mark.setAttribute(READER_HIGHLIGHT_ID_ATTRIBUTE, highlight.id);
      if (active.has(highlight.id)) mark.classList.add(READER_HIGHLIGHT_ACTIVE_CLASS);
    }
    result.marks.push(...marks);
    result.applied.push(highlight.id);
  }

  return result;
}

/** The element a click landed on (clicks can target a bare text node). */
const elementOf = (target: EventTarget | null): Element | null => {
  if (!target) return null;
  if ((target as Node).nodeType === 3) return (target as Text).parentElement;
  return target as Element;
};

/**
 * The highlight id of the mark a click landed on, or null when the reader clicked
 * anything else.
 */
export function highlightIdAt(target: EventTarget | null): string | null {
  const element = elementOf(target);
  if (!element || typeof element.closest !== 'function') return null;
  const mark = element.closest(
    `${READER_HIGHLIGHT_SELECTOR}[${READER_HIGHLIGHT_ID_ATTRIBUTE}]`,
  );
  return mark?.getAttribute(READER_HIGHLIGHT_ID_ATTRIBUTE) ?? null;
}

/**
 * The rect that covers **every** mark of one highlight in `root` — a quote across
 * a paragraph break is two marks, and the toolbar must sit over the whole mark,
 * not over its first line.
 *
 * Returns null when that highlight is not painted here (another chapter's row).
 */
export function highlightRectIn(root: ParentNode | null | undefined, id: string): DOMRect | null {
  if (!root) return null;
  const marks = Array.from(
    root.querySelectorAll(
      `${READER_HIGHLIGHT_SELECTOR}[${READER_HIGHLIGHT_ID_ATTRIBUTE}="${cssEscape(id)}"]`,
    ),
  );
  return unionRect(marks);
}

/** Quote an attribute value for a selector without requiring `CSS.escape`. */
const cssEscape = (value: string): string => value.replace(/["\\]/g, '\\$&');

/** The union of the client rects of `elements`, or null when none has one. */
export function unionRect(elements: readonly Element[]): DOMRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const element of elements) {
    if (typeof element.getBoundingClientRect !== 'function') continue;
    const rect = element.getBoundingClientRect();
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Every occurrence this highlight could legitimately claim, best first. */
function candidateRanges(
  docText: DocumentText,
  highlight: ReaderHighlight,
): Array<{ start: number; end: number }> {
  // A text anchor is a *hint*, never a requirement: when the context has drifted
  // (a re-typeset chapter, a sanitizer change), the quote alone must still find
  // its mark — losing a highlight because its neighbour text moved is worse than
  // painting the wrong twin of two identical sentences.
  const ranges: Array<{ start: number; end: number }> = [];
  const anchored = findAnchoredQuote(docText, highlight);
  if (anchored) ranges.push({ start: anchored.start, end: anchored.end });
  for (const match of findQuote(docText, highlight.quote)) {
    if (!ranges.some((range) => range.start === match.start && range.end === match.end)) {
      ranges.push({ start: match.start, end: match.end });
    }
  }
  return ranges;
}
