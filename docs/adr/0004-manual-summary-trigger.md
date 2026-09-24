# ADR 0004: Explicit Reader-Triggered Chapter Summarization

## Status
Accepted

## Context
When readers navigate through books, they frequently skim pages, jump through tables of contents, or quickly scan multiple chapters. 

If chapter summarization triggers automatically on section changes:
- Dozens of unnecessary API calls and token charges are incurred during rapid navigation.
- The sidebar is overwhelmed with ongoing, soon-to-be-abandoned streaming requests.
- Rate limits on AI providers may be triggered unintentionally.

## Decision
We enforce a **Strictly Manual / Explicit Trigger** mechanism:
1. Navigating to a new node checks local IndexedDB cache first (`node_summaries`, ADR 0015).
2. If cached, the summary renders immediately.
3. If not cached, the sidebar presents an empty-state action card whose button is `总结当前{章|节|段}` — the level word comes from the node model (ADR 0010) — initiating AI generation only upon explicit user click.
4. An active generation can be cancelled via a 停止 button at any point, and the partial text is kept.
5. The same policy governs the whole-book companion index: the panorama and the micro-briefs never start on import (ADR 0002 ¶4).

## Consequences

### Positive
- **Token Economy**: Zero unexpected or runaway API expenditures during rapid page turning or skimming.
- **Predictable UX**: Readers control precisely when AI processing occurs.
- **Connection Stability**: No race conditions between consecutive fast chapter switches.

### Negative / Trade-offs
- Requires one additional click for users who want summaries on every single chapter.
