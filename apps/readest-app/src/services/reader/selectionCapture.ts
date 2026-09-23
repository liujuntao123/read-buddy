/**
 * Text Selection capture — one set of rules, two adapters (ADR 0007; 候选 epilogue).
 *
 * The reader captures selections from two different documents: the host window's
 * article (the TXT scroll reader) and the chapter iframe the Foliate engine
 * recreates on every chapter change. Two hooks grew out of that, and they
 * **restated the rules**:
 *
 * - eligibility (non-collapsed, ≥ `MIN_SELECTION_CHARS` trimmed, rect from the
 *   range) was written twice;
 * - the `mouseup` / `keyup` / `selectionchange` triple was written twice;
 * - `reset()` cleared the selection through two different mechanisms.
 *
 * The only thing that genuinely varies is **which document** the selection lives
 * in, plus (for the iframe) a coordinate translation from the chapter's viewport
 * to page coordinates. Both adapters now call into this module and keep only that
 * varying part, so a rule change — a CJK-aware minimum length, an extra gesture
 * event — lands in one place instead of silently diverging between the two.
 *
 * This module is deliberately DOM-only and framework-free: the hooks are thin
 * React wrappers over it.
 */

/** Selections shorter than this (after trimming) never summon the toolbar. */
export const MIN_SELECTION_CHARS = 2;

/**
 * The three events that end or collapse a selection gesture.
 *
 * `mouseup`/`keyup` finish a gesture (a selection now exists); `selectionchange`
 * also fires mid-drag, which is why it is used to *hide* rather than to show —
 * otherwise the toolbar flickers while the reader is still selecting.
 */
export const SELECTION_EVENTS = ['mouseup', 'keyup', 'selectionchange'] as const;

/** A validated selection: trimmed text plus the rect of its range. */
export interface RawSelection {
  text: string;
  rect: DOMRect;
  /**
   * The live range the selection came from, when the document offered one.
   *
   * Reader highlights need it to know **which** occurrence of a repeated phrase
   * was marked: the quote alone cannot tell two identical sentences apart, and
   * the surrounding context can be read off the range's exact offsets. It is
   * deliberately optional — a test adapter feeds a ready-made `{text, rect}`, and
   * a range never outlives the document it came from (the engine recreates a
   * chapter's document on every chapter change).
   */
  range?: Range;
}

/** The rect of a range, with a zero rect fallback for environments without one. */
const rectOf = (range: Range): DOMRect =>
  typeof range.getBoundingClientRect === 'function'
    ? range.getBoundingClientRect()
    : new DOMRect(0, 0, 0, 0);

/**
 * The one eligibility rule.
 *
 * Returns null unless the selection is non-collapsed, at least
 * `MIN_SELECTION_CHARS` long after trimming, and — when `within` is given —
 * anchored inside that node. The containment check is what makes a selection in
 * the *host* article distinguishable from one in a chapter iframe; adapters whose
 * whole document is reader content simply omit it.
 */
export function readSelection(doc: Document, within?: Node | null): RawSelection | null {
  const selection = doc.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().trim();
  if (text.length < MIN_SELECTION_CHARS) return null;

  const range = selection.getRangeAt(0);
  if (within) {
    const ancestor = range.commonAncestorContainer;
    const anchor =
      ancestor.nodeType === Node.TEXT_NODE
        ? ancestor.parentElement
        : (ancestor as HTMLElement | null);
    if (!anchor || !within.contains(anchor)) return null;
  }

  return { text, rect: rectOf(range), range };
}

/** Wipe a document's native selection (no visual residue after an action). */
export function clearSelection(doc: Document | null | undefined): void {
  doc?.getSelection?.()?.removeAllRanges();
}

export interface CaptureSelectionsOptions {
  /** The document to listen in. */
  doc: Document;
  /** Adapter-specific reader; defaults to the shared rule with no containment. */
  read?: (doc: Document) => RawSelection | null;
  /** Adapter-specific coordinate translation (iframe → page). */
  toPage?: (raw: RawSelection, doc: Document) => RawSelection;
  /** Called on every gesture event with the current eligible selection, or null. */
  onChange: (selection: RawSelection | null) => void;
}

/**
 * Listen for selection gestures in one document and report the current eligible
 * selection. Returns the detach function; detaching never fires `onChange`, so a
 * caller can drop the listener while tearing down without a state update.
 */
export function captureSelections(options: CaptureSelectionsOptions): () => void {
  const { doc, onChange, toPage } = options;
  const read = options.read ?? ((target: Document) => readSelection(target));
  const handle = (): void => {
    const found = read(doc);
    onChange(found ? (toPage ? toPage(found, doc) : found) : null);
  };
  for (const event of SELECTION_EVENTS) doc.addEventListener(event, handle);
  return () => {
    for (const event of SELECTION_EVENTS) doc.removeEventListener(event, handle);
  };
}

/**
 * Translate the document's own viewport coordinates into page coordinates by
 * adding the host rect of the iframe that owns the document (ADR 0007). A
 * document that is not framed (or whose frame is unreachable) is already in page
 * coordinates, so the raw rect is returned unchanged.
 */
export function toPageCoordinates(raw: RawSelection, doc: Document): RawSelection {
  const frame = doc.defaultView?.frameElement;
  if (!frame || typeof frame.getBoundingClientRect !== 'function') return raw;
  const offset = frame.getBoundingClientRect();
  return {
    text: raw.text,
    rect: new DOMRect(
      raw.rect.left + offset.left,
      raw.rect.top + offset.top,
      raw.rect.width,
      raw.rect.height,
    ),
    // The range still lives in the chapter's document — only its *rect* needs
    // translating into page coordinates.
    ...(raw.range ? { range: raw.range } : {}),
  };
}