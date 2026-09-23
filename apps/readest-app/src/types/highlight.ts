/**
 * Reader highlights (划线) — CONTEXT.md 「Highlight」.
 *
 * A Highlight is a **reader-made** mark over a Text Selection: unlike the agent's
 * breathing cue (`services/reader/highlight`, which appears for two seconds and
 * clears itself), a reader highlight is persisted and re-rendered every time its
 * chapter is painted again.
 *
 * Where a highlight lives is recorded in the reader's own two coordinate spaces
 * rather than in a renderer-specific one (ADR 0018):
 *
 * - `nodeIndex` / `nodeTitle` — the Book Node (CONTEXT.md) the selection sits in,
 *   which is how the sidebar names it and how a jump is requested;
 * - `spineIndex` / `anchor` — the physical section it must be painted on;
 * - `quote` + `prefix` / `suffix` — the **text anchor**: the one piece of
 *   identity that survives the DOM being thrown away and rebuilt (the engine
 *   recreates a chapter's document on every load, and the host article is
 *   re-rendered on every settings change).
 *
 * The text anchor is deliberately a *quote*, not a character offset into the
 * global text space: the DOM shows rendered text, the node model indexes cleaned
 * text, and the two differ by whitespace and markup the sanitizer removes. A
 * quote is what both sides actually agree on — which is how the agent's own
 * `locate_in_reader` works (`services/reader/highlight`).
 */

export interface ReaderHighlight {
  /** Primary key: `${bookHash}:h_${uuid}` — the `h_` prefix keeps it tellable. */
  id: string;
  bookHash: string;
  /** 0-based global node ordinal the selection was made in. */
  nodeIndex: number;
  /** Node title as it read at creation time (the index may land later). */
  nodeTitle: string;
  /** Physical section ordinal — the chapter this highlight is painted on. */
  spineIndex: number;
  /** Intra-section directory anchor of the reading position, when it had one. */
  anchor?: string;
  /** The selected text, exactly as it was rendered. */
  quote: string;
  /** Up to `TEXT_ANCHOR_CONTEXT_CHARS` characters before the quote. */
  prefix?: string;
  /** Up to `TEXT_ANCHOR_CONTEXT_CHARS` characters after the quote. */
  suffix?: string;
  createdAt: number;
}

/** How much surrounding text an anchor keeps, on each side. */
export const TEXT_ANCHOR_CONTEXT_CHARS = 24;

/** Primary key of a `highlights` row. */
export const highlightId = (bookHash: string, uuid: string): string => `${bookHash}:h_${uuid}`;

/** What a highlight needs in order to be created (the rest is identity/time). */
export interface NewReaderHighlight {
  bookHash: string;
  nodeIndex: number;
  nodeTitle: string;
  spineIndex: number;
  anchor?: string;
  quote: string;
  prefix?: string;
  suffix?: string;
}

/** Document order: by node, then by when the reader marked it. */
export const compareHighlights = (a: ReaderHighlight, b: ReaderHighlight): number =>
  a.nodeIndex - b.nodeIndex || a.createdAt - b.createdAt;
