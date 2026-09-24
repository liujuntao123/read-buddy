/**
 * Book library service (ticket 06): import → persist → open flow over the
 * Dexie `books` table and the in-memory opened-book registry.
 *
 * - File bytes are stored verbatim (local-first, offline re-open); the
 *   content hash (SHA-256 truncated to 16 hex chars) is the book identity
 *   reused by summaries / conversations / segmentation.
 * - `openBook` re-parses the stored bytes and registers the parsed content
 *   so the AI features (nodeSource) pick the real book up automatically.
 */
import type { BookFormat, LibraryBook } from '@/types/library';
import type { BookNodeShape } from '@/services/bookNodes/nodeShape';
import type { SegmentStrategy } from '@/types/readingAgent';
import { getDatabase, type ReadBuddyDatabase } from '@/services/db/database';
import { clearOpenedBook, registerOpenedBook, type OpenedBookContent } from './contentRegistry';
import { readEpubMetadata } from './epubParser';
import { parseTxt } from './txtParser';
import { extractCover } from './coverExtract';
import { createFoliateEngine, engineToContent, type FoliateEngineHandle } from './foliateEngine';

/** Book row without the raw bytes — the shape list views / stores should hold. */
export type LibraryBookMeta = Omit<LibraryBook, 'data'>;

export interface LibraryDeps {
  /** Injectable database so tests run against an isolated fake-indexeddb. */
  db?: ReadBuddyDatabase;
  /**
   * Engine factory seam (ticket 07): tests inject a factory bound to a fake
   * view module; production uses the real lazy foliate engine.
   */
  createEngine?: typeof createFoliateEngine;
  /** Foliate cover extraction seam (tests inject a stub). */
  extractCover?: (file: File) => Promise<string | undefined>;
}

export type ImportResult =
  | { status: 'ok'; book: LibraryBook }
  | { status: 'unsupported' | 'duplicate'; message: string };

export const UNSUPPORTED_FORMAT_MESSAGE = '暂不支持该文件格式';

/** The result of opening a book: registry content plus the live engine. */
export type OpenedBook = OpenedBookContent & { engine?: FoliateEngineHandle };

const dbOf = (deps: LibraryDeps = {}): ReadBuddyDatabase => deps.db ?? getDatabase();

const stripExtension = (name: string): string => name.replace(/\.[^.]+$/, '');

/** Content hash: SHA-256 hex truncated to 16 chars (book identity / primary key). */
export async function computeBookHash(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}


/** Formats rendered by the Foliate pagination engine (ticket 07). */
export const ENGINE_FORMATS: readonly BookFormat[] = ['epub', 'mobi', 'fb2', 'cbz'];

/** True when the format is rendered through the Foliate engine. */
export const isEngineFormat = (format: BookFormat): boolean => ENGINE_FORMATS.includes(format);

/**
 * Format detection by file extension (ticket 07): the Foliate engine takes
 * EPUB plus MOBI/AZW/AZW3/PRC, FB2/FBZ and CBZ; PDF stays unsupported until
 * a later release. AZW variants all map to the `mobi` engine format —
 * foliate detects the real container by magic number anyway.
 */
export function detectFormat(name: string): BookFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith('.epub')) return 'epub';
  if (/\.(mobi|azw3?|prc)$/.test(lower)) return 'mobi';
  if (/\.(fb2|fbz)$/.test(lower)) return 'fb2';
  if (lower.endsWith('.cbz')) return 'cbz';
  if (lower.endsWith('.txt')) return 'txt';
  return 'unsupported';
}
/**
 * Import a local file: detect the format, hash the bytes, reject duplicates,
 * parse enough metadata for the shelf (EPUB title/author come from the OPF)
 * and persist the raw bytes.
 */
