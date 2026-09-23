# ADR 0018: A reader highlight is a quote, not an offset

## Status
Accepted

## Context
1. **划线 is a mark that outlives the document it was made in.** The engine throws a chapter's document away on every chapter change (`vendor/foliate-js/paginator.js` recreates the view and loads the section again) and the scroll reader re-renders its article whenever the reader changes typography. Anything that identifies a highlight by a DOM node, a `Range` or a DOM offset is therefore dead the moment the reader turns a page.
2. **Three identification schemes were available.** (a) A **CFI**, which foliate can compute for the *current viewport* (`view.getCFI(index, range)` on relocate) but exposes to nobody — and whose failure mode is worse than useless: `goToCfi` falls back to `goToFraction(0)`, i.e. a jump to the front of the book. (b) A **character offset** in the node model's global text space, which is exact but lives in a different space from the rendered DOM: the sanitizer removes markup and the extractor normalizes whitespace, so an offset computed on one side does not point at the same character on the other. (c) A **text anchor** — the quote plus a short prefix/suffix — which is what both sides actually agree on.
3. **Foliate ships an annotation overlay** (`overlayer.js` + `view.addAnnotation`), but reaching it means widening `FoliateEngineHandle` with annotation members — which **ADR 0012 forbids as optional members** — plus coping with its ordering hazard (the overlay is attached *after* the `load` event the pane receives) and its per-rect snapshots that need `redraw()`. It buys nothing this feature needs: the marks are text, and CSS styles text.
4. **The scroll reader's paragraphs were React's own text nodes** (`<p>{line}</p>`). Wrapping such a node in `<mark>` detaches it from what React believes it owns, so the next re-render writes the *new* line into the *old* node inside the mark — corrupting the paragraph. The agent's transient cue survived this only because it clears itself after two seconds.

## Decision
1. **A highlight is stored as identity + text anchor**: the Book Node ordinal and title, the physical section, and `quote` + `prefix` + `suffix` (`types/highlight.ts`). No DOM offset, no Range, no CFI is persisted.
2. **Matching ignores whitespace on both sides** (`services/reader/textMarks`). `Selection.toString()` inserts a block separator where the concatenated text nodes have none, so a cross-paragraph selection is the common case, not an edge case.
3. **The live Range is used at creation time, then discarded.** `readSelection` keeps the range it already computes, and the anchor's prefix/suffix are read from that exact occurrence — which is the only way to know *which* of two identical sentences the reader marked. Each highlight then consumes the occurrence it matched, so a third twin does not steal the first one's mark.
4. **One DOM primitive, two consumers.** `textMarks` owns the text-node walk, quote search and `<mark>` wrapping; the agent's breathing cue and the reader's persistent marks are two thin policies over it (their own class, CSS and lifetime). The cue clears only its own class, so the two coexist.
5. **Marks are painted onto HTML the renderer does not diff.** The scroll article renders its paragraphs as an escaped HTML string (as the demo fixture always did), and the engine's chapter documents are not React's at all. A mark is repainted on every document load and on every store change, and repaint is idempotent (unwrap, then wrap).
6. **A jump carries the physical section.** `LocateRequest` gained `spineIndex` and `anchor`, so a highlight click goes straight to its chapter — no node lookup, no spine scan for an un-indexed book — and the breathing cue lands on the right twin.
7. **The 划线 tab publishes a locate request** through the shared reader link bus, the same seam a citation card uses; it does not drive the engine itself.

## Consequences
### Positive
- A mark survives chapter changes, section switches, typography changes, theme changes and restarts, because none of those change the book's text.
- One code path paints both surfaces (host article and chapter iframe) — no engine interface growth, no overlay lifecycle, no CFI.
- The React hazard is closed by construction rather than by timing, and two tests pin it: a font-size change must leave the article's text intact, a paragraph-spacing change must repaint the mark.
- Two identical sentences in one chapter are handled: the anchor chooses, and each row consumes its own occurrence.

### Negative / Trade-offs
- **The anchor can drift.** If a future pipeline re-typesets or rewrites a chapter's text, the quote may no longer be found and the mark is reported `missing` rather than mis-placed (the row stays in the list, with its location, so nothing is silently lost).
- Whitespace-insensitive matching is a deliberate approximation: two sentences differing only in spacing are the same mark.
- An index or a listing can look like a table of contents to the *node-content* rule (ADR 0017) — unrelated but adjacent — and, symmetrically, a highlight made on a page whose text is later truncated by the sanitizer may not repaint.
- A highlight is not a CFI, so it does not participate in foliate's own annotation/navigation machinery (search results, media overlays). Nothing in the product needs that yet.
