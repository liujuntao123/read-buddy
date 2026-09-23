/**
 * Reader highlight breathing service (reading-agent architecture doc §3.3 +
 * §7.2): wraps a quoted snippet inside a rendered chapter (the TXT scroll
 * article or a Foliate iframe document) in <mark.readest-agent-highlight>
 * nodes, drives a 2-second breathing animation and scrolls the first mark into
 * view.
 *
 * This is the **agent's transient cue** — it breathes and then clears itself.
 * The reader's own persistent marks (划线) are a different feature with a
 * different lifetime; they live in `services/reader/readerHighlight` and share
 * this module's DOM primitives (`services/reader/textMarks`), so the two can
 * never disagree about how a quote is located or split across text nodes.
 */
import {
  collectTextSegments,
  findAnchoredQuote,
  injectStyleOnce,
  ownerDocumentOf,
  unwrapMarks,
  wrapTextRange,
} from './textMarks';

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
  injectStyleOnce(root, STYLE_ID, HIGHLIGHT_CSS);
}

/** Remove every previous agent highlight mark inside `root`. */
export function clearHighlights(root: HTMLElement | null | undefined): void {
  unwrapMarks(root, HIGHLIGHT_CLASS);
}

/**
 * Highlight `snippet` inside `root` with the breathing animation and scroll
 * the first mark into view. Returns true when the snippet was found.
 *
 * `options.anchor` disambiguates a repeated sentence (the reader's own marks
 * carry their surrounding text for exactly this reason); `options.onDone` fires
 * once the animation window elapses.
 */
export function highlightSnippet(
  root: HTMLElement | null | undefined,
  snippet: string,
  options: { anchor?: { prefix?: string; suffix?: string }; onDone?: () => void } = {},
): boolean {
  if (!root) return false;
  const needle = snippet.trim();
  if (!needle) return false;

  clearHighlights(root);
  injectHighlightStyles(ownerDocumentOf(root));

  const docText = collectTextSegments(root);
  const match = findAnchoredQuote(docText, { quote: needle, ...options.anchor });
  if (!match) {
    // Degraded match: retry with a strict prefix of the snippet (model
    // quotes sometimes drift from the cleaned text).
    const prefix = needle.slice(0, Math.max(4, Math.min(12, needle.length - 1)));
    if (prefix.length < 4 || prefix.length >= needle.length) return false;
    return highlightSnippet(root, prefix, options);
  }

  const marks = wrapTextRange(docText, match, HIGHLIGHT_CLASS);
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
