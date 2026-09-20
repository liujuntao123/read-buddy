/**
 * In-memory registry of the book currently opened in the reader.
 *
 * Parsers (EPUB spine sections, TXT monolithic text, demo fixtures) publish
 * an OpenedBookContent here; every AI feature resolves the current chapter
 * text through this registry (single source of truth, replacing the demo
 * hard-wiring). Nothing is persisted — re-opening a library book re-parses
 * the stored file bytes and re-registers.
 */

export interface OpenedBookContent {
  bookHash: string;
  /** Structured spine length (1 for monolithic TXT before segmentation). */
  sectionCount: number;
  getSectionTitle(index: number): string;
  /** Display HTML (sanitized) for a spine section. */
  getSectionHtml(index: number): string;
  /** Full plain text of a spine section (for AI context / segmentation). */
  getSectionText(index: number): string;
  /** Monolithic full text, when the book is a single unbroken document (TXT). */
  getMonolithicText?(): string;
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
