/**
 * Text marks — the one DOM walk that turns a *quote* into `<mark>` elements.
 *
 * Two features wrap reader text and they used to disagree about how: the agent's
 * breathing cue (`services/reader/highlight`) and reader highlights
 * (`services/reader/readerHighlight`). Both need the same three things — index a
 * document's text nodes, find a quote in that text, wrap the matching slice of
 * every text node it crosses — and neither needs to know about the other. This
 * module owns those three primitives; a caller supplies the class name, the CSS
 * and what to do afterwards.
 *
 * Why a quote and not an offset: the DOM shows *rendered* text while the node
 * model indexes *cleaned* text (the sanitizer drops markup, extraction
 * normalizes whitespace), so an offset computed on one side cannot be trusted on
 * the other. A quote plus its surrounding context is the identity both sides
 * agree on. Whitespace is ignored **on both sides** when matching, because a
 * selection that spans two paragraphs carries a block separator in
 * `Selection.toString()` that the concatenated text nodes never contain — the
 * single most common way a naive `indexOf` fails.
 */

/** One text node's slice of the document's concatenated text. */
export interface TextSegment {
  node: Text;
  /** Start offset of this node's text in the concatenated text. */
  start: number;
  end: number;
}

export interface DocumentText {
  /** Every non-blank text node's value, concatenated in document order. */
  text: string;
  segments: TextSegment[];
}

/** A range in the concatenated-text coordinate space. */
export interface TextRange {
  start: number;
  end: number;
}

/** The document a node belongs to (works for iframe documents too). */
export const ownerDocumentOf = (node: Node): Document =>
  (node as Node & { ownerDocument?: Document }).ownerDocument ?? (node as unknown as Document);

/**
 * Concatenate a root's non-blank text nodes in document order.
 *
 * Blank nodes are skipped (they carry no reader-visible text and would only add
 * noise to the offsets), and the concatenation inserts **nothing** between
 * nodes — the coordinate space is defined by this function, and `findQuote`
 * compensates for real block separators by ignoring whitespace.
 */
export function collectTextSegments(root: Node): DocumentText {
  const segments: TextSegment[] = [];
  let text = '';
  const owner = ownerDocumentOf(root);
  const walker = owner.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode() as Text | null;
  while (current) {
    const value = current.nodeValue ?? '';
    if (value.trim().length > 0) {
      segments.push({ node: current, start: text.length, end: text.length + value.length });
      text += value;
    }
    current = walker.nextNode() as Text | null;
  }
  return { text, segments };
}

/** Whitespace-insensitive projection: `compact[i]` came from `map[i]` in `text`. */
interface CompactText {
  compact: string;
  map: number[];
}

const compactOf = (text: string): CompactText => {
  const map: number[] = [];
  let compact = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (/\s/.test(char)) continue;
    compact += char;
    map.push(index);
  }
  return { compact, map };
};

/** A quote's occurrences, in the concatenated-text space. */
export interface QuoteMatch extends TextRange {
  /** The concatenated text immediately around this occurrence (for verification). */
  before: string;
  after: string;
}

/**
 * Every occurrence of `quote` in `docText.text`, in document order.
 *
 * Matching ignores whitespace on both sides (see the module note). Each match
 * reports the surrounding text so a caller holding a text anchor can pick the
 * occurrence whose context matches — which is how two identical sentences in one
 * chapter stay distinguishable.
 */
export function findQuote(docText: DocumentText, quote: string, context = 24): QuoteMatch[] {
  const needle = quote.replace(/\s+/g, '');
  if (!needle) return [];
  const { compact, map } = compactOf(docText.text);
  const matches: QuoteMatch[] = [];
  let cursor = 0;
  for (;;) {
    const at = compact.indexOf(needle, cursor);
    if (at < 0) break;
    const start = map[at]!;
    const end = map[at + needle.length - 1]! + 1;
    matches.push({
      start,
      end,
      before: docText.text.slice(Math.max(0, start - context), start),
      after: docText.text.slice(end, end + context),
    });
    cursor = at + needle.length;
  }
  return matches;
}

