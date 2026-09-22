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
 * headings inside one file). Both members are optional so sources without a
 * directory (TXT, mocks) keep registering unchanged.
 */
import type { BookTocEntry, NodeAnchor } from '@/types/readingAgent';

export interface OpenedBookContent {
  bookHash: string;
  /** Structured spine length (1 for monolithic TXT before segmentation). */
  spineCount: number;
  getSpineTitle(index: number): string;
  /** Display HTML (sanitized) for a spine section. */
  getSpineHtml(index: number): string;
  /** Full plain text of a spine section (for AI context / segmentation). */
  getSpineText(index: number): string;
  /**
   * On-demand plain text of a spine section (engine books: loads the
   * section even when the reader has never visited it). Falls back to the
   * sync cached text for non-engine sources.
   */
  getSpineTextAsync?(index: number): Promise<string>;
  /** Monolithic full text, when the book is a single unbroken document (TXT). */
  getMonolithicText?(): string;
  /** The book's own directory, resolved onto the physical spine. */
  getTocEntries?(): BookTocEntry[];
  /** Directory anchors located inside this spine section. */
  getSpineAnchors?(index: number): NodeAnchor[];
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
