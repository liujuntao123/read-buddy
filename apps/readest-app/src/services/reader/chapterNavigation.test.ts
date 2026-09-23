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

  it('prefers the anchored 节 over the 章 row that names the same file', () => {
    // 《说理》 shape: the plain-file href means "inside the file's first anchored
    // node", whose row precedes the 章 row in nothing but document order.
    const rows: NavEntry[] = [
      { title: '第2章', target: 'ch2.xhtml', spineIndex: 1 },
      { title: '§2.1', target: 'ch2.xhtml#a', spineIndex: 1 },
    ];
    // Anchor reported: the anchored row is the position.
    expect(resolveCurrentEntryIndex(rows, { spineIndex: 1, href: 'ch2.xhtml#a' })).toBe(1);
    // Plain file reported: still the anchored row, not the 章 row at index 0.
    expect(resolveCurrentEntryIndex(rows, { spineIndex: 1, href: 'ch2.xhtml' })).toBe(1);
    // No anchored sibling: the plain-file row is the position (unchanged).
    expect(
      resolveCurrentEntryIndex([rows[0]!], { spineIndex: 1, href: 'ch2.xhtml' }),
    ).toBe(0);
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

/**
 * 《说理》(陈嘉映) — the book that exposed defect 3.
 *
 * Its NCX names each chapter's file twice: the 章 row without an anchor and its
 * first 节 with one (`第2章 → part0043.xhtml`, `§2.1 → part0043.xhtml#id_1`). The
 * two hrefs are different strings but the same *place* — the 章 row starts where
 * the 节 row starts — and the vendored engine reports either of them depending on
 * whether the viewport has passed the heading. Before this table existed, 「上一节」
 * at the first 节 of every chapter stepped onto the 章 row, re-rendered the page it
 * was already on, and looked dead; 「下一节」 mirrored it by jumping backwards onto
 * the heading just passed.
 */
describe('one file named twice: 章 row + its first 节 row (《说理》 shape)', () => {
  const SHUOLI: NavEntry[] = [
    { title: '序言', target: 'part0003.xhtml', spineIndex: 3 },
    { title: '第1章 哲学之为穷理', target: 'part0004.xhtml', spineIndex: 4 },
    { title: '§1.1 哲学是什么', target: 'part0004.xhtml#id_1', spineIndex: 4 },
    { title: '§1.2 好道与说理', target: 'part0005.xhtml#id_2', spineIndex: 5 },
    { title: '第2章 哲学为什么关注语言？', target: 'part0043.xhtml', spineIndex: 43 },
    { title: '§2.1 语言转向', target: 'part0043.xhtml#id_3', spineIndex: 43 },
    { title: '§2.2 语言或概念 vs. 事质', target: 'part0044.xhtml#id_4', spineIndex: 44 },
  ];

  it('「上一节」 from the first 节 of a chapter reaches the previous chapter’s last 节 — not its own 章 row', async () => {
    // The engine reports the anchor the viewport sits at or just before …
    const anchored = navigatorAt(SHUOLI, { spineIndex: 43, href: 'part0043.xhtml#id_3' }, 219);
    expect(anchored.navigator.canStep('prev')).toBe(true);
    await expect(anchored.navigator.step('prev')).resolves.toMatchObject({
      title: '§1.2 好道与说理',
      target: 'part0005.xhtml#id_2',
    });
    expect(anchored.steps).toEqual(['part0005.xhtml#id_2']);

    // … and a plain file href once the viewport has passed the heading. A plain
    // file means "inside the first anchored node of that file", so the 章 row is
    // behind the reader here too (this is the exact reported symptom).
    const plain = navigatorAt(SHUOLI, { spineIndex: 43, href: 'part0043.xhtml' }, 219);
    expect(plain.navigator.canStep('prev')).toBe(true);
    await expect(plain.navigator.step('prev')).resolves.toMatchObject({
      target: 'part0005.xhtml#id_2',
    });
  });

  it('「下一节」 never steps backwards onto the heading just passed', async () => {
    // Reported as the plain file: the reader is already inside §2.1, so next must
    // move forward to §2.2 rather than re-entering part0043.xhtml#id_3.
    const plain = navigatorAt(SHUOLI, { spineIndex: 43, href: 'part0043.xhtml' }, 219);
    await expect(plain.navigator.step('next')).resolves.toMatchObject({
      title: '§2.2 语言或概念 vs. 事质',
      target: 'part0044.xhtml#id_4',
    });
    expect(plain.steps).toEqual(['part0044.xhtml#id_4']);

    // Reported as the anchor: §2.1 is where the reader is, so next skips it too.
    const anchored = navigatorAt(SHUOLI, { spineIndex: 43, href: 'part0043.xhtml#id_3' }, 219);
    await expect(anchored.navigator.step('next')).resolves.toMatchObject({
      target: 'part0044.xhtml#id_4',
    });
  });

  it('still steps from a plain 章 row onto its first 节 when there is no anchor to report', () => {
    // A 章 row whose file the reader is at with no anchored sibling yet: the row
    // itself is the place, so the ladder must not invent an anchor for it.
    const separateFiles: NavEntry[] = [
      { title: '第1章', target: 'ch1.xhtml', spineIndex: 0 },
      { title: '第2章', target: 'ch2.xhtml', spineIndex: 1 },
    ];
    const { navigator } = navigatorAt(separateFiles, { spineIndex: 0, href: 'ch1.xhtml' }, 2);
    expect(resolveCurrentEntryIndex(separateFiles, { spineIndex: 0, href: 'ch1.xhtml' })).toBe(0);
    expect(navigator.canStep('prev')).toBe(false);
  });

  it('does not send a reader in front of the whole directory to the end of the book', async () => {
    // `from === -1` (the position precedes every row) used to start the backward
    // loop at the LAST row — a jump to the end of the book from its front.
    const later: NavEntry[] = [{ title: '第三章', target: 'ch3.xhtml', spineIndex: 7 }];
    const { navigator, steps } = navigatorAt(later, { spineIndex: 2 }, 20);
    expect(navigator.canStep('prev')).toBe(true);
    // The honest answer is the section fallback (2 - 1), not row 0 of the book.
    await expect(navigator.step('prev')).resolves.toMatchObject({ target: 1, spineIndex: 1 });
    expect(steps).toEqual([1]);
  });
});