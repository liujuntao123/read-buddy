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
We adopt a **Zero-Embedding Chapter-First** architecture for `read-buddy`:
1. The AI Companion extracts raw plain text directly from the current active Book Node via the engine / the node model, on demand.
2. Token consumption is localized to the current node (~2,000 to 8,000 tokens per summary).
3. Generated summaries are persisted locally in IndexedDB keyed by `${bookHash}:${nodeIndex}` (a Node Summary id — ADR 0015).
4. **No embedding index exists anywhere in this app** — not even as an optional mode. Whole-Book awareness is bought differently: a model-free node index on every Book open, plus the reader-triggered panorama and micro-briefs (ADR 0004, ADR 0010), which is what the companion's system prompt is built from. See ADR 0005 and `docs/architecture.md`.

## Consequences

### Positive
- **Zero Onboarding Friction**: Users open any book and immediately get chapter summaries with no pre-indexing wait time.
- **Provider Agnostic**: Operates with pure chat completion endpoints (OpenAI, DeepSeek, Ollama) without requiring vector embedding models.
- **Cost Reduction**: Minimal token expenditure per reading session.

### Negative / Trade-offs
- **Cross-Chapter Omniscience**: without vectors, the model only knows distant chapters through the node outline, the panorama and its own tool calls — which is exactly why those exist (ADR 0004, ADR 0010).
