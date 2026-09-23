# ADR 0012: The reader engine handle has no optional members

## Status
Accepted

## Context
1. **The handle grew by accretion.** `FoliateEngineHandle` reached **28 members, 8 of them optional** — lifecycle, page turns, chapter navigation, the Directory, the text cache, presentation, events, cover. The optionals existed because the *vendored* `vendor/foliate-js/view.js` cannot promise to expose a given setter, so the uncertainty was expressed as `setTheme?:`, `setLayout?:`, `setTypography?:`, `setPageMode?:`, `getTocIndex?:`, `nextChapter?`, `prevChapter?`, `getCover?`.
2. **The uncertainty was pushed onto callers.** Each optional became a probe at every call site: `engine?.setTypography?.(…)` in three separate effects in the pane, `if (currentEngine.getTocIndex)`, `if (currentEngine?.prevChapter)`, `if (!book.cover && engine.getCover)`. Three callers independently re-asked "can this engine do X?".
3. **It was measurable in the test surface.** Both engine-consuming suites hand-rolled a ~55-line fake that had to stub all 28 members to exercise the handful their caller used, and one had to escape the interface with `as unknown as FoliateEngineHandle & { __relocators: … }`.
4. **Some members were probing the wrong thing.** `getCover?` asked whether the *method* exists, when the real question is whether the *book* has a cover. `setPageMode?` had no production caller at all (the dock writes to the settings store; the pane applies the resulting layout).
5. **Performance-wise the optionals were duplicated:** presentation applied from three effects meant three render passes and transient states where the theme had changed but the typography had not.

## Decision
1. **Presentation becomes one required operation.** `applyPresentation(patch)` takes `{ theme, layout?, typographyCss? }` and replaces `setTheme` / `setPageMode` / `setLayout` / `setTypography`. The engine owns which halves need re-applying, and applies styles before layout because a page-mode flip changes the geometry the column rules act on.
2. **Whether the vendored view can honour a knob is the engine's problem, not the caller's.** `PresentationDiagnostics` reports per knob whether it went through the element setter (`viaElement`), the renderer-attribute fallback (`viaRendererFallback`), or neither (`unsupported`). A Foliate bump that renames `setMaxInlineSize` now produces a reportable state instead of a silent no-op.
3. **Vendor access is declared once.** A single `FoliateVendorView` structural interface (all members optional, because the vendor is not ours) replaces the per-call-site `as unknown as { … }` casts; one `vendor()` accessor is the only cast.
4. **Facts about the book are required members.** `getCover()` returns `Promise<string | undefined>`: no cover for this book is `undefined`, not the absence of a method.
5. **Dead members are deleted, not kept optional.** `nextChapter` / `prevChapter` / `getTocIndex` / `tocItems` had no production callers left after ADR-0013's navigation module; a second way to step is how the two rules drifted apart to begin with.
6. **Result: 21 members, zero optional.**

## Consequences
### Positive
- Callers stop probing: the pane applies presentation in one effect instead of three, and no call site asks whether a method exists.
- A capability gap in the vendored engine is observable (`unsupported`) rather than silent, and the report clears when the route returns rather than accumulating.
- `bookLibrary`'s lazy cover path reads as a fact about the book (`if (!book.cover)`), not a capability test.
- The interface is honest about what the engine always promises, so a future four-way split (viewport / position / directory / text) can be argued on cohesion alone rather than on which members happen to be optional.

### Negative / Trade-offs
- `applyPresentation` is a coarser-grained call than four setters: a caller that wants to change only the theme must still name `theme` (the other fields are optional, so it is one field, not four). In exchange, a settings change can no longer leave the engine in a half-applied state.
- The engine keeps internal presentation state (`currentTheme`, `typographyCss`, `layout`) and diffs the patch against it, so a caller cannot force a redundant re-apply. That is deliberate — the paginator's `setStyles` replaces its stylesheet wholesale — but it does mean `applyPresentation` is not a pure pass-through.
- Making `getCover` required changed test doubles that deliberately omitted it; the omission was itself the thing being tested, which is precisely the probing this ADR removes.