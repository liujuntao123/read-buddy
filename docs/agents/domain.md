# Domain Docs

This repo uses a **single-context** domain documentation layout.

## Locations

- Glossary: `CONTEXT.md` at repository root
- Architectural Decision Records: `docs/adr/*.md`

## Consumer Rules

1. `CONTEXT.md` is strictly a glossary of ubiquitous language and domain concepts. It contains NO implementation details, ticket links, or temporary scratchpads.
2. An ADR is created only when a decision is:
   - **Hard to reverse** (meaningful cost to change later)
   - **Surprising without context** (future contributors would ask "why?")
   - **The result of a real trade-off** (evaluated genuine alternatives)
3. Any engineering agent must inspect `CONTEXT.md` before inventing new domain terms.
