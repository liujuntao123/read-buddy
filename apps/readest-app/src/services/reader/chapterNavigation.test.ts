import { describe, expect, it } from 'vitest';
import {
  createChapterNavigator,
  navEntriesFromDirectory,
  resolveCurrentEntryIndex,
  type NavEntry,
} from './chapterNavigation';

/**
 * The chapter-navigation module's contract (候选 7). Every case is driven with
 * plain values — rows in, positions in — because the module takes its rows,
 * position and `goTo` as arguments instead of reading a store or an engine. That
 * is the whole point of the deepening: the rule is now testable without a fake
 * engine, and `canStep` and `step` are answered by the same function, so a
 * disabled button can never disagree with a click.
 */

/** A directory as a real book declares it: one row per href, top level. */
const FLAT: NavEntry[] = [
  { title: '第一章 迷雾之城', target: 'ch1.xhtml', spineIndex: 0 },
  { title: '第二章 图书馆的密语', target: 'ch2.xhtml', spineIndex: 1 },
  { title: '第三章 长夜漫漫', target: 'ch3.xhtml', spineIndex: 2 },
];

const navigatorAt = (
  entries: NavEntry[],
  current: { spineIndex: number; href?: string },
  totalSections = 3,
) => {
  const steps: Array<string | number> = [];
  const navigator = createChapterNavigator({
    entries,
    totalSections,
    current,
    goTo: (target) => {
      steps.push(target);
    },
  });
  return { navigator, steps };
};

describe('resolveCurrentEntryIndex', () => {
  it('prefers the exact href the viewport reports', () => {
    expect(resolveCurrentEntryIndex(FLAT, { spineIndex: 2, href: 'ch2.xhtml' })).toBe(1);
  });

  it('falls back to the first row that starts at this section', () => {
    expect(resolveCurrentEntryIndex(FLAT, { spineIndex: 1 })).toBe(1);
  });

  it('falls back to the last row at or before this section (directory coarser than spine)', () => {
    // A directory with a row every 4 sections: section 5 belongs to row 1.
    const coarse: NavEntry[] = [
      { title: 'A', target: 'a.xhtml', spineIndex: 0 },
      { title: 'B', target: 'b.xhtml', spineIndex: 4 },
    ];
    expect(resolveCurrentEntryIndex(coarse, { spineIndex: 5 })).toBe(1);
  });

  it('reports -1 when no row is at or before the position', () => {
    const later: NavEntry[] = [{ title: 'A', target: 'a.xhtml', spineIndex: 3 }];
    expect(resolveCurrentEntryIndex(later, { spineIndex: 0 })).toBe(-1);
  });
});

describe('canStep and step agree', () => {
  it('walks forward through the directory and stops at the last row', async () => {
    const { navigator, steps } = navigatorAt(FLAT, { spineIndex: 0, href: 'ch1.xhtml' });

    expect(navigator.canStep('next')).toBe(true);
    await expect(navigator.step('next')).resolves.toMatchObject({ title: '第二章 图书馆的密语' });
    expect(steps).toEqual(['ch2.xhtml']);
  });

  it('reports no step at the end of the book — and takes none', async () => {
    const { navigator, steps } = navigatorAt(FLAT, { spineIndex: 2, href: 'ch3.xhtml' });

    expect(navigator.canStep('next')).toBe(false);
    await expect(navigator.step('next')).resolves.toBeNull();
    expect(steps).toEqual([]);
  });

  it('reports no step at the start of the book — and takes none', async () => {
    const { navigator, steps } = navigatorAt(FLAT, { spineIndex: 0, href: 'ch1.xhtml' });

    expect(navigator.canStep('prev')).toBe(false);
    await expect(navigator.step('prev')).resolves.toBeNull();
    expect(steps).toEqual([]);
  });

  it('retreats across chapters', async () => {
    const { navigator, steps } = navigatorAt(FLAT, { spineIndex: 2, href: 'ch3.xhtml' });

    expect(navigator.canStep('prev')).toBe(true);
    await expect(navigator.step('prev')).resolves.toMatchObject({ title: '第二章 图书馆的密语' });
    expect(steps).toEqual(['ch2.xhtml']);
  });
});

describe('the two coordinate spaces', () => {
  it('steps by section when the directory has no row there', async () => {
    // One directory row for a three-section book: the fallback advances a section.
    const { navigator, steps } = navigatorAt(
      [{ title: '全书', target: 'all.xhtml', spineIndex: 0 }],
      { spineIndex: 0, href: 'all.xhtml' },
    );

    await expect(navigator.step('next')).resolves.toMatchObject({ target: 1, spineIndex: 1 });
    expect(steps).toEqual([1]);
  });

  it('advances within one section when the directory is FINER than the spine', async () => {
    // 《何为良好生活》: 11 spine files, but the directory anchors 节 inside them.
    const anchored: NavEntry[] = [
      { title: '第一章', target: 'ch1.xhtml', spineIndex: 0 },
      { title: '第一节', target: 'ch1.xhtml#s1', spineIndex: 0 },
      { title: '第二节', target: 'ch1.xhtml#s2', spineIndex: 0 },
    ];
    const { navigator, steps } = navigatorAt(anchored, { spineIndex: 0, href: 'ch1.xhtml#s1' }, 1);

    // Same physical section, still a next step: the anchor is what moves.
    await expect(navigator.step('next')).resolves.toMatchObject({ target: 'ch1.xhtml#s2' });
    expect(steps).toEqual(['ch1.xhtml#s2']);
  });

  it('treats a row at the same section but a different file as a step', async () => {
    // A flat NCX where 卷 and 章 both resolve to section 0.
    const sameSection: NavEntry[] = [
      { title: '第一卷 风云', target: 'part1.xhtml', spineIndex: 0 },
      { title: '第一章 风起', target: 'ch1.xhtml', spineIndex: 0 },
    ];
    const { navigator } = navigatorAt(sameSection, { spineIndex: 0, href: 'part1.xhtml' }, 1);
    await expect(navigator.step('next')).resolves.toMatchObject({ target: 'ch1.xhtml' });
  });

  it('ignores a row the directory never resolved onto the spine', async () => {
    // spineIndex is absent: such a row is navigable by href but cannot be compared
    // by section, so it must not be mistaken for "after" on section grounds alone.
    const unresolved: NavEntry[] = [
      { title: '坏链接', target: 'missing.xhtml' },
      { title: '第二章', target: 'ch2.xhtml', spineIndex: 1 },
    ];
    const { navigator } = navigatorAt(unresolved, { spineIndex: 1, href: 'ch2.xhtml' }, 2);
    expect(navigator.canStep('next')).toBe(false);
  });
});

describe('navEntriesFromDirectory', () => {
  it('projects a parsed directory onto navigable rows, dropping unresolved sections', () => {
    const rows = navEntriesFromDirectory([
      { label: '第一章', depth: 0, spineIndex: 0, href: 'ch1.xhtml' },
      { label: '坏条目', depth: 0, spineIndex: -1, href: 'nope.xhtml' },
    ]);

    expect(rows[0]).toEqual({ title: '第一章', target: 'ch1.xhtml', spineIndex: 0 });
    // No spineIndex: the row is still reachable, it just cannot be section-compared.
    expect(rows[1]).toEqual({ title: '坏条目', target: 'nope.xhtml' });
  });
});