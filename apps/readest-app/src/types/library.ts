/**
 * Library domain types: imported books persisted in IndexedDB.
 *
 * The original file bytes are stored locally (local-first, offline re-open)
 * and re-parsed on open; the content hash is the deterministic book identity
 * reused by summaries / conversations / segmentation (CONTEXT.md "Book").
 */

export type BookFormat = 'epub' | 'mobi' | 'fb2' | 'cbz' | 'txt' | 'unsupported';

export interface LibraryBook {
  /** SHA-256 hex (truncated) of the file bytes — primary key. */
  hash: string;
  title: string;
  author?: string;
  /** Base64 data URL for the book's cover image thumbnail. */
  cover?: string;
  format: BookFormat;
  /** Original file size in bytes. */
  size: number;
  importedAt: number;
  updatedAt: number;
  /**
   * Last read node ordinal (physical spine ordinal for engine books, virtual
   * node ordinal for TXT), restored on re-open. Optional so pre-node-model
   * rows stay compatible.
   */
  lastNodeIndex?: number;
  /**
   * Last read position CFI (Foliate engine books), restored on re-open.
   * Optional so pre-ticket-07 rows (and TXT books) stay compatible.
   */
  lastCfi?: string;
  /**
   * Original file name including its extension. The Foliate engine re-opens
   * the stored bytes as a File, and CBZ/FBZ detection keys off the name
   * suffix (view.js `isCBZ`/`isFBZ`), so the name must survive the import.
   * Optional for pre-ticket-07 rows; openBook falls back to `title.format`.
   */
  fileName?: string;
  /** Raw file bytes (ArrayBuffer) so the book reopens without the file. */
  data: ArrayBuffer;
}
