/**
 * Book library service (ticket 06): import → persist → open flow over the
 * Dexie `books` table and the in-memory opened-book registry.
 *
 * - File bytes are stored verbatim (local-first, offline re-open); the
 *   content hash (SHA-256 truncated to 16 hex chars) is the book identity
 *   reused by summaries / conversations / segmentation.
 * - `openBook` re-parses the stored bytes and registers the parsed content
 *   so the AI features (chapterSource) pick the real book up automatically.
 */
import type { BookFormat, LibraryBook } from '@/types/library';
import { getDatabase, type ReadestPlusDatabase } from '@/services/db/database';
import { clearOpenedBook, registerOpenedBook, type OpenedBookContent } from './contentRegistry';
import { parseEpub } from './epubParser';
import { parseTxt } from './txtParser';

/** Book row without the raw bytes — the shape list views / stores should hold. */
export type LibraryBookMeta = Omit<LibraryBook, 'data'>;

export interface LibraryDeps {
  /** Injectable database so tests run against an isolated fake-indexeddb. */
  db?: ReadestPlusDatabase;
}

export type ImportResult =
  | { status: 'ok'; book: LibraryBook }
  | { status: 'unsupported' | 'duplicate'; message: string };

export const UNSUPPORTED_FORMAT_MESSAGE = '暂不支持该格式（待 Foliate 引擎接入）';

const dbOf = (deps: LibraryDeps = {}): ReadestPlusDatabase => deps.db ?? getDatabase();

const stripExtension = (name: string): string => name.replace(/\.[^.]+$/, '');

/** Content hash: SHA-256 hex truncated to 16 chars (book identity / primary key). */
export async function computeBookHash(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/** Format detection by file extension; anything else is unsupported for now. */
export function detectFormat(name: string): BookFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith('.epub')) return 'epub';
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
    return { status: 'duplicate', message: `《${existing.title}》已在书架中，内容相同无需重复导入` };
  }

  let title = stripExtension(file.name);
  let author: string | undefined;
  if (format === 'epub') {
    const parsed = await parseEpub(data, hash);
    title = parsed.title;
    author = parsed.author;
  }

  const now = Date.now();
  const book: LibraryBook = {
    hash,
    title,
    author,
    format,
    size: data.byteLength,
    importedAt: now,
    updatedAt: now,
    data,
  };
  await db.books.put(book);
  return { status: 'ok', book };
}

/**
 * Re-parse a stored book and register it as the opened content (AI features
 * resolve the current chapter through the registry). TXT books additionally
 * expose their monolithic full text for the segmentation flow.
 */
export async function openBook(book: LibraryBook, deps: LibraryDeps = {}): Promise<OpenedBookContent> {
  void deps; // Bytes travel with the row; the seam stays for API symmetry.

  if (book.format === 'epub') {
    const parsed = await parseEpub(book.data, book.hash);
    const content: OpenedBookContent = {
      bookHash: book.hash,
      sectionCount: parsed.sectionCount,
      getSectionTitle: parsed.getSectionTitle,
      getSectionHtml: parsed.getSectionHtml,
      getSectionText: parsed.getSectionText,
    };
    registerOpenedBook(content);
    return content;
  }

  if (book.format === 'txt') {
    const parsed = parseTxt(book.data, book.hash, book.title);
    const content: OpenedBookContent = {
      bookHash: book.hash,
      sectionCount: parsed.sectionCount,
      getSectionTitle: parsed.getSectionTitle,
      getSectionHtml: parsed.getSectionHtml,
      getSectionText: parsed.getSectionText,
      getMonolithicText: () => parsed.getMonolithicText(),
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

/** Delete a book row and drop its parsed-content cache from the registry. */
export async function removeBook(hash: string, deps: LibraryDeps = {}): Promise<void> {
  const db = dbOf(deps);
  await db.books.delete(hash);
  clearOpenedBook(hash);
}

/** Persist the last read section so re-opening resumes where the reader left off. */
export async function saveProgress(
  hash: string,
  sectionIndex: number,
  deps: LibraryDeps = {},
): Promise<void> {
  const db = dbOf(deps);
  const book = await db.books.get(hash);
  if (!book) return;
  await db.books.put({ ...book, lastSectionIndex: sectionIndex, updatedAt: Date.now() });
}
