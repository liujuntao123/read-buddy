/**
 * Library domain types: imported books persisted in IndexedDB.
 *
 * The original file bytes are stored locally (local-first, offline re-open)
 * and re-parsed on open; the content hash is the deterministic book identity
 * reused by summaries / conversations / segmentation (CONTEXT.md "Book").
 */

export type BookFormat = 'epub' | 'txt' | 'unsupported';

export interface LibraryBook {
  /** SHA-256 hex (truncated) of the file bytes — primary key. */
  hash: string;
  title: string;
  author?: string;
  format: BookFormat;
  /** Original file size in bytes. */
  size: number;
  importedAt: number;
  updatedAt: number;
  /** Last read section ordinal, restored on re-open. */
  lastSectionIndex?: number;
  /** Raw file bytes (ArrayBuffer) so the book reopens without the file. */
  data: ArrayBuffer;
}
