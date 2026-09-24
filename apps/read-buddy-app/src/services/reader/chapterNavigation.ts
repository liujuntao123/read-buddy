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
 *
 * A third was found by reading 《说理》 (用户反馈：「位于某一章的第一节时，点击上一节
 * 失效」), and it is the reason this module now thinks in **(file, anchor)** rather
 * than in raw href strings: a directory that names one file twice — `第2章 →
 * part0043.xhtml` (no anchor) and `§2.1 → part0043.xhtml#id_1` — made the *章* row
 * look like a destination from inside its own first 节, so 「上一节」 re-rendered the
 * page the reader was already on (all 9 chapters of that book, with the button
 * enabled the whole time). The mirror case made 「下一节」 jump backwards onto the
 * heading just passed. See `splitTarget` / `isCurrentPlace` for the rule.
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
 * A target split into the **file** it names and the **anchor** inside it.
 *
 * The distinction is what this module was missing. A directory routinely names
 * one file twice:
 *
 * ```text
 * 第2章 哲学为什么关注语言？   -> part0043.xhtml        (the 章; no anchor)
 * §2.1 语言转向                -> part0043.xhtml#id_1   (its first 节)
 * ```
 *
 * 《说理》 is that shape in all 9 of its chapters. `part0043.xhtml` and
 * `part0043.xhtml#id_1` are different strings but not different *places* — the
 * first one is where the second one starts — and a rule that only compares
 * strings treats the 章 row as a destination the reader can still step onto.
 */
const splitTarget = (target: string): { file: string; anchor?: string } => {
  const hash = target.indexOf('#');
  if (hash < 0) return { file: target };
  const anchor = target.slice(hash + 1);
  return anchor ? { file: target.slice(0, hash), anchor } : { file: target.slice(0, hash) };
};

const anchorOfTarget = (target: string | number): string | undefined =>
  typeof target === 'string' ? splitTarget(target).anchor : undefined;

const fileOfTarget = (target: string | number): string | undefined =>
  typeof target === 'string' ? splitTarget(target).file : undefined;

/**
 * The index of the row the reader is at.
 *
 * Four signals, in decreasing precision:
 *   1. **the exact href** the viewport reports, when it carries an anchor — the
 *      engine reports the anchor the viewport sits at or just before;
 *   2. **the first anchored row of the reported file**, when the href is a plain
 *      file. The vendored engine's `TOCProgress` resolves a plain-file href to the
 *      directory row *preceding* the anchor the viewport has passed
 *      (`vendor/foliate-js/progress.js` returns `items[i - 1]`), so a plain
 *      `part0043.xhtml` means the reader is already inside `part0043.xhtml#id_1` —
 *      the 章 row that also names that file is *behind* them. Taking the first
 *      exact match instead (which is always the 章 row) made 「下一节」 jump back
 *      onto the heading the reader had just passed;
 *   3. the first row that starts at this physical section;
 *   4. the last row that starts at or before it (a directory coarser than the
 *      spine: one row can span several sections).
 *
 * Returns -1 when the position precedes every row.
 */
export function resolveCurrentEntryIndex(
  entries: readonly NavEntry[],
  current: NavPosition,
): number {
  const exactMatch = (href: string): number =>
    entries.findIndex((entry) => typeof entry.target === 'string' && entry.target === href);

  if (current.href) {
    const here = splitTarget(current.href);
    if (here.anchor !== undefined) {
      const exact = exactMatch(current.href);
      if (exact >= 0) return exact;
    } else {
      // Plain file href: prefer the anchored node inside that file over the
      // container row that merely names the file (signal 2 above).
      const firstAnchored = entries.findIndex(
        (entry) => fileOfTarget(entry.target) === here.file && anchorOfTarget(entry.target) !== undefined,
      );
      if (firstAnchored >= 0) return firstAnchored;
      const exact = exactMatch(current.href);
      if (exact >= 0) return exact;
    }
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
 * A row that names the **same file with no anchor of its own** is the container
 * the reader is already inside (its own 章 row). Its destination resolves to the
 * file's start — the very place the current node begins — so stepping onto it
 * moves nothing. Treating it as a destination is the defect 《说理》 exposed: at
 * `...part0043.xhtml#id_1` (the first 节 of 第2章) 「上一节」 stepped onto
 * `...part0043.xhtml` (the 章 row) and re-rendered the page the reader was
 * already looking at, so the button appeared dead for all 9 chapters.
 *
 * Comparing **(file, anchor)** is what distinguishes all three cases.
 */
const isCurrentPlace = (entry: NavEntry, current: NavPosition): boolean => {
  if (current.href === undefined) {
    return entry.spineIndex !== undefined && entry.spineIndex === current.spineIndex;
  }
  // An ordinal target (a segmented TXT book) never equals an href: preserve the
  // original behaviour and let it be a step.
  if (typeof entry.target !== 'string') return false;
  const here = splitTarget(current.href);
  const there = splitTarget(entry.target);
  if (there.file !== here.file) return false;
  // Same file, no anchor: the file's own head — already inside what I am reading.
  if (there.anchor === undefined) return true;
  return there.anchor === here.anchor;
};


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
    // `from < 0` means the position precedes every row: there is nothing *before*
    // the reader in the directory to step onto. (The loop used to start at the
    // LAST row for this case, which sent a reader at the front of the book to its
    // end.) The section fallback below still applies.
    for (let i = from - 1; i >= 0; i--) {
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