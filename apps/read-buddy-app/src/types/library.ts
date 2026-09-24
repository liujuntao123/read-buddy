/**
 * Library domain types: imported books persisted in IndexedDB.
 *
 * The original file bytes are stored locally (local-first, offline re-open)
 * and re-parsed on open; the content hash is the deterministic book identity
 * reused by summaries / conversations / segmentation (CONTEXT.md "Book").
 */

export type BookFormat = 'epub' | 'mobi' | 'fb2' | 'cbz' | 'txt' | 'unsupported';

// Type-only: the shape is computed by the node model, and the shelf row is where
// a book that is not open can still remember it.
import type { BookNodeShape } from '@/services/bookNodes/nodeShape';
import type { SegmentStrategy } from '@/types/readingAgent';

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
   * The **physical** position the reader was last at: the spine-section ordinal
   * (engine books) or the virtual-section ordinal (TXT). Restored on re-open.
   *
   * Named `lastSpineIndex`, not `lastNodeIndex`: it never held a Book Node
   * ordinal (ADR 0011 / CONTEXT.md "Reading Position"). Optional so pre-v7 rows
   * stay compatible.
   */
  lastSpineIndex?: number;
  /**
   * The **Book Node** the reader was at — a real node ordinal, resolved by the
   * Reading Position owner through the Node View.
   *
   * Distinct from `lastSpineIndex` on purpose: they coincide only for TXT books
   * (whose virtual sections come from the same segmenter as their nodes). This
   * field is what lets the shelf say 「读至第 3 节」 honestly. Rows migrated by the
   * v7 upgrade carry no such field — v7 *deleted* the old `lastNodeIndex` because
   * that one held a spine ordinal (ADR 0011), so there is no ambiguity here.
   */
  lastNodeIndex?: number;
  /**
   * The book's **Book Node Shape**, recorded by the index pipeline when it builds
   * the node list. The shelf has no node model of its own, so without this it
   * cannot choose the 章 / 节 word for any row — it used to borrow the shape of
   * whichever book happened to be open.
   */
  nodeShape?: BookNodeShape;
  /**
   * The **Segmentation Rule** that produced the node list, recorded with the shape.
   *
   * Persisted because it cannot be recovered from the nodes: the rehydrate path used
   * to infer it as `spineIndex !== undefined ? 'native' : 'regex'`, which relabels a
   * fixed-length TXT index as `regex` — the reader would then be told the book's
   * 段 came from heading detection when they were cut by length.
   */
  nodeStrategy?: SegmentStrategy;
  /**
   * The Node Anchor inside that spine section, when the viewport sat on one.
   * Without it a resumed session restores the physical position but resolves the
   * wrong Book Node until the first relocate — an anchored 节 would be reported
   * as its owning 章.
   */
  lastAnchor?: string;
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