export async function importBookFile(file: File, deps: LibraryDeps = {}): Promise<ImportResult> {
  const format = detectFormat(file.name);
  if (format === 'unsupported') {
    return { status: 'unsupported', message: `「${file.name}」${UNSUPPORTED_FORMAT_MESSAGE}` };
  }

  const data = await file.arrayBuffer();
  const hash = await computeBookHash(data);
  const db = dbOf(deps);

  const existing = await db.books.get(hash);
  if (existing) {
    return { status: 'duplicate', message: `《${existing.title}》已在书架中，无需重复导入` };
  }

  let title = stripExtension(file.name);
  let author: string | undefined;
  let cover: string | undefined;
  if (format === 'epub') {
    // Metadata only: O(metadata), not O(book). The spine is materialized later by
    // the engine when the book is opened (候选 9).
    const meta = await readEpubMetadata(data, hash);
    title = meta.title;
    author = meta.author;
    cover = meta.cover;
  }

  // Foliate cover extraction (original readest approach): covers every engine
  // format — MOBI/FB2/CBZ get their first-shot cover here, and EPUBs whose
  // cover is only reachable through `<guide>` (or other zip-heuristic gaps)
  // are rescued. Failures never break the import.
  if (!cover && isEngineFormat(format)) {
    const fileForEngine = new File([data], file.name, { type: file.type || 'application/octet-stream' });
    cover = await (deps.extractCover ?? extractCover)(fileForEngine);
  }

  const now = Date.now();
  const book: LibraryBook = {
    hash,
    title,
    author,
    cover,
    format,
    size: data.byteLength,
    importedAt: now,
    updatedAt: now,
    // Keep the original name: foliate's CBZ/FBZ detection keys off the
    // extension (view.js isCBZ/isFBZ), so reopening needs the suffix intact.
    fileName: file.name,
    data,
  };
  await db.books.put(book);
  return { status: 'ok', book };
}

/**
 * Re-parse a stored book and register it as the opened content (AI features
 * resolve the current chapter through the registry).
 *
 * Ticket 07: engine formats (epub/mobi/fb2/cbz) open through the Foliate
 * engine — `prepare()` loads the book (no DOM rendering yet) so the spine /
 * TOC are readable, and the returned handle is what the reader pane renders.
 * TXT books keep the parseTxt path with the monolithic segmentation flow.
 *
 * Rows imported before cover extraction existed get their cover filled
 * lazily here: when the engine yields one, `onCoverExtracted` fires (after
 * the row was persisted) so callers can refresh their in-memory lists.
 */
export async function openBook(
  book: LibraryBook,
  deps: LibraryDeps & { onCoverExtracted?: (cover: string) => void } = {},
): Promise<OpenedBook> {
  if (isEngineFormat(book.format)) {
    const createEngine = deps.createEngine ?? createFoliateEngine;
    // foliate identifies formats by magic number, but CBZ/FBZ need the
    // original file name suffix; fall back for pre-ticket-07 rows.
    const fileName = book.fileName ?? `${book.title}.${book.format}`;
    const file = new File([book.data], fileName, { type: 'application/octet-stream' });
    const engine = createEngine(file);
    try {
      await engine.prepare();
    } catch (err) {
      engine.close();
      throw err;
    }
    const content = engineToContent(engine, book.hash);
    registerOpenedBook(content);
    if (!book.cover) {
      // `getCover` is required (候选 4): whether a cover exists is a fact about the
      // book, and the engine answers `undefined` when there is none — no more
      // testing for the method's existence.
      void engine
        .getCover()
        .then((extracted) => {
          if (!extracted) return;
          book.cover = extracted;
          return dbOf(deps)
            .books.update(book.hash, { cover: extracted })
            .then(() => deps.onCoverExtracted?.(extracted));
        })
        .catch(() => undefined);
    }
    return { ...content, engine };
  }

  if (book.format === 'txt') {
    const parsed = parseTxt(book.data, book.hash, book.title);
    // Built directly from the parser's members — no hand-copied field list to
    // keep in step with the interface (候选 8).
    const content: OpenedBookContent = {
      bookHash: book.hash,
      kind: 'monolithic',
      spineCount: parsed.spineCount,
      getSpineTitle: (index) => parsed.getSpineTitle(index),
      getSpineHtml: (index) => parsed.getSpineHtml(index),
      getSpineText: (index) => parsed.getSpineText(index),
      getMonolithicText: () => parsed.getMonolithicText(),
      getTocEntries: () => parsed.getTocEntries(),
      getSpineAnchors: (index) => parsed.getSpineAnchors(index),
    };
    registerOpenedBook(content);
    return content;
  }

  throw new Error(`${UNSUPPORTED_FORMAT_MESSAGE}：${book.title}`);
}

