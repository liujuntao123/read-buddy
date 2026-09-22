/**
 * Reader highlight breathing service (reading-agent architecture doc §3.3 +
 * §7.2): wraps a quoted snippet inside a rendered chapter (the TXT scroll
 * article or a Foliate iframe document) in <mark.readest-agent-highlight>
 * nodes and drives a 2-second breathing animation, scrolling the first mark
 * into view. Cross-node snippets are handled by wrapping every text-node
 * portion of the match range separately.
 */

export const HIGHLIGHT_CLASS = 'readest-agent-highlight';
/** How long the breathing animation runs before the marks fade out. */
export const HIGHLIGHT_DURATION_MS = 2_000;
const STYLE_ID = 'readest-agent-highlight-style';

const HIGHLIGHT_CSS = `
@keyframes readest-agent-breathe {
  0%, 100% { background-color: transparent; }
  50% { background-color: rgba(250, 204, 21, 0.55); }
}
.${HIGHLIGHT_CLASS} {
  background-color: rgba(250, 204, 21, 0.35);
  color: inherit;
  border-radius: 2px;
  animation: readest-agent-breathe 1s ease-in-out 2;
  transition: background-color 0.4s ease;
}
`;

/** Inject the keyframes once per document (idempotent). */
export function injectHighlightStyles(target: Document | ShadowRoot): void {
  const root = target as Document;
  if (!root || typeof root.getElementById !== 'function') return;
  if (root.getElementById(STYLE_ID)) return;
  const style = root.createElement('style');
  style.id = STYLE_ID;
  style.textContent = HIGHLIGHT_CSS;
  (root.head ?? root.documentElement ?? root).appendChild(style);
}

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

/** Concatenated visible text plus its text-node index. */
function collectTextSegments(root: Node): { text: string; segments: TextSegment[] } {
  const segments: TextSegment[] = [];
  let text = '';
  const walker = documentOwner(root).createTreeWalker(root, NodeFilter.SHOW_TEXT);
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

const documentOwner = (node: Node): Document =>
  (node as Node & { ownerDocument?: Document }).ownerDocument ??
  (node as unknown as Document);

/** Remove every previous agent highlight mark inside `root`. */
export function clearHighlights(root: HTMLElement | null | undefined): void {
  if (!root) return;
  for (const mark of Array.from(root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(documentOwner(root).createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  }
}

/**
 * Highlight `snippet` inside `root` with the breathing animation and scroll
 * the first mark into view. Returns true when the snippet was found.
 * `options.onDone` fires once the animation window elapses.
 */
export function highlightSnippet(
  root: HTMLElement | null | undefined,
  snippet: string,
  options: { onDone?: () => void } = {},
): boolean {
  if (!root) return false;
  const needle = snippet.trim();
  if (!needle) return false;

  clearHighlights(root);
  injectHighlightStyles(documentOwner(root));

  const { text, segments } = collectTextSegments(root);
  const hitStart = text.indexOf(needle);
  if (hitStart === -1) {
    // Degraded match: retry with a strict prefix of the snippet (model
    // quotes sometimes drift from the cleaned text).
    const prefix = needle.slice(0, Math.max(4, Math.min(12, needle.length - 1)));
    if (prefix.length < 4 || prefix.length >= needle.length) return false;
    return highlightSnippet(root, prefix, options);
  }
  const hitEnd = hitStart + needle.length;

  const doc = documentOwner(root);
  const marks: HTMLElement[] = [];
  for (const segment of segments) {
    if (segment.end <= hitStart || segment.start >= hitEnd) continue;
    const from = Math.max(hitStart, segment.start) - segment.start;
    const to = Math.min(hitEnd, segment.end) - segment.start;
    let target = segment.node;
    let endNode = target;
    // Split the text node so [from, to) becomes its own node.
    if (to < (target.nodeValue?.length ?? 0)) {
      endNode = target.splitText(to);
    }
    if (from > 0) {
      target = target.splitText(from);
    }
    void endNode;
    const mark = doc.createElement('mark');
    mark.className = HIGHLIGHT_CLASS;
    target.parentNode?.replaceChild(mark, target);
    mark.appendChild(target);
    marks.push(mark);
  }

  if (marks.length === 0) return false;
  marks[0]!.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const element = root as HTMLElement & { __agentHighlightTimer?: ReturnType<typeof setTimeout> };
  if (element.__agentHighlightTimer) clearTimeout(element.__agentHighlightTimer);
  element.__agentHighlightTimer = setTimeout(() => {
    clearHighlights(root);
    options.onDone?.();
  }, HIGHLIGHT_DURATION_MS + 400);
  return true;
}
