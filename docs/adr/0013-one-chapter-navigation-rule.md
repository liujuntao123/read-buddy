# ADR 0013: One chapter-navigation rule, two adapters

## Status
Accepted

## Context
1. **「下一章」 was decided twice.** The engine walked its flattened Directory with `nextChapter`/`prevChapter` (57 lines) plus a three-step `getTocIndex` ladder (exact href → first row at this section → last row at or before it). The reader dock re-implemented stepping from TOC-row adjacency, with its own shadowing copy of the same ladder and its own `prevToc`/`nextToc` arithmetic.
2. **The two rules disagreed, and the disagreement landed on one button.** The dock's rule produced the button's **disabled state**; the engine's rule produced the click's **effect**. A button could therefore be enabled and do nothing, or disabled while a step existed.
3. **The engine's rule could not reach anchored 节.** Its comparison used physical sections (`sIndex > currSec`) plus an href *file* comparison (`item.href.startsWith(currHref.split('#')[0])`). Two directory entries pointing into the **same file** at different anchors are the same section *and* the same file, so neither test fired: 《何为良好生活》 — 11 spine files, 70 节 — was un-navigable 节 by 节 even though its Directory listed every one of them. That is exactly the book ADR 0010 exists for.
4. **Two suites kept the shared case table in sync by hand** (`ReaderDock.test.tsx` and `foliateEngine.test.ts`), and could pass while disagreeing.

## Decision
1. **One module owns the rule** (`services/reader/chapterNavigation`), with a two-method interface: `step(direction)` and `canStep(direction)`. Both are answered by the same `find…` function, so a disabled button and a no-op click are the same fact rather than two derivations.
2. **The rule is: move in document order, skipping rows that point at where the reader already is.** Comparing **targets** (not sections, not href files) is what makes both shapes of Directory work:
   - a row repeating the current target (`第二章` and `卷二` both point at `ch2.xhtml`) is skipped, because stepping onto it would move nothing;
   - a row that merely shares the *file* (`ch1.xhtml#s1` → `ch1.xhtml#s2`) is a real move, because its target differs.
   A section-based comparison called both cases "the same place" — that was defect 3.
3. **Two adapters, one algorithm.** The engine navigates by Directory href; a segmented TXT book navigates by virtual-section ordinal. That difference lives in the rows' `target` and in `goTo`, never in the rule.
4. **The current-row ladder lives here too**, as `resolveCurrentEntryIndex`, replacing the engine's and the dock's copies.
5. **The engine re-exposes no stepping.** `nextChapter` / `prevChapter` / `getTocIndex` / `tocItems` were deleted: an engine-side second way to step is how the two rules drifted apart. The dock drives the module with the engine's `tocEntries()` + `currentLocation()` + `goTo()` as its adapter.

## Consequences
### Positive
- The button's enabled state and its effect cannot disagree.
- Anchored 节 are navigable: the books ADR 0010 was written for can be stepped 节 by 节.
- One case table (flat NCX, anchored 节, directory coarser than the spine, end of book, directory finer than the spine) is written once and both adapters are driven through it.
- Three duplicate implementations collapsed into one: two stepping algorithms and two current-row ladders.

### Negative / Trade-offs
- The module takes rows, position and `goTo` as arguments rather than reading a store or the engine, so each caller assembles an adapter. That is deliberate (it is what makes the rule testable with plain values) but it does mean the dock now maps its rendered rows into `NavEntry[]` — the popover list and the navigation list are the same rows by construction, which is a benefit, but the mapping is a line of code that did not exist before.
- `NavEntry.spineIndex` is optional: a Directory entry that never resolved onto the spine is still navigable by its target, it just cannot take part in section comparisons. The fallback path ("advance one section") may therefore step by ordinal where a Directory row exists but is unresolvable — the honest behaviour, since the reader can still reach the text.