/** List shelf metadata (raw bytes stripped so stores stay small), newest activity first. */
export async function readLibrary(deps: LibraryDeps = {}): Promise<LibraryBookMeta[]> {
  const rows = await dbOf(deps).books.toArray();
  return rows
    .map(({ data: _bytes, ...meta }) => meta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface RemoveBookOptions extends LibraryDeps {
  deleteArtifacts?: boolean;
}

/** Delete a book row and drop its parsed-content cache from the registry. */
export async function removeBook(hash: string, options: RemoveBookOptions = {}): Promise<void> {
  const db = dbOf(options);
  await db.books.delete(hash);
  clearOpenedBook(hash);

  if (options.deleteArtifacts) {
    await db.node_summaries?.where('bookHash').equals(hash).delete();
    await db.book_nodes?.where('bookHash').equals(hash).delete();
    await db.book_panoramas?.delete(hash);
    await db.reading_entities?.where('bookHash').equals(hash).delete();
    await db.bookSegmentations?.delete(hash);

    const convs = await db.conversations?.where('bookHash').equals(hash).toArray();
    if (convs && convs.length > 0) {
      const convIds = convs.map((c) => c.id);
      await db.messages?.where('conversationId').anyOf(convIds).delete();
      await db.agent_turn_traces?.where('conversationId').anyOf(convIds).delete();
      await db.conversations?.where('bookHash').equals(hash).delete();
    }
  }
}

/**
 * Persist reading progress: the physical position (spine ordinal, intra-section
 * Node Anchor) and, for engine books, the exact CFI so re-opening lands on the
 * spot. The options object keeps the existing call shape (`{ db }`); `cfi` and
 * `anchor` are omitted by the TXT path, which leaves any previously stored value
 * untouched.
 *
 * The anchor is part of the record because restoring only the ordinal leaves the
 * Node View resolving the owning 章 instead of the 节 the reader was in.
 */
export async function saveProgress(
  hash: string,
  spineIndex: number,
  options: LibraryDeps & { cfi?: string; anchor?: string; nodeIndex?: number } = {},
): Promise<void> {
  const db = dbOf(options);
  const book = await db.books.get(hash);
  if (!book) return;
  await db.books.put({
    ...book,
    lastSpineIndex: spineIndex,
    ...(options.nodeIndex !== undefined ? { lastNodeIndex: options.nodeIndex } : {}),
    lastAnchor: options.anchor ?? book.lastAnchor,
    lastCfi: options.cfi ?? book.lastCfi,
    updatedAt: Date.now(),
  });
}

/**
 * Record what the index pipeline built for a book, on its shelf row.
 *
 * The shelf has no node model, and it used to borrow whatever single shape the
 * index store happened to hold — so a row could wear another book's levels (候选 6).
 * The **Segmentation Rule** is recorded too: it cannot be inferred from the nodes,
 * and guessing it relabelled a fixed-length TXT index as heading-detected
 * (候选 epilogue). One writer, one reader, no query per card.
 */
export async function saveBookIndexSummary(
  hash: string,
  summary: { shape: BookNodeShape; strategy: SegmentStrategy },
  options: LibraryDeps = {},
): Promise<void> {
  const db = dbOf(options);
  const book = await db.books.get(hash);
  if (!book) return;
  await db.books.put({
    ...book,
    nodeShape: summary.shape,
    nodeStrategy: summary.strategy,
    updatedAt: Date.now(),
  });
}

/** The index summary a book remembers, or null when it was never indexed. */
export async function readBookIndexSummary(
  hash: string,
  options: LibraryDeps = {},
): Promise<{ shape: BookNodeShape; strategy: SegmentStrategy } | null> {
  const book = await dbOf(options).books.get(hash);
  if (!book?.nodeShape || !book.nodeStrategy) return null;
  return { shape: book.nodeShape, strategy: book.nodeStrategy };
}
