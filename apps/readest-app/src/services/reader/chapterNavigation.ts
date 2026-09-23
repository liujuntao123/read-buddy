/**
 * Chapter navigation — one module, two adapters (候选 7).
 *
 * The finding: 「下一章」 was decided **twice**. The engine walked its directory
 * order while comparing href file prefixes (`foliateEngine`'s `nextChapter`),
 * together with a three-step `getTocIndex` ladder; the reader dock re-implemented
 * stepping from TOC-row adjacency with its own shadowing copy of that ladder. The
 * two rules could disagree about the same book — and they did so in the worst
 * possible place: the button's **disabled state** came from the dock's rule while
 * the click's **effect** came from the engine's.
 *
 * This module owns the rule. Its interface is deliberately two methods:
 *
 * - `step(direction)` — take the step, returning the row stepped to (or `null`);
 * - `canStep(direction)` — whether that step exists.
 *
 * Both are answered by the same `find…` function, so a disabled button and a no-op
 * click are the same fact rather than two derivations. Nothing else is exposed:
 * an adapter supplies rows, the current position and a `goTo`, and the algorithm
 * is shared.
 *
 * The two adapters are real (they vary across the seam, so the seam is real):
 * an engine book navigates by **href** into a directory the book declares, while a
 * segmented TXT book navigates by **virtual-section ordinal**. That difference
 * lives in the rows' `target` and in `goTo` — never in the algorithm.
 *
 * Two defects were found and fixed while consolidating, both by the module's own
 * suite rather than by the app:
 * 1. the engine's rule could not step between two anchored 节 inside one spine
 *    file — the very books ADR 0010 exists for (《何为良好生活》: 70 节 across
 *    11 files) were un-navigable 节 by 节 even though the directory listed them;
 * 2. taking "document order is the truth" literally then walked into a row that
 *    repeats the current target (`第二章` and `卷二` both point at `ch2.xhtml`), so
 *    the reader appeared stuck on the same page.
 */
import type { BookTocEntry } from '@/types/readingAgent';

export type NavDirection = 'prev' | 'next';

/** One navigable row: a directory entry, or a virtual section of a TXT book. */
export interface NavEntry {
  title: string;
  /**
   * Where stepping to this row goes: an href for an engine book, a virtual /
   * spine ordinal for a segmented book.
   */
  target: string | number;
  /**
   * Physical section this row starts at. `undefined` (or negative) means the
   * directory entry never resolved onto the spine — such a row is still navigable
   * by its own target, it just cannot take part in section comparisons.
   */
  spineIndex?: number;
}

/** Where the reader is, in the coordinate spaces the rule needs. */
export interface NavPosition {
  /** Physical section ordinal. */
  spineIndex: number;
  /** The directory href the viewport currently sits at, when known. */
  href?: string;
}

export interface ChapterNavigatorDeps {
  /** Rows in document order. */
  entries: readonly NavEntry[];
  /** Physical section total, for the "advance a section" fallback. */
  totalSections: number;
  current: NavPosition;
  /** Perform the jump. Receives a `NavEntry.target` verbatim. */
  goTo: (target: string | number) => void | Promise<void>;
}

export interface ChapterNavigator {
  /** Whether a step in this direction exists. */
  canStep(direction: NavDirection): boolean;
  /** Take the step; resolves with the row reached, or null when none exists. */
  step(direction: NavDirection): Promise<NavEntry | null>;
}

/**
 * The index of the row the reader is at.
 *
 * Three signals, in decreasing precision — the ladder the engine used to publish
 * as `getTocIndex`, now the only copy of it:
 *   1. the exact href the viewport reports;
 *   2. the first row that starts at this physical section;
 *   3. the last row that starts at or before it (a directory coarser than the
 *      spine: one row can span several sections).
 *
 * Returns -1 when the position precedes every row.
 */
export function resolveCurrentEntryIndex(
  entries: readonly NavEntry[],
  current: NavPosition,
): number {
  if (current.href) {
    const exact = entries.findIndex(
      (entry) => typeof entry.target === 'string' && entry.target === current.href,
    );
    if (exact >= 0) return exact;
  }
  const atSection = entries.findIndex((entry) => entry.spineIndex === current.spineIndex);
  if (atSection >= 0) return atSection;
  let best = -1;
  entries.forEach((entry, index) => {
    if (
      entry.spineIndex !== undefined &&
      entry.spineIndex >= 0 &&
      entry.spineIndex <= current.spineIndex
    ) {
      best = index;
    }
  });
  return best;
}

/**
 * Is this row **where the reader already is**?
 *
 * Stepping onto it would be a no-op, and skipping such rows is what lets one rule
 * serve both shapes of directory:
 *
 * - a row that repeats the current target exactly (`第二章` and `卷二` both point at
 *   `ch2.xhtml`) moves nothing, so it is skipped;
 * - a row that only shares the *file* is a real move (`ch1.xhtml#s1` →
 *   `ch1.xhtml#s2` — two 节 inside one spine file), so it is taken.
 *
 * Comparing **targets** is what distinguishes those two cases; comparing sections
 * called both "the same place" and produced defect 1 above.
 */
const isCurrentPlace = (entry: NavEntry, current: NavPosition): boolean =>
  current.href !== undefined
    ? entry.target === current.href
    : entry.spineIndex !== undefined && entry.spineIndex === current.spineIndex;

export function createChapterNavigator(deps: ChapterNavigatorDeps): ChapterNavigator {
  const { entries, totalSections, current, goTo } = deps;

  /** A row that starts at `section`, or a synthetic one when the directory has none. */
  const sectionEntry = (section: number): NavEntry =>
    entries.find((entry) => entry.spineIndex === section) ?? {
      title: '',
      target: section,
      spineIndex: section,
    };

  /** The row a 「下一章」 step reaches, or null. */
  const findNext = (): NavEntry | null => {
    const from = resolveCurrentEntryIndex(entries, current);
    for (let i = Math.max(from + 1, 0); i < entries.length; i++) {
      const entry = entries[i]!;
      if (!isCurrentPlace(entry, current)) return entry;
    }
    // A directory coarser than the spine (or none at all): advance one section and
    // prefer a row that starts there.
    if (current.spineIndex < totalSections - 1) return sectionEntry(current.spineIndex + 1);
    return null;
  };

  /** The row a 「上一章」 step reaches, or null. */
  const findPrev = (): NavEntry | null => {
    const from = resolveCurrentEntryIndex(entries, current);
    for (let i = from >= 0 ? from - 1 : entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!;
      if (!isCurrentPlace(entry, current)) return entry;
    }
    if (current.spineIndex > 0) return sectionEntry(current.spineIndex - 1);
    return null;
  };

  const find = (direction: NavDirection): NavEntry | null =>
    direction === 'next' ? findNext() : findPrev();

  return {
    canStep: (direction) => find(direction) !== null,
    step: async (direction) => {
      const entry = find(direction);
      if (!entry) return null;
      await goTo(entry.target);
      return entry;
    },
  };
}

/**
 * Adapter: the book's own directory.
 *
 * `BookTocEntry` already carries the row title, its href and the section it
 * resolved onto, so the projection is a rename. This is the engine's view of the
 * book, and it is also what the node model was built from — which is why the two
 * cannot describe different books once the model exists.
 */
export const navEntriesFromDirectory = (entries: readonly BookTocEntry[]): NavEntry[] =>
  entries.map((entry) => ({
    title: entry.label,
    target: entry.href ?? entry.spineIndex,
    ...(entry.spineIndex >= 0 ? { spineIndex: entry.spineIndex } : {}),
  }));