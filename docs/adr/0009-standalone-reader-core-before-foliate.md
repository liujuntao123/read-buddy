# ADR 0009: Standalone Reader Core Before Foliate Integration

## Status
Accepted

## Context
Tickets 01–05 were scoped as AI-companion features premised on an inherited readest base (Foliate engine, book import, Tauri shell): spec 001's user stories begin at "As a reader opening a book…", and tickets reference `readerStore` and "Foliate spine" as existing. The repository contained no readest code — the dependency was assumed, never landed, and never ticketed. Implementation filled the reader seam with demo fixtures, shipped green against every ticket AC, and the product could not open a real book until ticket 06 added a standalone import/library/EPUB+TXT core.

## Decision
1. The reader core is built standalone in this repo (ticket 06: jszip EPUB spine, TXT with segmentation, IndexedDB library) behind the extractor/chapterSource/contentRegistry seams; Foliate-js pagination and the Tauri 2 shell arrive later as a renderer swap (ticket 07), not as a premise.
2. Process rule (recorded in `docs/agents/issue-tracker.md`): a spec premised on an external codebase carries a ticket that lands that base, referenced from `blocked_by`; every stub ships with an open debt ticket.

## Consequences
### Positive
- The AI pipeline was validated end-to-end on real books within one session of the gap being named (seams held: no rework in summary/chat/segmentation).
- The debt is now visible in the tracker instead of living in code comments.

### Negative / Trade-offs
- Scroll-per-section rendering, no CFI, no paginated layout, EPUB CSS fidelity reduced, MOBI/AZW3/FB2/PDF unsupported until Foliate lands (ticket 07).
- One session of implementation cost was spent on a throwaway demo path that ticket 06 then replaced at the seams.
