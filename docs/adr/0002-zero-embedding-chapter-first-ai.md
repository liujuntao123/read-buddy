# ADR 0002: Zero-Embedding Chapter-First Strategy Over Whole-Book RAG

## Status
Accepted

## Context
Upstream `readest` features an experimental AI assistant named Reedy, which indexes the entire book into local vector storage (Turso libSQL WASM + BM25 Tantivy). 

For long books (e.g. 500k+ Chinese characters or 800-page monographs), full-book indexing incurs severe user friction:
- Several minutes of preprocessing time and high CPU/Memory load.
- Mandatory embedding models and large API key token expenditures prior to any reading.
- Readers frequently only need an immediate overview of the *current chapter* they are reading.

## Decision
We adopt a **Zero-Embedding Chapter-First** architecture for `readest-plus`:
1. The AI Companion extracts raw plain text directly from the current active `Section` via the Foliate engine DOM/spine on demand.
2. Token consumption is localized exclusively to the active chapter (~2,000 to 8,000 tokens per summary).
3. Generated summaries are persisted locally in IndexedDB keyed by `${bookHash}:${sectionIndex}`.
4. Full RAG indexing is retained only as an optional advanced mode, not a prerequisite for chapter summarization or discussion.

## Consequences

### Positive
- **Zero Onboarding Friction**: Users open any book and immediately get chapter summaries with no pre-indexing wait time.
- **Provider Agnostic**: Operates with pure chat completion endpoints (OpenAI, DeepSeek, Ollama) without requiring vector embedding models.
- **Cost Reduction**: Minimal token expenditure per reading session.

### Negative / Trade-offs
- **Cross-Chapter Omniscience**: The model lacks awareness of distant previous chapters unless explicitly referenced or injected.