/** The single best occurrence for a text anchor, or null. */
export function findAnchoredQuote(
  docText: DocumentText,
  anchor: { quote: string; prefix?: string; suffix?: string },
  context = 24,
): QuoteMatch | null {
  const matches = findQuote(docText, anchor.quote, context);
  if (matches.length <= 1) return matches[0] ?? null;
  const contextMatches = matches.filter((match) => {
    const prefixOk = !anchor.prefix || match.before.endsWith(anchor.prefix.slice(-8));
    const suffixOk = !anchor.suffix || match.after.startsWith(anchor.suffix.slice(0, 8));
    return prefixOk && suffixOk;
  });
  return contextMatches[0] ?? matches[0]!;
}

/**
 * The offset in the concatenated text that a DOM point (container + offset)
 * refers to, or null when the point lies outside every indexed text node.
 *
 * The rule is "how much text comes before this point", which handles the two
 * shapes a selection endpoint takes: a **text node** plus a character offset (the
 * common case), and an **element** plus a child index — selecting a whole
 * paragraph, or dragging from a block boundary. For the latter, the point sits
 * before `childNodes[offset]`, so the answer is the end of the last indexed text
 * node among the preceding children (or the start of the first one inside the
 * element when nothing precedes it).
 */
function offsetOfPoint(docText: DocumentText, container: Node, offset: number): number | null {
  for (const segment of docText.segments) {
    if (segment.node === container) {
      const local = Math.min(Math.max(offset, 0), segment.end - segment.start);
      return segment.start + local;
    }
  }
  if (container.nodeType !== Node.ELEMENT_NODE) return null;

  const children = Array.from(container.childNodes);
  const before = offset >= children.length ? children : children.slice(0, offset);
  for (let index = docText.segments.length - 1; index >= 0; index -= 1) {
    const segment = docText.segments[index]!;
    if (before.some((child) => child === segment.node || child.contains(segment.node))) {
      return segment.end;
    }
  }
  const inside = docText.segments.find((segment) => container.contains(segment.node));
  return inside ? inside.start : null;
}

/**
 * Translate a live DOM `Range` into the concatenated-text coordinate space.
 *
 * This is what makes a highlight land on the sentence the reader actually
 * selected: a quote alone cannot distinguish two identical sentences, but the
 * range's exact offsets can. Returns null when the range's endpoints are not in
 * the indexed text (or when it is collapsed/inverted), leaving the caller to fall
 * back to a quote search.
 */
export function textRangeOfDomRange(docText: DocumentText, range: Range): TextRange | null {
  const start = offsetOfPoint(docText, range.startContainer, range.startOffset);
  const end = offsetOfPoint(docText, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

/**
 * Wrap `[from, to)` of the concatenated text in `<mark class="className">`
 * elements, one per text node the range crosses. Returns the marks created (in
 * document order).
 *
 * Text nodes are split so that each mark contains exactly its own slice, which
 * is what keeps a range that crosses a paragraph boundary from swallowing the
 * paragraph break into the mark.
 */
export function wrapTextRange(
  docText: DocumentText,
  range: TextRange,
  className: string,
): HTMLElement[] {
  const marks: HTMLElement[] = [];
  for (const segment of docText.segments) {
    if (segment.end <= range.start || segment.start >= range.end) continue;
    const from = Math.max(range.start, segment.start) - segment.start;
    const to = Math.min(range.end, segment.end) - segment.start;
    let target = segment.node;
    if (to < (target.nodeValue?.length ?? 0)) target.splitText(to);
    if (from > 0) target = target.splitText(from);
    const mark = ownerDocumentOf(target).createElement('mark');
    mark.className = className;
    target.parentNode?.replaceChild(mark, target);
    mark.appendChild(target);
    marks.push(mark);
  }
  return marks;
}

/**
 * Unwrap every `<mark class="className">` under `root`, restoring plain text.
 *
 * Adjacent text nodes are normalized so a wrap → unwrap → wrap cycle yields the
 * same segments (offsets stay stable across re-renders).
 */
export function unwrapMarks(root: HTMLElement | null | undefined, className: string): void {
  if (!root) return;
  for (const mark of Array.from(root.querySelectorAll(`mark.${className}`))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(ownerDocumentOf(root).createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  }
}

/** Inject a stylesheet into a document once (idempotent by `id`). */
export function injectStyleOnce(doc: Document, id: string, css: string): void {
  if (!doc || typeof doc.getElementById !== 'function') return;
  if (doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = css;
  (doc.head ?? doc.documentElement ?? doc).appendChild(style);
}
