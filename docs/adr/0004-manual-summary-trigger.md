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
1. Navigating to a new section checks local IndexedDB cache first.
2. If cached, the summary renders immediately.
3. If not cached, the sidebar presents an empty-state action card: `“生成本章总结” (Generate Summary for this Chapter)`, initiating AI generation only upon explicit user click.
4. An active generation can be cancelled via an Abort button at any point.

## Consequences

### Positive
- **Token Economy**: Zero unexpected or runaway API expenditures during rapid page turning or skimming.
- **Predictable UX**: Readers control precisely when AI processing occurs.
- **Connection Stability**: No race conditions between consecutive fast chapter switches.

### Negative / Trade-offs
- Requires one additional click for users who want summaries on every single chapter.
