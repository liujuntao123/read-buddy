# ADR 0007: One floating toolbar for both a selection and a highlight

## Status
Accepted

## Context
When a reader highlights text in the reader viewport, two interaction approaches exist for AI actions (Explain, Translate, Ask, Summarize):
1. **Two overlays**: the reader's own mark toolbar plus a separately spawned AI floating menu, leading to visual clutter, overlay collisions, and double-popup flickers.
2. **One toolbar with two roles**: a single floating toolbar whose subject is whatever the reader has marked — a live selection or a clicked highlight — with the mark's own action (划线 / 取消划线) first and the AI actions beside it.

## Decision
We choose **one toolbar, two roles**:
- `components/reader/SelectionToolbar` is the only floating toolbar; the reader panes render it for both a live selection and a clicked highlight, positioned from the mark's own rectangle.
- AI actions open or focus the AI Companion sidebar; 追问 pre-fills the composer with the quote **without** sending it.
- It dismisses on a click outside or Escape, and is available identically in the scroll reader and inside the engine's chapter iframe — one set of capture rules (`services/reader/selectionCapture`).

_Note (2026-09): the original draft of this ADR said the AI actions were appended to "the native Foliate/Readest annotator toolbar". No such upstream toolbar exists in this repo — the toolbar was written here. The decision that survives is 「exactly one toolbar」, not the mechanism._

## Consequences

### Positive
- **Visual Cleanliness**: Exactly one unified floating toolbar appears on text selection, and clicking a highlight reuses it instead of adding a second control.
- **Natural Ergonomics**: Follows existing reading muscle memory without introducing floating overlay overlap.

### Negative / Trade-offs
- The toolbar is one component serving two subjects, so its state (a live selection vs. a persisted mark) has to be modelled explicitly rather than assumed.
- It must be re-rendered per chapter document inside the engine's iframe, so the capture rules live in `services/reader/selectionCapture` and both panes consume the same ones.
