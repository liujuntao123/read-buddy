/**
 * In-memory registry of the book currently opened in the reader.
 *
 * Parsers (EPUB spine sections, TXT monolithic text, demo fixtures) publish
 * an OpenedBookContent here; every AI feature resolves the current chapter
 * text through this registry (single source of truth, replacing the demo
 * hard-wiring). Nothing is persisted — re-opening a library book re-parses
 * the stored file bytes and re-registers.
 *
 * Since the node model landed (CONTEXT.md, ADR 0010) the registry also carries
 * the book's OWN directory, resolved onto the physical spine, plus the
 * intra-section anchors of each spine section: that pair is what lets the
 * importer cut a spine file into per-节 nodes (an EPUB whose NCX anchors
 * headings inside one file). Both are required members and may be empty, and the
 * book's `kind` says which adapter is behind them (候选 8).
 *
 * The registry is the **single owner** of an opened book's content: `openBook`
 * returns the same object it registered, so there is one copy of the fact no
 * matter which read path a caller takes.
 */
import type { BookTocEntry, NodeAnchor } from '@/types/readingAgent';

/**
 * What an opened book actually is. Stated by the adapter, never inferred.
 *
 * This used to be *probed*: consumers asked `!opened.getMonolithicText` to decide
 * "is this an engine book", and `SummaryTab` did exactly that (候选 8). A required
 * discriminant means the answer is a fact, not a capability test.
 */
export type OpenedBookKind = 'engine' | 'monolithic' | 'structured';

export interface OpenedBookContent {
  bookHash: string;
  /** What kind of source produced this content. */
  kind: OpenedBookKind;
  /** Structured spine length (1 for monolithic TXT before segmentation). */
  spineCount: number;
  getSpineTitle(index: number): string;
  /**
   * Display HTML (sanitized) for a spine section, from the adapter's cache.
   * An engine book has only rendered the sections the reader has visited, so an
   * empty string honestly means 「not rendered yet」 — this member is the *display*
   * path and nothing else should read it for text.
   */
  getSpineHtml(index: number): string;
  /**
   * Plain text of a spine section, **always loading it when needed** (the engine
   * fetches the section even if the reader never visited it).
   *
   * It used to be a *synchronous* `getSpineText` that returned the cache — or `''`
   * — for engine books, so one member answered both 「这段的正文是什么」 and 「读者
   * 访问过这段吗」, and every AI caller learned the workaround separately (候选 8).
   */
  getSpineText(index: number): Promise<string>;
  /**
   * Monolithic full text, for `kind === 'monolithic'` books; `undefined` for a
   * segmented source. Required, so a caller reads the `kind` rather than probing
   * for this member's presence.
   */
  getMonolithicText(): string | undefined;
  /** The book's own directory, resolved onto the physical spine (may be empty). */
  getTocEntries(): BookTocEntry[];
  /** Directory anchors located inside this spine section (may be empty). */
  getSpineAnchors(index: number): NodeAnchor[];
}

const registry = new Map<string, OpenedBookContent>();

export const registerOpenedBook = (content: OpenedBookContent): void => {
  registry.set(content.bookHash, content);
};

export const getOpenedBook = (bookHash: string): OpenedBookContent | undefined =>
  registry.get(bookHash);

export const clearOpenedBook = (bookHash: string): void => {
  registry.delete(bookHash);
};
