/**
 * Pure helpers behind the 划线 tab's 「复制全部」 export and its row metadata.
 *
 * Both things this module exports are the same kind of thing — a function over
 * a **Highlight** row that answers a presentation question the store knows
 * nothing about: how the marks read as Markdown once they leave the app, and how
 * old one of them is. Keeping them here (rather than inside `HighlightsTab`)
 * makes them testable as values, with no store or DOM in the way.
 *
 * The clipboard write is deliberately **not** here: that is
 * `services/common/clipboard`'s one implementation, shared with every other 复制
 * action in the app.
 *
 * The formatter takes the location label as an argument instead of reaching for
 * the node model: 「章 › 节」 is answered by the caller, which already resolves it
 * for its rows, so this file stays pure and works before a book context exists.
 */
import type { ReaderHighlight } from '@/types/highlight';

/** One quote as Markdown blockquote lines (a blank line stays a blank quote line). */
const quoteAsBlockquote = (quote: string): string =>
  quote
    .split('\n')
    .map((line) => `> ${line.trim()}`.trimEnd())
    .join('\n');

export interface HighlightExportOptions {
  /** 「章 › 节」 for one row — the caller's own location label. */
  resolveLocation: (highlight: ReaderHighlight) => string;
  /**
   * The book's title. 《》 is for book titles only (CONTEXT.md), and the heading
   * is what tells a pasted export which book the marks came from.
   */
  bookTitle?: string;
}

/**
 * Every mark of one book as Markdown, grouped by location: `## 章 › 节`, then
 * the quotes as `>` lines.
 *
 * Grouping follows **document order**, not an alphabetical or a location sort:
 * the caller hands the rows in the order `compareHighlights` put them, and two
 * marks of the same node that are separated by an earlier node read as two
 * groups of that node's title rather than as one block moved out of the text's
 * order. The export is meant to be pasted into notes, where the reading order is
 * the only order that means anything.
 */
export function formatHighlightsAsMarkdown(
  highlights: readonly ReaderHighlight[],
  { resolveLocation, bookTitle }: HighlightExportOptions,
): string {
  const blocks: string[] = [];
  if (bookTitle) blocks.push(`# 《${bookTitle}》划线`);

  const groups = new Map<string, ReaderHighlight[]>();
  for (const highlight of highlights) {
    const location = resolveLocation(highlight);
    const rows = groups.get(location);
    if (rows) rows.push(highlight);
    else groups.set(location, [highlight]);
  }

  for (const [location, rows] of groups) {
    blocks.push(`## ${location}`, rows.map((row) => quoteAsBlockquote(row.quote)).join('\n\n'));
  }

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * How old a mark is, said the way a reader would (「3 天前」).
 *
 * Relative rather than absolute on purpose: the row already carries where the
 * mark lives, and a bare date answers a question nobody asked. `now` is a
 * parameter so the answer is a value a test can pin.
 */
export function relativeTimeLabel(createdAt: number, now: number = Date.now()): string {
  const elapsed = now - createdAt;
  // A future timestamp (clock skew, a hand-edited row) reads as 刚刚 rather than
  // as a negative age.
  if (!Number.isFinite(elapsed) || elapsed < MINUTE) return '刚刚';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} 分钟前`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} 小时前`;
  if (elapsed < MONTH) return `${Math.floor(elapsed / DAY)} 天前`;
  if (elapsed < YEAR) return `${Math.floor(elapsed / MONTH)} 个月前`;
  return `${Math.floor(elapsed / YEAR)} 年前`;
}
