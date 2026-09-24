/**
 * TXT parser (ticket 06): UTF-8 decoding with a GBK fallback, exposed as a
 * monolithic single-section book. The segmentation flow (regex detection /
 * fixed-length chunks, ticket 02) turns the monolithic text into virtual
 * chapters; the AI side consumes it through `getMonolithicText`.
 */
import type { BookTocEntry, NodeAnchor } from '@/types/readingAgent';

/** Share of U+FFFD replacement chars above which we assume a non-UTF-8 encoding. */
const REPLACEMENT_RATIO_THRESHOLD = 0.02;

/**
 * Decode raw TXT bytes: UTF-8 first; when more than 2% of the decoded
 * characters are U+FFFD replacements, retry as GBK (common for Chinese
 * e-book TXT files). Environments without a GBK decoder keep the UTF-8 best
 * effort instead of throwing.
 */
export function decodeTxt(data: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(data);
  if (utf8.length === 0) return utf8;

  let replacements = 0;
  for (let i = 0; i < utf8.length; i++) {
    if (utf8.charCodeAt(i) === 0xfffd) replacements++;
  }
  if (replacements / utf8.length <= REPLACEMENT_RATIO_THRESHOLD) return utf8;

  try {
    return new TextDecoder('gbk').decode(data);
  } catch {
    return utf8;
  }
}

/**
 * Book shape a text parser hands back: `OpenedBookContent` minus `bookHash`.
 *
 * It lives here because a TXT book is the only source that still goes through a
 * parser at open time — EPUB/MOBI/FB2/CBZ are read by the Foliate engine and their
 * import metadata comes from `readEpubMetadata` (候选 9).
 */
export interface ParsedBook {
  title: string;
  author?: string;
  cover?: string;
  spineCount: number;
  getSpineTitle(index: number): string;
  getSpineHtml(index: number): string;
  /** Plain text of a section; always loads (see `OpenedBookContent`). */
  getSpineText(index: number): Promise<string>;
  /** The book's own directory, resolved onto the physical spine (may be empty). */
  getTocEntries(): BookTocEntry[];
  /** Directory anchors located inside a spine section (may be empty). */
  getSpineAnchors(index: number): NodeAnchor[];
}

/** A TXT book: one raw section plus the monolithic full text. */
export interface ParsedTxtBook extends ParsedBook {
  getMonolithicText(): string;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Parse TXT bytes into a single-section book titled `fallbackTitle`
 * (the file name without extension, chosen by the caller).
 */
export function parseTxt(data: ArrayBuffer, hash: string, fallbackTitle: string): ParsedTxtBook {
  void hash; // Part of the shared parser signature; identity lives in the registry.
  const fullText = decodeTxt(data);

  return {
    title: fallbackTitle,
    spineCount: 1,
    getSpineTitle: () => fallbackTitle,
    // One <p> per non-empty line; user text is HTML-escaped before wrapping.
    getSpineHtml: () =>
      fullText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('\n'),
    getSpineText: async () => fullText,
    getMonolithicText: () => fullText,
    // A TXT book ships no directory, so the node model falls back to regex /
    // fixed-length segmentation over the monolithic text.
    getTocEntries: () => [],
    getSpineAnchors: () => [],
  };
}
